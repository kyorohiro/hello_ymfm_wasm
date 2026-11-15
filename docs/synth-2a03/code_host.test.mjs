// Exercise the shipped starter through the shared runtime without audio output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {NES_STARTER_CODE} from './code_host.js';
import {resolveNesCodeNoteTarget} from './code_audio.js';

const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(predicate){
  const deadline=performance.now()+2500;
  while(performance.now()<deadline){if(predicate())return;await turn();}
  throw Error('Runtime did not reach the expected note');
}
function fixture(source='pulse'){
  const calls=[];
  const client={
    getState:async()=>({preset:{source}}),
    noteOn:async(channel,note)=>{calls.push(['noteOn',channel,note]);},
    noteOff:async channel=>{calls.push(['noteOff',channel]);},
    keyOff:async channel=>{calls.push(['keyOff',channel]);},
  };
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>performance.now()/1000,
    supportedSoundChips:['nes'],useSoundChip:async()=>client,
    resolveNoteTarget:(...args)=>resolveNesCodeNoteTarget(client,...args),
    stopSoundChips:async()=>calls.push(['host','stop']),guardExecution:false,createTaskChannel:()=>null});
  return{runtime,calls,setSource(value){source=value;}};
}
test('NES default index follows the selected source with physical channels and beat timing',async t=>{
  assert.doesNotMatch(NES_STARTER_CODE,/\b(?:sleep|play)\(/);
  assert.match(NES_STARTER_CODE,/await beat\(0\.5\)/);
  for(const[source,channel]of Object.entries({pulse:0,triangle:2,noise:3,dmc:4,fds:5}))await t.test(source,async()=>{
    const f=fixture(source);
    try{
      await f.runtime.run(NES_STARTER_CODE);
      await until(()=>f.calls.some(call=>call[0]==='noteOn'));
      assert.equal(f.calls.find(call=>call[0]==='noteOn')[1],channel);
      assert.equal(f.runtime.getState().bpm,120);
      assert.deepEqual(f.runtime.getState().loopNames,['melody']);
    }finally{await f.runtime.stop();}
  });
});
test('choosing another editor source affects the next note without restarting the running loop',async()=>{
  const f=fixture();
  try{
    await f.runtime.run(NES_STARTER_CODE);
    await until(()=>f.calls.some(call=>call[0]==='noteOn'&&call[1]===0));
    f.setSource('fds');
    await until(()=>f.calls.some(call=>call[0]==='noteOn'&&call[1]===5));
    assert(f.calls.some(call=>call[0]==='noteOff'&&call[1]===0),'The old note releases on its original channel');
    f.setSource('noise');
    await until(()=>f.calls.some(call=>call[0]==='noteOn'&&call[1]===3));
    assert(f.runtime.getState().running);
    assert.equal(f.calls.filter(call=>call[0]==='host').length,1,'Only Run retired the previous session');
  }finally{await f.runtime.stop();}
});
