// Exercise the shipped starter through the shared Code runtime without audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {SCSP_STARTER_CODE} from './code_host.js';
import {resolveScspCodeNoteTarget} from './code_audio.js';

const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(predicate){
  const deadline=performance.now()+2500;
  while(performance.now()<deadline){if(predicate())return;await turn();}
  throw Error('Runtime did not reach the expected SCSP note');
}
test('SCSP starter plays logical CH1 with BPM and beat timing over the current editor sound',async()=>{
  let sound='pcm';const calls=[],client={
    noteOn:async(channel,note)=>{calls.push(['noteOn',channel,note,sound]);},
    noteOff:async channel=>{calls.push(['noteOff',channel]);},
    keyOff:async channel=>{calls.push(['keyOff',channel]);},
  };
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>performance.now()/1000,
    supportedSoundChips:['scsp'],useSoundChip:async()=>client,
    resolveNoteTarget:(...args)=>resolveScspCodeNoteTarget(client,...args),
    stopSoundChips:async()=>calls.push(['host','stop']),guardExecution:false,createTaskChannel:()=>null});
  assert.doesNotMatch(SCSP_STARTER_CODE,/\b(?:sleep|play)\(/);assert.match(SCSP_STARTER_CODE,/await beat\(0\.5\)/);
  try{
    await runtime.run(SCSP_STARTER_CODE);await until(()=>calls.some(call=>call[0]==='noteOn'));
    assert.equal(calls.find(call=>call[0]==='noteOn')[1],0);assert.equal(runtime.getState().bpm,120);assert.deepEqual(runtime.getState().loopNames,['melody']);
    sound='fm6';await until(()=>calls.some(call=>call[0]==='noteOn'&&call[3]==='fm6'));
    assert(runtime.getState().running);assert.equal(calls.filter(call=>call[0]==='host').length,1);
    await runtime.apply("stopLoop('melody');");assert(calls.some(call=>call[0]==='noteOff'||call[0]==='keyOff'));
  }finally{await runtime.stop();}
});
