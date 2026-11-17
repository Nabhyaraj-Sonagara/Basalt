# Dependency shims

Two packages deep in Electron's tooling are deprecated, and the latest upstream releases still depend on them. Instead of carrying deprecated code, root `package.json` `overrides` swap them for these small replacements built on Node's standard library. Each one matches the API its only caller uses.

| Shim | Replaces | Used by | Why |
|---|---|---|---|
| `lodash.isequal` | `lodash.isequal@4.5.0` | `electron-updater` (compares update metadata) | npm deprecated it, and its notice says to use `util.isDeepStrictEqual` |
| `rimraf-v2` | `rimraf@2.6.3` | `temp` ← `electron-winstaller` (Squirrel.Windows; Basalt builds NSIS installers) | rimraf below v4 is unsupported; this keeps the v2 callback and `.sync` API on top of `fs.rm` |

Remove a shim once its caller stops depending on the deprecated package.
