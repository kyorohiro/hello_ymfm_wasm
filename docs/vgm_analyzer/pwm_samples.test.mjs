import test from 'node:test';
import assert from 'node:assert/strict';
import {createPwmSamples,renderPwmPreview,pwmCaptureJson,pwmCaptureWav} from './pwm_samples.js';
import {extractSamples} from './sample_explorer.js';
test('PWM stereo writes, same-time updates and Cycle changes survive capture',()=>{
 const p=createPwmSamples();p.write(0,5,0);p.write(1,100,0);p.write(2,75,5);p.write(3,25,5);
 p.write(2,50,7);p.write(2,100,7);p.write(1,200,8);p.finish(10,'end');
 const s=p.samples[0],pcm=renderPwmPreview(s);
 assert.deepEqual([...pcm.left],[.5,.5,1,0,0]);assert.deepEqual([...pcm.right],[-.5,-.5,-.5,-.75,-.75]);
 const json=JSON.parse(pwmCaptureJson(s,5));assert.equal(json.initialState.cycle,100);assert.deepEqual(json.times,[0,0,2,2,3]);
 const wav=pwmCaptureWav(s),v=new DataView(wav.buffer);assert.equal(v.getUint16(22,true),2);assert.equal(v.getUint32(24,true),44100);assert.equal(v.getUint32(40,true),20);
 assert.equal(v.getInt16(44,true),16384);assert.equal(v.getInt16(46,true),-16384);
});
test('window boundary carries both held values and does not create empty tail',()=>{
 const p=createPwmSamples();p.write(1,100,0);p.write(4,75,0);p.advance(441000);p.write(4,25,441000);p.finish(441002,'end');
 assert.equal(p.samples.length,2);assert.equal(p.events[1].startTime,441000);
 assert.equal(renderPwmPreview(p.samples[0]).right.at(-1),.5);
 assert.deepEqual([...renderPwmPreview(p.samples[1]).left],[-.5,-.5]);
 const q=createPwmSamples();q.write(1,100,0);q.write(4,75,0);q.advance(441000);q.finish(441000,'end');assert.equal(q.samples.length,1);
});
function file(commands){const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);v.setUint32(0x70,23011361,true);b.set(commands,256);return b;}
test('extractor captures direct and stream PWM writes through the same target',async()=>{
 const r=await extractSamples(file([0xb2,0x10,100,0xb2,0x40,75,0x71,
  0x67,0x66,3,4,0,0,0,25,0,50,0,0x90,0,0x11,0,4,0x91,0,3,1,0,
  0x92,0,0x44,0xac,0,0,0x95,0,0,0,0,0x71,0x66]));
 assert.equal(r.samples.length,1);assert.equal(r.samples[0].kind,'pwm');assert.deepEqual([...renderPwmPreview(r.samples[0]).left],[.5,.5,-.5,0]);
 assert.equal(r.events[0].endTime,4);
});
