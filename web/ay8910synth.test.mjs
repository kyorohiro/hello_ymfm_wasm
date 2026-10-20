import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundChip} from './soundchip.js';
import {AY8910Synth,AY8910DirectTransport,AY8910_CLOCK,ay8910PeriodFromHz} from './ay8910synth.js';

function capture() {
  const writes = []; let resets = 0;
  const synth = new AY8910Synth({transport:{writeRegister:(r,v) => writes.push([r,v]),reset() {resets++;}}});
  return {synth,writes,resets:() => resets};
}
function audible(pcm,label) {
  assert(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite),label+': finite');
  assert(Math.max(...pcm.left)-Math.min(...pcm.left)>.001,label+': audible AC');
  assert.deepEqual(pcm.left,pcm.right,label+': mono reaches both outputs');
}
function noAc(pcm,label) {
  // The existing normalized AY DAC retains a constant DC baseline at level 0.
  // Ignore the first resampling boundary; muting the native channel is the
  // runtime's separate mechanism for producing exact zero PCM on Stop.
  const tail = pcm.left.subarray(8);
  assert(Math.max(...tail)-Math.min(...tail)<1e-8,label);
}
function frequency(pcm,rate) {
  const values = pcm.subarray(Math.ceil(rate*.025)),mean = values.reduce((a,b) => a+b,0)/values.length,crossings = [];
  for (let i=1; i<values.length; i++) if (values[i-1]<mean && values[i]>=mean) crossings.push(i-1+(mean-values[i-1])/(values[i]-values[i-1]));
  assert(crossings.length>10,'Enough tone periods');
  return (crossings.length-1)*rate/(crossings.at(-1)-crossings[0]);
}

test('AY construction writes nothing; explicit initialization has genuinely silent output levels', () => {
  const {synth,writes,resets} = capture();
  assert.equal(writes.length,0); assert.equal(resets(),0); assert.equal(synth.clock,AY8910_CLOCK); assert.equal(synth.channels,3); assert.equal(synth.chip,'ay8910');
  synth.initialize(); assert.equal(resets(),1);
  const image = synth.getRegisterSnapshot(); assert.equal(image.length,16); assert.equal(image[7],0x38);
  assert.deepEqual([...image.slice(8,11)],[0,0,0]); assert.deepEqual(synth._getState().levels,[9,9,9]);
  synth.keyOn(1); assert.deepEqual(writes.at(-1),[9,9]); assert.equal(synth.getRegisterSnapshot()[7],0x38);
  synth.reset(); assert(synth.getRegisterSnapshot().every(value => value === 0));
});

test('AY partial edits retain unrelated channels, shared mixer I/O bits and reserved bits', () => {
  const {synth,writes} = capture();
  synth.writeRegister(7,0xed); synth.setMixer(1,{tone:true}); assert.deepEqual(writes.at(-1),[7,0xed&~2]);
  synth.setMixer(1,{noise:true}); assert.deepEqual(writes.at(-1),[7,0xed&~18]);
  synth.writeRegister(1,0xf0); synth.setTonePeriod(0,0xabc); assert.deepEqual(writes.slice(-2),[[0,0xbc],[1,0xfa]]);
  synth.writeRegister(6,0xe0); synth.setNoisePeriod(13); assert.deepEqual(writes.at(-1),[6,0xed]);
  synth.writeRegister(8,0xf4); synth.setVolume(0,7); assert.deepEqual(writes.at(-1),[8,0xf7],'Envelope and unused bits retained');
  synth.setVolume(0,6,false); assert.deepEqual(writes.at(-1),[8,0xe6]);
  synth.writeRegister(13,0xf0); synth.setEnvelope({shape:10}); assert.deepEqual(writes.at(-1),[13,0xfa]);
  const count = writes.length; synth.setEnvelope({period:0x1234}); assert.deepEqual(writes.slice(count),[[11,0x34],[12,0x12]],'Period-only edit never retriggers shape');
});

test('AY keyOn preserves tone/noise combinations and restores retained fixed/envelope levels', () => {
  const {synth,writes} = capture(); synth.initialize();
  synth.noise(1,{period:7,volume:11,envelope:true});
  const mixer = synth.getRegisterSnapshot()[7],noise = synth.getRegisterSnapshot()[6];
  synth.keyOff(1); assert.equal(synth.getRegisterSnapshot()[9]&31,0); assert.equal(synth._getState().levels[1],27);
  synth.noteOn(1,'A4'); assert.deepEqual(writes.at(-1),[9,27]);
  assert.equal(synth.getRegisterSnapshot()[7],mixer,'Noise-only remains noise-only when a Keyboard note arrives'); assert.equal(synth.getRegisterSnapshot()[6],noise);
  synth.setMixer(1,{tone:true}); synth.keyOff(1); synth.keyOn(1); assert.equal(synth.getRegisterSnapshot()[7]&18,0,'Combined tone and noise stay enabled');
  synth.off(1); synth.setVolume(1,6); assert.equal(synth.getRegisterSnapshot()[9],22,'setVolume preserves retained envelope selection even after keyOff');
  synth.allNotesOff(); assert.deepEqual([...synth.getRegisterSnapshot().slice(8,11)],[0,0,0]); assert.deepEqual(synth._getState().levels,[9,22,9]);
});

test('AY current voice, tone convenience and shared noise/envelope APIs use hardware units', () => {
  const {synth,writes} = capture(); synth.initialize();
  assert.equal(synth.tone(2,{note:'A4',volume:10}),254); assert.equal(synth.getRegisterSnapshot()[7],0x38);
  assert.equal(synth.setTone(2,{frequency:440,envelope:true}),254); assert.equal(synth.getRegisterSnapshot()[10],26);
  synth.noise(0,{period:9,volume:7}); assert.equal(synth.getRegisterSnapshot()[6]&31,9); assert.equal(synth.getRegisterSnapshot()[7]&9,1);
  synth.setVoice(0,{tone:true,frequency:880,volume:6,envelope:false}); assert.equal(synth.getRegisterSnapshot()[7]&9,0); assert.equal(synth.getRegisterSnapshot()[8],6);
  assert.equal(synth.setNote(1,69),synth.setNote(1,'A4')); assert.equal(synth.setFrequency(1,440),254);
  const count = writes.length; synth.setEnvelope({shape:8,period:500}); assert.deepEqual(writes.slice(count),[[11,244],[12,1],[13,8]]);
});

test('AY full state carries retained muted levels; snapshot adoption copies without writes', () => {
  const {synth,writes,resets} = capture(); synth.initialize(); synth.setVolume(0,0); synth.setVolume(1,12,true); synth.allNotesOff();
  const state = synth._getState(),other = capture(); other.synth._adoptState(state);
  assert.equal(other.writes.length,0); assert.equal(other.resets(),0); assert.deepEqual(other.synth._getState(),state);
  other.synth.keyOn(0); assert.equal(other.synth.getRegisterSnapshot()[8],0,'Intentional configured zero survives full state');
  other.synth.keyOn(1); assert.equal(other.synth.getRegisterSnapshot()[9],28);
  const raw = new Uint8Array(16); raw[7]=0x38; raw[8]=6;
  const bare = capture(); bare.synth.adoptRegisterSnapshot(raw); raw[8]=0; const copy = bare.synth.getRegisterSnapshot(); copy[8]=0;
  assert.equal(bare.synth.getRegisterSnapshot()[8],6); assert.deepEqual(bare.synth._getState().levels,[6,9,9]); assert.equal(bare.writes.length,0);
  const before = synth._getState(),count = writes.length;
  for (const bad of [{registers:new Uint8Array(15)},{registers:new Uint8Array(16),levels:[1,2,32]},{registers:new Uint8Array(16),levels:[1,2]}]) assert.throws(() => synth._adoptState(bad));
  assert.deepEqual(synth._getState(),before); assert.equal(writes.length,count); assert.equal(resets(),1);
});

test('AY complete musical edits validate before the first register changes', () => {
  const {synth,writes} = capture();
  for (const run of [
    () => synth.setVoice(0,{frequency:440,volume:16}),() => synth.tone(0,{frequency:440,envelope:1}),
    () => synth.setVolume(0,undefined),
    () => synth.tone(0,{period:10,note:'A4'}),() => synth.noise(0,{period:9,volume:-1}),
    () => synth.noise(0,{period:9,envelope:null}),() => synth.noise(0,{volume:null}),
    () => synth.setVoice(0,{tone:true,noise:1}),() => synth.setMixer(0,{tone:true,volume:9}),
    () => synth.setEnvelope({period:500,shape:16}),() => synth.setEnvelope({period:65536}),
    () => synth.setNoisePeriod(32),() => synth.setTonePeriod(0,4096),
    () => synth.noteOn(3,'A4'),() => synth.noteOn(0,'C0'),() => synth.noteOn(0,69.5),
    () => synth.setFrequency(0,0),() => synth.setFrequency(0,NaN),() => synth.setFrequency(0,1e9),
    () => synth.writeRegister(16,0),() => synth.writeRegister(0,256),
    () => synth.adoptRegisterSnapshot(new Uint8Array(15)),
  ]) assert.throws(run);
  assert.equal(writes.length,0); assert(synth.getRegisterSnapshot().every(value => value === 0));
});

test('AY observer and veto filter describe only accepted register writes', () => {
  const {synth,writes} = capture(),events = [];
  synth._observe = event => events.push(event); synth._beforeWrite = register => register !== 6;
  synth.setNoisePeriod(12); assert.equal(writes.length,0); assert.equal(events.length,0); assert.equal(synth.getRegisterSnapshot()[6],0);
  synth.setVolume(2,8); assert.deepEqual(events[0],{method:'writeRegister',args:[10,8],channel:2});
  synth.reset(); assert.deepEqual(events[1],{method:'reset',args:[]});
});

test('AY period helper uses the AY input clock and rejects unrepresentable frequencies', () => {
  assert.equal(ay8910PeriodFromHz(440),254); assert.equal(ay8910PeriodFromHz(440,2000000),284);
  for (const value of [0,-1,NaN,Infinity,1,1e9]) assert.throws(() => ay8910PeriodFromHz(value));
  for (const clock of [0,-1,NaN,Infinity,1789773.5]) assert.throws(() => ay8910PeriodFromHz(440,clock));
});

test('AY real native PCM: all three voices give A4 at two construction clocks, mirrored mono, and no AC after Stop',async () => {
  for (const clock of [1789773,2000000]) {
    const chip = await createSoundChip('ay8910',{clock,sampleRate:44100});
    const transport = new AY8910DirectTransport(chip),synth = new AY8910Synth({transport,clock}),rate=transport.sampleRate();
    try {
      synth.initialize(); noAc(transport.generateStereo(128),'Initialized voices have no AC output');
      for (let ch=0;ch<3;ch++) {
        synth.initialize(); synth.noteOn(ch,'A4');
        const pcm = transport.generateStereo(9000); audible(pcm,`CH${ch} at ${clock}`);
        const hz=frequency(pcm.left,rate); assert(Math.abs(hz-440)<1.5,`CH${ch} at ${clock}: ${hz} Hz`);
        synth.off(ch); noAc(transport.generateStereo(128),'off ends tone output');
        synth.keyOn(ch); audible(transport.generateStereo(4096),'configured voice restarts');
        synth.allNotesOff(); noAc(transport.generateStereo(128),'allNotesOff has no AC output');
      }
    } finally {chip.dispose();}
  }
});

test('AY real native PCM: noise-only, mixed tone/noise and shared hardware envelope retain voice settings',async () => {
  const chip=await createSoundChip('ay8910'),transport=new AY8910DirectTransport(chip),synth=new AY8910Synth({transport});
  try {
    synth.initialize(); synth.noise(0,{period:13,volume:11}); audible(transport.generateStereo(4096),'Noise');
    const mixer=synth.getRegisterSnapshot()[7]; synth.off(0); noAc(transport.generateStereo(128),'Noise off has no AC output');
    synth.noteOn(0,'A4'); assert.equal(synth.getRegisterSnapshot()[7],mixer); audible(transport.generateStereo(4096),'Noise Keyboard preserves its voice');
    synth.setMixer(0,{tone:true}); audible(transport.generateStereo(4096),'Mixed tone and noise');
    synth.allNotesOff(); synth.setEnvelope({period:64,shape:10});
    synth.tone(1,{note:'A4',volume:9,envelope:true}); audible(transport.generateStereo(8192),'Shared hardware envelope');
    synth.allNotesOff(); noAc(transport.generateStereo(128),'Envelope mode is also silenced');
  } finally {chip.dispose();}
});
