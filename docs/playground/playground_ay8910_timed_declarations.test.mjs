import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, writeFile, rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {selectYmCodeDeclarations} from '../synth-ym2149-st/code_declarations.js';
import {definitionSource, sourcePosition} from './playground_monaco_definitions.js';

const declarations = await readFile(new URL('./tetorica-playground-globals.d.ts', import.meta.url), 'utf8');

test('YM2149 timed operation declarations preserve immediate results and type isolated recorder/snapshot usage', async () => {
  const work = await mkdtemp(join(tmpdir(), 'ay-timed-types-'));
  try {
    await writeFile(join(work, 'globals.d.ts'), selectYmCodeDeclarations(declarations));
    await writeFile(join(work, 'entry.ts'), `export {};
const ym = await useSoundChip('ay8910');
const immediate:number = ym.setNote(CH1, 'C4');
const operations = ym.build(b => {
  const receiver:PlaygroundAy8910OperationRecorder = b.atSample(0).setNote(CH1, 'C4');
  receiver.keyOn(CH1).atSeconds(0.1).noteOff(CH1);
  // @ts-expect-error recording a note returns the recorder
  const period:number = b.setNote(CH1, 'D4');
  // @ts-expect-error recording has no live-state getter
  b.getRegisterSnapshot();
}, {referenceSampleRate:44100});
const chained = ym.build(b => b.setEnvelope({shape:8}));
const snapshot = await ym.captureState();
const format:'tetorica-ay8910-state' = snapshot.format;
const version:1 = snapshot.version;
const identity:string|number = snapshot.instanceId;
const type:0|16 = snapshot.type;
const copied:readonly number[] = snapshot.levels;
const renderedFrame:number = snapshot.frame;
const outputRate:number = snapshot.sampleRate;
const current:PlaygroundAy8910CompiledWrite[] = await ym.compile(operations);
await ym.compile(operations, {initialState:'client'});
await ym.compile(operations, {initialState:'reset'});
await ym.compile(operations, {initialState:snapshot});
const row = current[0];
const time:number = row.offsetSeconds;
const register:number = row.register;
const value:number = row.value;
const index:number = row.operationIndex + row.writeIndex;
const receipt = await ym.schedule(chained, {name:'buzzer', repeatSeconds:1/110});
const start:number|undefined = receipt.startFrame;
const staged:boolean|undefined = receipt.staged;
const cleared:boolean = await ym.clearSchedule('buzzer');
// @ts-expect-error recording must finish synchronously
ym.build(async b => {b.keyOn(CH1);});
// @ts-expect-error only the three AY channels exist
ym.build(b => b.noteOn(3, 'C4'));
// @ts-expect-error unsupported baseline name
await ym.compile(operations, {initialState:'cached'});
// @ts-expect-error raw registers omit snapshot metadata and retained levels
await ym.compile(operations, {initialState:ym.getRegisterSnapshot()});
// @ts-expect-error captured state is read-only
snapshot.registers[0] = 1;
// @ts-expect-error captured metadata is read-only
snapshot.clock = 1000000;
// @ts-expect-error operation programs retain their captured reference rate
operations.referenceSampleRate = 48000;
// @ts-expect-error schedules require a name
await ym.schedule(operations, {});
// @ts-expect-error raw write rows are not recorded operation programs
await ym.schedule([{offsetSeconds:0,register:13,value:8}], {name:'raw'});
`);
    execFileSync(process.execPath, [
      fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url)),
      '--strict', '--noEmit', '--skipLibCheck', 'false', '--target', 'ES2022',
      '--module', 'ESNext', '--moduleResolution', 'Bundler', '--lib', 'ES2022',
      join(work, 'globals.d.ts'), join(work, 'entry.ts'),
    ], {stdio:'pipe'});
  } catch (error) {
    throw Error(error.stdout?.toString() || error.message);
  } finally {
    await rm(work, {recursive:true, force:true});
  }
});

test('timed AY methods navigate to the recording, live-client and snapshot implementations', async () => {
  const lines = declarations.split('\n');
  const at = (owner, symbol) => {
    const start = lines.findIndex(line => line.startsWith(`interface ${owner} {`));
    assert(start >= 0, owner);
    const line = lines.findIndex((value, index) => index > start && value.trimStart().startsWith(symbol));
    assert(line > start, symbol);
    return definitionSource(declarations, {lineNumber:line + 1, column:lines[line].indexOf(symbol) + 1}, 'atari-st');
  };
  const targets = [
    ['PlaygroundAy8910', 'build', 'ay8910_operations.js', 'buildAyOperations'],
    ['PlaygroundAy8910', 'compile', 'ay8910_timed_client.js', 'attachAyTimedClient'],
    ['PlaygroundAy8910', 'captureState', 'ay8910_timed_client.js', 'attachAyTimedClient'],
    ['PlaygroundAy8910', 'schedule', 'ay8910_timed_client.js', 'attachAyTimedClient'],
    ['PlaygroundAy8910', 'clearSchedule', 'ay8910_timed_client.js', 'attachAyTimedClient'],
    ['PlaygroundAy8910OperationRecorder', 'atSample', 'ay8910_operations.js', 'buildAyOperations'],
    ['PlaygroundAy8910OperationRecorder', 'setEnvelope', 'ay8910_operations.js', 'buildAyOperations'],
    ['PlaygroundAy8910StateSnapshot', 'readonly format', 'ay8910_timed_state.js', 'createAyTimedSnapshot'],
    ['PlaygroundAy8910CompiledWrite', 'register', 'ay8910_operations.js', 'compileAyOperations'],
  ];
  for (const [owner, symbol, file, implementation] of targets) {
    assert.deepEqual(at(owner, symbol), {file, symbol:implementation});
    const source = await readFile(new URL(`../../tetorica_src/runtime/${file}`, import.meta.url), 'utf8');
    assert(sourcePosition(source, implementation).lineNumber > 1);
  }
});

test('readable runtime mirror list includes every AY timed dependency', async () => {
  const script = await readFile(new URL('../../scripts/sync_web_js_to_docs.sh', import.meta.url), 'utf8');
  for (const file of ['ay8910_operations.js', 'ay8910_timed_state.js', 'ay8910_timed_client.js', 'ay8910_timed_processor.js']) {
    assert.equal(script.split('\n').filter(line => line === file).length, 1, file);
  }
});
