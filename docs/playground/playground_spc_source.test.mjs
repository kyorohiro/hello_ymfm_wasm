import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateSpcImportDirectory, prepareSpcImport, buildSpcImportFiles} from './playground_spc_source.js';
import {prepareSnesBRR} from '../js/snessynth.js';

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
function fixture() {
  const bytes = new Uint8Array(0x10200);
  bytes.set(new TextEncoder().encode('SNES-SPC700 Sound File Data v0.30'));
  bytes[0x21] = bytes[0x22] = 0x1a;
  bytes[0x23] = 0x1a;
  bytes.set(new TextEncoder().encode('Song title'), 0x2e);
  const ram = bytes.subarray(0x100, 0x10100), dsp = bytes.subarray(0x10100, 0x10180);
  dsp[0x5d] = 2;
  for (let n = 0; n < 256; n++) ram.set([0, 0x10, 0, 0x10], 0x200 + n * 4);
  ram.set([3, 0x12, 0x34, 0x56, 0x78, 0x98, 0x76, 0x54, 0x32], 0x1000);
  ram.set([0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
    3, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11], 0x1100);
  ram.set([0, 0x11, 9, 0x11], 0x200 + 7 * 4);
  ram.set([1, 0x12, 0x34, 0x56, 0x78, 0x98, 0x76, 0x54, 0x32], 0x1200);
  ram.set([0, 0x12, 0, 0x12], 0x200 + 10 * 4);
  dsp.set([0x9c, 80, 0x34, 0x12, 7, 0xac, 0xd4, 0x67, 20], 0);
  dsp.set([64, 50, 0, 0, 3, 0, 0, 127, 0], 16);
  return bytes;
}

const select = (sourceNumber, extra = {}) => ({sourceNumber, ...extra});
const get = (plan, suffix) => {
  const entry = plan.files.find(value => value.path.endsWith(suffix));
  assert.ok(entry, `Missing ${suffix}`);
  return entry;
};
async function execute(plan, functions) {
  return new AsyncFunction(...Object.keys(functions), get(plan, plan.entryPath).data)(...Object.values(functions));
}
function virtualReader(plan) {
  return async (path, {type} = {}) => {
    const absolute = `${plan.directory}/${path.replace(/^\.\//, '')}`;
    const entry = plan.files.find(value => value.path === absolute);
    assert.ok(entry, `Generated code resolves ${path}`);
    if (type === 'json') return JSON.parse(entry.data);
    if (type === 'arrayBuffer') return entry.data.slice().buffer;
    return entry.data;
  };
}

test('prepare copies SPC bytes and retains metadata, all aliases, Voice settings and resolved loops', async () => {
  const original = fixture();
  const prepared = await prepareSpcImport(original, 'Song.spc');
  original.fill(0);
  assert.equal(prepared.metadata.title, 'Song title');
  assert.equal(prepared.spc.originalBytes[0], 83);
  assert.equal(prepared.scan.summary.scannedSourceNumbers, 256);
  assert.equal(prepared.candidates.length, 3);
  const candidate = prepared.candidates.find(value => value.id === 'srcn-7');
  assert.deepEqual(candidate.sourceNumbers, [7]);
  assert.equal(candidate.sourceEntries[0].startAddress, 0x1100);
  assert.equal(candidate.loopStartSamples, 16);
  assert.equal(candidate.voices[0].volumeLeft, -100);
  assert.equal(candidate.voices[0].pitch, 0x1234);
  assert.equal(candidate.importable, true);
  const aliases = prepared.candidates.find(value => value.id === 'srcn-0');
  assert.equal(aliases.sourceNumbers.length, 254);
  assert.ok(aliases.voices.some(voice => voice.index === 1));
});

test('invalid input, scan cancellation and bounded-scan warnings are propagated', async () => {
  await assert.rejects(prepareSpcImport(new Uint8Array(20)), /Truncated SPC/);
  const bytes = fixture(); bytes[0] = 0;
  await assert.rejects(prepareSpcImport(bytes), /signature/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareSpcImport(fixture(), 'song.spc', {signal:controller.signal}), {name:'AbortError'});
  const prepared = await prepareSpcImport(fixture(), 'song.spc', {maxBlocks:1, maxTotalBlocks:1});
  assert.ok(prepared.warnings.some(value => value.startsWith('Incomplete scan:')));
  assert.ok(prepared.scan.rejected.some(value => value.kind === 'budget'));
});

test('directory allocator is safe, preserves Unicode and avoids repeated import overwrites', () => {
  assert.equal(allocateSpcImportDirectory('曲.spc'), '/spc/曲');
  assert.equal(allocateSpcImportDirectory('sys.spc'), '/spc/_sys');
  assert.equal(allocateSpcImportDirectory('../bad\\name.spc'), '/spc/_bad_name');
  assert.equal(allocateSpcImportDirectory('song.spc', ['/spc/song/original.spc']), '/spc/song-2');
  assert.equal(allocateSpcImportDirectory('song.spc', ['/spc/song', '/spc/song-2/index.js']), '/spc/song-3');
  assert.equal(allocateSpcImportDirectory('song.spc', ['/spc', '/spc-2/song/index.js']), '/spc-2/song-2');
  assert.equal(allocateSpcImportDirectory('song.spc', [], ['/spc', '/spc/song']), '/spc/song-2');
});

test('song plan retains the exact SPC and generated playback remains alive until runtime Stop', async () => {
  const prepared = await prepareSpcImport(fixture(), 'song.spc');
  const plan = buildSpcImportFiles(prepared, {mode:'song', directory:'/spc/song'});
  assert.equal(plan.entryPath, '/spc/song/index.js');
  assert.equal(plan.mode, 'song');
  assert.deepEqual(get(plan, '/original.spc').data, prepared.spc.originalBytes);
  assert.notEqual(get(plan, '/original.spc').data, prepared.spc.originalBytes);
  const info = JSON.parse(get(plan, '/sourceinfo.json').data);
  assert.equal(info.metadata.title, 'Song title');
  const calls = [];
  await execute(plan, {
    useSoundChip:async chip => {
      assert.equal(chip, 'spc');
      return {loadSPC:async value => {assert.deepEqual(new Uint8Array(value), prepared.spc.originalBytes); calls.push('load');},
        play:async () => calls.push('play'), dispose:() => calls.push('dispose')};
    },
    file:virtualReader(plan),
  });
  assert.deepEqual(calls, ['load', 'play']);
});

test('generated instrument script restores signed volumes, raw envelope and pitch, and disposes after release', async () => {
  const prepared = await prepareSpcImport(fixture());
  const plan = buildSpcImportFiles(prepared, {mode:'instruments', directory:'/spc/tone', selected:[select(7, {voiceIndex:0, referenceNote:'F#3'})]});
  assert.equal(plan.entryPath, '/spc/tone/srcn-007-voice-1.js');
  assert.equal(plan.mode, 'instruments');
  const captured = JSON.parse(get(plan, '/presets/srcn-007-voice-1.json').data);
  assert.deepEqual(captured, {adsr1:0xac, adsr2:0xd4, gain:0x67, volumeLeft:-100, volumeRight:80, pitch:0x1234});
  const calls = [];
  await execute(plan, {
    createSoundChip:async chip => {
      assert.equal(chip, 'snes');
      return {
        loadBRR:async (bytes, options) => {const sample = prepareSnesBRR(bytes, options); assert.equal(sample.rootNote, 'F#3'); assert.equal(sample.basePitch, 0x1234); assert.equal(sample.loopStartSamples, 16); calls.push('load'); return {id:0};},
        setPreset:(channel, preset) => {assert.equal(channel, 0); assert.deepEqual(preset, {...captured, sample:{id:0}}); calls.push('preset');},
        setPitch:(channel, pitch) => {assert.equal(pitch, 0x1234); calls.push('pitch');},
        keyOn:channel => {assert.equal(channel, 0); calls.push('on');},
        keyOff:channel => {assert.equal(channel, 0); calls.push('off');},
        dispose:() => calls.push('dispose'),
      };
    },
    file:virtualReader(plan), sleep:async seconds => {assert.equal(seconds, 1); calls.push('sleep');},
  });
  assert.deepEqual(calls, ['load', 'preset', 'pitch', 'on', 'sleep', 'off', 'sleep', 'dispose']);
  const metadata = JSON.parse(get(plan, '.metadata.json').data);
  assert.equal(metadata.rootNote, null);
  assert.equal(metadata.assignedReferenceNote, 'F#3');
  assert.equal(metadata.selectedVoiceIndex, 0);
  assert.deepEqual(metadata.sourceNumbers, [7]);
  assert.equal(metadata.sourceEntries[0].loopAddress, 0x1109);
});

test('captured PITCH 0 is not silently replaced; only its declared tuning uses unity basePitch', async () => {
  const prepared = await prepareSpcImport(fixture());
  const plan = buildSpcImportFiles(prepared, {mode:'instruments', directory:'/spc/tone', selected:[select(3, {voiceIndex:1})]});
  const preset = JSON.parse(get(plan, '/presets/srcn-000-voice-2.json').data);
  assert.equal(preset.pitch, 0);
  const metadata = JSON.parse(get(plan, '.metadata.json').data);
  assert.equal(metadata.assignedBasePitch, 4096);
  assert.equal(metadata.assignedReferenceNote, 'C4');
  assert.ok(metadata.sourceNumbers.includes(3));
  assert.match(get(plan, '.js').data, /basePitch: 4096/);
  assert.match(get(plan, '.js').data, /setPitch\(0, voicePreset.pitch\)/);
});

test('unreferenced candidates get explicit default registers, and optional null Voice requests raw defaults', async () => {
  const prepared = await prepareSpcImport(fixture());
  const selected = [select(10), select(7, {voiceIndex:null, referenceNote:60})];
  const plan = buildSpcImportFiles(prepared, {mode:'instruments', directory:'/spc/tones', selected});
  assert.equal(plan.entryPath, '/spc/tones/srcn-010-raw.js');
  for (const suffix of ['/presets/srcn-010-raw.json', '/presets/srcn-007-raw.json']) {
    assert.deepEqual(JSON.parse(get(plan, suffix).data), {adsr1:143, adsr2:224, gain:127, volumeLeft:90, volumeRight:90, pitch:4096});
  }
  assert.equal(plan.files.filter(value => value.path.endsWith('.js')).length, 2);
  assert.equal(new Set(plan.files.map(value => value.path)).size, plan.files.length);
});

test('generated finally disposes the independent synth on a stopped/failed sleep', async () => {
  const prepared = await prepareSpcImport(fixture());
  const plan = buildSpcImportFiles(prepared, {mode:'instruments', directory:'/spc/tone', selected:[select(10)]});
  let disposed = false;
  await assert.rejects(execute(plan, {file:virtualReader(plan), createSoundChip:async () => ({loadBRR:async () => ({id:0}),
    setPreset(){}, setPitch(){}, keyOn(){}, dispose(){disposed = true;}}), sleep:async () => {throw Error('Run stopped');}}), /Run stopped/);
  assert.equal(disposed, true);
});

test('unsafe paths, malformed modes/selections/tuning and duplicate files fail before any write plan', async () => {
  const prepared = await prepareSpcImport(fixture());
  const base = {mode:'instruments', directory:'/spc/tone', selected:[select(7)]};
  for (const directory of ['relative', '/', '/spc/../tone', '/spc//tone', '/spc/./tone', '/.git/tone', '/.tet.ss/tone', '/sys/tone', '/spc/\\tone', '/spc/tone\n', '/spc/http:']) {
    assert.throws(() => buildSpcImportFiles(prepared, {...base, directory}), /directory|reserved/);
  }
  assert.throws(() => buildSpcImportFiles(prepared, {...base, mode:'notes'}), /mode/);
  assert.throws(() => buildSpcImportFiles(prepared, {...base, selected:[]}), /at least one/);
  for (const selected of [[{}], [select(-1)], [{candidateId:'missing'}], [select(7, {voiceIndex:1})], [select(7, {voiceIndex:99})], [select(7, {referenceNote:'H4'})], [select(7, {referenceNote:NaN})], [select(7), select(7)]]) {
    assert.throws(() => buildSpcImportFiles(prepared, {...base, selected}));
  }
});

test('unresolved BRR loop is reported as unimportable, remains playable as the full original SPC', async () => {
  const bytes = fixture(), ram = bytes.subarray(0x100, 0x10100);
  ram.set([0x12, 0x34], 0x200 + 7 * 4 + 2);
  const prepared = await prepareSpcImport(bytes);
  const candidate = prepared.candidates.find(value => value.id === 'srcn-7');
  assert.equal(candidate.importable, false);
  assert.match(candidate.importReason, /loop.*outside/);
  assert.throws(() => buildSpcImportFiles(prepared, {mode:'instruments', directory:'/spc/tone', selected:[select(7)]}), /cannot be relocated/);
  assert.ok(buildSpcImportFiles(prepared, {mode:'song', directory:'/spc/song'}).entryPath);
});

test('a candidate larger than fresh instrument RAM is rejected without truncation or loop changes', async () => {
  const bytes = fixture(), ram = bytes.subarray(0x100, 0x10100);
  ram.fill(0);
  for (let n = 0; n < 256; n++) ram.set([0, 4, 0, 4], 0x200 + n * 4);
  ram[0] = 1; // END after the 7,168 blocks from $0400 through $ffff.
  const prepared = await prepareSpcImport(bytes);
  const candidate = prepared.candidates[0];
  assert.equal(candidate.brr.length, 64521);
  assert.equal(candidate.importable, false);
  assert.match(candidate.importReason, /64521.*64512/);
  assert.throws(() => buildSpcImportFiles(prepared, {mode:'instruments', directory:'/spc/tone', selected:[select(0)]}), /64521.*64512/);
});
