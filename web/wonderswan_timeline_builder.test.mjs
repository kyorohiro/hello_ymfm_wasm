import test from 'node:test';
import assert from 'node:assert/strict';
import {WonderSwanSynth} from './wonderswansynth.js';

test('WonderSwan offline score shares high-level byte encoding without sending audio commands', async () => {
  const calls=[];
  const synth=new WonderSwanSynth({transport:{
    writeRegister(){assert.fail('offline score wrote to the audio transport');},
    writeMemory(){assert.fail('offline score wrote to the audio transport');},
    reset(){assert.fail('offline score reset the audio transport');},
    async prepareTimeline(score){calls.push(['prepare',score]);return 'ready';},
    async playTimeline(){calls.push(['play']);return 'done';},
    async stopTimeline(){calls.push(['stop']);},
  }});
  const bytes=new Uint8Array([0,128,4,192]);
  const score=synth.createTimeline({clock:3200001,pcmData:bytes});
  bytes.fill(0);
  score.writeRegister(0x90,0x22);score.adoptRegisterState();
  score.setVolume(0,12,8);score.setFrequency(0,500);
  score.at(3).pcm(0,4,2,7);
  score.writeMemory(0x1234,0xa5);
  const trace=score.finish(100);
  assert.equal(trace.clock,3200001);
  assert.deepEqual([...trace.pcmData],[0,128,4,192]);
  assert.deepEqual(trace.events,[[0,0,0x90,0x22],[0,0,0x88,0xc8],
    [0,0,0x80,56],[0,0,0x81,7],[3,2,0,4,2,7],[7,1,0x1234,0xa5]]);
  score.at(20).writeRegister(0x90,0);
  assert.equal(trace.events.length,6,'finished scores own their storage');
  assert.equal(await synth.prepareTimeline(trace),'ready');
  assert.equal(await synth.playTimeline(),'done');await synth.stopTimeline();
  assert.deepEqual(calls.map(call=>call[0]),['prepare','play','stop']);
});

test('WonderSwan score rejects backward time and malformed packed data before playback', () => {
  const synth=new WonderSwanSynth({transport:{writeRegister(){},writeMemory(){},reset(){}}});
  const score=synth.createTimeline({pcmData:new Uint8Array([0,128,5,192])});
  score.writeRegister(0x90,0x22);score.at(10).pcm(0,4,2,14);
  assert.throws(()=>score.at(13),/timeline sample/);
  assert.throws(()=>score.finish(13),/timeline duration/);
  assert.throws(()=>score.finish(20),/run end/);
  assert.throws(()=>synth.playTimeline(),/audio transport/);
});
