// Fails fast, with the fix spelled out, when Node is too old or dependencies aren't installed.
// Runs before `dev`, `build` and `package`. Uses only Node built-ins so it works before `npm install`.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const [major, minor] = process.versions.node.split('.').map(Number);
const nodeOk = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22;
if (!nodeOk) {
  problems.push(
    `Basalt needs Node 20.19+ or 22.12+ (you have ${process.versions.node}).\n` +
      '    Install Node 22 LTS, e.g. `nvm install 22 && nvm use 22` or `brew install node@22`,\n' +
      '    then run `npm install` again from the repository root.',
  );
}

const bin = (name) => join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const missing = ['electron-vite', 'electron-builder', 'vitest'].filter((n) => !existsSync(bin(n)));
if (missing.length) {
  problems.push(
    `Dependencies aren't installed (missing: ${missing.join(', ')}).\n` +
      `    Run \`npm install\` from the repository root (${root}).\n` +
      '    One install covers every package and the desktop app. If it failed part-way,\n' +
      '    delete node_modules and run `npm ci`, and check the first error it prints.',
  );
}

if (problems.length) {
  console.error('\nBasalt setup check failed:\n');
  for (const p of problems) console.error(`  • ${p}\n`);
  process.exit(1);
}
