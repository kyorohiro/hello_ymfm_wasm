import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePlaySeconds} from './playground_duration.js';
import {createPlaygroundMusic} from './playground_music.js';
import {createMidiApi} from './playground_midi.js';

test('explicit units, legacy defaults and validation',()=>{
 assert.equal(resolvePlaySeconds({beats:1},120),.5);
 assert.equal(resolvePlaySeconds({seconds:.3},220),.3);
 assert.equal(resolvePlaySeconds({duration:1},220),1);
 assert.equal(resolvePlaySeconds({duration:1},120,'beats',1),.5);
 assert.equal(resolvePlaySeconds({},120),.2);
 assert.equal(resolvePlaySeconds({},120,'beats',1),.5);
 assert.equal(resolvePlaySeconds({beats:0},120),0);
 for(const options of [{beats:1,seconds:1},{beats:1,duration:1},{seconds:1,duration:1},{seconds:NaN},{beats:-1},{seconds:Infinity},{beats:'1'},{beats:null}])assert.throws(()=>resolvePlaySeconds(options,120));
});
for(const mode of ['fm','midi'])test(`${mode}: validates before sound, snapshots BPM, preserves legacy duration`,async()=>{
 let bpm=120;const sleeps=[],calls=[];
 const sleep=async seconds=>{sleeps.push(seconds);};
 let play;
 if(mode==='fm'){
  const api=createPlaygroundMusic({getBpm:()=>bpm,sleep,activeNotes:new Set(),presets:{},getCurrentLoopContext:()=>null,
   noteToSemitone:{C:0},pitchReference:{},createPitchFromMidi:()=>({block:4,fnum:500}),
   synth:()=>({noteOn(){calls.push('on');bpm=240;},noteOff(){calls.push('off');}})});
  play=api.play;
 }else{
  const api=createMidiApi(async method=>{calls.push(method);if(method==='noteOn'){bpm=240;return 1;}},{sleep,bpm:()=>bpm});
  play=api.output('tetorica-ym2612').play.bind(api.output('tetorica-ym2612'));
 }
 for(const options of [{beats:1,seconds:1},{duration:1,beats:1},{seconds:-1}])await assert.rejects(play('C4',options));
 assert.equal(calls.length,0);
 await play('C4',{beats:1});assert.equal(sleeps.at(-1),.5);
 await play('C4',{seconds:.3});assert.equal(sleeps.at(-1),.3);
 bpm=120;await play('C4',{duration:1});assert.equal(sleeps.at(-1),mode==='fm'?1:.5);
});
