'use strict';
// Replacement for the deprecated lodash.isequal. electron-updater compares plain JSON
// update metadata with it, which isDeepStrictEqual handles the same way.
const { isDeepStrictEqual } = require('node:util');

module.exports = function isEqual(a, b) {
  return isDeepStrictEqual(a, b);
};
