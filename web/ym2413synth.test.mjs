import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundChip} from './soundchip.js';
import {YM2413Synth,YM2413DirectTransport,YM2413_INSTRUMENTS,YM2413_USER_PRESETS,ym2413PitchFromHz} from './ym2413synth.js';

function capture(clock = 3579545) {
  const writes = []; let resets = 0;
  const synth = new YM2413Synth({clock,transport:{writeRegister:(r,v) => writes.push([r,v]),reset() {resets++;}}});
  return {synth,writes,resets:() => resets};
}
function audible(pcm,label) {
  assert(pcm.left.every(Number.isFinite),`${label}: finite left`);
  assert(pcm.right.every(Number.isFinite),`${label}: finite right`);
  assert(pcm.left.some(v => Math.abs(v) > .001),`${label}: audible`);
  assert.deepEqual(pcm.left,pcm.right,`${label}: mono is mirrored to both outputs`);
}
function frequency(pcm,rate) {
  const crossings = [];
  for (let i = Math.ceil(rate * .04); i < pcm.length; i++) if (pcm[i-1] < 0 && pcm[i] >= 0) crossings.push(i-1-pcm[i-1]/(pcm[i]-pcm[i-1]));
  assert(crossings.length > 10,'Enough periods to estimate frequency');
  return (crossings.length-1)*rate/(crossings.at(-1)-crossings[0]);
}

test('OPLL construction makes no writes; explicit initialization installs a shared patch and silent voices', () => {
  const {synth,writes,resets} = capture();
  assert.equal(writes.length,0); assert.equal(resets(),0);
  assert.equal(synth.chip,'ym2413'); assert.equal(synth.channels,9); assert.equal(synth.clock,3579545);
  synth.initialize(); assert.equal(resets(),1);
  const image = synth.getRegisterSnapshot(); assert.equal(image.length,64);
  assert.deepEqual([...image.slice(0,8)],[0x21,0x21,63,0,0xf0,0xf0,12,12]);
  for (let ch = 0; ch < 9; ch++) {assert.equal(image[0x30+ch],0x1f); assert.equal(image[0x20+ch],0);}
  synth.reset(); assert(synth.getRegisterSnapshot().every(v => v === 0));
});

test('OPLL built-in instrument numbers and original user patches are explicit immutable metadata', () => {
  assert.equal(YM2413_INSTRUMENTS.length,16); assert.equal(YM2413_INSTRUMENTS[0],'User'); assert.equal(YM2413_INSTRUMENTS[1],'Violin'); assert.equal(YM2413_INSTRUMENTS[15],'Electric Guitar');
  assert(Object.isFrozen(YM2413_INSTRUMENTS)); assert(Object.isFrozen(YM2413_USER_PRESETS));
  for (const patch of Object.values(YM2413_USER_PRESETS)) {
    assert(Object.isFrozen(patch)); assert(Object.isFrozen(patch.operators));
    assert(patch.operators.every(Object.isFrozen)); assert(!('tl' in patch.operators[1]));
  }
});

test('OPLL channel fields preserve adjacent raw instrument, attenuation, gate and sustain bits', () => {
  const {synth,writes} = capture();
  synth.writeRegister(0x30,0xd6); synth.setInstrument(0,3); assert.deepEqual(writes.at(-1),[0x30,0x36]);
  synth.setAttenuation(0,9); assert.deepEqual(writes.at(-1),[0x30,0x39]);
  synth.writeRegister(0x20,0xf8); synth.setSustain(0,false); assert.deepEqual(writes.at(-1),[0x20,0xd8]);
  synth.setPitch(0,290,4); assert.deepEqual(writes.slice(-2),[[0x10,0x22],[0x20,0xd9]]);
  synth.setSustain(0,true); assert.deepEqual(writes.at(-1),[0x20,0xf9]);
  synth.noteOff(0); assert.deepEqual(writes.at(-1),[0x20,0xe9]);
  synth.noteOn(0,'A4'); assert.deepEqual(writes.slice(-3),[[0x10,0x22],[0x20,0xe9],[0x20,0xf9]]);
  assert.deepEqual(synth.setNote(8,69),synth.setNote(8,'A4'));
  assert.deepEqual(synth.setFrequency(8,440),{fnum:290,block:4});
});

test('OPLL user-operator fields use the actual shared eight-register layout', () => {
  const {synth,writes} = capture();
  for (let r = 0; r < 8; r++) synth.writeRegister(r,255);
  synth.setUserOperator(0,{multi:2,tl:1}); assert.deepEqual(writes.slice(-2),[[0,0xf2],[2,0xc1]]);
  synth.setUserOperator(1,{mul:3,ksl:1}); assert.deepEqual(writes.slice(-2),[[1,0xf3],[3,0x7f]]);
  synth.setUserOperator(0,{waveform:0}); assert.deepEqual(writes.at(-1),[3,0x77]);
  synth.setUserOperator(1,{waveform:0}); assert.deepEqual(writes.at(-1),[3,0x67]);
  synth.setUserPatch({feedback:2}); assert.deepEqual(writes.at(-1),[3,0x62],'Reserved bit 5 and carrier KSL stay intact');
  synth.setUserOperator(1,{am:false,vibrato:false,egt:false,ksr:false,ar:9,dr:4,sl:8,rr:5});
  assert.deepEqual(writes.slice(-8),[[1,0x73],[1,0x33],[1,0x13],[1,3],[5,0x9f],[5,0x94],[7,0x8f],[7,0x85]]);
  const before = writes.length; synth.setUserOperator(0,{sustain:1,ksr:true});
  assert.equal(writes.length,before+2);
});

test('OPLL user patches are globally shared rather than faked as independent channel patches', () => {
  const {synth,writes} = capture();
  synth.setInstrument(0,0,3); synth.setInstrument(1,0,6); writes.length = 0;
  synth.setPreset(2,{userPatch:YM2413_USER_PRESETS.sine,attenuation:4,sustain:false});
  const snapshot = synth.getRegisterSnapshot();
  assert.equal(snapshot[0x30],3); assert.equal(snapshot[0x31],6); assert.equal(snapshot[0x32],4);
  assert(writes.filter(([r]) => r < 8).length > 8);
  assert(!writes.some(([r]) => r === 0x30 || r === 0x31),'Existing instrument-0 voices use the same shared patch without channel replay');
  const raw = [0x21,0x21,63,0x20,0xf0,0xf0,12,12];
  writes.length = 0; synth.setUserPatch(raw); assert.deepEqual(writes,raw.map((v,r) => [r,v]));
  assert.deepEqual([...synth.getRegisterSnapshot().slice(0,8)],raw);
});

test('OPLL snapshot copies and atomic adoption never write or reset the borrowed chip', () => {
  const {synth,writes,resets} = capture();
  const input = new Uint8Array(64); input[0x30] = 0xf7; input[3] = 0xa0;
  synth.adoptRegisterSnapshot(input); input[3] = 0;
  const copy = synth.getRegisterSnapshot(); copy[3] = 0;
  assert.equal(synth.getRegisterSnapshot()[3],0xa0); assert.equal(writes.length,0); assert.equal(resets(),0);
  synth.setUserPatch({feedback:3}); assert.deepEqual(writes.at(-1),[3,0xa3]);
  const image = synth.getRegisterSnapshot(), count = writes.length, invalid = Array.from(image); invalid[63] = 256;
  for (const bad of [invalid,new Uint8Array(63),null]) assert.throws(() => synth.adoptRegisterSnapshot(bad));
  assert.deepEqual(synth.getRegisterSnapshot(),image); assert.equal(writes.length,count);
});

test('OPLL complete voice, user patch, note and rhythm edits validate before any write', () => {
  const {synth,writes} = capture();
  for (const run of [
    () => synth.setVoice(0,{instrument:3,attenuation:16}),
    () => synth.setVoice(0,{sustain:1}),
    () => synth.setInstrument(0,16),
    () => synth.setInstrument(0,3,-1),
    () => synth.setPreset(0,{userPatch:YM2413_USER_PRESETS.bell,attenuation:16}),
    () => synth.setPreset(0,{instrument:1,userPatch:YM2413_USER_PRESETS.sine}),
    () => synth.setUserPatch({feedback:3,operators:[{tl:12},{rr:16}]}),
    () => synth.setUserPatch({feedback:8}),
    () => synth.setUserPatch([1,2,3,4,5,6,7,256]),
    () => synth.setUserPatch(new Uint8Array(7)),
    () => synth.setUserPatch({operators:[{}, {}, {}]}),
    () => synth.setUserOperator(0,{multi:2,ar:16}),
    () => synth.setUserOperator(1,{tl:1}),
    () => synth.setUserOperator(0,{dt:1}),
    () => synth.setUserOperator(0,{multi:1,mul:2}),
    () => synth.setUserOperator(0,{egt:true,sustain:false}),
    () => synth.setUserOperator(0,{waveform:2}),
    () => synth.setUserOperator(2,{tl:10}),
    () => synth.setPitch(0,512,4),
    () => synth.setPitch(0,290,8),
    () => synth.setFrequency(0,0),
    () => synth.setFrequency(0,Infinity),
    () => synth.setFrequency(0,1e9),
    () => synth.noteOn(9,'A4'),
    () => synth.noteOn(0,'C10'),
    () => synth.noteOn(0,69.5),
    () => synth.noteOn(0,127),
    () => synth.setRhythm({enabled:true,snare:1}),
    () => synth.setRhythmLevels({bassDrum:5,snare:16}),
    () => synth.setRhythmLevel('rimshot',5),
    () => synth.writeRegister(64,1),
    () => synth.writeRegister(0,256),
  ]) assert.throws(run);
  assert.equal(writes.length,0); assert(synth.getRegisterSnapshot().every(v => v === 0));
});

test('OPLL percussion levels preserve the correct partner nibble and share melodic instrument registers', () => {
  const {synth,writes} = capture();
  synth.writeRegister(0x36,0xa4); synth.writeRegister(0x37,0xb5); synth.writeRegister(0x38,0xc6);
  synth.setRhythmLevels({bassDrum:3,snare:2,tom:7,cymbal:8,hiHat:9});
  assert.deepEqual(writes.slice(-5),[[0x36,0xa3],[0x37,0xb2],[0x38,0x76],[0x38,0x78],[0x37,0x92]]);
  synth.setRhythmLevel('hiHat',4); assert.deepEqual(writes.at(-1),[0x37,0x42]);
  synth.setRhythm({enabled:true});
  for (const run of [() => synth.noteOn(6,'A4'),() => synth.setInstrument(7,4),() => synth.setAttenuation(8,3)]) assert.throws(run);
  synth.setPitch(7,290,4); assert.equal(synth.getRegisterSnapshot()[0x17],0x22,'Drum pitch remains controllable');
  synth.setRhythm({enabled:false});
  assert.equal(synth.getRegisterSnapshot()[0x37],0x42,'No virtual previous instrument is restored after rhythm');
  assert.equal(synth.getRegisterSnapshot()[0x38],0x78);
  synth.setInstrument(7,1); assert.equal(synth.getRegisterSnapshot()[0x37],0x12,'Explicit melodic restore preserves that register low nibble');
});

test('OPLL rhythm ownership transitions release only normal CH6..8 keys and preserve unrelated gates', () => {
  const {synth,writes} = capture();
  for (const [r,v] of [[0x25,0xf1],[0x26,0xf2],[0x27,0xde],[0x28,0x74],[0x0e,0xc0]]) synth.writeRegister(r,v);
  writes.length = 0; synth.setRhythm({enabled:true,bassDrum:true});
  assert.deepEqual(writes,[[0x26,0xe2],[0x27,0xce],[0x28,0x64],[0x0e,0xe0],[0x0e,0xf0]]);
  assert.equal(synth.getRegisterSnapshot()[0x25],0xf1);
  synth.writeRegister(0x26,0xf2); writes.length = 0; synth.setRhythm({enabled:true,snare:true});
  assert(writes.every(([r]) => r === 0x0e)); assert.equal(synth.getRegisterSnapshot()[0x26],0xf2);
  const image = synth.getRegisterSnapshot(), count = writes.length;
  assert.throws(() => synth.setRhythm({enabled:false,tom:'yes'}));
  assert.equal(writes.length,count); assert.deepEqual(synth.getRegisterSnapshot(),image);
  synth.setRhythm({enabled:false}); assert.equal(synth.getRegisterSnapshot()[0x26],0xe2);
});

test('OPLL allNotesOff clears every normal and percussion key without changing patches, pitch or sustain', () => {
  const {synth} = capture();
  for (let ch = 0; ch < 9; ch++) {synth.writeRegister(0x20+ch,0xff); synth.writeRegister(0x30+ch,0x93);}
  synth.writeRegister(0x0e,255); synth.allNotesOff();
  for (let ch = 0; ch < 9; ch++) {assert.equal(synth.getRegisterSnapshot()[0x20+ch],0xef); assert.equal(synth.getRegisterSnapshot()[0x30+ch],0x93);}
  assert.equal(synth.getRegisterSnapshot()[0x0e],0xe0);
});

test('OPLL observers and write filtering include only accepted physical writes', () => {
  const {synth,writes} = capture(), events = [];
  synth._observe = event => events.push(event); synth._beforeWrite = register => register !== 3;
  synth.writeRegister(3,3); assert.equal(writes.length,0); assert.equal(events.length,0); assert.equal(synth.getRegisterSnapshot()[3],0);
  synth.writeRegister(0x28,0x18); assert.deepEqual(events[0],{method:'writeRegister',args:[0x28,0x18],channel:8});
  synth.reset(); assert.deepEqual(events[1],{method:'reset',args:[]});
});

test('OPLL DirectTransport uses one register-address/data pair and does not own the chip', () => {
  const bus = []; let resets = 0;
  const chip = {write:(r,v) => bus.push([r,v]),reset:() => resets++,sampleRate:clock => Math.floor(clock/72),generateStereo:frames => ({left:new Float32Array(frames),right:new Float32Array(frames)}),readStatus:() => 0,getIrq:() => false};
  const transport = new YM2413DirectTransport(chip,{clock:3200000});
  assert.equal(resets,0); transport.writeRegister(0x20,0x19); assert.deepEqual(bus,[[0,0x20],[1,0x19]]);
  assert.equal(transport.sampleRate(),Math.floor(3200000/72)); assert.equal(transport.generateStereo(4).left.length,4);
  assert.throws(() => transport.writeRegister(64,1)); assert.equal(bus.length,2);
});

test('OPLL frequency conversion uses nine-bit F-NUM with the actual master clock', () => {
  assert.deepEqual(ym2413PitchFromHz(440),{fnum:290,block:4});
  assert.deepEqual(ym2413PitchFromHz(440,3579545*2),{fnum:290,block:3});
  for (const hz of [0,-1,NaN,Infinity,1e-9,1e9]) assert.throws(() => ym2413PitchFromHz(hz));
  for (const clock of [0,-1,NaN,Infinity]) assert.throws(() => ym2413PitchFromHz(440,clock));
});

test('OPLL actual WASM: all nine channels give A4 at two clocks, release, and retrigger',async () => {
  const chip = await createSoundChip('ym2413');
  try {
    for (const clock of [3579545,3200000]) {
      const transport = new YM2413DirectTransport(chip,{clock}), synth = new YM2413Synth({transport,clock}), rate = transport.sampleRate();
      for (let ch = 0; ch < 9; ch++) {
        synth.initialize(); synth.setInstrument(ch,0,3); synth.noteOn(ch,'A4');
        const pcm = transport.generateStereo(Math.ceil(rate * .2)); audible(pcm,`CH${ch} clock ${clock}`);
        const hz = frequency(pcm.left,rate); assert(Math.abs(hz-440) < 1.5,`CH${ch} clock ${clock}: ${hz} Hz`);
        synth.noteOff(ch); transport.generateStereo(rate); assert(transport.generateStereo(128).left.every(v => Math.abs(v) < .0001));
        synth.noteOn(ch,'A4'); audible(transport.generateStereo(Math.ceil(rate * .12)),`CH${ch} retrigger`);
      }
    }
  } finally {chip.dispose();}
});

test('OPLL actual WASM: all fifteen built-in voices and original shared patches produce finite mono audio',async () => {
  const chip = await createSoundChip('ym2413'), transport = new YM2413DirectTransport(chip), synth = new YM2413Synth({transport});
  try {
    for (let instrument = 1; instrument < 16; instrument++) {
      synth.initialize(); synth.setVoice(0,{instrument,attenuation:3,sustain:false}); synth.noteOn(0,'A4');
      audible(transport.generateStereo(16000),YM2413_INSTRUMENTS[instrument]);
    }
    for (const patch of Object.values(YM2413_USER_PRESETS)) {
      synth.initialize(); synth.setPreset(0,{userPatch:patch,attenuation:3}); synth.noteOn(0,'A4'); audible(transport.generateStereo(16000),patch.label);
    }
  } finally {chip.dispose();}
});

test('OPLL actual WASM: editing instrument 0 updates held voices on multiple channels',async () => {
  const chip = await createSoundChip('ym2413'), transport = new YM2413DirectTransport(chip), synth = new YM2413Synth({transport}), rate = transport.sampleRate();
  try {
    for (const channel of [0,8]) {
      synth.initialize(); synth.setInstrument(channel,0,3); synth.noteOn(channel,'A4');
      const before = transport.generateStereo(Math.ceil(rate * .16)); assert(Math.abs(frequency(before.left,rate)-440) < 1.5);
      synth.setUserOperator(1,{multi:2});
      const after = transport.generateStereo(Math.ceil(rate * .16)); assert(Math.abs(frequency(after.left,rate)-880) < 2,`Shared carrier edit affects CH${channel}`);
    }
  } finally {chip.dispose();}
});

test('OPLL actual WASM: five percussion gates are audible; attenuation masks and normal melody recover',async () => {
  const chip = await createSoundChip('ym2413'), transport = new YM2413DirectTransport(chip), synth = new YM2413Synth({transport}), rate = transport.sampleRate();
  try {
    for (const drum of ['bassDrum','snare','tom','cymbal','hiHat']) {
      synth.initialize();
      for (const [ch,note] of [[6,'C3'],[7,'F#3'],[8,'C4']]) synth.setNote(ch,note);
      synth.setRhythm({enabled:true}); synth.setRhythmLevels({bassDrum:3,snare:3,tom:3,cymbal:3,hiHat:3}); synth.setRhythm({[drum]:true});
      audible(transport.generateStereo(12000),drum);
      synth.allNotesOff(); transport.generateStereo(rate*2); assert(transport.generateStereo(128).left.every(v => Math.abs(v) < .0001),`${drum} releases`);
      synth.setRhythm({enabled:false}); synth.setVoice(8,{instrument:0,attenuation:3,sustain:false}); synth.noteOn(8,'A4');
      const pcm = transport.generateStereo(Math.ceil(rate * .16)); audible(pcm,`melody after ${drum}`); assert(Math.abs(frequency(pcm.left,rate)-440) < 1.5);
    }
  } finally {chip.dispose();}
});
