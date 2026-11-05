// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createDefaultPreset, readPreset, waveShape, presetToCode, createDemoDpcm, MAX_DPCM_BYTES, TRIANGLE_LENGTHS, LENGTH_TABLE} from './preset.js';
import {NesApuSynth, NesApuDirectTransport} from '../js/nesapusynth.js';
import factory from '../generated/nesapu_wasm.js';
import {NesApuWasm} from '../js/nesapu_wasm.js';

const volumeEnvelopeDefault = {enabled:false,increase:false,period:8,initialGain:32};
const envelopeClockDefault = {masterSpeed:232,halt:false};
const modulationEnvelopeDefault = {enabled:false,increase:true,period:8,initialGain:0};
const triangleDefault = {control:true,linearReload:127,lengthIndex:1};
const lengthDefault = {lengthHalt:true,lengthIndex:1};
const withLengthDefaults = preset => ({...preset,pulse:{...preset.pulse,...lengthDefault},noise:{...preset.noise,...lengthDefault}});
function createLegacyPreset(version) {
  const preset = createDefaultPreset(); preset.version = version;
  if (version <= 5) delete preset.triangle;
  for (const source of ['pulse','noise']) {delete preset[source].lengthHalt; delete preset[source].lengthIndex;}
  if (version <= 4) {
    const clock = preset.fds.envelopeClock; delete preset.fds.envelopeClock; delete preset.fds.modulation.envelope;
    if (version <= 3) delete preset.fds.envelope;
    else preset.fds.envelope = {...preset.fds.envelope,...clock};
  }
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
  source.triangle = {control:false,linearReload:48,lengthIndex:0};
  const copy = readPreset(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(copy, {...source, name: 'FDS flute'});
  copy.fds.wave[0] = 63; copy.fds.modulation.table[0] = 4; copy.noise.envelope.period = 0; copy.fds.envelope.initialGain = 0;
  assert.notEqual(source.fds.wave[0], 63); assert.equal(source.fds.modulation.table[0], 1);
  assert.equal(source.noise.envelope.period, 5);
  assert.equal(source.fds.envelope.initialGain, 63);
  copy.fds.envelopeClock.masterSpeed = 0; copy.fds.modulation.envelope.initialGain = 0;
  assert.equal(source.fds.envelopeClock.masterSpeed,255); assert.equal(source.fds.modulation.envelope.initialGain,63);
  copy.triangle.linearReload = 0; assert.equal(source.triangle.linearReload,48);
});

test('strict presets reject ambiguous, sparse, non-finite, extra and out-of-hardware data', () => {
  const changes = [
    p => {p.extra = 1;}, p => {delete p.noise;}, p => {p.format = 'nes';}, p => {p.version = 8;}, p => {p.source = 'sid';},
    p => {p.name = 'a\ncode';}, p => {p.name = 'a'.repeat(81);}, p => {p.name = 'bad\u2028code';},
    p => {p.pulse.duty = .4;}, p => {p.pulse.volume = 16;}, p => {p.pulse.envelope.enabled = 1;}, p => {p.pulse.envelope.period = -1;},
    ...['pulse','noise'].flatMap(source => [
      p => {delete p[source].lengthHalt;}, p => {delete p[source].lengthIndex;}, p => {p[source].lengthHalt = 1;},
      p => {p[source].lengthHalt = 'false';}, p => {p[source].lengthIndex = -1;}, p => {p[source].lengthIndex = 32;},
      p => {p[source].lengthIndex = .5;}, p => {p[source].lengthIndex = NaN;}, p => {p[source].lengthIndex = Infinity;},
    ]),
    p => {p.pulse.sweep.period = 8;}, p => {p.pulse.sweep.shift = 1.5;}, p => {p.pulse.sweep.negate = 'true';},
    p => {delete p.triangle;}, p => {p.triangle = null;}, p => {p.triangle.extra = 1;}, p => {delete p.triangle.control;},
    p => {p.triangle.control = 1;}, p => {p.triangle.control = 'false';}, p => {p.triangle.linearReload = -1;}, p => {p.triangle.linearReload = 128;},
    p => {p.triangle.linearReload = .5;}, p => {p.triangle.linearReload = NaN;}, p => {p.triangle.lengthIndex = -1;}, p => {p.triangle.lengthIndex = 32;}, p => {p.triangle.lengthIndex = Infinity;},
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

test('v7 owns DPCM bytes and strictly migrates original v1 presets without enabling DMC', () => {
  const original = createLegacyPreset(1);
  const migrated = readPreset(original);
  assert.equal(migrated.version, 7); assert.equal(migrated.source, 'pulse');
  assert.deepEqual(migrated.triangle,triangleDefault);
  assert.deepEqual(migrated.dmc, {data: [], rate: 15, loop: false, level: 64});
  assert.deepEqual(migrated.noise, {...original.noise, ...lengthDefault, envelope:{enabled:false, period:8, loop:false}});
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
  assert.deepEqual(migrated,withLengthDefaults({...before, version:7, triangle:triangleDefault, noise:{...before.noise,envelope:{enabled:false,period:8,loop:false}},fds:{...before.fds,envelope:volumeEnvelopeDefault,envelopeClock:envelopeClockDefault,modulation:{...before.fds.modulation,envelope:modulationEnvelopeDefault}}}));
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
  assert.deepEqual(migrated,withLengthDefaults({...before,version:7,triangle:triangleDefault,fds:{...before.fds,envelope:volumeEnvelopeDefault,envelopeClock:envelopeClockDefault,modulation:{...before.fds.modulation,envelope:modulationEnvelopeDefault}}}));
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
  assert.deepEqual(migrated,withLengthDefaults({...before,version:7,triangle:triangleDefault,fds:{...before.fds,
    envelope:{enabled:true,increase:true,period:63,initialGain:63},envelopeClock:{masterSpeed:0,halt:true},
    modulation:{...before.fds.modulation,envelope:modulationEnvelopeDefault}}}));
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

test('v5 presets gain independent held Triangle settings without changing existing sound data', () => {
  const original = createLegacyPreset(5); original.source = 'triangle';
  original.noise.envelope = {enabled:true,period:3,loop:true};
  original.fds.envelope = {enabled:true,increase:true,period:12,initialGain:0};
  original.fds.envelopeClock = {masterSpeed:0,halt:true};
  original.fds.modulation.envelope = {enabled:true,increase:false,period:63,initialGain:63};
  original.dmc = {data:[1,2,255],rate:7,loop:true,level:33};
  const before = structuredClone(original), migrated = readPreset(original);
  assert.deepEqual(original,before);
  assert.deepEqual(migrated,withLengthDefaults({...before,version:7,triangle:triangleDefault}));
  migrated.triangle.control = false; migrated.triangle.lengthIndex = 0;
  migrated.dmc.data[0] = 255;
  assert.deepEqual(readPreset(original).triangle,triangleDefault);
  assert.equal(original.dmc.data[0],1);
  for (const version of [1,2,3,4,5]) {
    const legacy = createLegacyPreset(version), restored = readPreset(legacy);
    assert.deepEqual(restored.triangle,triangleDefault);
    assert.throws(()=>readPreset({...legacy,triangle:triangleDefault}),'old schemas reject an unversioned Triangle extension');
    const invalid = structuredClone(legacy); invalid.pulse.volume = 16;
    assert.throws(()=>readPreset(invalid),'migration validates the original sound data');
  }
});

test('Triangle counter settings survive JSON and exported code triggers every authored length index through the public API', () => {
  assert.equal(TRIANGLE_LENGTHS.length,32); assert(Object.isFrozen(TRIANGLE_LENGTHS));
  assert.equal(TRIANGLE_LENGTHS[0],10); assert.equal(TRIANGLE_LENGTHS[1],254); assert.equal(TRIANGLE_LENGTHS[31],30);
  assert(TRIANGLE_LENGTHS.every(value=>Number.isInteger(value)&&value>0));
  for (const control of [false,true]) for (const linearReload of [0,48,127]) for (let lengthIndex=0;lengthIndex<32;lengthIndex++) {
    const preset = createDefaultPreset(); preset.source = 'triangle'; preset.triangle = {control,linearReload,lengthIndex};
    assert.deepEqual(readPreset(JSON.parse(JSON.stringify(preset))),preset);
    const writes = [], nes = new NesApuSynth({transport:{writeRegister:(address,value)=>writes.push([address,value])}});
    writes.length = 0; const code = presetToCode(preset); vm.runInNewContext(code,{nes});
    const period = Math.round(nes.clock / (32 * (440 * 2 ** ((60-69)/12))) - 1), state = nes._getState();
    assert.equal(state.registers[8],(control?128:0)|linearReload);
    assert.equal(state.registers[10],period&255);
    assert.equal(state.registers[11],(lengthIndex<<3)|(period>>8),'index zero remains zero instead of falling back to index one');
    assert.equal(state.enabled&4,4);
    const controlAt = writes.findLastIndex(([address])=>address===0x4008), triggerAt = writes.findLastIndex(([address])=>address===0x400b);
    assert(controlAt>=0&&controlAt<triggerAt,'Triangle counter settings precede the enabled-channel trigger');
    assert.equal(writes[triggerAt][1]>>3,lengthIndex);
    assert(!writes.slice(triggerAt+1).some(([address])=>address===0x400b),'no later generic noteOn resets the authored length index');
    assert.match(code,/nes\.triangle\.keyOn\(\)/); assert(!code.includes('nes.noteOn('));
    assert(!code.includes('nes._getState(')); assert.match(code,/Release with nes\.noteOff\(2\)/);
  }
});

test('v1–v6 migration keeps old fixed-volume holds and Envelope Loop while adding strict independent Length settings', () => {
  for (let version=1;version<=6;version++) {
    const original = createLegacyPreset(version);
    original.pulse.envelope = {enabled:true,period:0,loop:false};
    if (version>=3) original.noise.envelope = {enabled:true,period:15,loop:true};
    if (version===6) original.triangle = {control:false,linearReload:24,lengthIndex:0};
    const before = structuredClone(original), migrated = readPreset(original);
    assert.equal(migrated.version,7); assert.deepEqual(original,before);
    for (const source of ['pulse','noise']) {
      assert.equal(migrated[source].lengthHalt,true); assert.equal(migrated[source].lengthIndex,1);
      assert.deepEqual(migrated[source].envelope,source==='noise'&&version<3?{enabled:false,period:8,loop:false}:original[source].envelope);
      for (const [field,value] of Object.entries(lengthDefault)) {
        const invalid = structuredClone(original); invalid[source][field]=value;
        assert.throws(()=>readPreset(invalid),`v${version} ${source} rejects hidden ${field}`);
      }
    }
    if (version===6) assert.deepEqual(migrated.triangle,original.triangle);
    migrated.pulse.lengthHalt=false; migrated.noise.lengthIndex=0;
    assert.equal(readPreset(original).pulse.lengthHalt,true); assert.equal(readPreset(original).noise.lengthIndex,1);
  }
});

test('Pulse and Noise exported code preserves every Length index and the shared Envelope Loop / halt bit', () => {
  assert.equal(LENGTH_TABLE,TRIANGLE_LENGTHS,'all three APU generators share the same hardware table');
  for (const source of ['pulse','noise']) for (const enabled of [false,true]) for (const loop of [false,true])
    for (const lengthHalt of [false,true]) for (let lengthIndex=0;lengthIndex<32;lengthIndex++) {
      const preset=createDefaultPreset(); preset.source=source;
      Object.assign(preset[source],{lengthHalt,lengthIndex});
      preset[source].envelope={enabled,period:15,loop};
      assert.deepEqual(readPreset(JSON.parse(JSON.stringify(preset))),preset);
      const writes=[],nes=new NesApuSynth({transport:{writeRegister:(address,value)=>writes.push([address,value])}});
      nes.pulse.noteOn(1,'C4'); writes.length=0;
      const code=presetToCode(preset); vm.runInNewContext(code,{nes});
      const channel=source==='pulse'?0:3,base=channel*4,state=nes._getState();
      const halt=enabled?loop:lengthHalt;
      assert.equal(Boolean(state.registers[base]&32),halt);
      assert.equal(Boolean(state.registers[base]&16),!enabled);
      assert.equal(state.registers[base+3]>>3,lengthIndex);
      assert.equal(state.enabled&(1<<channel),1<<channel);
      assert.equal(state.enabled&2,2,'audition preserves an already enabled second Pulse');
      const trigger=writes.findLastIndex(([address])=>address===0x4003+base);
      assert(trigger>=0); assert.equal(writes[trigger][1]>>3,lengthIndex);
      assert(!code.includes('nes._getState(')); assert(!code.includes('nes.noteOn('));
      assert.match(code,new RegExp(`Release with nes\\.noteOff\\(${channel}\\)`));
    }
});

test('exported Pulse / Noise code starts the real WASM Length Counter, including index zero and Envelope-coupled holds', async t => {
  const wasmBinary=await readFile(new URL('../generated/nesapu_wasm.wasm',import.meta.url));
  for (const sampleRate of [44100,48000]) {
    const core=await NesApuWasm.create({moduleFactory:factory,moduleOptions:{wasmBinary},sampleRate,fds:true});
    t.after(()=>core.dispose());
    const nes=new NesApuSynth({transport:new NesApuDirectTransport(core),fds:true});
    for (const source of ['pulse','noise']) for (const lengthIndex of [0,3,31])
      for (const [enabled,loop,lengthHalt] of [[false,false,false],[false,false,true],[true,false,true],[true,true,false]]) {
        nes.reset();
        const preset=createDefaultPreset();preset.source=source;
        Object.assign(preset[source],{lengthIndex,lengthHalt});preset[source].envelope={enabled,period:15,loop};
        vm.runInNewContext(presetToCode(preset),{nes});
        const channel=source==='pulse'?0:3,halt=enabled?loop:lengthHalt;
        assert.equal(core.getState().lengths[channel],LENGTH_TABLE[lengthIndex]);
        const pcm=core.generateStereo(Math.ceil(sampleRate*(LENGTH_TABLE[lengthIndex]/120+.06)));
        assert(pcm.left.every(Number.isFinite));assert(pcm.right.every(Number.isFinite));
        assert.equal(core.getState().lengths[channel],halt?LENGTH_TABLE[lengthIndex]:0,`${source} ${sampleRate} ${lengthIndex} halt=${halt}`);
        assert(pcm.left.some(value=>Math.abs(value)>.0001),'a real oscillator produced audible data before gate expiry');
        nes.noteOff(channel); assert.equal(core.getState().lengths[channel],0);
      }
  }
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
    preset.noise = {...preset.noise,volume:3,period:7,shortMode:true,envelope:{enabled,period,loop}};
    assert.deepEqual(readPreset(JSON.parse(JSON.stringify(preset))),preset);
    const writes = [], nes = new NesApuSynth({transport:{writeRegister:(r,v)=>writes.push([r,v])}});
    writes.length = 0;
    vm.runInNewContext(presetToCode(preset),{nes});
    const expectedControl = enabled ? (loop ? 32 : 0) | period : 0x30 | preset.noise.volume;
    const controlWrites = writes.filter(([r]) => r === 0x400c);
    assert.equal(controlWrites.at(-1)[1],expectedControl);
    assert(writes.some(([r,v]) => r === 0x400e && v === 0x87));
    const controlIndex = writes.findLastIndex(([r]) => r === 0x400c), triggerIndex = writes.findLastIndex(([r]) => r === 0x400f);
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
