import test from 'node:test';
import assert from 'node:assert/strict';
import {createPokeyClient,createPokeyRegisterClient} from './playground_pokey.js';
import {createPokeyFixture,peak} from '../test/helpers/pokey_worklet_fixture.mjs';

test('POKEY Main/Worker clients retain independent zero-based channels and physical read-map ACKs',async()=>{
  const p=await createPokeyFixture({clock:1789773});
  try{
    p.client.noteOn(0,'E3');p.client.noteOn(3,'A4');assert(peak(p.render(4096)[0])>.01);
    const snapshot=p.client._getState(),messages=[],worker=createPokeyClient({postMessage:data=>messages.push(data),close(){}},{clock:1789773,state:snapshot});
    assert.equal(messages.length,0,'state handoff does not replay writes or reset');worker.keyOff(3);assert.deepEqual(messages.at(-1),{method:'writeRegister',args:[7,0xa0],channel:3});worker.dispose();
    p.client.writeRegister(0,0x55);const read=p.client.readRegister(0);assert(read instanceof Promise);assert.notEqual(await read,0x55,'POT0 hardware read does not echo AUDF0 write');
    await p.client.setChannelMuted(0,true);assert(p.processor.speaker.mutedChannels[0]);await p.client.setChannelMuted(0,false);
    await p.client._stopVoices();assert(p.read().channels.every(channel=>!channel.active));assert.equal(peak(p.render(128)[0]),0);assert.equal(p.client._getState().registers[1]&15,0);
    p.client.keyOn(0);assert(peak(p.render(4096)[0])>.01,'Stop preserves configured pitch/distortion/volume');
  }finally{p.close();}
});

test('POKEY client clock is fixed and rejection leaves pitch authoring synchronized',async()=>{
  const p=await createPokeyFixture({clock:1789773});
  try{
    await p.client.setClock(1789773);await assert.rejects(p.client.setClock(2000000),/new POKEY|clock/);assert.equal(p.client.clock,1789773);
    const actual=p.client.setNote(2,'A4');assert.equal(actual,1789773/(2*28*73));assert.equal(p.read().channels[2].frequency,actual);
    await assert.rejects(p.client.setClock(0),/clock/);assert.equal(p.client.clock,1789773);
  }finally{p.close();}
});

test('POKEY retained zero volume survives state handoff, inspector audition and subsequent key presses',async()=>{
  const p=await createPokeyFixture();
  try{
    p.client.setVolume(2,0);assert.equal(p.client._getState().levels[2],0);assert.equal(p.read().channels[2].configuredVolume,0);
    p.invoke('auditionOn',[2,69,'zero']);assert.equal(p.read().channels[2].configuredVolume,0);assert.equal(peak(p.render(1024)[0]),0);p.invoke('auditionOff',[2,'zero']);
    const clone=createPokeyRegisterClient(()=>{}, {clock:p.clock});clone._adoptState(p.client._getState());assert.equal(clone._getState().levels[2],0);clone.dispose();
    p.client.keyOn(2);assert.equal(peak(p.render(1024)[0]),0);p.client.setVolume(2,6);p.client.keyOn(2);assert(peak(p.render(1024)[0])>.01);
  }finally{p.close();}
});

test('POKEY disposal is idempotent, rejects all pending ACKs and prevents no-write setters after close',async()=>{
  const commands=[];let closed=0;const client=createPokeyClient({postMessage:data=>commands.push(data),close(){closed++;}});
  client.initialize();const clock=client.setClock(2000000),read=client.readRegister(0),stop=client._stopVoices();
  const checks=[assert.rejects(clock,/disposed/),assert.rejects(read,/disposed/),assert.rejects(stop,/disposed/)];client.dispose();await Promise.all(checks);client.dispose();assert.equal(closed,1);
  const before=commands.length;assert.throws(()=>client.setVolume(0,6),/disposed/);assert.throws(()=>client.noteOn(0,'A4'),/disposed/);assert.throws(()=>client._stopVoices(),/disposed/);assert.equal(commands.length,before);
});
