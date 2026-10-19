import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ym2608AudioEngine} from './ym2608audioengine.js';
import {Ym2608Timeline} from './playground_ym2608_timeline.js';
import factory from '../docs/generated/ym2608_wasm.js';

function referenceProcess(left,right,frames) {
  for (let frame = 0; frame < frames; frame++) {
    this._resampleRemainder += this._chipSampleRate;
    const count = Math.floor(this._resampleRemainder / this._sampleRate);
    this._resampleRemainder -= count * this._sampleRate;
    if (count) {
      const pcm = this.ym2608.generateStereo(count);
      let l = 0, r = 0;
      for (let index = 0; index < count; index++) {l += pcm.left[index]; r += pcm.right[index];}
      this._lastLeft = l/count; this._lastRight = r/count;
    }
    left[frame] = this._lastLeft * this._masterVolume;
    right[frame] = this._lastRight * this._masterVolume;
  }
}

for (const rate of [44100,48000,96000]) {
  test(`YM2608 engine: batched real FM/SSG/rhythm/ADPCM remains exact through timeline and clocks at ${rate} Hz`,async t => {
    const wasmBinary = await readFile(new URL('../docs/generated/ym2608_wasm.wasm',import.meta.url));
    const create = () => Ym2608AudioEngine.create({ym2608ModuleFactory:factory,ym2608ModuleOptions:{wasmBinary},outputSampleRate:rate,masterVolume:.73});
    const a = await create(), b = await create();
    t.after(() => {a.dispose(); b.dispose();});
    b.process = referenceProcess;
    let viewCalls = 0, ownedCalls = 0;
    const view = a.ym2608.generateStereoView.bind(a.ym2608), owned = b.ym2608.generateStereo.bind(b.ym2608);
    a.ym2608.generateStereoView = frames => {viewCalls++; return view(frames);};
    a.ym2608.generateStereo = () => assert.fail('audio engine must use borrowed PCM');
    b.ym2608.generateStereo = frames => {ownedCalls++; return owned(frames);};
    const rom = await readFile(new URL('./tetorica_ym2608_adpcm_rom.bin',import.meta.url));
    a.loadAdpcmARom(rom); b.loadAdpcmARom(rom);
    const patch = [[0,0,0xb0,7],[0,0,0xb4,0xc0]];
    for (const offset of [0,4,8,12]) patch.push([0,0,0x30+offset,1],[0,0,0x40+offset,offset === 12 ? 32 : 127],[0,0,0x50+offset,31],[0,0,0x80+offset,15]);
    patch.push([0,0,0xa4,0x22],[0,0,0xa0,0x69],[0,0,0x28,0xf0],
      [0,0,0,120],[0,0,1,0],[0,0,7,0x3e],[0,0,8,8],
      [0,0,0x11,48],[0,0,0x18,0xd8],[0,0,0x10,1],
      [0,2,0,0],[0,1,1,0xc0],[0,1,2,0],[0,1,3,0],[0,1,4,7],[0,1,5,0],
      [0,1,9,0x49],[0,1,10,0x24],[0,1,11,200],[0,1,0,0xa0],
      [73,0,0,48],[211,0,0x10,1],[441,0,8,4],[882,0,8,0],[1000,1,0,1],[1200,0,0x28,0]);
    const messagesA = [], messagesB = [];
    const timelineA = new Ym2608Timeline(a,rate), timelineB = new Ym2608Timeline(b,rate);
    for (const [timeline,replies] of [[timelineA,messagesA],[timelineB,messagesB]]) {
      timeline.prepare(patch,[new Uint8Array(256).fill(0x17)],1200);
      timeline.play(error => replies.push(error));
    }
    let peak = 0;
    for (const [index,frames] of [37,1,26,64,1,30,41,57,128,128,128,512,512,4096].entries()) {
      if ([1,4,8].includes(index)) {
        const clock = {1:100000,4:16000000,8:7987200}[index];
        a._chipSampleRate = a.ym2608.sampleRate(clock); b._chipSampleRate = b.ym2608.sampleRate(clock);
      }
      if (index === 9) {a.setMasterVolume(1.2); b.setMasterVolume(1.2);}
      const left = new Float32Array(frames), right = new Float32Array(frames);
      const expectedLeft = new Float32Array(frames), expectedRight = new Float32Array(frames);
      timelineA.process(left,right); timelineB.process(expectedLeft,expectedRight);
      assert.deepEqual(left,expectedLeft); assert.deepEqual(right,expectedRight);
      assert.equal(a._resampleRemainder,b._resampleRemainder);
      assert.deepEqual(messagesA,messagesB);
      for (const value of left) peak = Math.max(peak,Math.abs(value));
    }
    assert(peak > .001);
    assert.deepEqual(messagesA,[undefined]);
    assert(viewCalls < ownedCalls/16,'one WASM call per timeline segment replaces per-output-sample allocation');
    a.reset(); b.reset();
    assert.deepEqual(a.processFrames(128),b.processFrames(128),'reset must discard held samples and fractional phase');
  });
}

test('YM2608 engine: a synchronous IRQ register write keeps its per-output-frame PCM boundary',async t => {
  const wasmBinary = await readFile(new URL('../docs/generated/ym2608_wasm.wasm',import.meta.url));
  const create = () => Ym2608AudioEngine.create({ym2608ModuleFactory:factory,ym2608ModuleOptions:{wasmBinary},outputSampleRate:48000});
  const a = await create(), b = await create(), interrupts = [0,0];
  t.after(() => {a.dispose(); b.dispose();});
  b.process = referenceProcess;
  for (const [index,engine] of [a,b].entries()) {
    for (const [register,value] of [[0,120],[1,0],[7,0x3e],[8,12],[0x24,0xff],[0x25,3]]) engine.writeYm2608(0,register,value);
    engine.ym2608.setHooks({onIrq(asserted) {
      if (!asserted) return;
      interrupts[index]++;
      engine.writeYm2608(0,8,1);
      engine.writeYm2608(0,0x27,0x10);
    }});
    engine.writeYm2608(0,0x27,5);
  }
  assert.deepEqual(a.processFrames(512),b.processFrames(512));
  assert(interrupts[0] > 0);
  assert.deepEqual(interrupts,[1,1]);
});

test('YM2608 engine: long offline output stays within the native PCM request limit',() => {
  const left = new Float32Array(3000).fill(.25), right = new Float32Array(3000).fill(-.25);
  let calls = 0, generated = 0;
  const chip = {generateStereoView(frames) {
    assert(frames <= 0x1000000,'each request must fit the native frame limit');
    assert(frames <= left.length,'bounded PCM capacity must not follow offline output duration');
    calls++; generated += frames; return {left,right};
  }};
  const engine = new Ym2608AudioEngine(chip,1000000,48000);
  // This output needs 18,750,000 source frames: a single native request would
  // exceed its 16,777,216-frame limit, despite the output arrays fitting easily.
  const output = engine.processFrames(900000);
  assert.equal(generated,18750000);
  assert(calls > 1);
  assert.equal(output.left[0],.25); assert.equal(output.left.at(-1),.25);
  assert.equal(output.right[0],-.25); assert.equal(output.right.at(-1),-.25);
});
