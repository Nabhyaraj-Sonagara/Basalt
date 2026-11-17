// Sets one version across every package and tags it: npm run release -- 0.2.0
// Then push the commit and the tag (git push && git push origin v0.2.0); the Release workflow
// builds the installers and publishes the GitHub Release.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: npm run release -- <version>, for example npm run release -- 0.2.0');
  process.exit(1);
}
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) {
  console.error('Commit or stash your changes first.');
  process.exit(1);
}

// Every workspace listed in the root package.json (packages/*, apps/*).
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifests = ['package.json'];
for (const pattern of rootPkg.workspaces) {
  const dir = pattern.replace(/\/\*$/, '');
  for (const name of readdirSync(join(root, dir)).sort()) {
    const m = `${dir}/${name}/package.json`;
    if (existsSync(join(root, m))) manifests.push(m);
  }
}
const names = manifests.map((m) => JSON.parse(readFileSync(join(root, m), 'utf8')).name);
for (const m of manifests) {
  const path = join(root, m);
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  pkg.version = version;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const dep of Object.keys(pkg[field] ?? {})) if (names.includes(dep)) pkg[field][dep] = version;
  }
  writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
}
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
git('add', ...manifests, 'package-lock.json');
git('commit', '-m', `Release v${version}`);
git('tag', '-a', `v${version}`, '-m', `Basalt ${version}`);
console.log(`\nTagged v${version}. Publish it with:\n\n  git push && git push origin v${version}\n`);
