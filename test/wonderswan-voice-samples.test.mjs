import test from 'node:test';
import assert from 'node:assert/strict';
import {extractSamples,listSamples,sampleFile} from '../docs/vgm_analyzer/sample_core.js';

test('Sample API captures timed VGM DAC streams and following direct Voice writes in source order',async()=>{
  const commands=[
    0xbc,0x10,0x22,0xbc,0x11,8,0xbc,0x14,15,
    0x67,0x66,0x0a,4,0,0,0,0x20,0x80,0xe0,0x60,
    0x90,0,0x21,0,9,0x91,0,0x0a,1,0,
    0x92,0,0x22,0x56,0,0,0x95,0,0,0,0,
    0x61,7,0,0xbc,9,0x80,0x61,2,0,0x66,
  ];
  const bytes=new Uint8Array(0x100+commands.length),view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);
  view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);view.setUint32(0xc0,3072000,true);
  bytes.set(commands,0x100);
  const result=await extractSamples(bytes);
  assert.equal(result.samples.length,1);
  const sample=result.samples[0];assert.equal(sample.kind,'voice-pcm');
  assert.deepEqual([...sample.data],[0x20,0x80,0xe0,0x60,0x80]);
  assert.deepEqual([...sample.times].filter((_,index)=>sample.registers[index]===9),[0,2,4,6,7]);
  assert.equal(sample.durationSamples,9);
  const json=JSON.parse(new TextDecoder().decode(sampleFile(sample,result.events).bytes));
  assert.equal(json.format,'tetorica-wonderswan-voice-pcm');
  assert.deepEqual(json.pcmBytes,[...sample.data]);assert.deepEqual(json.times,[...sample.times]);
  const inventory=await listSamples(bytes);
  assert.equal(inventory.samples[0].representation,'timed-voice-pcm');
  assert.ok(Array.isArray(inventory.samples[0].initial.registers));
  assert.equal(inventory.samples[0].initial.heldRegisters.length,32);
});
