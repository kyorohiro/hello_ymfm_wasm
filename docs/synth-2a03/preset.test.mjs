// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDefaultPreset, readPreset, waveShape, presetToCode, createDemoDpcm, MAX_DPCM_BYTES} from './preset.js';
import {NesApuSynth} from '../js/nesapusynth.js';

const volumeEnvelopeDefault = {enabled:false,increase:false,period:8,initialGain:32};
const envelopeClockDefault = {masterSpeed:232,halt:false};
const modulationEnvelopeDefault = {enabled:false,increase:true,period:8,initialGain:0};
function createLegacyPreset(version) {
  const preset = createDefaultPreset(); preset.version = version;
  const clock = preset.fds.envelopeClock; delete preset.fds.envelopeClock; delete preset.fds.modulation.envelope;
  if (version <= 3) delete preset.fds.envelope;
  else preset.fds.envelope = {...preset.fds.envelope,...clock};
  if (version <= 2) delete preset.noise.envelope;
  if (version === 1) delete preset.dmc;
  return preset;
}

test('portable NES/FDS preset owns complete independent six-bit wave and modulation data', () => {
  const source = createDefaultPreset(); source.name = '  FDS flute  '; source.source = 'fds';
  source.fds.modulation.enabled = true; source.fds.modulation.bias = -24;
  source.pulse.envelope = {enabled: true, period: 4, loop: true};
  source.noise.envelope = {enabled: true, period: 5, loop: true};
  source.fds.envelope = {enabled:true,increase:false,period:63,initialGain:63};
  source.fds.envelopeClock = {masterSpeed:255,halt:true};
  source.fds.modulation.envelope = {enabled:true,increase:true,period:63,initialGain:63};
  const copy = readPreset(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(copy, {...source, name: 'FDS flute'});
  copy.fds.wave[0] = 63; copy.fds.modulation.table[0] = 4; copy.noise.envelope.period = 0; copy.fds.envelope.initialGain = 0;
  assert.notEqual(source.fds.wave[0], 63); assert.equal(source.fds.modulation.table[0], 1);
  assert.equal(source.noise.envelope.period, 5);
  assert.equal(source.fds.envelope.initialGain, 63);
  copy.fds.envelopeClock.masterSpeed = 0; copy.fds.modulation.envelope.initialGain = 0;
  assert.equal(source.fds.envelopeClock.masterSpeed,255); assert.equal(source.fds.modulation.envelope.initialGain,63);
});

test('strict presets reject ambiguous, sparse, non-finite, extra and out-of-hardware data', () => {
  const changes = [
    p => {p.extra = 1;}, p => {delete p.noise;}, p => {p.format = 'nes';}, p => {p.version = 6;}, p => {p.source = 'sid';},
    p => {p.name = 'a\ncode';}, p => {p.name = 'a'.repeat(81);}, p => {p.name = 'bad\u2028code';},
    p => {p.pulse.duty = .4;}, p => {p.pulse.volume = 16;}, p => {p.pulse.envelope.enabled = 1;}, p => {p.pulse.envelope.period = -1;},
    p => {p.pulse.sweep.period = 8;}, p => {p.pulse.sweep.shift = 1.5;}, p => {p.pulse.sweep.negate = 'true';},
    p => {p.noise.period = 16;}, p => {p.noise.volume = -1;}, p => {p.noise.shortMode = 0;},
    p => {delete p.noise.envelope;}, p => {p.noise.envelope = null;}, p => {p.noise.envelope.extra = 1;},
    p => {delete p.noise.envelope.loop;}, p => {p.noise.envelope.enabled = 1;}, p => {p.noise.envelope.loop = 'false';},
    p => {p.noise.envelope.period = -1;}, p => {p.noise.envelope.period = 16;}, p => {p.noise.envelope.period = .5;}, p => {p.noise.envelope.period = NaN;},
    p => {p.fds.wave.pop();}, p => {delete p.fds.wave[4];}, p => {p.fds.wave.foo = 1;}, p => {p.fds.wave[5] = 64;},
    p => {p.fds.volume = 33;}, p => {p.fds.master = 4;}, p => {p.fds.modulation.table[1] = 8;},
    p => {delete p.fds.envelope;}, p => {p.fds.envelope = null;}, p => {p.fds.envelope.extra = 1;},
    p => {delete p.fds.envelope.initialGain;}, p => {p.fds.envelope.enabled = 1;}, p => {p.fds.envelope.increase = 'false';}, p => {p.fds.envelope.halt = false;},
    p => {p.fds.envelope.period = -1;}, p => {p.fds.envelope.period = 64;}, p => {p.fds.envelope.period = .5;},
    p => {delete p.fds.envelopeClock;}, p => {p.fds.envelopeClock = null;}, p => {p.fds.envelopeClock.extra = 1;}, p => {delete p.fds.envelopeClock.halt;},
    p => {p.fds.envelopeClock.masterSpeed = -1;}, p => {p.fds.envelopeClock.masterSpeed = 256;}, p => {p.fds.envelopeClock.masterSpeed = NaN;}, p => {p.fds.envelopeClock.halt = 0;},
    p => {p.fds.envelope.initialGain = -1;}, p => {p.fds.envelope.initialGain = 64;}, p => {p.fds.envelope.initialGain = Infinity;},
    p => {p.fds.modulation.table.length = 31;}, p => {p.fds.modulation.table.extra = 1;},
    p => {p.fds.modulation.rate = 4096;}, p => {p.fds.modulation.depth = NaN;}, p => {p.fds.modulation.bias = -65;},
    p => {delete p.fds.modulation.envelope;}, p => {p.fds.modulation.envelope = null;}, p => {p.fds.modulation.envelope.extra = 1;}, p => {delete p.fds.modulation.envelope.initialGain;},
    p => {p.fds.modulation.envelope.enabled = 1;}, p => {p.fds.modulation.envelope.increase = 'true';},
    p => {p.fds.modulation.envelope.period = -1;}, p => {p.fds.modulation.envelope.period = 64;}, p => {p.fds.modulation.envelope.period = NaN;},
    p => {p.fds.modulation.envelope.initialGain = -1;}, p => {p.fds.modulation.envelope.initialGain = 64;}, p => {p.fds.modulation.envelope.initialGain = .5;},
    p => {Object.setPrototypeOf(p, {source: 'noise'});},
  ];
  for (const change of changes) {const preset = createDefaultPreset(); change(preset); assert.throws(() => readPreset(preset));}
});

test('v5 owns DPCM bytes and strictly migrates original v1 presets without enabling DMC', () => {
  const original = createLegacyPreset(1);
  const migrated = readPreset(original);
  assert.equal(migrated.version, 5); assert.equal(migrated.source, 'pulse');
  assert.deepEqual(migrated.dmc, {data: [], rate: 15, loop: false, level: 64});
  assert.deepEqual(migrated.noise, {...original.noise, envelope:{enabled:false, period:8, loop:false}});
  assert.deepEqual(migrated.fds, {...original.fds,envelope:volumeEnvelopeDefault,envelopeClock:envelopeClockDefault,modulation:{...original.fds.modulation,envelope:modulationEnvelopeDefault}});
  assert.throws(() => readPreset({...original, source:'dmc'}));
  assert.throws(() => readPreset({...original, dmc:migrated.dmc}));
  assert.throws(() => readPreset({...original, noise:migrated.noise}), 'v1 does not accept a hidden v3 Envelope field');
  assert.throws(() => readPreset({...original, fds:migrated.fds}), 'v1 does not accept a hidden v4 Envelope field');
  const preset = createDefaultPreset(); preset.source = 'dmc'; preset.dmc.data = createDemoDpcm();
  const restored = readPreset(JSON.parse(JSON.stringify(preset)));
  assert.deepEqual(restored, preset);
  const firstByte = preset.dmc.data[0]; restored.dmc.data[0] ^= 255; assert.equal(preset.dmc.data[0], firstByte);
  assert.equal(MAX_DPCM_BYTES, 4081); assert.equal(createDemoDpcm().length, 257);
  assert.equal(readPreset({...preset, dmc:{...preset.dmc, data:[]}}).dmc.data.length, 0, 'empty editable DMC draft is valid');
  for (const change of [
    p => {delete p.dmc;}, p => {p.dmc.extra = 1;}, p => {p.dmc.data = Array(4082).fill(0);},
    p => {p.dmc.data[0] = 256;}, p => {p.dmc.data[0] = -1;}, p => {p.dmc.data[0] = .5;},
    p => {p.dmc.data[0] = NaN;}, p => {delete p.dmc.data[0];}, p => {p.dmc.data.extra = 0;},
    p => {p.dmc.rate = 16;}, p => {p.dmc.loop = 1;}, p => {p.dmc.level = 128;},
  ]) {const invalid = structuredClone(preset); change(invalid); assert.throws(() => readPreset(invalid));}
  const inherited = structuredClone(preset); delete inherited.dmc.data[0]; inherited.dmc.data.extra = 0;
  Object.setPrototypeOf(inherited.dmc.data, {0:255}); assert.throws(() => readPreset(inherited));
});

test('v2 DPCM presets migrate to a detached disabled Noise envelope without changing other settings', () => {
  const original = createLegacyPreset(2); original.source = 'dmc';
  original.dmc = {data:[1,2,255], rate:3, loop:true, level:31};
  const before = structuredClone(original), migrated = readPreset(original);
  assert.deepEqual(original,before,'migration never edits the input');
  assert.deepEqual(migrated,{...before, version:5, noise:{...before.noise,envelope:{enabled:false,period:8,loop:false}},fds:{...before.fds,envelope:volumeEnvelopeDefault,envelopeClock:envelopeClockDefault,modulation:{...before.fds.modulation,envelope:modulationEnvelopeDefault}}});
  migrated.dmc.data[0] = 0; assert.equal(original.dmc.data[0],1);
  const another = readPreset(original); migrated.noise.envelope.period = 15;
  assert.equal(another.noise.envelope.period,8,'each legacy migration owns its Envelope settings');
  assert.throws(() => readPreset({...original,noise:another.noise}),'v2 rejects unexpected Envelope fields');
  assert.throws(() => readPreset({...original,fds:another.fds}),'v2 rejects unexpected FDS Envelope fields');
  assert.throws(() => readPreset({...original,version:3}),'v3 requires explicit Envelope settings');
  const invalid = structuredClone(original); invalid.noise.shortMode = 1;
  assert.throws(() => readPreset(invalid),'migration validates old fields before accepting them');
});

test('v3 presets retain Noise Envelope and fixed FDS output while adding independent disabled FDS Envelope settings', () => {
  const original = createLegacyPreset(3); original.source = 'fds';
  original.noise.envelope = {enabled:true,period:3,loop:true};
  original.fds.volume = 0; original.fds.master = 3;
  const before = structuredClone(original), migrated = readPreset(original);
  assert.deepEqual(original,before);
  assert.deepEqual(migrated,{...before,version:5,fds:{...before.fds,envelope:volumeEnvelopeDefault,envelopeClock:envelopeClockDefault,modulation:{...before.fds.modulation,envelope:modulationEnvelopeDefault}}});
  migrated.fds.envelope.enabled = true; migrated.fds.envelope.initialGain = 63;
  assert.deepEqual(readPreset(original).fds.envelope,createDefaultPreset().fds.envelope);
  assert.throws(() => readPreset({...original,fds:migrated.fds}),'v3 rejects an unversioned FDS Envelope extension');
  const invalid = structuredClone(original); invalid.fds.volume = 33; assert.throws(() => readPreset(invalid));
});

test('v4 FDS Envelope presets split the shared clock without changing volume or modulation settings', () => {
  const original = createLegacyPreset(4); original.source = 'fds';
  original.fds.envelope = {enabled:true,increase:true,period:63,masterSpeed:0,initialGain:63,halt:true};
  original.fds.modulation.enabled = true; original.fds.modulation.depth = 47;
  const before = structuredClone(original), migrated = readPreset(original);
  assert.deepEqual(original,before);
  assert.deepEqual(migrated,{...before,version:5,fds:{...before.fds,
    envelope:{enabled:true,increase:true,period:63,initialGain:63},envelopeClock:{masterSpeed:0,halt:true},
    modulation:{...before.fds.modulation,envelope:modulationEnvelopeDefault}}});
  migrated.fds.envelopeClock.halt = false; migrated.fds.modulation.envelope.initialGain = 63;
  assert.deepEqual(readPreset(original).fds.envelopeClock,{masterSpeed:0,halt:true});
  assert.deepEqual(readPreset(original).fds.modulation.envelope,modulationEnvelopeDefault);
  for (const version of [1,2,3,4]) {
    const legacy = createLegacyPreset(version);
    assert.throws(()=>readPreset({...legacy,fds:{...legacy.fds,envelopeClock:envelopeClockDefault}}),'legacy versions reject a hidden shared clock');
    assert.throws(()=>readPreset({...legacy,fds:{...legacy.fds,modulation:{...legacy.fds.modulation,envelope:modulationEnvelopeDefault}}}),'legacy versions reject a hidden depth Envelope');
  }
  for (const mutate of [
    p=>{delete p.fds.envelope.masterSpeed;},p=>{delete p.fds.envelope.halt;},p=>{p.fds.envelope.masterSpeed=256;},p=>{p.fds.envelope.halt=1;},
  ]) {const invalid=createLegacyPreset(4);mutate(invalid);assert.throws(()=>readPreset(invalid));}
});

test('FDS Volume and Depth Envelope exports share a clock and preserve independent raw gains after keyOn', () => {
  for (const volumeEnabled of [false,true]) for (const depthEnabled of [false,true])
    for (const increase of [false,true]) for (const period of [0,63]) for (const masterSpeed of [0,255]) for (const initialGain of [0,63]) for (const halt of [false,true]) {
      const preset = createDefaultPreset(); preset.source = 'fds'; preset.fds.master = 3;
      preset.fds.envelope = {enabled:volumeEnabled,increase,period,initialGain};
      preset.fds.envelopeClock = {masterSpeed,halt};
      preset.fds.modulation.enabled = true;
      preset.fds.modulation.envelope = {enabled:depthEnabled,increase:!increase,period:63-period,initialGain:63-initialGain};
      assert.deepEqual(readPreset(JSON.parse(JSON.stringify(preset))),preset);
      const writes = [], nes = new NesApuSynth({transport:{writeRegister:(r,v)=>writes.push([r,v])},fds:true});
      let modulationOptions; const setModulation = nes.fds.setModulation;
      nes.fds.setModulation = options=>{modulationOptions=options;return setModulation(options);};
      writes.length = 0; const code = presetToCode(preset); vm.runInNewContext(code,{nes});
      assert.deepEqual(Object.keys(modulationOptions).sort(),['bias','depth','enabled','rate','table'],'setModulation receives only fields supported by the existing public API');
      const anyEnvelope = volumeEnabled || depthEnabled;
      const volumeControl = volumeEnabled ? (increase ? 64 : 0) | period : 128 | preset.fds.volume;
      const depthControl = depthEnabled ? (!increase ? 64 : 0) | (63-period) : 128 | preset.fds.modulation.depth;
      const pitch = Math.round((440 * 2 ** ((60 - 69) / 12)) * 4194304 / nes.clock), state = nes._getState();
      assert.equal(state.registers[0x80],volumeControl); assert.equal(state.registers[0x84],depthControl);
      assert.equal(state.registers[0x83],(pitch >> 8) | (anyEnvelope && !halt ? 0 : 64));
      assert.equal(state.registers[0x89],3);
      if (anyEnvelope) {
        assert.equal(state.registers[0x8a],masterSpeed);
        const clock = writes.findLastIndex(([r])=>r===0x408a), start = writes.findLastIndex(([r])=>r===0x4083);
        for (const [enabled,address,gain,control] of [[volumeEnabled,0x4080,initialGain,volumeControl],[depthEnabled,0x4084,63-initialGain,depthControl]]) {
          if (!enabled) continue;
          const seed=writes.findLastIndex(([r,v],index)=>index<clock&&r===address&&v===(128|gain));
          const envelope=writes.findLastIndex(([r])=>r===address);
          assert(seed>=0&&seed<clock&&clock<envelope&&envelope<start,'each seed precedes the shared clock and its envelope starts before clock release');
          assert.equal(writes[envelope][1],control);
        }
        assert.equal(writes.slice(start+1).some(([r])=>[0x4080,0x4084,0x4083].includes(r)),false,'no later noteOn overwrites either envelope');
      } else {
        assert.match(code,/nes\.noteOn\(5, 'C4'\)/); assert(!code.includes('0x408a'));
      }
      assert(!code.includes('nes._getState('),'export uses the existing public API');
      assert.match(code,/Release with nes\.noteOff\(5\)/);
    }
});

test('Noise Envelope endpoints survive JSON round-trip and generated code configures the existing register API before trigger', () => {
  for (const enabled of [false,true]) for (const period of [0,15]) for (const loop of [false,true]) {
    const preset = createDefaultPreset(); preset.source = 'noise';
    preset.noise = {volume:3,period:7,shortMode:true,envelope:{enabled,period,loop}};
    assert.deepEqual(readPreset(JSON.parse(JSON.stringify(preset))),preset);
    const writes = [], nes = new NesApuSynth({transport:{writeRegister:(r,v)=>writes.push([r,v])}});
    writes.length = 0;
    vm.runInNewContext(presetToCode(preset),{nes});
    const expectedControl = enabled ? (loop ? 32 : 0) | period : 0x30 | preset.noise.volume;
    const controlWrites = writes.filter(([r]) => r === 0x400c);
    assert.equal(controlWrites.at(-1)[1],expectedControl);
    assert(writes.some(([r,v]) => r === 0x400e && v === 0x87));
    const controlIndex = writes.findLastIndex(([r]) => r === 0x400c), triggerIndex = writes.findIndex(([r]) => r === 0x400f);
    assert(controlIndex < triggerIndex && triggerIndex >= 0,'Envelope control is established before the real Noise trigger');
    assert.equal(writes[triggerIndex][1],8);
    assert.equal(nes._getState().registers[0x0c],expectedControl);
  }
});

test('built-in DPCM demo loops at level 64 without saturation or an unmatched tail', () => {
  const data = createDemoDpcm();
  assert(Array.isArray(data)); assert.equal(data.length, 257);
  assert(data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255));
  let level = 64, positiveSteps = 0, negativeSteps = 0, highCycles = 0, lowCycles = 0, halfCycle = 0;
  for (let pass = 0; pass < 3; pass++) {
    for (const byte of data) for (let bit = 0; bit < 8; bit++) {
      const up = Boolean(byte & (1 << bit));
      level += up ? 2 : -2;
      if (up) positiveSteps++; else negativeSteps++;
      assert(level >= 38 && level <= 90, 'the standard-level demo stays away from DAC saturation');
      if (halfCycle <= 0 && level >= 76) {highCycles++; halfCycle = 1;}
      if (halfCycle >= 0 && level <= 52) {lowCycles++; halfCycle = -1;}
    }
    assert.equal(level, 64, 'each whole hardware-length pass returns to the starting level');
  }
  assert.equal(positiveSteps, negativeSteps);
  assert.equal(highCycles, 48); assert.equal(lowCycles, 48);
  const original = data[0]; data[0] ^= 255; assert.equal(createDemoDpcm()[0], original, 'each call owns a fresh byte array');
});

test('DMC JavaScript export awaits encoded memory and empty drafts only explain how to load data', async () => {
  const preset = createDefaultPreset(); preset.source = 'dmc';
  const empty = presetToCode(preset); assert(!empty.includes('loadSample(')); assert(!empty.includes('dmc.play('));
  preset.dmc = {data:createDemoDpcm(), rate:5, loop:true, level:31};
  const writes = [], uploads = [];
  const nes = new NesApuSynth({transport:{writeRegister:(r,v)=>writes.push([r,v]), loadMemory:(bytes,address)=>{uploads.push({bytes,address});}}});
  writes.length = 0;
  const code = presetToCode(preset);
  await vm.runInNewContext(`(async () => {${code}\n})()`, {nes, Uint8Array});
  assert.equal(uploads.length, 1); assert.equal(uploads[0].address, 0xc000);
  assert.deepEqual(Array.from(uploads[0].bytes), preset.dmc.data);
  assert(writes.some(([r,v]) => r === 0x4010 && v === 69));
  assert(writes.some(([r,v]) => r === 0x4011 && v === 31));
  assert.match(code, /nes\.dmc\.stop\(\); nes\.writeRegister\(0x4011, 0\)/);
});

test('software wave shapes produce detached 64-point six-bit cycles', () => {
  for (const name of ['sine', 'triangle', 'saw', 'square']) {
    const wave = waveShape(name); assert.equal(wave.length, 64);
    assert(wave.every(value => Number.isInteger(value) && value >= 0 && value <= 63));
    const before = wave[0]; wave[0] = 255; assert.equal(waveShape(name)[0], before);
  }
  assert.deepEqual(waveShape('square'), [...Array(32).fill(63), ...Array(32).fill(0)]);
  assert.throws(() => waveShape('imported'));
});

test('copied code configures the actual NES Synth API for every initial source', () => {
  for (const source of ['pulse', 'triangle', 'noise', 'fds']) {
    const writes = [], preset = createDefaultPreset(); preset.source = source;
    preset.pulse.envelope.enabled = true; preset.fds.modulation.enabled = true;
    const nes = new NesApuSynth({transport: {writeRegister:(r,v) => writes.push([r,v])}, fds: true});
    writes.length = 0; vm.runInNewContext(presetToCode(preset), {nes});
    if (source === 'pulse') {assert(writes.some(([r,v]) => r === 0x4000 && !(v & 16))); assert(writes.some(([r]) => r === 0x4004));}
    if (source === 'triangle') assert(writes.some(([r,v]) => r === 0x4008 && v === 255));
    if (source === 'noise') assert(writes.some(([r]) => r === 0x400e));
    if (source === 'fds') {assert.equal(writes.filter(([r]) => r >= 0x4040 && r <= 0x407f).length, 64); assert.equal(writes.filter(([r]) => r === 0x4088).length, 32);}
  }
});
