import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Ym2203} from './ym2203.js';
import {Ym2608} from './ym2608.js';
import {Ym2610B} from './ym2610b.js';
import {createPerformanceQueue, createPerformanceChipOwnership} from './playground_performance_queue.js';
import {createChipPortReceiver} from './playground_chip_port.js';
import {createOpnAuditionGuard, receiveOpnAuditionCommand} from './playground_audition_guard.js';
import {validateChipClock} from './playground_chip_clock.js';

const chips = [['ym2203', Ym2203], ['ym2608', Ym2608], ['ym2610b', Ym2610B]];

async function setup(name, Chip, rate) {
  let Processor;
  const scope = {
    currentFrame:0, sampleRate:rate, Float32Array, Uint8Array, Uint32Array, Error,
    createPerformanceQueue, createPerformanceChipOwnership, createChipPortReceiver,
    createOpnAuditionGuard, receiveOpnAuditionCommand, validateChipClock,
    AudioWorkletProcessor:class {constructor() {this.port = {postMessage() {}};}},
    registerProcessor(_name, Type) {Processor = Type;},
  };
  const source = await readFile(new URL(`./${name}-worklet.js`, import.meta.url), 'utf8');
  vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), scope);
  const moduleFactory = (await import(`../docs/generated/${name}_wasm.js`)).default;
  const wasmBinary = await readFile(new URL(`../docs/generated/${name}_wasm.wasm`, import.meta.url));
  const processor = new Processor();
  processor.chip = await Chip.create({moduleFactory, moduleOptions:{wasmBinary}});
  processor.chipRate = processor.chip.sampleRate();
  processor.auditions = createOpnAuditionGuard(processor.chip, name === 'ym2203' ? 3 : 6);
  let calls = 0;
  const generate = processor.chip.generateStereo.bind(processor.chip);
  processor.chip.generateStereo = frames => {calls++; return generate(frames);};
  return {processor, scope, get calls() {return calls;}};
}

// Keep the previous per-output-frame implementation as an independent PCM
// reference. Both sides run real WASM, including its FM, SSG and timer state.
function referenceRender({processor:p, scope}, left, right) {
  for (let frame = 0; frame < left.length; frame++) {
    if (p.performanceQueue.nextFrame() <= scope.currentFrame + frame) p.performanceQueue.advance(scope.currentFrame + frame);
    p.remainder += p.chipRate;
    const count = Math.floor(p.remainder / scope.sampleRate);
    p.remainder -= count * scope.sampleRate;
    if (count) {
      const pcm = p.chip.generateStereo(count);
      let l = 0, r = 0;
      for (let index = 0; index < count; index++) {l += pcm.left[index]; r += pcm.right[index];}
      p.lastLeft = l / count; p.lastRight = r / count;
    }
    left[frame] = p.lastLeft; right[frame] = p.lastRight;
  }
}

function program(fixture) {
  const {processor:p, scope} = fixture;
  const write = (register, value) => ({type:'write', port:0, register, value});
  const patch = [write(0xb0,7), write(0xb4,0xc0)];
  for (const offset of [0,4,8,12]) patch.push(write(0x30 + offset,1),write(0x40 + offset,offset === 12 ? 32 : 127),write(0x50 + offset,31),write(0x80 + offset,15));
  patch.push(write(0xa4,0x22),write(0xa0,0x69),write(0x28,0xf0),write(0,120),write(1,0),write(7,0x3e),write(8,8));
  const port = {postMessage() {}, start() {}, close() {}};
  p.port.onmessage({data:{type:'attach-chip-port',port}});
  p.port.onmessage({data:{type:'performance-start',session:1}});
  const events = [
    [0,patch],
    [37,[{type:'chip-clock',clock:100000,id:'slow'}]],
    [64,[write(0xa0,0xe0)]],
    [128,[{type:'chip-clock',clock:16000000,id:'fast'}]],
    [159,[write(0x4c,12)]],
    [200,[write(8,4)]],
    [257,[{type:'reset'},...patch]],
    [320,[{type:'chip-clock',clock:1000000,id:'slow-again'}]],
    [381,[{type:'chip-clock',clock:8000000,id:'restore'}]],
    [511,[write(0x28,0)]],
    [560,[write(0x28,0xf0)]],
    [620,[write(8,0)]],
    [702,[write(8,9),write(0,48)]],
  ];
  for (const [frame,commands] of events) port.onmessage({data:{performance:{session:1,owner:'melody',time:frame/scope.sampleRate},commands}});
}

for (const [name,Chip] of chips) for (const rate of [44100,48000,96000]) {
  test(`${name} batched primary matches real per-frame FM/SSG across timed clocks, reset and held samples at ${rate} Hz`, async t => {
    const actual = await setup(name,Chip,rate), reference = await setup(name,Chip,rate);
    t.after(() => {actual.processor.chip.dispose(); reference.processor.chip.dispose();});
    program(actual); program(reference);
    let peak = 0;
    // Different quantum sizes exercise events at the first/last frame and
    // reuse/growth of scratch storage without discarding fractional phase.
    for (const frames of [37,1,26,64,1,30,41,57,1,62,61,128,49,60,82,1,127,512,3]) {
      const left = new Float32Array(frames), right = new Float32Array(frames);
      const expectedLeft = new Float32Array(frames), expectedRight = new Float32Array(frames);
      actual.processor.process([],[[left,right]]);
      referenceRender(reference,expectedLeft,expectedRight);
      assert.deepEqual(left,expectedLeft);
      assert.deepEqual(right,expectedRight);
      assert.equal(actual.processor.remainder,reference.processor.remainder);
      actual.scope.currentFrame += frames; reference.scope.currentFrame += frames;
      for (const value of left) peak = Math.max(peak,Math.abs(value));
    }
    assert(peak > .001,'actual FM/SSG output must be audible');
    assert(actual.calls < reference.calls / 8,'WASM calls scale with timed segments instead of output samples');
    assert.equal(actual.processor.performanceQueue.getStats().queuedCommands,0);
  });
}
