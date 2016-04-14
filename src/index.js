 /**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */
'use strict';

import Cache from './Cache';

import denodeify from 'denodeify';
import docblock from './lib/docblock';
import fs from 'graceful-fs';
import getPlatformExtension from './lib/getPlatformExtension';
import nodeCrawl from './crawlers/node';
import os from 'os';
import path from './fastpath';
import watchmanCrawl from './crawlers/watchman';
import {execSync} from 'child_process';

const GENERIC_PLATFORM = 'generic';
const NODE_MODULES = path.sep + 'node_modules' + path.sep;
const PACKAGE_JSON = path.sep + 'package.json';
const VERSION = require('../package.json').version;

const readFile = denodeify(fs.readFile);
const writeFile = denodeify(fs.writeFile);

const canUseWatchman = (() => {
  try {
    execSync('watchman version', {stdio: 'ignore'});
    return true;
  } catch (e) {}
  return false;
})();

export default class HasteMap {

  constructor({
    extensions,
    ignore,
    nodeModulesWhitelist,
    platforms,
    resetCache,
    roots,
    useWatchman,
  }) {
    this.options = {
      extensions,
      ignore,
      platforms,
      nodeModulesWhitelist: nodeModulesWhitelist || {test: () => false},
      resetCache,
      roots,
      useWatchman: useWatchman === undefined ? true : useWatchman,
    };

    this._buildPromise = null;
    this._cachePath = Cache.getCacheFilePath(
      os.tmpDir(),
      VERSION,
      roots.join(':'),
      extensions.join(':'),
      platforms.join(':'),
    );
  }

  build() {
    if (!this._buildPromise) {
      this._buildPromise = this._buildFileMap()
        .then(data => this._buildHasteMap(data))
        .then(data => this._persist(data));
    }
    return this._buildPromise;
  }

  matchFiles(pattern) {
    return this.build().then(data => {
      const files = [];
      for (const file in data.files) {
        if (pattern.test(file)) {
          files.push(file);
        }
      }
      return files;
    });
  }

  _buildFileMap() {
    const dataPromise = this.options.resetCache
      ? Promise.resolve(this._createEmptyMap())
      : readFile(this._cachePath, 'utf-8').then(data => this._parse(data));

    return dataPromise
      .catch(() => this._createEmptyMap())
      .then(data => this._crawl(data));
  }

  _buildHasteMap(data) {
    const map = Object.create(null);
    const setModule = module => {
      if (!map[module.id]) {
        map[module.id] = Object.create(null);
      }
      const moduleMap = map[module.id];
      const platform = getPlatformExtension(module.path) || GENERIC_PLATFORM;
      const existingModule = moduleMap[platform];
      if (existingModule && existingModule.path !== module.path) {
        console.warn(
          `@providesModule naming collision:\n` +
          `  Duplicate module name: ${module.id}\n` +
          `  Paths: ${module.path} collides with ${existingModule.path}\n\n` +
          `This warning is caused by a @providesModule declaration ` +
          `with the same name accross two different files.`
        );
      }

      const fileData = data.files[module.path];
      fileData.id = module.id;
      moduleMap[platform] = module;
    };

    const promises = [];
    for (const filePath in data.files) {
      if (!this._isNodeModulesDir(filePath)) {
        const fileData = data.files[filePath];
        const moduleData = data.map[fileData.id];
        if (fileData.visited) {
          if (!fileData.id) {
            continue;
          } else if (fileData.id && moduleData) {
            map[fileData.id] = moduleData;
            continue;
          }
        }

        fileData.visited = true;
        if (filePath.endsWith(PACKAGE_JSON)) {
          promises.push(this._processHastePackage(filePath, setModule));
        } else {
          promises.push(this._processHasteModule(filePath, setModule));
        }
      }
    }

    return Promise.all(promises).then(() => {
      data.map = map;
      return data;
    });
  }

  _parse(data) {
    data = JSON.parse(data);
    Object.setPrototypeOf(data.clocks, null);
    Object.setPrototypeOf(data.files, null);
    Object.setPrototypeOf(data.map, null);
    return data;
  }

  _persist(data) {
    return writeFile(this._cachePath, JSON.stringify(data))
      .then(() => data);
  }

  _crawl(data) {
    const crawl =
      (canUseWatchman && this.options.useWatchman) ? watchmanCrawl : nodeCrawl;

    return crawl(
      this.options.roots,
      this.options.extensions,
      this.options.ignore,
      data
    );
  }

  _isNodeModulesDir(filePath) {
    if (filePath.indexOf(NODE_MODULES)) {
      return false;
    }

    return !this.nodeModulesWhitelist.test(filePath);
  }

  _createEmptyMap() {
    return {
      clocks: Object.create(null),
      files: Object.create(null),
      map: Object.create(null),
    };
  }

  _processHastePackage(filePath, setModule) {
    return readFile(filePath, 'utf-8')
      .then(data => {
        data = JSON.parse(data);
        if (data.name) {
          setModule({
            id: data.name,
            path: filePath,
            type: 'package',
          });
        }
      });
  }

  _processHasteModule(filePath, setModule) {
    return readFile(filePath, 'utf-8')
      .then(data => {
        const doc = docblock.parseAsObject(data);
        const id = doc.providesModule || doc.provides;

        if (id) {
          setModule({
            id,
            path: filePath,
            type: 'module',
          });
        }
      });
  }

}
