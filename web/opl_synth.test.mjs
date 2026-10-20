import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundChip} from './soundchip.js';
import {OPLSynth,OPLDirectTransport,OPL_PRESETS,oplPitchFromHz} from './opl_synth.js';

const names = ['ym3526','ym3812','y8950','ymf262'];
function capture(chip = 'ym3812') {
  const writes = []; let resets = 0;
  const synth = new OPLSynth({chip,transport:{writeRegister:(r,v,p=0) => writes.push([r,v,p]),reset() {resets++;}}});
  return {synth,writes,resets:() => resets};
}
function frequency(pcm,rate) {
  const crossings = [];
  for (let i = Math.ceil(rate * .02); i < pcm.length; i++) {
    if (pcm[i-1] < 0 && pcm[i] >= 0) crossings.push(i-1 - pcm[i-1] / (pcm[i]-pcm[i-1]));
  }
  assert(crossings.length > 8,'Tone must contain enough periods');
  return (crossings.length - 1) * rate / (crossings.at(-1)-crossings[0]);
}
function audible(pcm,label = 'tone') {
  assert(pcm.left.every(Number.isFinite),`${label}: left finite`);
  assert(pcm.right.every(Number.isFinite),`${label}: right finite`);
  assert(pcm.left.some(v => Math.abs(v) > .001) || pcm.right.some(v => Math.abs(v) > .001),`${label}: audible`);
}

test('OPL construction borrows transport without resetting; initialization is explicit', () => {
  for (const chip of names) {
    const {synth,writes,resets} = capture(chip);
    assert.equal(writes.length,0); assert.equal(resets(),0);
    assert.equal(synth.channels,chip === 'ymf262' ? 18 : 9);
    assert.equal(synth.clock,chip === 'ymf262' ? 14318180 : 3579545);
    synth.initialize(); assert.equal(resets(),1);
    const image = synth.getRegisterSnapshot();
    assert.equal(image.length,chip === 'ymf262' ? 512 : 256);
    if (chip === 'ym3812') assert.equal(image[1],32);
    if (chip === 'ymf262') assert.equal(image[0x105],1);
    assert.equal(image[0x40] & 63,63); assert.equal(image[0x43] & 63,63);
    for (let ch = 0; ch < synth.channels; ch++) assert.equal(image[(ch >= 9 ? 0x100 : 0) + 0xb0 + ch % 9] & 32,0);
    synth.reset(); assert(synth.getRegisterSnapshot().every(v => v === 0));
  }
});

test('OPL uses documented logical modulator/carrier slots on every physical channel', () => {
  const {synth,writes} = capture('ymf262');
  const expected = [[0,3],[1,4],[2,5],[8,11],[9,12],[10,13],[16,19],[17,20],[18,21]];
  for (let bank = 0; bank < 2; bank++) for (let ch = 0; ch < 9; ch++) {
    for (let op = 0; op < 2; op++) {
      synth.setOperator(bank * 9 + ch,op,{multi:3,tl:12,ar:15,dr:4,sl:5,rr:6,waveform:7});
      const slot = expected[ch][op];
      assert.deepEqual(writes.splice(0),[[0x20+slot,3,bank],[0x40+slot,12,bank],[0x60+slot,0xf0,bank],[0x60+slot,0xf4,bank],[0x80+slot,0x50,bank],[0x80+slot,0x56,bank],[0xe0+slot,7,bank]]);
    }
  }
  synth.setFourOp(9,true); writes.length = 0;
  for (let op = 0; op < 4; op++) synth.setOperator(9,op,{multi:op+1});
  assert.deepEqual(writes,[[0x20,1,1],[0x23,2,1],[0x28,3,1],[0x2b,4,1]]);
});

test('OPL partial edits preserve raw key, rhythm, operator and output-routing bits', () => {
  const {synth,writes} = capture('ymf262');
  synth.writeRegister(0x20,0xff); synth.setOperator(0,0,{multi:2}); assert.deepEqual(writes.at(-1),[0x20,0xf2,0]);
  synth.setOperator(0,0,{egt:false,ksr:false}); assert.equal(synth.getRegisterSnapshot()[0x20],0xc2);
  synth.writeRegister(0x40,0xd3); synth.setOperator(0,0,{tl:7}); assert.equal(synth.getRegisterSnapshot()[0x40],0xc7);
  synth.writeRegister(0xb0,0xe0); synth.setPitch(0,580,4); assert.equal(synth.getRegisterSnapshot()[0xb0],0xf2);
  synth.setFrequency(0,220); assert.equal(synth.getRegisterSnapshot()[0xb0] & 0xe0,0xe0);
  synth.writeRegister(0xc0,0xcf); synth.setAlgo(0,0); assert.equal(synth.getRegisterSnapshot()[0xc0],0xce);
  synth.setPan(0,true,false); assert.equal(synth.getRegisterSnapshot()[0xc0],0xde);
  synth.setAlgo(0,1,2); assert.equal(synth.getRegisterSnapshot()[0xc0],0xd5);
  synth.writeRegister(0xbd,0x2b); synth.setLFO({amDepth:true}); assert.equal(synth.getRegisterSnapshot()[0xbd],0xab);
  synth.setRhythm({snare:false,tom:true}); assert.equal(synth.getRegisterSnapshot()[0xbd],0xa7);
  synth.setLFO({pmDepth:true,amDepth:false}); assert.equal(synth.getRegisterSnapshot()[0xbd],0x67);
  const opl2 = capture().synth;
  opl2.writeRegister(0xe0,0xfc); opl2.setOperator(0,0,{waveform:3}); assert.equal(opl2.getRegisterSnapshot()[0xe0],0xff,'OPL2 preserves unused waveform bit 2');
});

test('OPL snapshots are independent, atomically validated and adopted without writes', () => {
  const {synth,writes,resets} = capture('ymf262');
  const snapshot = new Uint8Array(512); snapshot[0x140] = 0xed; snapshot[0x104] = 8;
  synth.adoptRegisterSnapshot(snapshot); assert.equal(writes.length,0); assert.equal(resets(),0);
  snapshot[0x140] = 0; const copy = synth.getRegisterSnapshot(); copy[0x140] = 0;
  assert.equal(synth.getRegisterSnapshot()[0x140],0xed);
  synth.setOperator(9,0,{tl:3}); assert.deepEqual(writes.at(-1),[0x40,0xc3,1]);
  assert(synth.isFourOp(9));
  const invalid = Array.from(snapshot); invalid[511] = -1;
  const prior = synth.getRegisterSnapshot(), count = writes.length;
  for (const bad of [null,new Uint8Array(256),invalid]) assert.throws(() => synth.adoptRegisterSnapshot(bad));
  assert.equal(writes.length,count); assert.deepEqual(synth.getRegisterSnapshot(),prior);
  synth.writeRegister(0x160,0xff); synth.setOperator(9,0,{dr:3}); assert.deepEqual(writes.at(-1),[0x60,0xf3,1]);
});

test('OPL rejects an invalid complete edit before writing any register', () => {
  for (const chip of names) {
    const {synth,writes} = capture(chip);
    for (const run of [
      () => synth.setOperator(0,0,{multi:2,ar:16}),
      () => synth.setOperator(0,0,{mul:1,multi:2}),
      () => synth.setOperator(0,0,{egt:true,sustain:false}),
      () => synth.setOperator(0,0,{am:2}),
      () => synth.setOperator(0,0,{unknown:1}),
      () => synth.setPreset(0,{algorithm:0,operators:[{tl:20},{rr:16}]}),
      () => synth.setPreset(0,{fourOp:true,operators:[{tl:20},{tl:20},{tl:20},{ar:16}]}),
      () => synth.setPreset(0,{fourOp:true,algorithm:4}),
      () => synth.setPreset(0,{pan:{left:true,right:'yes'}}),
      () => synth.setRhythm({enabled:true,snare:1}),
      () => synth.setLFO({amDepth:true,frequency:2}),
      () => synth.setPitch(0,1024,3),
      () => synth.setPitch(0,400,8),
      () => synth.noteOn(synth.channels,'A4'),
      () => synth.noteOn(0,'C10'),
      () => synth.noteOn(0,69.5),
      () => synth.noteOn(0,127),
      () => synth.setFrequency(0,0),
      () => synth.setFrequency(0,NaN),
      () => synth.setFrequency(0,1e9),
      () => synth.writeRegister(512,1),
      () => synth.writeRegister(0x100,1,1),
    ]) assert.throws(run,chip);
    if (chip !== 'ymf262') {
      assert.throws(() => synth.setPan(0,false,true));
      assert.throws(() => synth.setFourOp(0,true));
    }
    assert.throws(() => synth.setOperator(0,0,{waveform:chip === 'ymf262' ? 8 : chip === 'ym3812' ? 4 : 1}));
    assert.equal(writes.length,0,chip);
  }
});

test('OPL3 pair changes stop both physical keys and preserve other pairs and fields', () => {
  const {synth,writes} = capture('ymf262');
  synth.writeRegister(0x104,0xc0); synth.writeRegister(0xb0,0xf2); synth.writeRegister(0xb3,0xeb);
  writes.length = 0; synth.setFourOp(0,true);
  assert.deepEqual(writes,[[0xb0,0xd2,0],[0xb3,0xcb,0],[4,0xc1,1]]);
  synth.writeRegister(0xc0,0xfe); synth.writeRegister(0xc3,0x7e);
  synth.setAlgo(0,3,5); assert.equal(synth.getRegisterSnapshot()[0xc0],0xfb); assert.equal(synth.getRegisterSnapshot()[0xc3],0x7f);
  synth.setPan(0,false,true); assert.equal(synth.getRegisterSnapshot()[0xc0],0xeb); assert.equal(synth.getRegisterSnapshot()[0xc3],0x6f);
  const count = writes.length;
  for (const operation of [() => synth.noteOn(3,'A4'),() => synth.setOperator(3,0,{tl:10}),() => synth.setFourOp(3,true)]) assert.throws(operation);
  assert.equal(writes.length,count);
  synth.setPreset(0,OPL_PRESETS.sine); assert(!synth.isFourOp(0)); assert.equal(synth.getRegisterSnapshot()[0x104],0xc0);
  synth.noteOn(3,'A4'); assert.equal(synth.getRegisterSnapshot()[0xb3] & 32,32);
});

test('OPL allNotesOff releases physical keys and drums without changing their patches', () => {
  const {synth} = capture('ymf262');
  for (let ch = 0; ch < 18; ch++) synth.writeRegister(0xb0 + ch % 9,0xff,ch >= 9 ? 1 : 0);
  synth.writeRegister(0xbd,0xff); synth.writeRegister(4,0x3f,1);
  synth.allNotesOff();
  for (let ch = 0; ch < 18; ch++) assert.equal(synth.getRegisterSnapshot()[(ch >= 9 ? 0x100 : 0) + 0xb0 + ch % 9],0xdf);
  assert.equal(synth.getRegisterSnapshot()[0xbd],0xe0); assert.equal(synth.getRegisterSnapshot()[0x104],0x3f);
  const {synth:rhythm,writes} = capture(); rhythm.setRhythm({enabled:true}); writes.length = 0;
  assert.throws(() => rhythm.noteOn(6,'A4')); assert.equal(writes.length,0);
});

test('OPL rhythm mode changes release only CH6..8; partial drum edits preserve melodic gates', () => {
  const {synth,writes} = capture();
  for (const [reg,value] of [[0xb5,0xf1],[0xb6,0xf2],[0xb7,0xee],[0xb8,0xf4],[0xbd,0xc0]]) synth.writeRegister(reg,value);
  writes.length = 0;
  synth.setRhythm({enabled:true,bassDrum:true});
  assert.deepEqual(writes,[[0xb6,0xd2,0],[0xb7,0xce,0],[0xb8,0xd4,0],[0xbd,0xe0,0],[0xbd,0xf0,0]]);
  assert.equal(synth.getRegisterSnapshot()[0xb5],0xf1);
  synth.writeRegister(0xb6,0xf2); writes.length = 0;
  synth.setRhythm({enabled:true,snare:true});
  synth.setLFO({amDepth:false});
  assert(writes.every(([r]) => r === 0xbd)); assert.equal(synth.getRegisterSnapshot()[0xb6],0xf2);
  const before = synth.getRegisterSnapshot(), count = writes.length;
  assert.throws(() => synth.setRhythm({enabled:false,bassDrum:'yes'}));
  assert.equal(writes.length,count); assert.deepEqual(synth.getRegisterSnapshot(),before);
  synth.setRhythm({enabled:false}); assert.equal(synth.getRegisterSnapshot()[0xb6],0xd2);
});

test('OPL observer and write filter mirror only writes accepted by the transport', () => {
  const {synth,writes} = capture('ymf262'); const events = [];
  synth._observe = event => events.push(event);
  synth._beforeWrite = (r,v,p) => !(r === 0x20 && p === 1);
  synth.writeRegister(0x120,7); assert.equal(writes.length,0); assert.equal(events.length,0); assert.equal(synth.getRegisterSnapshot()[0x120],0);
  synth.writeRegister(0x1b8,0x32); assert.deepEqual(events[0],{method:'writeRegister',args:[0xb8,0x32,1],channel:17});
  synth.reset(); assert.deepEqual(events[1],{method:'reset',args:[]});
});

test('OPL DirectTransport writes the correct bank without taking chip ownership', () => {
  const bus = []; let resets = 0;
  const raw = {write:(o,v) => bus.push([o,v]),reset() {resets++;},sampleRate:clock => clock / 288,generateStereo:frames => ({left:new Float32Array(frames),right:new Float32Array(frames)})};
  const transport = new OPLDirectTransport(raw,{chip:'ymf262'});
  transport.writeRegister(0x120,7); transport.writeRegister(0xb8,32,1); transport.writeRegister(0xa0,1);
  assert.deepEqual(bus,[[2,0x20],[3,7],[2,0xb8],[3,32],[0,0xa0],[1,1]]);
  assert.equal(resets,0); assert.equal(transport.sampleRate(),14318180 / 288);
  assert.equal(transport.generateStereo(3).left.length,3);
  const count = bus.length; assert.throws(() => transport.writeRegister(0x120,3,1)); assert.equal(bus.length,count);
});

for (const name of names) test(`${name}: real WASM gives A4 at both clocks on every channel, and releases`,async () => {
  const chip = await createSoundChip(name);
  try {
    const baseClock = name === 'ymf262' ? 14318180 : 3579545;
    for (const scale of [1,.8]) {
      const clock = baseClock * scale;
      const transport = new OPLDirectTransport(chip,{chip:name,clock});
      const synth = new OPLSynth({transport,chip:name,clock});
      const rate = transport.sampleRate();
      for (let ch = 0; ch < synth.channels; ch++) {
        synth.initialize(); synth.setPreset(ch,OPL_PRESETS.sine); synth.noteOn(ch,'A4');
        const pcm = transport.generateStereo(Math.ceil(rate * .14)); audible(pcm,`${name} CH${ch}`);
        assert(Math.abs(frequency(pcm.left,rate)-440) < 1.5,`${name} CH${ch}, clock ${clock}: ${frequency(pcm.left,rate)} Hz`);
        assert.deepEqual(synth.setNote(ch,69),synth.setNote(ch,'A4'));
        if (name === 'ymf262') {
          synth.setPan(ch,false,true); const routed = transport.generateStereo(128);
          assert(routed.left.every(v => v === 0)); assert(routed.right.some(v => v !== 0));
        } else assert.deepEqual(pcm.left,pcm.right);
        synth.noteOff(ch); transport.generateStereo(Math.ceil(rate * .7));
        const tail = transport.generateStereo(128); assert(tail.left.every(v => Math.abs(v) < .0001)); assert(tail.right.every(v => Math.abs(v) < .0001));
      }
    }
  } finally {chip.dispose();}
});

test('OPL3: real WASM gives four-operator A4 for all six pairs and four algorithms',async () => {
  const chip = await createSoundChip('ymf262');
  const transport = new OPLDirectTransport(chip,{chip:'ymf262'}), synth = new OPLSynth({transport,chip:'ymf262'}), rate = transport.sampleRate();
  try {
    for (const ch of [0,1,2,9,10,11]) for (let algorithm = 0; algorithm < 4; algorithm++) {
      synth.initialize();
      const silent = OPL_PRESETS.sine.operators[0], carrier = OPL_PRESETS.sine.operators[1];
      synth.setPreset(ch,{fourOp:true,algorithm,feedback:0,pan:{left:true,right:false},operators:[silent,silent,silent,carrier]});
      synth.noteOn(ch,'A4');
      const pcm = transport.generateStereo(Math.ceil(rate * .15)); audible(pcm,`CH${ch} algorithm ${algorithm}`);
      assert(pcm.right.every(v => v === 0));
      const hz = frequency(pcm.left,rate); assert(Math.abs(hz-440) < 1.5,`CH${ch} algorithm ${algorithm}: ${hz} Hz`);
      synth.allNotesOff(); transport.generateStereo(Math.ceil(rate * .7));
      assert(transport.generateStereo(128).left.every(v => Math.abs(v) < .0001));
    }
  } finally {chip.dispose();}
});

test('OPL3: a disconnected secondary can sound immediately without an intermediate PCM frame',async () => {
  const chip = await createSoundChip('ymf262');
  const transport = new OPLDirectTransport(chip,{chip:'ymf262'}), synth = new OPLSynth({transport,chip:'ymf262'}), rate = transport.sampleRate();
  try {
    synth.initialize(); synth.setPreset(0,OPL_PRESETS['four-op-bell']); synth.noteOn(0,'A4');
    transport.generateStereo(4096); // Install the four-op operator mapping.
    synth.setFourOp(0,false);
    synth.setPreset(3,OPL_PRESETS.sine); synth.noteOn(3,'A4');
    transport.generateStereo(Math.ceil(rate * .7));
    const pcm = transport.generateStereo(Math.ceil(rate * .15)); audible(pcm,'disconnected CH3');
    const hz = frequency(pcm.left,rate); assert(Math.abs(hz-440) < 1.5,`Disconnected CH3: ${hz} Hz`);
  } finally {chip.dispose();}
});

for (const name of names) test(`${name}: original presets, waveform selections and rhythm produce finite audio`,async () => {
  const chip = await createSoundChip(name), transport = new OPLDirectTransport(chip,{chip:name}), synth = new OPLSynth({transport,chip:name});
  try {
    for (const preset of Object.values(OPL_PRESETS)) {
      if (preset.fourOp && name !== 'ymf262') continue;
      synth.initialize(); synth.setPreset(0,preset); synth.noteOn(0,'C4'); audible(transport.generateStereo(6000),`${name} ${preset.label}`);
    }
    const max = name === 'ymf262' ? 7 : name === 'ym3812' ? 3 : 0;
    let sine;
    for (let waveform = 0; waveform <= max; waveform++) {
      synth.initialize(); synth.setPreset(0,OPL_PRESETS.sine); synth.setOperator(0,1,{waveform}); synth.noteOn(0,'A4');
      const pcm = transport.generateStereo(4096); audible(pcm,`${name} waveform ${waveform}`);
      if (waveform === 0) sine = pcm.left;
      else assert.notDeepEqual(pcm.left,sine,`${name} waveform ${waveform} differs from sine`);
    }
    synth.initialize();
    for (const ch of [6,7,8]) {synth.setPreset(ch,OPL_PRESETS.organ); synth.setNote(ch,'A4');}
    synth.setLFO({amDepth:true,pmDepth:true}); synth.setRhythm({enabled:true,bassDrum:true,snare:true,tom:true,cymbal:true,hiHat:true});
    audible(transport.generateStereo(4096),`${name} rhythm`);
    synth.allNotesOff(); transport.generateStereo(60000); assert(transport.generateStereo(128).left.every(v => Math.abs(v) < .0001));
  } finally {chip.dispose();}
});

test('OPL pitch conversion rejects unrepresentable frequencies and respects model master clocks', () => {
  for (const chip of names) {
    const clock = chip === 'ymf262' ? 14318180 : 3579545;
    assert.deepEqual(oplPitchFromHz(440,clock,chip),{fnum:580,block:4});
    for (const hz of [0,-1,NaN,Infinity,1e-8,1e9]) assert.throws(() => oplPitchFromHz(hz,clock,chip));
  }
});
