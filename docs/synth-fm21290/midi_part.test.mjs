// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMidiFile} from '../js/midi_file.js';
import {partScore,partSource} from './midi_part.js';

test('selected part generates editable calls on the SMF tempo map through its own end of track',async()=>{
  const track=bytes=>[77,84,114,107,0,0,0,bytes.length,...bytes];
  const song=parseMidiFile(Uint8Array.from([77,84,104,100,0,0,0,6,0,1,0,2,0,96,
    ...track([96,255,81,3,15,66,64,0,255,47,0]),
    ...track([0,145,40,99,96,144,60,100,0,64,80,0,176,64,1,
      48,224,0,96,48,144,60,0,0,128,64,0,48,176,64,0,48,255,47,0])]));
  const key=song.parts.find(p=>p.channel===1).key;
  const expected=[[.5,'noteOn',60,100],[.5,'noteOn',64,80],[.5,'sustain',1],
    [1,'pitchBend',12288],[1.5,'noteOff',60],[1.5,'noteOff',64],[2,'sustain',0],[2.5,'finish']];
  const score=partScore(song,key);
  assert.deepEqual(score,expected);
  let time=0;
  const calls=[],waits=[];
  const part=Object.fromEntries(expected.map(([,method])=>[method,(...args)=>calls.push([time,method,...args])]));
  const run=Object.getPrototypeOf(async()=>{}).constructor('midi',partSource(score));
  await run({createPart:()=>part,createTimeline:()=>({waitUntil(t){time=t;waits.push(t);}})});
  assert.deepEqual(waits,[.5,1,1.5,2,2.5]);
  assert.deepEqual(calls,expected);
  assert.throws(()=>partScore(song,'missing'),/Select a MIDI part/);
});
