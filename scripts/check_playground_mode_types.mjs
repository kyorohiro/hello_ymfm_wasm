import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'playground-mode-types-'));
try {
  const fixtures = [
    ...['ym2612', 'ym2203', 'ym2608', 'ym2610', 'ym2610b'].map(chip => `playground-mode-${chip}.ts`),
    'playground-time.ts', 'playground-tone.ts', 'playground-chip-clock.ts',
  ];
  for (const fixture of fixtures) {
    const config = join(scratch, 'tsconfig.json');
    await writeFile(config, JSON.stringify({compilerOptions: {
      strict: true, noEmit: true, skipLibCheck: false,
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM'], types: [],
    }, files: [join(root, 'test/types', fixture)]}));
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], {stdio: 'inherit'});
  }
  console.log('PASS: Playground mode declarations, selected channels/capabilities, independent chips, and existing time/tone/clock types.');
} finally {
  await rm(scratch, {recursive: true, force: true});
}
