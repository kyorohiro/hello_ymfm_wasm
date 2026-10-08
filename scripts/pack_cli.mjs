// Build and pack only the VGM distribution; FM2612 remains in dist/fm2612/.
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [join(root, 'scripts/build_cli_chip_list.mjs')], {cwd: root, stdio: ['ignore', 2, 2]});
execFileSync(process.execPath, [join(root, 'scripts/build_cli.mjs')], {cwd: root, stdio: ['ignore', 2, 2]});
execFileSync('npm', ['pack', '--pack-destination', root, ...process.argv.slice(2)], {
  cwd: join(root, 'dist/vgm'), stdio: 'inherit',
});
