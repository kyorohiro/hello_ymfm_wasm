import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {GameboySynth, GameboyDirectTransport} from './gameboysynth.js';
import {createGameboyClient} from './playground_gameboy.js';
import {GameboyApu} from './gameboyapu.js';
import moduleFactory from './generated/gameboy_apu_wasm.js';
function fixture() {
  const writes = [], registers = new Uint8Array(48);
  let resets = 0, disposals = 0;
  const gb = new GameboySynth({transport: {
    writeRegister(r, v) { writes.push([r, v]); registers[r] = v; },
    reset() { resets++; registers.fill(0); }, dispose() { disposals++; },
  }});
  return {gb, writes, registers, get resets() { return resets; }, get disposals() { return disposals; }};
}
test('lifecycle and silent initialization, raw requires no initialization', () => {
  const f = fixture(), {gb, writes} = f;
  assert.throws(() => gb.pulse.keyOn(0), /initialize/);
  gb.writeRegister(22, 128); assert.throws(() => gb.wave.keyOn(), /initialize/);
  gb.initialize(); assert.equal(f.resets, 1);
  assert.ok(!writes.some(([r,v]) => [4,9,14,19].includes(r) && (v & 128)));
  assert.equal(f.registers[20], 0x33); assert.equal(f.registers[21], 255);
  gb.writeRegister(22, 0); assert.throws(() => gb.noise.keyOn(), /initialize/);
  gb.initialize(); gb.reset(); assert.throws(() => gb.setPan(0,true,true), /initialize/);
  gb.dispose(); gb.dispose(); assert.equal(f.disposals, 1);
  for (const fn of [() => gb.initialize(), () => gb.reset(), () => gb.writeRegister(0,0), () => gb.wave.setNote('C4'), () => gb.pulse.setVoice(0,{})]) assert.throws(fn, /disposed/);
});
test('rounded frequency boundaries, notes and MIDI', () => {
  const {gb, registers:r} = fixture(); gb.initialize();
  for (const [ch, note, midi] of [[0,'C4',60],[1,'F#4',66],[0,'Bb3',58]]) {
    const hz = gb.pulse.setNote(ch,note);
    assert.equal(hz, gb.pulse.setNote(ch,midi));
    const n = Math.round(2048 - 131072 / (440 * 2 ** ((midi-69)/12)));
    assert.equal(r[ch*5+3] | ((r[ch*5+4]&7)<<8), n);
    assert.equal(hz, 131072/(2048-n));
  }
  assert.equal(gb.pulse.setFrequency(0,131072/2048.4),64);
  assert.equal(gb.wave.setFrequency(65536/2048.4),32);
  assert.equal(gb.pulse.setFrequency(0,200000),131072);
  for (const hz of [NaN,Infinity,0,-1,1,262144]) assert.throws(() => gb.pulse.setFrequency(0,hz), RangeError);
  for (const note of [0,1,-1,128,60.5,'H4','C-2']) assert.throws(() => gb.pulse.setNote(0,note), RangeError);
  assert.ok(gb.pulse.setNote(1,127)>0);
  assert.throws(() => gb.pulse.keyOn(2),RangeError);
});
test('immediate voice, deep partial envelope, sweep, raw preservation and DAC restoration', () => {
  const {gb, registers:r, writes} = fixture(); gb.initialize();
  gb.writeRegister(0,0x85); gb.writeRegister(1,0x3f); gb.writeRegister(2,0x9b);
  gb.writeRegister(4,0x78);
  let size = writes.length;
  gb.pulse.setVoice(0,{duty:0.25,envelope:{period:2}});
  gb.pulse.setSweep({period:3}); assert.equal(writes.length,size + 3);
  assert.equal(r[0],0xb5); assert.equal(r[1],0x7f); assert.equal(r[2],0x9a);
  gb.pulse.setFrequency(0,440); assert.equal(r[4]&0xf8,0x78);
  gb.pulse.keyOn(0); assert.equal(r[0],0xb5); assert.equal(r[1],0x7f); assert.equal(r[2],0x9a); assert.equal(r[4]&0xc0,0x80);
  gb.pulse.keyOff(0); assert.equal(r[2],0); gb.pulse.keyOn(0); assert.equal(r[2],0x9a);
  gb.writeRegister(2,0); gb.pulse.keyOn(0); assert.equal(r[2],0);
  gb.writeRegister(6,0x3a); gb.writeRegister(7,0xc5); gb.writeRegister(8,0x12); gb.writeRegister(9,0x42);
  gb.pulse.setVoice(1,{duty:0.75}); gb.pulse.keyOn(1);
  assert.equal(r[6],0xfa); assert.equal(r[7],0xc5); assert.equal(r[8],0x12); assert.equal(r[9],0x82);
  assert.equal(r[0],0xb5); // CH2 did not write CH1 sweep.
  gb.pulse.setVoice(1,{volume:0,envelope:{direction:'up'}}); gb.pulse.keyOn(1); assert.equal(r[7],0x0d);
});
test('wave packing, copy, mute is not DAC off, raw wave and noise state', () => {
  const {gb, registers:r} = fixture(); gb.initialize();
  const samples=Array.from({length:32},(_,i)=>i%16);
  gb.wave.setWaveform(samples); samples[0]=15;
  assert.equal(r[32],0x01); assert.equal(r[47],0xef); assert.equal(r[10]&128,0);
  gb.writeRegister(10,0x35); gb.writeRegister(11,0xf1); gb.writeRegister(12,0x9f);
  gb.writeRegister(13,0x12); gb.writeRegister(14,0x73); gb.writeRegister(32,0xab);
  gb.wave.setLevel(0); gb.wave.keyOn();
  assert.equal(r[10],0xb5); assert.equal(r[12],0x9f); assert.equal(r[11],0xf1); assert.equal(r[14],0xb3); assert.equal(r[32],0xab);
  gb.wave.setLevel(0.5); assert.equal(r[12],0xdf); assert.equal(r[10],0xb5);
  gb.wave.keyOff(); assert.equal(r[10],0x35);
  gb.writeRegister(16,0x3a); gb.writeRegister(17,0x92); gb.writeRegister(18,0x56); gb.writeRegister(19,0x7f);
  gb.noise.setVoice({width:7,shift:3}); gb.noise.keyOn();
  assert.equal(r[16],0x3a); assert.equal(r[17],0x92); assert.equal(r[18],0x3e); assert.equal(r[19],0xbf);
  gb.noise.keyOff(); gb.noise.keyOn(); assert.equal(r[17],0x92);
  gb.writeRegister(17,0); gb.noise.keyOn(); assert.equal(r[17],0);
});
test('pan/master immediate updates preserve unrelated routing and VIN', () => {
  const {gb,registers:r}=fixture(); gb.initialize();
  gb.writeRegister(20,0x88); gb.setMasterVolume(2,5); assert.equal(r[20],0xad);
  gb.writeRegister(21,0xa5); gb.setPan(1,true,false); assert.equal(r[21],0xa5);
  gb.setPan(0,false,true); assert.equal(r[21],0xa5);
  gb.setPan(2,true,false); assert.equal(r[21],0xe1);
});
test('invalid inputs are atomic for sent and configured state', () => {
  const a=fixture(), b=fixture(); a.gb.initialize(); b.gb.initialize();
  const operations = [
    g=>g.pulse.setVoice(0,{volume:4,envelope:{period:8}}),
    g=>g.pulse.setVoice(0,{volume:4,unknown:1}),
    g=>g.pulse.setSweep({period:2,shift:9}),
    g=>g.noise.setVoice({volume:4,width:8}),
    g=>g.pulse.setDuty(2,0.5), g=>g.pulse.setDuty(0,0.3),
    g=>g.pulse.setEnvelope(0,{volume:12,period:8}),
    g=>g.noise.setEnvelope({volume:-1}),
    g=>g.noise.setParameters({divisor:2,shift:16}),
    g=>g.noise.setParameters({volume:12}),
    g=>g.wave.stopAndSetWaveform([1]),
    g=>g.wave.setWaveform([...Array(31).fill(1),16]),
    g=>g.wave.setLevel(0.3), g=>g.setMasterVolume(3,8), g=>g.setPan(0,true,1),
    g=>g.writeRegister(48,3), g=>g.pulse.setVoice(1,{envelope:{unknown:2}}),
  ];
  const count=a.writes.length;
  for (const op of operations) { assert.throws(()=>op(a.gb)); assert.equal(a.writes.length,count); }
  for (const f of [a,b]) { f.gb.pulse.keyOn(0); f.gb.pulse.keyOn(1); f.gb.wave.keyOn(); f.gb.noise.keyOn(); }
  assert.deepEqual(a.writes,b.writes);
});
test('direct and port use identical logic; disposal and new Run clients', () => {
  const f=fixture(); let closed=0; const sent=[];
  const gb=createGameboyClient({postMessage:m=>sent.push(m),close:()=>closed++});
  const exercise=g=>{g.initialize();g.pulse.setNote(0,'C4');g.pulse.keyOn(0);g.pulse.setDuty(0,0.25);g.pulse.setEnvelope(0,{period:2});g.noise.setParameters({width:7});g.pulse.keyOff(0);g.dispose();g.dispose();};
  exercise(f.gb);exercise(gb);
  assert.deepEqual(sent.filter(m=>m.method==='writeRegister').map(m=>m.args),f.writes);
  assert.equal(closed,1); assert.equal(sent.filter(m=>m.method==='dispose').length,1);
  const next=createGameboyClient({postMessage(){},close(){}});next.initialize();next.pulse.keyOn(1);next.dispose();
});
test('real core: silent initialize, raw-equivalent pulse, wave mute and borrowed ownership', async () => {
  const create=()=>GameboyApu.create({moduleFactory,sampleRate:48000,moduleOptions:{wasmBinary:readFileSyncBytes}});
  const readFileSyncBytes=await readFile(new URL('./generated/gameboy_apu_wasm.wasm',import.meta.url));
  const chip=await create(), raw=await create();
  const gb=new GameboySynth({transport:new GameboyDirectTransport(chip)});
  try {
    gb.initialize(); assert.ok(chip.generateStereo(512).left.every(v=>v===0));
    // Independently configure the raw core: C4 quantizes to N=1547 (0x60b).
    chip.reset(); gb.initialize(); gb.pulse.setNote(0,'C4'); gb.pulse.keyOn(0);
    raw.reset();
    for (const [r,v] of [[22,128],[20,0x33],[21,255],[0,0],[1,0x80],[2,0xa0],[3,0x0b],[4,0x86]]) raw.writeRegister(r,v);
    const actual=chip.generateStereo(2048), expected=raw.generateStereo(2048);
    assert.deepEqual(actual,expected);assert.ok(actual.left.some(v=>Math.abs(v)>0.001));
    gb.pulse.keyOff(0);gb.wave.setLevel(0);gb.wave.keyOn();
    // NR32 mute holds a constant DAC level in this core (DC, no waveform).
    const muted = chip.generateStereo(512).left.subarray(16);
    assert.ok(muted.every(v=>v===muted[0]));
    gb.wave.setLevel(1); const audible = chip.generateStereo(512).left;
    assert.ok(audible.some(v=>v!==audible[0]));
    gb.dispose(); assert.doesNotThrow(()=>chip.generateStereo(1));
  } finally {gb.dispose();chip.dispose();raw.dispose();}
});

test('individual live setters preserve other bits, never trigger, and send one envelope write', () => {
  const {gb, registers:r, writes} = fixture(); gb.initialize();
  gb.pulse.keyOn(0); gb.noise.keyOn();
  gb.writeRegister(1,0xbf); gb.writeRegister(18,0x53);
  writes.length=0;
  gb.pulse.setDuty(0,0.25);
  gb.pulse.setEnvelope(0,{volume:12,direction:'down',period:2});
  gb.pulse.setSweep({period:2,shift:1});
  gb.noise.setParameters({width:7});
  gb.noise.setEnvelope({volume:9,direction:'up',period:3});
  assert.deepEqual(writes,[[1,0x7f],[2,0xc2],[0,0x21],[18,0x5b],[17,0x9b]]);
  writes.length=0;
  gb.pulse.setVoice(0,{});gb.pulse.setEnvelope(0,{});gb.pulse.setSweep({});gb.noise.setParameters({});
  assert.deepEqual(writes,[]);
  gb.pulse.keyOff(0);gb.pulse.setDuty(0,0.5);assert.equal(r[2],0);
  gb.pulse.keyOn(0);assert.equal(r[2],0xc2);assert.equal(r[1],0xbf);
  gb.wave.keyOn();gb.wave.stopAndSetWaveform(Array(32).fill(3));
  assert.equal(r[10]&128,0);assert.equal(r[32],0x33);
});
test('new setters require initialization and reject disposed instances', () => {
  const {gb}=fixture();
  const calls=[()=>gb.pulse.setDuty(0,0.5),()=>gb.pulse.setEnvelope(1,{}),
    ()=>gb.noise.setParameters({}),()=>gb.noise.setEnvelope({}),
    ()=>gb.wave.stopAndSetWaveform(Array(32).fill(0))];
  for (const call of calls) assert.throws(call,/initialize/);
  gb.initialize();gb.dispose();
  for (const call of calls) assert.throws(call,/disposed/);
});
test('real core: sustained live changes match raw writes without retriggering', async () => {
  const wasmBinary=await readFile(new URL('./generated/gameboy_apu_wasm.wasm',import.meta.url));
  const create=()=>GameboyApu.create({moduleFactory,sampleRate:48000,moduleOptions:{wasmBinary}});
  const chip=await create(), raw=await create();
  const gb=new GameboySynth({transport:new GameboyDirectTransport(chip)});
  const reference=new GameboySynth({transport:new GameboyDirectTransport(raw)});
  const compare=()=>assert.deepEqual(chip.generateStereo(2048),raw.generateStereo(2048));
  try {
    for (const g of [gb,reference]) {g.initialize();g.pulse.keyOn(0);g.noise.keyOn();}
    compare();
    gb.pulse.setDuty(0,0.25);raw.writeRegister(1,0x40);compare();
    gb.noise.setParameters({divisor:5,shift:3,width:7});raw.writeRegister(18,0x3d);compare();
    gb.pulse.setEnvelope(0,{volume:12,period:2});raw.writeRegister(2,0xc2);compare();
    gb.pulse.setSweep({period:2,shift:1});raw.writeRegister(0,0x21);compare();
    gb.noise.setEnvelope({volume:0,direction:'up',period:1});raw.writeRegister(17,0x09);compare();
  } finally {gb.dispose();reference.dispose();chip.dispose();raw.dispose();}
});
