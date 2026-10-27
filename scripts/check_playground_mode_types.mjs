import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {selectPlaygroundDeclarations} from '../docs/playground/playground_declarations.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'playground-mode-types-'));
try {
  const fixtures = [
    ...['ym2612', 'mega-cd', 'ym2203', 'ym2608', 'ym2610', 'ym2610b'].map(chip => `playground-mode-${chip}.ts`),
    ...['pokey','pokey-dual','wonderswan','gameboy','nes','snes','x68000','huc6280','pc-engine-cd','game-gear','master-system','dx7','ym3526','ym3812','y8950','ymf262','msx','msx-audio','atari-st'].map(chip => `playground-mode-${chip}.ts`),
    'playground-time.ts', 'playground-tone.ts', 'playground-chip-clock.ts', 'playground-cdda.ts',
  ];
  for (const fixture of fixtures) {
    let fixturePath = join(root, 'test/types', fixture);
    const nativeChip = /^playground-mode-(pokey|pokey-dual|wonderswan|gameboy|nes|snes|x68000|huc6280|pc-engine-cd|game-gear|master-system|dx7|ym3526|ym3812|y8950|ymf262|msx|msx-audio|atari-st)\.ts$/.exec(fixture)?.[1];
    if (nativeChip) {
      const globals = join(scratch, 'tetorica-playground-globals.d.ts');
      await writeFile(globals, selectPlaygroundDeclarations(
        await readFile(join(root, 'docs/playground/tetorica-playground-globals.d.ts'), 'utf8'), nativeChip));
      const source = await readFile(fixturePath, 'utf8');
      fixturePath = join(scratch, fixture);
      await writeFile(fixturePath, source
        .replace('../../docs/playground/tetorica-playground-globals.d.ts', globals)
        .replace(`../../docs/playground/tetorica-playground-${nativeChip}.d.ts`, join(root, `docs/playground/tetorica-playground-${nativeChip}.d.ts`)));
    }
    const config = join(scratch, 'tsconfig.json');
    await writeFile(config, JSON.stringify({compilerOptions: {
      strict: true, noEmit: true, skipLibCheck: false,
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM'], types: [],
    }, files: [fixturePath]}));
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], {stdio: 'inherit'});
  }
  console.log('PASS: Playground mode declarations, selected channels/capabilities, independent chips, and existing time/tone/clock types.');
} finally {
  await rm(scratch, {recursive: true, force: true});
}
