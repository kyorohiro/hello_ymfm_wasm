import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {YM2610BSynth, YM2610BDirectTransport} from './ym2610bsynth.js';
import {Ym2610B} from './ym2610b.js';
import {FM_PRESETS} from './megadrive-fm-presets.js';
import {hzToBlockFnum} from './pitch.js';

test('SSG mixer preserves raw writes, other channels and I/O; reset stays within SSG', () => {
  const writes = [];
  let resets = 0;
  const synth = new YM2610BSynth({transport: {
    write(port, register, value) { writes.push([port, register, value]); },
    reset() { resets++; },
  }});
  synth.write(0, 7, 0xff);
  assert.equal(synth.ssg.tone(0, {frequency: 440}), 284);
  assert.equal(synth.ssg.registers[7], 0xfe);
  synth.ssg.noise(1, {period: 12});
  assert.equal(synth.ssg.registers[7], 0xee);
  synth.ssg.setEnvelope({period: 4000, shape: 9});
  synth.ssg.setVolume(2, 12, true);
  assert.equal(synth.ssg.registers[10], 16);
  const count = writes.length;
  assert.throws(() => synth.ssg.tone(3, {frequency: 440}), RangeError);
  assert.throws(() => synth.ssg.noise(0, {period: 32}), RangeError);
  assert.throws(() => synth.ssg.setEnvelope({period: 4000, shape: 16}), RangeError);
  assert.equal(writes.length, count, 'invalid calls must not partially write');
  synth.ssg.reset();
  assert.equal(resets, 1, 'SSG reset must not reset whole chip');
  assert.ok(writes.slice(count).every(([p,r]) => p === 0 && r <= 13));
  assert.equal(synth.ssg.registers[7], 0xff);
  synth.reset();
  assert.equal(resets, 2);
  assert.ok(synth.ssg.registers.every(x => x === 0));
});

test('real YM2610B: six FM channels, CH3 special, SSG pitch and mixed output', async () => {
  const {default: moduleFactory} = await import('../docs/generated/ym2610b_wasm.js');
  const chip = await Ym2610B.create({moduleFactory, moduleOptions: {
    wasmBinary: await readFile(new URL('../docs/generated/ym2610b_wasm.wasm', import.meta.url)),
  }});
  const peak = a => a.reduce((p,x) => Math.max(p, Math.abs(x)), 0);
  try {
    const synth = new YM2610BSynth({transport: new YM2610BDirectTransport(chip)});
    const rate = chip.sampleRate();
    synth.ssg.reset();
    synth.ssg.tone(0, {frequency: 440, volume: 12});
    const pcm = chip.generateStereo(Math.round(rate * 0.2));
    assert.ok(peak(pcm.left) > 0.01);
    let rises = 0;
    for (let i=1; i<pcm.left.length; i++) if (pcm.left[i] > pcm.left[i-1] + 0.01) rises++;
    assert.ok(Math.abs(rises / 0.2 - 440) < 10);
    synth.ssg.off(0);
    chip.generateStereo(100);
    assert.equal(peak(chip.generateStereo(1000).left), 0);
    synth.setPreset(0, FM_PRESETS.sine);
    const {block, fnum} = hzToBlockFnum(440, 8000000);
    synth.noteOn(0, block, fnum);
    chip.generateStereo(Math.round(rate * 0.1));
    synth.ssg.reset();
    assert.ok(peak(chip.generateStereo(10000).left) > 0.001, 'FM must survive SSG reset');
    // All six FM voices must work after construction and after reset.
    const strength = (data, hz) => {
      let re=0, im=0;
      for (let i=0; i<data.length; i++) {
        const angle = 2 * Math.PI * hz * i / rate;
        re += data[i] * Math.cos(angle); im += data[i] * Math.sin(angle);
      }
      return Math.hypot(re,im) / data.length;
    };
    for (let ch=0; ch<6; ch++) {
      synth.reset();
      synth.setPreset(ch, FM_PRESETS.sine);
      synth.setOperator(ch, 3, {tl: 0});
      synth.setPan(ch, ch < 3, ch >= 3);
      synth.noteOn(ch, block, fnum);
      chip.generateStereo(Math.round(rate * 0.05));
      const audio = chip.generateStereo(Math.round(rate * 0.1));
      const active = ch < 3 ? audio.left : audio.right;
      const silent = ch < 3 ? audio.right : audio.left;
      assert.ok(strength(active, 440) > 0.01, `FM CH${ch+1} frequency/output`);
      assert.equal(peak(silent), 0);
      synth.noteOff(ch);
      chip.generateStereo(Math.round(rate * 0.5));
      assert.ok(peak(chip.generateStereo(1000).left) < 0.0001);
      assert.ok(peak(chip.generateStereo(1000).right) < 0.0001);
    }
    synth.reset();
    synth.setPreset(2, FM_PRESETS.sine);
    synth.setAlgo(2, 7, 0);
    synth.setChannel3SpecialMode(true);
    const frequencies = [220, 277.182631, 329.627557, 440];
    frequencies.forEach((hz, op) => {
      synth.setOperator(2, op, {multi: 1, dt: 0, tl: 20});
      const p = hzToBlockFnum(hz, 8000000);
      synth.setChannel3SpecialFrequency(op, p.block, p.fnum);
    });
    synth.keyOn(2);
    chip.generateStereo(Math.round(rate * 0.05));
    const special = chip.generateStereo(Math.round(rate * 0.2));
    for (const hz of frequencies) assert.ok(strength(special.left, hz) > 0.005, `CH3 special ${hz} Hz`);
    // SSG and FM coexist; ADPCM bank writes must not corrupt SSG's mixer shadow.
    synth.write(0, 7, 0xff);
    synth.write(1, 7, 0);
    assert.equal(synth.ssg.registers[7], 0xff);
    synth.ssg.tone(0, {frequency: 880});
    const mixed = chip.generateStereo(Math.round(rate * 0.2));
    assert.ok(strength(mixed.left, 880) > 0.005);
    assert.ok(strength(mixed.left, 220) > 0.005);
  } finally { chip.dispose(); }
});


test('ADPCM register maps, validation and independent shadows', () => {
  const writes=[]; const transfers=[];
  const synth=new YM2610BSynth({transport:{
    write(p,r,v) {writes.push([p,r,v]);},
    loadAdpcmMemory(...args) {transfers.push(args);},
  }});
  const a=synth.adpcmA, b=synth.adpcmB;
  assert.equal(synth.adpcm,b);
  a.loadMemory(new Uint8Array(256),256); b.loadMemory(new ArrayBuffer(256),512);
  assert.deepEqual(transfers.map(([t,,addr])=>[t,addr]),[[0,256],[1,512]]);
  a.setSample(5,{start:256,end:768});
  assert.deepEqual(writes.slice(-4),[[1,0x15,1],[1,0x1d,0],[1,0x25,2],[1,0x2d,0]]);
  b.setSample({start:512,end:1024});
  assert.deepEqual([...b.registers.slice(2,6)],[2,0,3,0]);
  b.keyOn({repeat:true}); assert.deepEqual(writes.at(-1),[0,0x10,0xb0]);
  a.keyOn([0,5]); assert.deepEqual(writes.at(-1),[1,0,33]);
  synth.write(1,8,0x85); a.setVoice(0,{volume:20}); assert.deepEqual(writes.at(-1),[1,8,0x94]);
  synth.write(0,0x11,0x80); b.setPan(true,true); assert.deepEqual(writes.at(-1),[0,0x11,0xc0]);
  const n=writes.length;
  for (const fn of [()=>a.setSample(6,{start:0,end:256}),()=>a.setSample(0,{start:0,end:0x100000}),()=>b.setSample({start:32,end:512}),()=>b.setPlaybackRate(999999),()=>a.keyOn([1,9]),()=>b.loadMemory(new Uint8Array(257),0xffff00)]) assert.throws(fn);
  assert.equal(writes.length,n);
  b.reset(); assert.ok(writes.slice(n).every(([p,r])=>p===0 && r>=0x10 && r<0x1c));
});

test('native A/B playback: ROM loads preserve regions, six A voices, auto-stop, B repeat and reset', async () => {
  const {default:moduleFactory}=await import('../docs/generated/ym2610b_wasm.js');
  const chip=await Ym2610B.create({moduleFactory,moduleOptions:{wasmBinary:await readFile(new URL('../docs/generated/ym2610b_wasm.wasm',import.meta.url))}});
  const peak=x=>x.reduce((m,v)=>Math.max(m,Math.abs(v)),0);
  try {
    const synth=new YM2610BSynth({transport:new YM2610BDirectTransport(chip)});
    const a=synth.adpcmA,b=synth.adpcmB,rate=chip.sampleRate();
    // Load higher addresses first: a later lower-address load must not shrink ROM.
    for(let ch=5;ch>=0;ch--) a.loadMemory(new Uint8Array(256).fill(0x17),ch*256);
    b.loadMemory(new Uint8Array(256).fill(0x17),256);
    for(let ch=0;ch<6;ch++) {
      synth.reset(); chip.generateStereo(1000);
      a.setVolume(48); a.setVoice(ch,{volume:24,left:ch<3,right:ch>=3});
      a.setSample(ch,{start:ch*256,end:(ch+1)*256}); a.keyOn(ch);
      const pcm=chip.generateStereo(rate*0.01);
      assert.ok(peak(ch<3?pcm.left:pcm.right)>0.001);
      assert.equal(peak(ch<3?pcm.right:pcm.left),0);
      chip.generateStereo(rate*0.1);
      const end=chip.generateStereo(1000);
      assert.equal(peak(end.left)+peak(end.right),0);
    }
    b.setSample({start:256,end:512}); b.setPlaybackRate(8000); b.setVolume(160); b.setPan(true,false);
    b.keyOn(); assert.ok(peak(chip.generateStereo(rate*0.02).left)>0.01);
    chip.generateStereo(rate*0.1); assert.equal(peak(chip.generateStereo(1000).left),0);
    b.keyOn({repeat:true}); chip.generateStereo(rate*0.2);
    assert.ok(peak(chip.generateStereo(1000).left)>0.01);
    b.setPan(false,true); b.setPlaybackRate(16000); chip.generateStereo(1000);
    const right=chip.generateStereo(1000); assert.equal(peak(right.left),0); assert.ok(peak(right.right)>0.01);
    b.keyOff(); chip.generateStereo(1000); assert.equal(peak(chip.generateStereo(1000).right),0);
    synth.ssg.reset(); synth.ssg.tone(0,{frequency:440}); a.reset(); b.reset();
    assert.ok(peak(chip.generateStereo(10000).left)>0.01,'ADPCM reset must preserve SSG');
  } finally {chip.dispose();}
});
