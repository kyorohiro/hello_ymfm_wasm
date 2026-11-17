import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withFm2612DeclarationSources} from '../scripts/fm2612_type_sources.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const compiler = join(root, 'node_modules/typescript/bin/tsc');

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'fm2612-declarations-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const sourceDirectory = join(directory, 'src');
  await mkdir(sourceDirectory);
  await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
  const sources = new Map();
  for (const name of ['ay8910_timed_state.js', 'playground_performance_queue.js']) {
    sources.set(join(sourceDirectory, name), await readFile(join(root, 'tetorica_src/runtime', name), 'utf8'));
  }
  sources.set(join(sourceDirectory, 'ay8910.js'), 'export function validateAy8910(options) {}\n');
  sources.set(join(sourceDirectory, 'ay8910_operations.js'), 'export function validateAyOperationState(state) { return state; }\n');
  sources.set(join(sourceDirectory, 'processor.js'), `
import {createPerformanceQueue} from './playground_performance_queue.js?v=fixture';
export class Processor {
  constructor(configuration) { this.queue = createPerformanceQueue(configuration); }
}
`);
  for (const [file, source] of sources) await writeFile(file, source);
  return {directory, sources};
}

test('declaration staging retains snapshot and queue option contracts through processor inference', async t => {
  const {directory, sources} = await fixture(t);
  const config = join(directory, 'tsconfig.json');
  await writeFile(config, JSON.stringify({compilerOptions: {
    allowJs: true, checkJs: false, declaration: true, emitDeclarationOnly: true,
    noEmitOnError: true, strictNullChecks: true, skipLibCheck: false,
    target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
    rootDir: join(directory, 'src'), declarationDir: join(directory, 'types'), types: [],
  }, files: [...sources.keys()]}));
  await withFm2612DeclarationSources([...sources.keys()], () => {
    execFileSync(process.execPath, [compiler, '-p', config], {stdio: 'pipe'});
  });
  for (const [file, source] of sources) assert.equal(await readFile(file, 'utf8'), source);

  const consumer = join(directory, 'consumer.mts');
  await writeFile(consumer, `
import {createAyTimedSnapshot} from './types/ay8910_timed_state.js';
import {Processor} from './types/processor.js';
const snapshot = createAyTimedSnapshot({}, {
  instanceId: 'chip', clock: 2000000, type: 16, flags: 1, frame: 0, sampleRate: 48000,
});
const frame: number = snapshot.frame;
const processor = new Processor({} as any);
processor.queue.clearPattern('buzzer', {session: 1, owner: 'melody'});
processor.queue.clearPattern('buzzer');
processor.queue.cancelPatternOwner('melody', {session: 1});
processor.queue.commitPatterns([], {session: 1, owner: 'melody', dryRun: true});
processor.queue.commitPatterns([], {session: 1, owner: 'melody'}, () => {});
// @ts-expect-error Session identities are numeric.
processor.queue.clearPattern('buzzer', {session: 'old'});
// @ts-expect-error Owner identities are strings.
processor.queue.commitPatterns([], {session: 1, owner: 2});
// @ts-expect-error A snapshot clock is numeric.
createAyTimedSnapshot({}, {instanceId: 'chip', clock: '2MHz', frame: 0, sampleRate: 48000});
`);
  await writeFile(config, JSON.stringify({compilerOptions: {
    strict: true, noEmit: true, skipLibCheck: false, target: 'ES2022',
    module: 'NodeNext', moduleResolution: 'NodeNext', types: [],
  }, files: [consumer]}));
  execFileSync(process.execPath, [compiler, '-p', config], {stdio: 'pipe'});
});

test('failed declaration emission restores option annotations and versioned imports exactly', async t => {
  const {sources} = await fixture(t);
  await assert.rejects(withFm2612DeclarationSources([...sources.keys()], async () => {
    const queue = await readFile([...sources.keys()].find(file => file.endsWith('playground_performance_queue.js')), 'utf8');
    const processor = await readFile([...sources.keys()].find(file => file.endsWith('processor.js')), 'utf8');
    assert.match(queue, /@param \{\{session\?: number, owner\?: string\}\}/);
    assert.doesNotMatch(processor, /\?v=fixture/);
    throw new Error('Injected declaration compiler failure');
  }), /Injected declaration compiler failure/);
  for (const [file, source] of sources) assert.equal(await readFile(file, 'utf8'), source);
});
