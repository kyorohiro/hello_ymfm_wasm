// Assemble npm documentation separately from the repository README.
import { mkdtemp, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [join(root, 'scripts/build_cli.mjs')], {cwd: root, stdio: ['ignore', 'inherit', 'inherit']});
const stage = await mkdtemp(join(tmpdir(), 'tetorica-npm-stage-'));
try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  // Repository lifecycle scripts are not available or needed in the package.
  delete pkg.scripts;
  await writeFile(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  for (const file of ['dist', 'CLI.md', 'LICENSE']) await cp(join(root, file), join(stage, file), {recursive: true});
  await cp(join(root, 'cli/README.md'), join(stage, 'README.md'));
  execFileSync('npm', ['pack', '--pack-destination', root, ...process.argv.slice(2)], {cwd: stage, stdio: 'inherit'});
} finally {
  await rm(stage, {recursive: true, force: true});
}
