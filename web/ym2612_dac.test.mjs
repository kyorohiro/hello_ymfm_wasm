import test from 'node:test';
import assert from 'node:assert/strict';
import {YM2612Synth, YM2612DirectTransport, YM2612WorkletTransport} from './ym2612synth.js';
import {YM2612DacPlayer, receiveDacCommand} from './ym2612_dac.js';

function fixture(rate = 48000) {
  let frame = 0, value = 128;
  const writes = [];
  const chip = {sampleRate: () => rate, reset() {frame = 0; value = 128;},
    writeRegister(r, v, p) {writes.push([frame, p, r, v]); if (r === 0x2a) value = v;},
    generateStereo(n) {frame += n; return {left: new Float32Array(n).fill(value), right: new Float32Array(n).fill(value)};},
  };
  const transport = new YM2612DirectTransport(chip), synth = new YM2612Synth({transport});
  return {transport, synth, writes};
}

test('registered PCM is copied; offset/size and repeated starts follow the render clock', async () => {
  const {synth, transport, writes} = fixture();
  const data = Uint8Array.of(0, 100, 200, 255);
  await synth.dac.setSample('voice', data.subarray(1, 3), {sampleRate: 12000});
  data.fill(1);
  await synth.dac.playFromSample('voice', {when: 0.001});
  const pcm = transport.generateStereo(60).left;
  assert.deepEqual([...pcm.slice(48, 56)], [100,100,100,100,200,200,200,200]);
  assert.equal(pcm[56], 128);
  await synth.dac.playFromSample('voice', {offset: 1, size: 1, pan: 'left'});
  assert.deepEqual([...transport.generateStereo(5).left], [200,200,200,200,128]);
  assert.ok(writes.some(w => w[0] === 60 && w[2] === 0xb6 && w[3] === 0x80));
});

test('fractional rate conversion does not drift and is independent of render chunk size', async () => {
  async function render(chunks) {
    const f = fixture(53267);
    await f.synth.dac.play(new Uint8Array(11025).fill(190), {sampleRate: 11025});
    for (const n of chunks) f.transport.generateStereo(n);
    return f.writes;
  }
  const whole = await render([53268]);
  assert.deepEqual(await render([...Array(416).fill(128), 20]), whole);
  assert.ok(whole.some(w => w[0] === 53267 && w[2] === 0x2b && w[3] === 0));
});

test('one physical voice: new starts replace active PCM; stop cancels queued starts; reset retains samples', async () => {
  const {synth, transport} = fixture(100);
  await synth.dac.setSample('a', [150,151,152], {sampleRate: 10});
  await synth.dac.playFromSample('a');
  await synth.dac.play([210], {sampleRate:10, when:0.05});
  assert.deepEqual([...transport.generateStereo(7).left], [150,150,150,150,150,210,210]);
  await synth.dac.playFromSample('a', {when: 1});
  await synth.dac.stop();
  assert.ok(transport.generateStereo(120).left.every(v => v === 128));
  const api = synth.dac;
  synth.reset();
  assert.equal(api, synth.dac);
  await synth.dac.playFromSample('a');
  assert.equal(transport.generateStereo(1).left[0], 150);
  assert.doesNotThrow(() => structuredClone(synth.getState()));
});

test('validation and unsupported transports fail explicitly', async () => {
  const {synth, transport} = fixture();
  assert.throws(() => synth.dac.setSample('x', new Float32Array(2), {sampleRate: 1}), /PCM/);
  assert.throws(() => synth.dac.setSample('x', [256], {sampleRate: 1}), /PCM/);
  assert.throws(() => synth.dac.play([1], {sampleRate:0}), /sampleRate/);
  assert.throws(() => synth.dac.play([1], {sampleRate:1, when:-1}), /when/);
  await assert.rejects(synth.dac.playFromSample('missing'), /Unknown/);
  await synth.dac.setSample('x', [1], {sampleRate:1});
  await assert.rejects(synth.dac.playFromSample('x', {offset:1}), /range/);
  await synth.dac.removeSample('x');
  await assert.rejects(synth.dac.playFromSample('x'), /Unknown/);
  assert.throws(() => transport.generateStereo(-1), /frames/);
  const other = new YM2612Synth({transport:{write(){}}});
  await assert.rejects(other.dac.play([1], {sampleRate:1}), /requires/);
});

test('Web registration waits for backend ACK; source bytes survive transfer; failures and disposal reject', async () => {
  const sent = [];
  let listener;
  const port = {addEventListener(_type, fn){listener=fn;}, start(){},
    postMessage(message, transfer=[]) {sent.push(structuredClone(message, {transfer}));}};
  const transport = new YM2612WorkletTransport({port});
  const synth = new YM2612Synth({transport});
  const source = Uint8Array.of(140,180);
  let ready = false;
  const registration = synth.dac.setSample('x', source, {sampleRate:12000}).then(() => {ready=true;});
  await Promise.resolve();
  assert.equal(ready, false);
  assert.equal(source.byteLength, 2);
  const player = new YM2612DacPlayer(48000, () => {});
  receiveDacCommand(player, sent.at(-1), 0, data => listener({data}));
  await registration;
  assert.equal(ready, true);
  const failure = synth.dac.playFromSample('bad');
  receiveDacCommand(player, sent.at(-1), 0, data => listener({data}));
  await assert.rejects(failure, /Unknown/);
  const pending = synth.dac.setSample('y', [1], {sampleRate:1});
  transport.dispose();
  await assert.rejects(pending, /disposed/);
});

test('Node Buffer PCM owns its bytes and late requests start at the next render frame', async () => {
  const {synth,transport,writes} = fixture(100);
  const buffer = Buffer.from([10,150,160,20]);
  await synth.dac.setSample('buffer', buffer.subarray(1,3), {sampleRate:10});
  buffer.fill(0);
  transport.generateStereo(10);
  synth.setPan(5,true,true,2,3);
  await synth.dac.playFromSample('buffer', {when:0,pan:'right'});
  assert.equal(transport.generateStereo(1).left[0],150);
  assert.ok(writes.some(w=>w[0]===10 && w[2]===0xb6 && w[3]===0x63));
});

test('Direct DAC rendering copies borrowed views before the next generate overwrites them',async()=>{
 const scratch=new Float32Array(32);let value=128;
 const chip={sampleRate:()=>100,reset(){},writeRegister(r,v){if(r===42)value=v;},
  generateStereo(){throw new Error('owned intermediate PCM should not be needed');},
  generateStereoView(n){scratch.fill(value);return {left:scratch,right:scratch};}};
 const transport=new YM2612DirectTransport(chip),synth=new YM2612Synth({transport});
 await synth.dac.play([140,180],{sampleRate:10});
 const result=transport.generateStereo(21);scratch.fill(0);
 assert.deepEqual([...result.left],[...Array(10).fill(140),...Array(10).fill(180),128]);
 assert.deepEqual(result.left,result.right);
});

test('real WASM PCM is identical with owned arrays and borrowed capacity views',async()=>{
 const {Ym2612}=await import('./ym2612.js');
 const {default:factory}=await import('../docs/generated/ym2612_wasm.js');
 const chip=await Ym2612.create({moduleFactory:factory});
 try{
  chip.reserveStereoFrames(512);
  const view=chip.generateStereoView.bind(chip),results=[];
  for(const useViews of [false,true]){
   chip.generateStereoView=useViews?view:undefined;
   const transport=new YM2612DirectTransport(chip),synth=new YM2612Synth({transport});
   await synth.dac.play(Uint8Array.from({length:2205},(_,i)=>128+Math.round(60*Math.sin(i/4))),{sampleRate:11025});
   results.push(transport.generateStereo(Math.ceil(chip.sampleRate()*.21)));
  }
  assert.deepEqual(results[0],results[1]);
 }finally{chip.dispose();}
});
