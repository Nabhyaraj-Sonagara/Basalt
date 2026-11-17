// Assembles the download site into site-dist/: the page, the design-system tokens and fonts,
// the logos and the app screenshots. GitHub Pages publishes site-dist/ (see .github/workflows/pages.yml).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'site-dist');
const generated = join(root, 'packages/ui/src/generated');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'site'), out, { recursive: true });
cpSync(join(generated, 'tokens.css'), join(out, 'tokens.css'));
cpSync(join(generated, 'fonts'), join(out, 'fonts'), { recursive: true });
cpSync(join(root, 'design-system/project/assets/Logos'), join(out, 'assets'), { recursive: true });
cpSync(join(root, 'docs/screenshots'), join(out, 'screenshots'), { recursive: true });
console.log(`Built the site in ${out}`);
