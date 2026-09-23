import test from 'node:test';
import assert from 'node:assert/strict';
import {createMidiApi} from './playground_midi.js';
import {createMidiSongPlayer} from './midi_song.js';

test('handwritten beat score uses the public API and applies tempo changes inside notes',async()=>{
 let time=0,id=0;const events=[];
 const midi=createMidiApi(async(method,args)=>{events.push([time,method,args]);if(method==='noteOn')return ++id;},{now:()=>time,bpm:()=>999,sleep:async seconds=>{time+=seconds;}});
 const output=midi.output('tetorica-ym2612',{channel:0});
 function* melody(output) {
  yield {at:0,output,play:'C4',duration:2};
  yield {at:1,output,pitchBend:.25};
  yield {at:1,output,play:'E4',duration:.5,velocity:90};
 }
 const player=midi.createSongPlayer({channels:{1:{events:melody,outputs:[output]}},tempos:[{beat:0,bpm:120},{beat:1,bpm:60}],endBeat:2});
 await player.runChannels([1]);
 assert.deepEqual(events.map(e=>e.slice(0,2)),[[0,'noteOn'],[.5,'pitchBend'],[.5,'noteOn'],[1,'release'],[1.5,'release'],[1.5,'cc']]);
 assert.equal(player.running,false);
});

test('fractional beats keep off/on order and waits nondecreasing',async()=>{
 const events=[];let time=-1;
 const output={noteOn:async n=>events.push(['on',n]),noteOff:async n=>events.push(['off',n]),cc:async()=>{}};
 function* melody(output) {
  yield {at:1/96,output,play:'C4',duration:5/96,order:0,offOrder:1};
  yield {at:6/96,output,play:'D4',duration:1/96,order:2,offOrder:3};
 }
 const player=createMidiSongPlayer({createTimeline:()=>({waitUntil:async t=>{assert(t>=time);time=t;}})},{channels:{1:{events:melody,outputs:[output]}}});
 await player.runChannels([1]);
 assert.deepEqual(events,[['on','C4'],['off','C4'],['on','D4'],['off','D4']]);
});

test('bad edited score cleans every output, preserves original failure, and unlocks',async()=>{
 let cleanups=0;
 const output={noteOn:async()=>{},noteOff:async()=>{},cc:async()=>{cleanups++;throw Error('cleanup failure');}};
 function* melody(output){yield {at:0,output,play:'C4',duration:-1};}
 const player=createMidiSongPlayer({createTimeline:()=>({waitUntil:async()=>{}})},{channels:{1:{events:melody,outputs:[output]}}});
 await assert.rejects(player.runChannels([1]),/duration/);
 assert.equal(cleanups,1);assert.equal(player.running,false);
 await assert.rejects(player.runChannels([1]),/duration/);assert.equal(cleanups,2);
});
