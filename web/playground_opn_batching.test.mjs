import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Ym2612} from './ym2612.js';
import {Ym2203} from './ym2203.js';
import {Ym2610B} from './ym2610b.js';
import ym2612Factory from '../docs/generated/ym2612_wasm.js';
import ym2203Factory from '../docs/generated/ym2203_wasm.js';
import ym2610Factory from '../docs/generated/ym2610b_wasm.js';
import {validateChipClock} from './playground_chip_clock.js';
import {createProcessorPerformance} from './playground_performance_processor.js';

async function setup(name,rate) {
  let Processor, resolveReady, calls = 0;
  const ready = new Promise(resolve => {resolveReady = resolve;});
  const messages = [];
  const scope = {sampleRate:rate,currentFrame:0,Ym2612,Ym2203,Ym2610B,ym2612Factory,ym2203Factory,ym2610Factory,validateChipClock,
    createProcessorPerformance:options => createProcessorPerformance({...options,rate,nowFrame:() => scope.currentFrame}),
    AudioWorkletProcessor:class {constructor() {this.port = {postMessage:message => {messages.push(message); resolveReady(message);}};}},
    registerProcessor(_name,Type) {Processor = Type;},
  };
  const source = await readFile(new URL('./playground_opn_worklet.js',import.meta.url),'utf8');
  vm.runInNewContext(source.replace(/^import .*;\n/gm,''),scope);
  const wasmBinary = await readFile(new URL(`../docs/generated/${name === 'ym2610' ? 'ym2610b' : name}_wasm.wasm`,import.meta.url));
  const p = new Processor({processorOptions:{name,wasmBinary}});
  assert.equal((await ready).ready,true);
  const view = p.chip.generateStereoView.bind(p.chip);
  p.chip.generateStereoView = frames => {calls++; return view(frames);};
  const port = {postMessage:message => messages.push(message)};
  const receive = command => p.receive(command,port);
  return {p,scope,messages,receive,get calls() {return calls;}};
}

// Independent reference is the previous per-output-sample worklet algorithm.
function referenceSegment(left,right) {
  for (let frame = 0; frame < left.length; frame++) {
    const schedule = this.schedule;
    if (schedule) {
      const position = schedule.frame * 44100 / this.testRate;
      while (schedule.index < schedule.events.length && schedule.events[schedule.index][0] <= position) {
        const [,register,value] = schedule.events[schedule.index++];
        this.chip.write(0,register); this.chip.write(1,value);
      }
      if (position >= schedule.duration) {this.schedule = null; schedule.port.postMessage({id:schedule.id});}
      else schedule.frame++;
    }
    this.remainder += this.rate;
    const count = Math.floor(this.remainder / this.testRate);
    this.remainder -= count * this.testRate;
    if (count) {
      const pcm = this.chip.generateStereo(count);
      let l = 0, r = 0;
      for (let index = 0; index < count; index++) {l += pcm.left[index]; r += pcm.right[index];}
      this.left = l/count; this.right = r/count;
    }
    left[frame] = this.left; right[frame] = this.right;
  }
}

function program(fixture,name) {
  const write = (register,value) => ({method:'write',args:[0,register,value]});
  const channel = name === 'ym2610' ? 1 : 0;
  const patch = [write(0xb0+channel,7),write(0xb4+channel,0xc0)];
  for (const offset of [0,4,8,12]) patch.push(write(0x30+offset+channel,1),write(0x40+offset+channel,offset === 12 ? 32 : 127),write(0x50+offset+channel,31),write(0x80+offset+channel,15));
  patch.push(write(0xa4+channel,0x22),write(0xa0+channel,0x69),write(0x28,0xf0|channel));
  if (name !== 'ym2612') patch.push(write(0,120),write(1,0),write(7,0x3e),write(8,8));
  for (const command of patch) fixture.receive(command);
  fixture.receive({type:'performance-start',session:1});
  for (const [frame,commands] of [
    [37,[{method:'clock',args:[100000]}]],
    [129,[{method:'clock',args:[16000000]}]],
    [257,[write(0xa0+channel,180)]],
    [560,[write(0x28,channel)]],
    [702,[write(0x28,0xf0|channel)]],
  ]) fixture.receive({performance:{session:1,owner:'lead',time:frame/fixture.scope.sampleRate},commands});
  if (name === 'ym2203') fixture.receive({method:'schedule',id:'vgm',args:[[
    [0,8,8],[1,0,48],[73,0,96],[211,8,4],[441,0,120],[882,8,0],
  ],882]});
}

for (const name of ['ym2612','ym2203','ym2610']) for (const rate of [44100,48000,96000]) {
  test(`independent ${name}: batched borrowed PCM preserves timed writes and VGM scheduling at ${rate} Hz`,async t => {
    const actual = await setup(name,rate), reference = await setup(name,rate);
    t.after(() => {actual.p.dispose(); reference.p.dispose();});
    reference.p.testRate = rate;
    reference.p.renderSegment = referenceSegment.bind(reference.p);
    let ownedCalls = 0;
    const generate = reference.p.chip.generateStereo.bind(reference.p.chip);
    reference.p.chip.generateStereo = frames => {ownedCalls++; return generate(frames);};
    actual.p.chip.generateStereo = () => assert.fail('real-time OPN must use borrowed PCM');
    program(actual,name); program(reference,name);
    let peak = 0;
    for (const frames of [37,1,26,64,1,30,41,57,1,62,61,128,49,60,82,1,127,128,128,128,4096]) {
      const left = new Float32Array(frames), right = new Float32Array(frames);
      const expectedLeft = new Float32Array(frames), expectedRight = new Float32Array(frames);
      actual.p.process([],[[left,right]]); reference.p.process([],[[expectedLeft,expectedRight]]);
      assert.deepEqual(left,expectedLeft); assert.deepEqual(right,expectedRight);
      assert.equal(actual.p.remainder,reference.p.remainder);
      assert.deepEqual(structuredClone(actual.messages),structuredClone(reference.messages));
      actual.scope.currentFrame += frames; reference.scope.currentFrame += frames;
      for (const value of left) peak = Math.max(peak,Math.abs(value));
    }
    assert(peak > .001);
    assert(actual.calls < ownedCalls/16,'WASM rendering must scale with event segments, not output samples');
    if (name === 'ym2203') {
      assert.equal(actual.p.schedule,null);
      assert.equal(actual.messages.filter(message => message.id === 'vgm').length,1);
    }
  });
}
