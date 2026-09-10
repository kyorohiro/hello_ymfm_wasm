import test from 'node:test';
import assert from 'node:assert/strict';
import {createDacSamples,renderDacPreview} from './dac_samples.js';
import {extractSamples} from './sample_explorer.js';
test('DAC disabled writes latch; irregular timing and last same-time write survive',()=>{
 const d=createDacSamples();d.write(0x2a,192,0,0);d.write(0x2b,128,0,10);d.write(0x2a,0,0,12);d.write(0x2a,255,0,12);d.write(0x2b,0,0,15);
 assert.deepEqual([...renderDacPreview(d.samples[0])],[0.5,0.5,127/128,127/128,127/128]);
 assert.equal(d.events[0].startTime,10);assert.equal(d.events[0].endTime,15);
});
test('long holds have bounded windows and carry the held DAC value',()=>{
 const d=createDacSamples();d.write(0x2a,192,0,0);d.write(0x2b,128,0,0);d.advance(441010);d.finish(441010,'VGM end');
 assert.equal(d.samples.length,2);assert.equal(d.samples[0].duration,441000);assert.equal(d.samples[1].duration,10);assert.equal(renderDacPreview(d.samples[1])[0],0.5);
});
function file(commands){const b=new Uint8Array(256+commands.length);b.set([86,103,109,32]);const v=new DataView(b.buffer);v.setUint32(8,0x171,true);v.setUint32(0x2c,7670454,true);v.setUint32(0x34,0xcc,true);b.set(commands,256);return b;}
test('VGM PCM bank DAC commands produce timestamped captured output',async()=>{
 const r=await extractSamples(file([0x67,0x66,0,2,0,0,0,192,64,0x52,0x2b,128,0xe0,0,0,0,0,0x82,0x83,0x52,0x2b,0,0x66]));
 const s=r.samples[0];assert.equal(s.kind,'dac');assert.equal(s.duration,5);assert.deepEqual([...renderDacPreview(s)],[0.5,0.5,-0.5,-0.5,-0.5]);
});
test('VGM stream frequency controls DAC write times',async()=>{
 const r=await extractSamples(file([0x67,0x66,0,2,0,0,0,192,64,0x52,0x2b,128,
  0x90,0,2,0,0x2a,0x91,0,0,1,0,0x92,0,0x22,0x56,0,0,
  0x93,0,0,0,0,0,1,2,0,0,0,0x61,6,0,0x52,0x2b,0,0x66]));
 assert.deepEqual([...renderDacPreview(r.samples[0])],[0,0,0.5,0.5,-0.5,-0.5]);
});
