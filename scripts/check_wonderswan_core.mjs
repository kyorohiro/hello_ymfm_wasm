/** First-stage WonderSwan verification: real native C++ vs real WASM.
 * Also checks independently specified register, DAC and timing expectations.
 * No browser, AudioContext, machine emulator or audio device is used.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir, endianness} from 'node:os';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {WonderSwan, WONDERSWAN_CLOCK} from '../web/wonderswan.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'node scripts/check_wonderswan_core.mjs [--wasm-dir DIR] [--fixture FILE] [--out REPORT.json] [--wav-dir DIR]';
function argumentsFor(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' && argv.length === 1) return null;
    assert(['--wasm-dir','--fixture','--out','--wav-dir'].includes(argv[i]), `Unknown argument: ${argv[i]}\n${usage}`);
    assert(!Object.hasOwn(result, argv[i]), `Duplicate argument: ${argv[i]}`);
    assert(argv[i + 1] && !argv[i + 1].startsWith('--'), `${argv[i]} needs a path`);
    result[argv[i]] = resolve(argv[++i]);
  }
  return result;
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const square = Uint8Array.from({length:32}, (_, i) => i < 16 ? 15 : 0);
const ramp = Uint8Array.from({length:32}, (_, i) => i & 15);
const triangle = Uint8Array.from({length:32}, (_, i) => i < 16 ? i : 31 - i);
function waveEvents(channel, samples, base = 0) {
  const events = [['w',0x8f,base]];
  for (let i = 0; i < 16; i++) events.push(['m',(base << 6) + channel * 16 + i, samples[i * 2] | samples[i * 2 + 1] << 4]);
  return events;
}
function voiceEvents(channel, {divisor = 1830, pan = 0xff, samples = square, base = 0} = {}) {
  return [...waveEvents(channel, samples, base), ['w',0x80 + channel * 2,divisor & 255],
    ['w',0x81 + channel * 2,divisor >> 8], ['w',0x88 + channel,pan], ['w',0x91,8]];
}
function apply(chip, [op, a, b]) {
  if (op === 'w') chip.writeRegister(a, b);
  else if (op === 'm') chip.writeMemory(a, b);
  else if (op === 'u') chip.setChannelMuted(a, !!b);
  else if (op === 'r') chip.reset();
  else throw new Error(`Unknown fixture operation ${op}`);
}
function render(chip, scene, layout = [128], api = 'owned') {
  const left = new Float32Array(scene.frames), right = new Float32Array(scene.frames);
  const events = scene.events.slice().sort((a, b) => a.frame - b.frame);
  let position = 0, next = 0, block = 0;
  while (position < scene.frames) {
    while (next < events.length && events[next].frame === position) apply(chip, events[next++].command);
    const frames = Math.min(layout[block++ % layout.length], scene.frames - position, (events[next]?.frame ?? scene.frames) - position);
    assert(frames > 0);
    if (api === 'into') chip.generateStereoInto(left.subarray(position, position + frames), right.subarray(position, position + frames), frames);
    else {
      const pcm = api === 'borrowed' ? chip.generateStereoView(frames) : chip.generateStereo(frames);
      left.set(pcm.left, position); right.set(pcm.right, position);
    }
    position += frames;
  }
  assert.equal(next, events.length);
  return {left, right, registers:Uint8Array.from({length:32}, (_, i) => chip.readRegister(0x80 + i)),
    memory:Uint8Array.from({length:0x4000}, (_, i) => chip.readMemory(i))};
}
function nativeInput(scene) {
  const lines = []; let position = 0;
  for (const {frame, command} of scene.events.slice().sort((a, b) => a.frame - b.frame)) {
    if (frame !== position) lines.push(`g ${frame - position}`);
    position = frame; lines.push(command.join(' '));
  }
  if (position < scene.frames) lines.push(`g ${scene.frames - position}`);
  for (let i = 0; i < 32; i++) lines.push(`q ${0x80 + i}`);
  for (let i = 0; i < 0x4000; i++) lines.push(`p ${i}`);
  return lines.join('\n') + '\n';
}
function nativeRender(fixture, scene, clock, rate) {
  const bytes = execFileSync(fixture, [String(clock), String(rate)], {input:nativeInput(scene), timeout:30000, maxBuffer:scene.frames * 8 + 65536});
  assert.equal(bytes.length, scene.frames * 8 + 32 + 0x4000);
  const left = new Float32Array(scene.frames), right = new Float32Array(scene.frames);
  for (let i = 0; i < scene.frames; i++) { left[i] = bytes.readFloatLE(i * 8); right[i] = bytes.readFloatLE(i * 8 + 4); }
  return {left, right, registers:new Uint8Array(bytes.subarray(scene.frames * 8, scene.frames * 8 + 32)), memory:new Uint8Array(bytes.subarray(scene.frames * 8 + 32))};
}
function equalPcm(actual, expected, label) {
  for (const field of ['left','right','registers','memory']) assert.deepEqual(actual[field], expected[field], `${label}: ${field}`);
}
function metrics({left, right}) {
  let peak = 0, mean = 0, variance = 0;
  for (const side of [left, right]) {
    let sum = 0, squares = 0;
    for (const value of side) {
      assert(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); sum += value; squares += value * value;
    }
    const sideMean = sum / side.length;
    mean += sideMean / 2; variance += Math.max(0,squares / side.length - sideMean * sideMean) / 2;
  }
  return {peak, mean, acRms:Math.sqrt(variance)};
}
function frequency(samples, rate) {
  const body = samples.subarray(Math.floor(samples.length / 10));
  const threshold = body.reduce((a, b) => a + b, 0) / body.length;
  const crossings = [];
  for (let i = 1; i < body.length; i++) if (body[i - 1] <= threshold && body[i] > threshold) crossings.push(i);
  assert(crossings.length > 4, 'Need several audible periods');
  return rate * (crossings.length - 1) / (crossings.at(-1) - crossings[0]);
}
function scenes() {
  const result = [];
  const scene = (name, commands, {frames = 4096, silent = false} = {}) => {
    const events = [], at = (frame, list) => list.forEach(command => events.push({frame, command}));
    commands(at); result.push({name, frames, silent, events});
  };
  scene('cold-silence', () => {}, {silent:true});
  for (let channel = 0; channel < 4; channel++) scene(`wave/channel-${channel}/pan-and-pitch`, at => {
    at(0, [...voiceEvents(channel, {samples:triangle, base:255}), ['w',0x90,1 << channel]]);
    at(509, [['w',0x88 + channel,0xf0]]); at(1021, [['w',0x88 + channel,0x0f]]);
    at(2053, [['w',0x80 + channel * 2,160], ['w',0x81 + channel * 2,7]]);
    at(3001, [['w',0x90,0]]); at(3503, [['w',0x90,1 << channel]]);
  });
  scene('four-waves/packed-RAM-live-edit-and-base', at => {
    for (let channel = 0; channel < 4; channel++) at(0, voiceEvents(channel, {divisor:1701 + channel * 67, pan:0x96 + channel * 0x11, samples:channel & 1 ? ramp : triangle}));
    at(0, [['w',0x90,15]]); at(701, [['m',0,0xff], ['m',63,0x05]]);
    at(1703, [['w',0x8f,255]]); at(2801, [['w',0x8f,0]]);
    at(3501, [['w',0x91,0]]); at(3901, [['w',0x91,8]]);
  });
  for (let type = 0; type < 8; type++) scene(`noise/type-${type}`, at => {
    at(0, [...voiceEvents(3, {divisor:1920}), ['w',0x8e,0x18 | type], ['w',0x90,0x88]]);
    at(701, [['w',0x8e,0x10 | type]]); at(1703, [['w',0x86,207]]);
    at(2801, [['w',0x90,8]]); at(3501, [['w',0x90,0x88]]);
  });
  for (const step of [1,7,0x81,0xff]) scene(`sweep/signed-step-${step}`, at => {
    at(0, [...voiceEvents(2, {divisor:1952}), ['w',0x8c,step], ['w',0x8d,0], ['w',0x90,0x44]]);
    at(701, [['w',0x8d,1]]); at(1703, [['w',0x90,4]]);
    at(2801, [['w',0x90,0x44]]); at(3501, [['w',0x8d,0]]);
  });
  scene('voice/PCM-byte-and-left-right-levels', at => {
    at(0, [['w',0x91,8], ['w',0x90,0x22], ['w',0x89,0xff], ['w',0x94,0x0f]]);
    at(701, [['w',0x89,0x20], ['w',0x94,5]]); at(1703, [['w',0x89,0xe1], ['w',0x94,8]]);
    at(2801, [['w',0x94,2]]); at(3501, [['w',0x94,15]]);
  });
  scene('all-voices/mute-state-and-reset', at => {
    for (let channel = 0; channel < 4; channel++) at(0, voiceEvents(channel, {divisor:1631 + channel * 95}));
    at(0, [['w',0x90,15]]); at(503, [['u',0,1], ['u',3,1]]);
    at(1701, [['u',0,0]]); at(2201, [['u',3,0]]); at(2803, [['r']]);
    at(3401, [...voiceEvents(1), ['w',0x90,2]]);
  });
  scene('short-periods/many-fetches-and-counter-wrap', at => {
    for (let channel = 0; channel < 4; channel++) at(0, voiceEvents(channel, {divisor:2044 + channel, samples:ramp}));
    at(0, [['w',0x8e,0x18], ['w',0x90,0xcc], ['w',0x8c,0x7f], ['w',0x8d,0]]);
    at(2003, [['w',0x90,15]]);
  });
  return result;
}

async function specifiedChecks(create) {
  const exact = (actual, expected, label) => assert.deepEqual(Array.from(actual), expected.map(value => value / 1024), label);
  const atNativeRate = () => create({sampleRate:24000});
  const report = {reference:'Independent specified MAME baseline expectations; hardware deviations are listed in README.', checks:0};
  let chip = await atNativeRate();
  try {
    for (const command of [...voiceEvents(0, {divisor:1920, pan:0xf0, samples:ramp}), ['w',0x90,1]]) apply(chip, command);
    const pcm = chip.generateStereo(8);
    exact(pcm.left, [0,0,15,30,45,60,75,90], 'low-nibble-first and old-signal-before-fetch');
    exact(pcm.right, [0,0,0,0,0,0,0,0], 'independent right mute'); report.checks += 2;
    chip.reset();
    for (const command of [...voiceEvents(0, {divisor:1984, pan:0xf0, samples:ramp}), ['w',0x90,1]]) apply(chip, command);
    exact(chip.generateStereo(5).left, [0,15,45,75,105], 'multiple waveform fetches per native tick'); report.checks++;
    chip.reset();
    for (const command of [...voiceEvents(0, {divisor:0, samples:new Uint8Array(32).fill(15)}), ['w',0x90,1]]) apply(chip, command);
    exact(chip.generateStereo(18).left, [...Array(16).fill(0),225,225], 'longest period initial latency'); report.checks++;
  } finally { chip.dispose(); }
  for (let type = 0; type < 8; type++) {
    chip = await atNativeRate();
    try {
      for (const command of [...voiceEvents(3, {divisor:1920, pan:0xf0}), ['w',0x8e,0x18 | type], ['w',0x90,0x88]]) apply(chip, command);
      const taps = [14,10,13,4,8,6,9,11]; let seed = 0, output = 0, signal = 0;
      for (let tick = 0; tick < 64; tick++) {
        exact(chip.generateStereo(1).left, [15 * signal], `noise${type} tick${tick} PCM`);
        signal = output ? 15 : 0;
        output = (1 ^ (seed >> 7) ^ (seed >> taps[type])) & 1; seed = ((seed << 1) | output) & 0xffff;
        assert.equal(chip.readRegister(0x92) | chip.readRegister(0x93) << 8, seed, `noise${type} tick${tick} LFSR`);
      }
      report.checks++;
    } finally { chip.dispose(); }
  }
  for (const [initial, step, after] of [[2047,1,0],[0,255,2047]]) for (const speed of [0,31]) {
    chip = await atNativeRate();
    try {
      for (const command of [...voiceEvents(2, {divisor:initial}), ['w',0x8c,step], ['w',0x8d,speed], ['w',0x90,0x44]]) apply(chip, command);
      const period = 64 * (speed + 1);
      chip.generateStereo(period - 1); assert.equal(chip.readRegister(0x84) | chip.readRegister(0x85) << 8, initial);
      chip.generateStereo(1); assert.equal(chip.readRegister(0x84) | chip.readRegister(0x85) << 8, after);
      report.checks++;
    } finally { chip.dispose(); }
  }
  chip = await atNativeRate();
  try {
    chip.writeRegister(0x91,8); chip.writeRegister(0x90,0x22); chip.writeRegister(0x89,255);
    for (const [volume, left, right] of [[15,255,255],[5,127,127],[8,255,0],[2,0,255],[0,0,0]]) {
      chip.writeRegister(0x94,volume); const pcm = chip.generateStereo(3);
      exact(pcm.left, Array(3).fill(left), `PCM volume${volume} left`); exact(pcm.right, Array(3).fill(right), `PCM volume${volume} right`);
    }
    chip.writeRegister(0x94,15); chip.writeRegister(0x90,0x20);
    exact(chip.generateStereo(3).left, [0,0,0], 'known MAME voice gate behavior'); report.checks++;
    chip.writeRegister(0x81,255); assert.equal(chip.readRegister(0x81),7);
    chip.writeRegister(0x8e,255); assert.equal(chip.readRegister(0x8e),23);
    chip.writeRegister(0x93,255); assert.equal(chip.readRegister(0x93),127);
    chip.writeRegister(0x91,0xff); assert.equal(chip.readRegister(0x91),0x8f);
    chip.writeRegister(0x9e,0xff); assert.equal(chip.readRegister(0x9e),3); report.checks++;
  } finally { chip.dispose(); }
  const pitch = [];
  for (const rate of [44100,48000,96000]) {
    chip = await create({sampleRate:rate});
    try {
      for (const command of [...voiceEvents(0), ['w',0x90,1]]) apply(chip, command);
      const pcm = chip.generateStereo(rate); const hz = frequency(pcm.left, rate);
      assert(Math.abs(hz - 96000 / 218) < 0.08, `A4 measured ${hz} at ${rate}`);
      assert.deepEqual(pcm.left, pcm.right); pitch.push({rate,expectedHz:96000 / 218,measuredHz:hz}); report.checks++;
    } finally { chip.dispose(); }
  }
  report.pitch = pitch;
  const muted = await atNativeRate(), audible = await atNativeRate();
  try {
    const setup = [...voiceEvents(0), ['w',0x90,1]];
    for (const chip of [muted,audible]) { setup.forEach(command => apply(chip,command)); chip.generateStereo(53); }
    muted.setChannelMuted(0,true);
    assert(muted.generateStereo(733).left.every(value => value === 0), 'monitor mute suppresses held and future PCM');
    audible.generateStereo(733); muted.setChannelMuted(0,false);
    assert.deepEqual(muted.generateStereo(433),audible.generateStereo(433),'monitor mute retains phase advancement'); report.checks++;
    for (const chip of [muted,audible]) { chip.reset(); setup.forEach(command => apply(chip,command)); chip.generateStereo(53); }
    muted.writeRegister(0x90,0); assert(muted.generateStereo(733).left.every(value => value === 0)); muted.writeRegister(0x90,1);
    assert.deepEqual(muted.generateStereo(433),audible.generateStereo(433),'hardware channel disable freezes voice phase'); report.checks++;
  } finally { muted.dispose(); audible.dispose(); }
  const ordinary = await create({clock:4000000}), fractional = await create({clock:4000001});
  try {
    for (const command of [...voiceEvents(0, {divisor:1984, samples:ramp}), ['w',0x90,1]]) {
      apply(ordinary,command); apply(fractional,command);
    }
    assert.deepEqual(ordinary.generateStereo(10001),fractional.generateStereo(10001),'MAME floor(clock/128) cadence'); report.checks++;
  } finally { ordinary.dispose(); fractional.dispose(); }
  return report;
}

async function wrapperChecks(create, module) {
  const a = await create(), b = await create();
  try {
    const setup = [...voiceEvents(0), ['w',0x90,1]]; setup.forEach(command => apply(a, command));
    assert(b.generateStereo(512).left.every(value => value === 0), 'instances isolate RAM/registers/counters');
    b.reset();
    setup.forEach(command => apply(b, command));
    a.reserveFrames(1024); const view = a.generateStereoView(128);
    assert.equal(a.generateStereoView(128), view, 'fixed render blocks reuse borrowed view objects');
    b.generateStereo(256); assert.deepEqual(a.generateStereo(257), b.generateStereo(257));
    const retained = a.generateStereo(17), copy = {left:retained.left.slice(), right:retained.right.slice()};
    a.generateStereo(8192); assert.deepEqual(retained, copy, 'owned PCM survives later buffer growth');
    const oldHeapBytes = module.HEAPF32.byteLength;
    const allocation = module._malloc(oldHeapBytes + 65536);
    assert(allocation, 'force actual WASM memory growth');
    assert(module.HEAPF32.byteLength > oldHeapBytes, 'WASM linear memory actually grew');
    try { assert(a.generateStereoView(128).left.some(value => value > 0)); assert.deepEqual(retained, copy); }
    finally { module._free(allocation); }
    a.loadMemory(Uint8Array.of(1,2,3), 0x3ffd); assert.deepEqual([a.readMemory(0x3ffd),a.readMemory(0x3ffe),a.readMemory(0x3fff)], [1,2,3]);
    for (const operation of [() => a.writeRegister(0x64,0), () => a.writeRegister(0x80,256), () => a.readMemory(0x4000),
      () => a.loadMemory(Uint8Array.of(1,2),0x3fff), () => a.setChannelMuted(4,true), () => a.setChannelMuted(0,1),
      () => a.generateStereo(-1), () => a.generateStereoView(0.5), () => a.reserveFrames(Infinity)]) assert.throws(operation);
    const output = new Float32Array(256);
    assert.throws(() => a.generateStereoInto(output.subarray(0,128),output.subarray(64,192),128));
    const untouched = a.generateStereo(0); assert.equal(untouched.left.length,0);
    a.dispose(); a.dispose(); assert.deepEqual(retained, copy, 'owned PCM survives disposal');
    for (const operation of [() => a.reset(), () => a.writeRegister(0x90,1), () => a.readMemory(0), () => a.generateStereo(0)]) assert.throws(operation, /disposed/);
    b.reset(); assert(b.generateStereo(511).left.every(value => value === 0)); assert.equal(b.readMemory(0),0); assert.equal(b.readRegister(0x91),128);
  } finally { a.dispose(); b.dispose(); }
  let called = false;
  for (const options of [{clock:0},{clock:100000001},{sampleRate:0},{sampleRate:384001},{sampleRate:NaN}]) {
    await assert.rejects(WonderSwan.create({...options,moduleFactory:() => { called = true; }}), RangeError);
  }
  assert.equal(called,false, 'invalid configuration rejected before loading WASM');
  return {passed:true,actualHeapGrowth:true,borrowedViewReuse:true,ownedLifetime:true,rangeValidation:true,isolatedInstances:true};
}

function floatWav(pcm, rate) {
  const frames = pcm.left.length, result = Buffer.alloc(44 + frames * 8);
  result.write('RIFF',0); result.writeUInt32LE(result.length - 8,4); result.write('WAVEfmt ',8);
  result.writeUInt32LE(16,16); result.writeUInt16LE(3,20); result.writeUInt16LE(2,22);
  result.writeUInt32LE(rate,24); result.writeUInt32LE(rate * 8,28); result.writeUInt16LE(8,32); result.writeUInt16LE(32,34);
  result.write('data',36); result.writeUInt32LE(frames * 8,40);
  for (let i = 0; i < frames; i++) { result.writeFloatLE(pcm.left[i],44 + i * 8); result.writeFloatLE(pcm.right[i],48 + i * 8); }
  return result;
}
async function listeningFiles(create, directory) {
  await mkdir(directory, {recursive:true}); const files = [], rate = 48000;
  const programs = [
    ['four-wave-chord', [...[0,1,2,3].flatMap((ch) => voiceEvents(ch, {divisor:[1865,1903,1926,1952][ch],samples:triangle,pan:[0xf6,0x9c,0xc9,0x6f][ch]})), ['w',0x90,15]]],
    ['noise', [...voiceEvents(3,{divisor:1920,pan:0x88}), ['w',0x8e,0x18], ['w',0x90,0x88]]],
    ['sweep', [...voiceEvents(2,{divisor:1700,samples:triangle}), ['w',0x8c,1], ['w',0x8d,1], ['w',0x90,0x44]]],
  ];
  for (const [name, commands] of programs) {
    const chip = await create({sampleRate:rate});
    try {
      commands.forEach(command => apply(chip, command));
      const bytes = floatWav(chip.generateStereo(rate * 2), rate), path = join(directory, `wonderswan-${name}.wav`);
      await writeFile(path, bytes); files.push({path,frames:rate * 2,sha256:sha256(bytes)});
    } finally { chip.dispose(); }
  }
  const chip = await create({sampleRate:rate});
  try {
    chip.writeRegister(0x91,8); chip.writeRegister(0x90,0x22); chip.writeRegister(0x94,0x0f);
    const pcm = {left:new Float32Array(rate * 2),right:new Float32Array(rate * 2)};
    // A generated 8-bit sine is written at exactly 8 kHz, not CPU/DMA emulation.
    for (let sample = 0; sample < 16000; sample++) {
      chip.writeRegister(0x89,Math.round(127.5 + Math.sin(2 * Math.PI * 440 * sample / 8000) * 100));
      const block = chip.generateStereoView(6); pcm.left.set(block.left,sample * 6); pcm.right.set(block.right,sample * 6);
    }
    const bytes = floatWav(pcm,rate), path = join(directory,'wonderswan-voice-pcm.wav');
    await writeFile(path,bytes); files.push({path,frames:rate * 2,sha256:sha256(bytes)});
  } finally { chip.dispose(); }
  return files;
}

async function main() {
  const args = argumentsFor(process.argv.slice(2)); if (!args) { console.log(usage); return; }
  assert.equal(endianness(),'LE','Native fixture binary format currently requires a little-endian host');
  const wasmDirectory = args['--wasm-dir'] ?? join(root,'docs/generated');
  const wasmPath = join(wasmDirectory,'wonderswan_wasm.wasm'), jsPath = join(wasmDirectory,'wonderswan_wasm.js');
  const binary = await readFile(wasmPath), {default:factory} = await import(pathToFileURL(jsPath).href);
  const receiptPath = join(wasmDirectory,'wonderswan_build-info.json');
  const receiptBytes = await readFile(receiptPath), receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.schemaVersion,1); assert.equal(receipt.artifact,'wonderswan');
  const expectedInputs = ['third_party/mame-wonderswan/wonderswan.cpp','third_party/mame-wonderswan/wonderswan.h',
    'third_party/mame-wonderswan/README.md','third_party/mame-wonderswan/LICENSE',
    'third_party/mame-wonderswan/upstream/wswansound.cpp','third_party/mame-wonderswan/upstream/wswansound.h',
    'wasm/wonderswan_wasm.cpp','scripts/build_wonderswan_wasm.sh'];
  assert.deepEqual(receipt.inputs.map(input => input.path).sort(),expectedInputs.sort(),'complete build input inventory');
  for (const record of receipt.inputs) {
    const bytes = await readFile(join(root,record.path));
    assert.equal(bytes.length,record.bytes,record.path+' receipt size'); assert.equal(sha256(bytes),record.sha256,record.path+' receipt SHA');
  }
  assert.deepEqual(receipt.outputs.map(output => output.path).sort(),['wonderswan_wasm.js','wonderswan_wasm.wasm']);
  for (const record of receipt.outputs) {
    const bytes = await readFile(join(wasmDirectory,record.path));
    assert.equal(bytes.length,record.bytes,record.path+' receipt size'); assert.equal(sha256(bytes),record.sha256,record.path+' receipt SHA');
  }
  const module = await factory({wasmBinary:binary});
  const create = options => WonderSwan.create({...options,moduleFactory:() => module});
  const temporary = await mkdtemp(join(tmpdir(),'tetorica-wonderswan-'));
  const report = {schemaVersion:1,passed:false,deviceOpened:false,clock:WONDERSWAN_CLOCK,rates:[44100,48000,96000],
    method:'Real native C++ and WASM through synchronous JS; exact stereo PCM, complete 32-byte register window and 16 KiB wave RAM. Separate fixed-value DAC, LFSR, sweep and pitch expectations.',
    limits:['MAME-derived preliminary headphone sound path, not hardware validation or whole-machine emulation.',
      'Raw unipolar output scale; no normalization, Mixer gain, DC filter, real-time scheduling or listening judgment.',
      'Hyper Voice, CPU, DMA, BIOS, ROM and VGM playback are outside this first stage. Fixed SDK and Playground modes are unchanged.'],
    sources:[],cases:[],totalComparedStereoFrames:0,maximumDifference:0,
    buildReceipt:{sha256:sha256(receiptBytes),...receipt}};
  try {
    const fixture = args['--fixture'] ?? join(temporary,process.platform === 'win32' ? 'fixture.exe' : 'fixture');
    if (!args['--fixture']) execFileSync(process.env.CXX || 'clang++', ['-std=c++14','-O2','-Wall','-Wextra','-Werror','-pedantic',
      '-I'+join(root,'third_party/mame-wonderswan'),join(root,'test/helpers/wonderswan_core_fixture.cpp'),
      join(root,'third_party/mame-wonderswan/wonderswan.cpp'),'-o',fixture], {stdio:'pipe'});
    const selftest = join(temporary,process.platform === 'win32' ? 'selftest.exe' : 'selftest');
    execFileSync(process.env.CXX || 'clang++', ['-std=c++14','-O2','-Wall','-Wextra','-Werror','-pedantic',
      '-I'+join(root,'third_party/mame-wonderswan'),join(root,'test/helpers/wonderswan_core_selftest.cpp'),
      join(root,'third_party/mame-wonderswan/wonderswan.cpp'),join(root,'wasm/wonderswan_wasm.cpp'),'-o',selftest],{stdio:'pipe'});
    report.nativeSelfTest = JSON.parse(execFileSync(selftest,[],{encoding:'utf8',timeout:30000}));
    report.specifiedChecks = await specifiedChecks(create); report.wrapperChecks = await wrapperChecks(create,module);
    for (const rate of report.rates) for (const clock of [WONDERSWAN_CLOCK,4000001]) for (const scene of scenes()) {
      const expected = nativeRender(fixture,scene,clock,rate), label = `${scene.name}/${clock}/${rate}`;
      for (const [layout, api] of [[[128],'owned'],[[1,17,127,509,3,1024,257],'borrowed'],[[97,256,11],'into']]) {
        const chip = await create({clock,sampleRate:rate});
        try {
          const actual = render(chip,scene,layout,api); equalPcm(actual,expected,label+'/'+api);
          const m = metrics(actual); if (scene.silent) assert.equal(m.peak,0); else assert(m.peak > 0.001,label+' must emit sound');
          chip.reset(); equalPcm(render(chip,scene,layout,api),expected,label+'/reset-replay');
          report.totalComparedStereoFrames += scene.frames * 2;
        } finally { chip.dispose(); }
      }
      const m = metrics(expected); report.cases.push({name:scene.name,clock,rate,frames:scene.frames,...m,
        pcmSha256:sha256(Buffer.concat([Buffer.from(expected.left.buffer),Buffer.from(expected.right.buffer)])),maximumDifference:0});
    }
    const files = ['third_party/mame-wonderswan/wonderswan.h','third_party/mame-wonderswan/wonderswan.cpp','wasm/wonderswan_wasm.cpp',
      'web/wonderswan.js','scripts/build_wonderswan_wasm.sh','scripts/check_wonderswan_core.mjs',
      'test/helpers/wonderswan_core_fixture.cpp','test/helpers/wonderswan_core_selftest.cpp'];
    for (const path of files) { const bytes = await readFile(join(root,path)); report.sources.push({path,bytes:bytes.length,sha256:sha256(bytes)}); }
    report.outputs = [];
    for (const path of [jsPath,wasmPath]) { const bytes = await readFile(path); report.outputs.push({path,bytes:bytes.length,sha256:sha256(bytes)}); }
    if (args['--wav-dir']) report.listeningFiles = await listeningFiles(create,args['--wav-dir']);
    report.passed = true;
    if (args['--out']) { await mkdir(dirname(args['--out']),{recursive:true}); await writeFile(args['--out'],JSON.stringify(report,null,2)+'\n'); }
    console.log(JSON.stringify({passed:true,cases:report.cases.length,comparedStereoFrames:report.totalComparedStereoFrames,
      specifiedChecks:report.specifiedChecks.checks,maximumDifference:0,...(args['--out'] ? {report:args['--out']} : {})},null,2));
  } finally { await rm(temporary,{recursive:true,force:true}); }
}
main().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; });
