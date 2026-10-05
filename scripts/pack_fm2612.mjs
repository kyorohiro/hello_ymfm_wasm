import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [join(root, 'scripts/build_fm2612_package.mjs')], {cwd: root, stdio: 'inherit'});
execFileSync('npm', ['pack', '--pack-destination', root, ...process.argv.slice(2)], {
  cwd: join(root, 'dist/fm2612'), stdio: 'inherit',
});
