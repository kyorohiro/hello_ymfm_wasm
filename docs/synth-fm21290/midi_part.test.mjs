// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMidiFile} from '../js/midi_file.js';
import {partScore,partSource,playbackRegion} from './midi_part.js';

test('selected part generates editable calls on the SMF tempo map through its own end of track',async()=>{
  const track=bytes=>[77,84,114,107,0,0,0,bytes.length,...bytes];
  const song=parseMidiFile(Uint8Array.from([77,84,104,100,0,0,0,6,0,1,0,2,0,96,
    ...track([96,255,81,3,15,66,64,0,255,47,0]),
    ...track([0,145,40,99,96,144,60,100,0,64,80,0,176,64,1,0,1,97,
      48,224,0,96,48,144,60,0,0,128,64,0,48,176,64,0,48,255,47,0])]));
  const key=song.parts.find(p=>p.channel===1).key;
  const expected=[[.5,'noteOn',60,100],[.5,'noteOn',64,80],[.5,'sustain',1],[.5,'modWheel',97],
    [1,'pitchBend',12288],[1.5,'noteOff',60],[1.5,'noteOff',64],[2,'sustain',0],[2.5,'finish']];
  const score=partScore(song,key);
  assert.deepEqual(score,expected);
  assert.deepEqual(playbackRegion(score,1,2,true)[0],[0,'modWheel',97]);
  let time=0;
  const calls=[],waits=[];
  const part=Object.fromEntries(expected.map(([,method])=>[method,(...args)=>calls.push([time,method,...args])]));
  const run=Object.getPrototypeOf(async()=>{}).constructor('midi',partSource(score));
  await run({createPart:()=>part,createTimeline:()=>({waitUntil(t){time=t;waits.push(t);}})});
  assert.deepEqual(waits,[.5,1,1.5,2,2.5]);
  assert.deepEqual(calls,expected);
  assert.throws(()=>partScore(song,'missing'),/Select a MIDI part/);
});

test('seek restores the engine-specific pedal, keys and bend before boundary events',()=>{
  const score=[[0,'noteOn',60,72],[0,'sustain',1],[.1,'noteOff',60],
    [.2,'noteOn',60,94],[.3,'pitchBend',9000],[.5,'noteOn',64,80],
    [.75,'noteOff',64],[1,'noteOn',70,88],[2,'finish']];
  const shared=[[0,'noteOn',60,94],[0,'noteOn',64,80],[.25,'noteOff',64],[.5,'finish']];
  assert.deepEqual(playbackRegion(score,.5,1,true),[[0,'sustain',1],[0,'pitchBend',9000],
    [0,'noteOn',60,72],[0,'noteOff',60],...shared]);
  assert.deepEqual(playbackRegion(score,.5,1,false),[[0,'sustain',1],[0,'pitchBend',9000],...shared]);
  score[1][2]=127;
  assert.deepEqual(playbackRegion(score,.5,1,false),[[0,'sustain',127],[0,'pitchBend',9000],...shared]);
  assert.deepEqual(playbackRegion(score,0,2,true),score);
});
test('seek follows AUTO allocation when all slots are held or a pedal slot is reused',()=>{
  const initial=Array.from({length:16},(_,n)=>[0,'noteOn',48+n,80]);
  const score=[...initial,[.1,'noteOn',90,66],[.2,'sustain',127],[.3,'noteOff',48],
    [.4,'noteOn',70,99],[1,'finish']];
  const notes=playbackRegion(score,.5,1,true).filter(e=>e[1]==='noteOn');
  assert.deepEqual(notes,[[0,'noteOn',70,99],...initial.slice(1)]);
});
test('range validates endpoints and preserves instantaneous tracks',()=>{
  const score=[[0,'noteOn',60,75],[0,'finish']];
  assert.deepEqual(playbackRegion(score,0,0,true),score);
  for(const [a,b] of [[NaN,1],[0,Infinity],[-1,1],[0,2],[1,1],[.8,.2]])
    assert.throws(()=>playbackRegion([[1,'finish']],a,b,true),RangeError);
});
