 /**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

'use strict';

import denodeify from 'denodeify';
import path from '../fastpath';
import watchman from 'fb-watchman';

const watchmanURL = 'https://facebook.github.io/watchman/docs/troubleshooting.html';

function isDescendant(root, child) {
  return child.startsWith(root);
}

function WatchmanError(error) {
  return new Error(
    `Watchman error: ${error.message.trim()}. Make sure watchman ` +
    `is running for this project. See ${watchmanURL}.`
  );
}

export default function watchmanCrawl(roots, extensions, ignore, data) {
  const files = data.files;
  const clocks = data.clocks;

  const client = new watchman.Client();
  const cmd = denodeify(client.command.bind(client));
  return Promise.all(roots.map(root => cmd(['watch-project', root])))
    .then(responses => {
      const watchmanRoots = Array.from(
        new Set(responses.map(response => response.watch))
      );
      return Promise.all(watchmanRoots.map(root => {
        // Build up an expression to filter the output by the relevant roots.
        const dirExpr = ['anyof'];
        roots.forEach(subRoot => {
          if (isDescendant(root, subRoot)) {
            dirExpr.push(['dirname', path.relative(root, subRoot)]);
          }
        });

        const query = {
          expression: [
            'allof',
            ['type', 'f'],
            dirExpr,
            ['suffix', ...extensions],
          ],
          fields: ['name', 'exists', 'mtime_ms'],
        };

        if (clocks[root]) {
          // Use the `since` generator if we have a clock available
          query.since = clocks[root];
        } else {
          // Otherwise use the `suffix` generator
          query.suffix = extensions;
        }

        return cmd(['query', root, query]).then(response => {
          if ('warning' in response) {
            console.warn('watchman warning: ', response.warning);
          }

          clocks[root] = response.clock;
          response.files.forEach(({name, exists, mtime_ms}) => {
            name = root + path.sep + name;
            if (!exists) {
              console.log('remove', name);
              delete files[name];
            } else if (!ignore(name)) {
              console.log('add', name);
              const mtime = mtime_ms.toNumber();
              const isNew = !files[name] || files[name].mtime !== mtime;
              if (isNew) {
                files[name] = {
                  id: null,
                  mtime,
                  visited: false,
                };
              }
            }
          });
        });
      }));
    })
    .then(() => data)
    .catch(error => {
      throw WatchmanError(error);
    });
}
