import test from 'node:test';
import assert from 'node:assert/strict';
import {Oki6295AudioEngine} from '../js/okim6295audioengine.js';
import {SongSampleMemory,decodeSongSample} from './song-samples.js';

test('banked pause preview follows the accepted sample through a busy retrigger and partial ROM uploads',()=>{
  const chip=new Oki6295AudioEngine({clock:0x80000000+1000000});
  const memory=new SongSampleMemory(), offset=0x40000, size=offset+10;
  const upload=(address,bytes)=>{
    chip.loadOki6295Rom(Uint8Array.from(bytes),offset+address,size);
    memory.observe(offset+address,bytes.length,size);
  };
  upload(0,[0,0,8,0,0,9]);
  upload(8,[0x17]);
  chip.writeOki6295(15,1);chip.command(128);chip.command(0x10);
  chip.command(129);chip.command(0x13);
  assert.equal(memory.snapshot(chip).voices[0].bytes,null);
  upload(9,[0x17]);
  const {voices,rate}=memory.snapshot(chip);
  assert.equal(rate,1000000/132);
  assert.deepEqual([voices[0].busy,voices[0].sample,voices[0].attenuation,voices[0].requestedSample,voices[0].requestedAttenuation],[true,0,0,1,3]);
  const {pcm}=decodeSongSample(voices[0],2);
  for (const sample of pcm) {chip.tick();assert.equal(sample,chip.voices[0].output);}
  assert.equal(chip.readStatus(),0xf0);
  assert.deepEqual(memory.snapshot(chip).voices[0].bytes,Uint8Array.of(0x17,0x17));
});
