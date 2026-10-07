import {mkdtemp, mkdir, cp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.argv[2]) execFileSync(process.execPath, [join(root, 'scripts/build_fm2612_package.mjs')], {stdio: 'inherit'});
const scratch = await mkdtemp(join(tmpdir(), 'fm2612-types-'));
try {
  const installed = join(scratch, 'node_modules/tetorica-fm2612');
  await mkdir(join(scratch, 'node_modules'), {recursive: true});
  await cp(process.argv[2] ?? join(root, 'dist/fm2612'), installed, {recursive: true});
  await writeFile(join(scratch, 'package.json'), '{"private":true,"type":"module"}');
  await cp(join(root, 'test/types/fm2612.mts'), join(scratch, 'consumer.mts'));
  await cp(join(root, 'test/types/fm2612-browser.mts'), join(scratch, 'browser.mts'));
  for (const resolution of ['NodeNext', 'Bundler']) {
    await writeFile(join(scratch, 'tsconfig.json'), JSON.stringify({compilerOptions: {
      strict: true, noEmit: true, skipLibCheck: false, target: 'ES2022',
      module: resolution === 'NodeNext' ? 'NodeNext' : 'ESNext', moduleResolution: resolution,
      types: ['node'], typeRoots: [join(root, 'node_modules/@types')],
    }, files: ['consumer.mts']}));
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(scratch, 'tsconfig.json')], {stdio: 'inherit'});
  }
  await writeFile(join(scratch, 'tsconfig.json'), JSON.stringify({compilerOptions: {
    strict: true, noEmit: true, skipLibCheck: false, target: 'ES2022',
    module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], types: [],
  }, files: ['browser.mts']}));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(scratch, 'tsconfig.json')], {stdio: 'inherit'});
  console.log('PASS: installed declarations, NodeNext/Bundler, positive/negative types and browser without Node ambient types.');
} finally {await rm(scratch, {recursive: true, force: true});}
