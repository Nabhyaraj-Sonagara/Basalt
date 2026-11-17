// Makes sure Electron's binary is downloaded. Since Electron 45 the npm package no longer
// downloads it during install, but electron-vite (npm run dev) expects it to be there and
// fails with "Electron uninstall" otherwise. Runs after npm install and before dev/build/package.
// Set ELECTRON_SKIP_BINARY_DOWNLOAD=1 to skip (for example when only building the sync server).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) process.exit(0);
const require = createRequire(import.meta.url);
let pkgDir;
try {
  pkgDir = dirname(require.resolve('electron/package.json'));
} catch {
  process.exit(0); // not installed (yet); check-setup.mjs explains what to do
}
if (existsSync(join(pkgDir, 'path.txt'))) process.exit(0);
console.log('Downloading Electron (about 100 MB, once)…');
const res = spawnSync(process.execPath, [join(pkgDir, 'install.js')], { stdio: 'inherit' });
if (res.status !== 0) {
  console.error(
    '\nCouldn\'t download Electron. Check your connection (or set ELECTRON_MIRROR, see the README), then run:\n\n  npx install-electron\n',
  );
  process.exit(res.status ?? 1);
}
