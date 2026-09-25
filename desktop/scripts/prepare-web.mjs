// Copies Expo's web build (dist-web/ at the repo root) into desktop/web and keeps the desktop
// app's version in step with app.json. Run by `npm run desktop:web` from the repo root.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktop, '..');
const built = join(root, 'dist-web');
if (!existsSync(join(built, 'index.html'))) {
  console.error('No web build in dist-web/. Run `npx expo export -p web --output-dir dist-web` first.');
  process.exit(1);
}
rmSync(join(desktop, 'web'), { recursive: true, force: true });
cpSync(built, join(desktop, 'web'), { recursive: true });

const version = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo.version;
const pkgPath = join(desktop, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (pkg.version !== version) {
  pkg.version = version;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}
console.log(`desktop/web ready (ArkStore ${version})`);
