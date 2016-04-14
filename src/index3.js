 /**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

const path = require('path');
const HasteMap = require('../lib').default;

const useWatchman = process.argv.indexOf('-n') === -1;
console.log(`use ${useWatchman ? 'watchman' : 'node'}.`);

const map = new HasteMap({
  extensions: ['js', 'json'],
  ignore: () => false,
  platforms: [],
  resetCache: process.argv.indexOf('-c') !== -1,
  nodeModulesWhitelist: /node_modules\/react-native\//,
  roots: [path.resolve(process.cwd(), process.argv[2])],
  useWatchman,
});
console.time('build');
map.build()
  .then(data => {
    console.timeEnd('build');
    if (process.argv.indexOf('-s') === -1) {
      console.log(data);
    }
  })
  .catch(e => console.log(e, e.stack))
  .then(() => process.exit());
