'use strict';
// rimraf v2's API (rimraf(path, [opts], cb) and rimraf.sync(path, [opts])) on top of fs.rm,
// for the one caller that still needs it (temp, via electron-winstaller).
const fs = require('node:fs');

const rmOptions = (opts) => ({ recursive: true, force: true, maxRetries: (opts && opts.maxBusyTries) || 3 });

function rimraf(path, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }
  fs.rm(path, rmOptions(opts), (err) => cb && cb(err || null));
}

rimraf.sync = function sync(path, opts) {
  fs.rmSync(path, rmOptions(opts));
};

module.exports = rimraf;
