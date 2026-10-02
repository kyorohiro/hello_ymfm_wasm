import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createYm2151Client} from './playground_ym2151.js';
import {Ym2151} from './ym2151.js';
import factory from '../docs/generated/ym2151_wasm.js';

async function setup(sampleRate) {
  let Processor, ready;
  const started = new Promise(resolve => {ready = resolve;});
  const source = (await readFile(new URL('./playground_ym2151_worklet.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInNewContext(source, {Ym2151, factory, sampleRate,
    AudioWorkletProcessor: class { constructor() {this.port = {postMessage: ready};} },
    registerProcessor: (_, value) => {Processor = value;},
  });
  const processor = new Processor({processorOptions: {wasmBinary: await readFile(new URL('../docs/generated/ym2151_wasm.wasm', import.meta.url))}});
  assert.equal((await started).ready, true);
  const chip = createYm2151Client({postMessage: data => processor.receive(data), close() {}});
  const render = n => {const out = [new Float32Array(n), new Float32Array(n)]; processor.process([], [out]); return out;};
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
  const source=await readFile(new URL('../docs/playground/examples/chip-saw/ym2151-tone.js',import.meta.url),'utf8');
  try {
    let calls=0;
    await new (Object.getPrototypeOf(async function(){}).constructor)('useSoundChip','sleep',source)(
      async name=>{assert.equal(name,'ym2151');return chip;},async seconds=>{render(Math.round(seconds*48000));calls++;});
    assert.equal(calls,8);assert.equal(processor.dead,true);
  } finally {chip.dispose();processor.dispose();}
});
