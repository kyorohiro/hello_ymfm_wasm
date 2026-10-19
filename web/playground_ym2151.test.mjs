import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createYm2151Client} from './playground_ym2151.js';
import {Ym2151} from './ym2151.js';
import factory from '../docs/generated/ym2151_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {validateChipClock} from './playground_chip_clock.js';
import {Ym2151VoiceInspector} from './playground_ym2151_inspector.js';
import {receiveChipInspector} from './playground_chip_inspector_state.js';

async function setup(sampleRate) {
  let Processor, ready, frame = 0;
  const started = new Promise(resolve => {ready = resolve;});
  const source = (await readFile(new URL('./playground_ym2151_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {Ym2151, factory, sampleRate, validateChipClock,Ym2151VoiceInspector,receiveChipInspector,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:sampleRate,nowFrame:()=>frame}),
    AudioWorkletProcessor: class { constructor() {this.port = {postMessage: ready};} },
    registerProcessor: (_, value) => {Processor = value;},
  });
  const processor = new Processor({processorOptions: {wasmBinary: await readFile(new URL('../docs/generated/ym2151_wasm.wasm', import.meta.url))}});
  assert.equal((await started).ready, true);
  const chip = createYm2151Client({postMessage: data => processor.receive(data), close() {}});
  const render = n => {const out = [new Float32Array(n), new Float32Array(n)]; processor.process([], [out]); frame += n; return out;};
  return {processor, chip, render};
}
for (const rate of [44100,48000]) test(`OPM all channels, pan, pitch, release and noise at ${rate}`, async () => {
  const {chip, processor, render} = await setup(rate);
  try {
    for (let ch=0;ch<8;ch++) {
      chip.reset(); chip.setAlgo(ch,7); chip.setPan(ch,true,false);
      chip.setOperator(ch,3,{mul:1,tl:32,ar:31,rr:15});
      assert.equal(chip.setNote(ch,'A4'),0x4a); chip.keyOn(ch,8);
      const [left,right] = render(rate);
      assert.ok(left.some(x=>Math.abs(x)>.01)); assert.ok(right.every(x=>x===0));
      assert.ok(left.every(Number.isFinite));
      let crossings=0;
      for(let i=1;i<left.length;i++)if(left[i-1]<0&&left[i]>=0)crossings++;
      assert.ok(Math.abs(crossings-440)<5, `frequency: ${crossings}`);
      chip.setPan(ch,false,true);
      const pan=render(128); assert.ok(pan[0].every(x=>x===0)); assert.ok(pan[1].some(x=>x!==0));
      if(ch===7){chip.setNoise(true,12);assert.ok(render(1000)[1].some(x=>Math.abs(x)>.01));chip.setNoise(false);}
      chip.keyOff(ch); render(rate); assert.ok(render(128)[1].every(x=>Math.abs(x)<.0001));
    }
  } finally {chip.dispose();processor.dispose();}
  assert.equal(processor.process([], [[new Float32Array(128),new Float32Array(128)]]),false);
  assert.throws(()=>chip.keyOn(0),/disposed/);
});
test('OPM validates before writes and preserves adjacent bitfields, including raw edits', () => {
  const messages=[];const chip=createYm2151Client({postMessage: x=>messages.push(x),close(){}});
  chip.writeRegister(0x20,0x80);chip.setAlgo(0,4,3);
  assert.deepEqual(messages.at(-1).args,[0x20,0x9c]);
  chip.setPan(0,true,false);assert.deepEqual(messages.at(-1).args,[0x20,0x5c]);
  chip.setOperator(0,2,{dt1:3,mul:2});assert.deepEqual(messages.at(-1).args,[0x50,0x32]);
  const n=messages.length;
  for(const fn of [()=>chip.keyOn(8),()=>chip.setNote(0,'C0'),()=>chip.setNote(0,109),()=>chip.setPitch(0,1,64),()=>chip.setOperator(0,3,{tl:22,ar:32})])assert.throws(fn,RangeError);
  assert.equal(messages.length,n);
  chip.dispose();chip.dispose();assert.equal(messages.length,n+1);
});
test('OPM example runs against the real worklet', async () => {
  const {chip,processor,render}=await setup(48000);
  const source=await readFile(new URL('../docs/playground/examples/x68000/ym2151-tone.js',import.meta.url),'utf8');
  try {
    let calls=0;
    await new (Object.getPrototypeOf(async function(){}).constructor)('useSoundChip','sleep',source)(
      async name=>{assert.equal(name,'ym2151');return chip;},async seconds=>{render(Math.round(seconds*48000));calls++;});
    assert.equal(calls,8);assert.equal(processor.dead,true);
  } finally {chip.dispose();processor.dispose();}
});

test('OPM Stop silences an indefinite release and restores its saved patch on the next trigger', async () => {
  const {chip,processor,render}=await setup(48000);
  const peak = pcm => Math.max(...pcm[0].map(Math.abs));
  try {
    chip.setAlgo(0,7);chip.setPan(0,true,true);
    chip.setOperator(0,3,{mul:1,tl:32,ar:31,d1r:0,d2r:0,rr:0});
    chip.setNote(0,'A4');chip.keyOn(0,8);
    assert(peak(render(4096))>.01);
    const saved=chip._getState().registers.slice();
    chip.allNotesOff();assert.equal(peak(render(2048)),0);
    assert.deepEqual(chip._getState().registers,saved,'Stop keeps the patch in client memory');
    chip.keyOn(0,8);assert(peak(render(4096))>.01,'the old operator levels are restored');
    chip._forceKeyOff(0);assert(peak(render(2048))<.00001,'loop cancellation mutes even RR=0');
    chip.keyOn(0,8);assert(peak(render(4096))>.01);
  } finally {chip.dispose();processor.dispose();}
});

// Reference the former one-native-generation-per-output-sample path. Batching
// must preserve every native sample, held value and fractional phase exactly.
function useSampleReference(processor, sampleRate) {
  processor.renderSegment = function(left, right) {
    for (let i = 0; i < left.length; i++) {
      this.remainder += this.rate;
      const count = Math.floor(this.remainder / sampleRate);
      this.remainder -= count * sampleRate;
      if (count) {
        const pcm = this.chip.generateStereo(count);
        let l = 0, r = 0;
        for (let j = 0; j < count; j++) { l += pcm.left[j]; r += pcm.right[j]; }
        this.left = l / count; this.right = r / count;
      }
      left[i] = this.silent ? 0 : this.left; right[i] = this.silent ? 0 : this.right;
    }
  }.bind(processor);
}
function configureTone(chip) {
  chip.setAlgo(0,7); chip.setPan(0,true,true);
  chip.setOperator(0,3,{mul:1,tl:32,ar:31,d1r:0,d2r:0,rr:0});
  chip.setPitch(0,0x4a); chip.keyOn(0,8);
}
for (const rate of [44100,48000,96000]) test(`OPM batched native PCM equals sample rendering at ${rate} Hz and changing clocks`, async () => {
  const actual = await setup(rate), reference = await setup(rate), port = {postMessage() {}};
  useSampleReference(reference.processor, rate);
  try {
    for (const clock of [3579545,4000000,8000000,100000]) {
      for (const fixture of [actual,reference]) {
        fixture.processor.apply({method:'clock',args:[clock]},port);
        fixture.chip._adoptClock(clock);
        configureTone(fixture.chip);
      }
      for (const frames of [128,1,127,53,1024]) {
        const output = actual.render(frames), expected = reference.render(frames);
        assert.deepEqual(output,expected, `clock ${clock}, ${frames} output frames`);
        assert.equal(actual.processor.remainder,reference.processor.remainder);
      }
      for (const fixture of [actual,reference]) fixture.chip.allNotesOff();
      assert.deepEqual(actual.render(128),reference.render(128));
    }
  } finally { actual.processor.dispose(); reference.processor.dispose(); }
});
test('OPM batches one native generation per reserved-event segment and reuses count storage', async () => {
  const rate = 48000, actual = await setup(rate), reference = await setup(rate), port = {postMessage() {}};
  useSampleReference(reference.processor, rate);
  try {
    for (const fixture of [actual,reference]) {
      configureTone(fixture.chip);
      fixture.processor.receive({type:'performance-start',session:1},port);
      fixture.processor.receive({performance:{session:1,owner:'tone',time:63/rate},commands:[{method:'writeRegister',args:[0x28,0x4c]}]},port);
      fixture.processor.receive({performance:{session:1,owner:'tone',time:191/rate},commands:[{method:'allNotesOff',args:[]}]},port);
    }
    let calls = 0;
    const generate = actual.processor.chip.generateStereo.bind(actual.processor.chip);
    actual.processor.chip.generateStereo = frames => { calls++; return generate(frames); };
    const counts = actual.processor.counts;
    assert.deepEqual(actual.render(128),reference.render(128));
    assert.equal(calls,2,'the pitch event splits the quantum into two native generations');
    calls = 0;
    assert.deepEqual(actual.render(128),reference.render(128));
    assert.equal(calls,2,'Stop still takes effect at its reserved output frame');
    assert.equal(actual.processor.counts,counts,'normal quanta do not allocate count arrays');
  } finally { actual.processor.dispose(); reference.processor.dispose(); }
});
