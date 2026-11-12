// The actual shared runtime and generated source; no audio device is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {GAMEBOY_STARTER_CODE} from './code_host.js';
import {resolveGameboyCodeNoteTarget} from './code_audio.js';

const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(fn){const end=performance.now()+2000;while(performance.now()<end){if(fn())return;await turn();}throw Error('Runtime did not reach expected gate');}
function fixture(source='pulse'){
  const calls=[];
  const tone=kind=>({noteOn:async(...args)=>{calls.push([kind,'noteOn',...args]);},keyOn:async(...args)=>{calls.push([kind,'keyOn',...args]);},keyOff:async(...args)=>{calls.push([kind,'keyOff',...args]);}});
  const client={getState:async()=>({editorSource:source}),pulse:tone('pulse'),wave:tone('wave'),noise:tone('noise')};
  const physical=(channel,method,...args)=>channel===2?client.wave[method](...args):channel===3?client.noise[method](...args):client.pulse[method](channel,...args);
  client.noteOn=(channel,note)=>physical(channel,'noteOn',note);client.keyOn=channel=>physical(channel,'keyOn');client.keyOff=channel=>physical(channel,'keyOff');
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>performance.now()/1000,supportedSoundChips:['gameboy'],useSoundChip:async()=>client,
    resolveNoteTarget:(...args)=>resolveGameboyCodeNoteTarget(client,...args),
    stopSoundChips:async()=>{calls.push(['host','stop']);},guardExecution:false,createTaskChannel:()=>null});
  return{runtime,calls,setSource(value){source=value;}};
}
test('DMG starter follows newly selected sounds without restarting its live loop',async()=>{
  const f=fixture('pulse');
  try{
    await f.runtime.run(GAMEBOY_STARTER_CODE);
    await until(()=>f.calls.some(call=>call[0]==='pulse'&&call[1]==='noteOn'));
    f.setSource('wave');await until(()=>f.calls.some(call=>call[0]==='wave'&&call[1]==='noteOn'));
    f.setSource('noise');await until(()=>f.calls.some(call=>call[0]==='noise'&&call[1]==='keyOn'));
    assert(f.runtime.getState().running);assert.deepEqual(f.runtime.getState().loopNames,['melody']);
    assert.equal(f.calls.filter(call=>call[0]==='host').length,1,'Only the initial Run retires the previous session');
  }finally{await f.runtime.stop();}
});
test('DMG default index uses the current selected physical source without initializing over its sound',async()=>{
  for(const source of ['pulse','wave','noise']){
    const f=fixture(source);
    try{await f.runtime.run(GAMEBOY_STARTER_CODE);await until(()=>f.calls.some(call=>call[0]===source&&['noteOn','keyOn'].includes(call[1])));
      assert(!f.calls.some(call=>call[0]!=='host'&&call[0]!==source));assert.equal(f.runtime.getState().bpm,120);assert.deepEqual(f.runtime.getState().loopNames,['melody']);
      if(source==='pulse')assert.equal(f.calls.find(call=>call[0]==='pulse')[2],0);
    }finally{await f.runtime.stop();}
  }
});
test('DMG aliases share physical ownership so stopping an older loop cannot release its replacement',async t=>{
  const cases=[['wave','wave.noteOn("C4")','noteOn(CH3,"E4")'],['noise','noise.keyOn()','keyOn(CH4)'],['pulse','pulse.noteOn(CH1,"C4")','noteOn(CH1,"E4")']];
  for(const[kind,oldAction,newAction]of cases)await t.test(kind,async()=>{
    const f=fixture();
    try{
      await f.runtime.run(`const gb=await useSoundChip('gameboy');liveLoop('old',async()=>{await gb.${oldAction};await sleep(10);});`);
      await until(()=>f.calls.filter(call=>call[0]===kind&&['noteOn','keyOn'].includes(call[1])).length===1);
      await f.runtime.apply(`const gb=await useSoundChip('gameboy');liveLoop('old',async()=>{await sleep(10);});liveLoop('new',async()=>{await gb.${newAction};await sleep(10);});`);
      await until(()=>f.calls.filter(call=>call[0]===kind&&['noteOn','keyOn'].includes(call[1])).length===2);
      const before=f.calls.filter(call=>call[1]==='keyOff').length;await f.runtime.apply("stopLoop('old');liveLoop('new',async()=>{await sleep(10);});");await turn();assert.equal(f.calls.filter(call=>call[1]==='keyOff').length,before,'Older alias cannot release the new physical owner');
      await f.runtime.apply("stopLoop('new');");await turn();assert.equal(f.calls.filter(call=>call[1]==='keyOff').length,before+1,'Current physical owner releases normally');
    }finally{await f.runtime.stop();}
  });
});
test('stopLoop releases pending nested DMG Wave and Noise gates',async t=>{
  for(const action of ['wave.noteOn("C4")','wave.keyOn()','noise.keyOn()'])await t.test(action,async()=>{
    const f=fixture(),kind=action.split('.')[0];
    try{
      await f.runtime.run(`const gb=await useSoundChip('gameboy');context.cancel=()=>stopLoop('held');liveLoop('held',async()=>{await gb.${action};await sleep(10);});`);
      await until(()=>f.calls.some(call=>call[0]===kind&&['noteOn','keyOn'].includes(call[1])));
      const stops=f.calls.filter(call=>call[0]==='host').length;f.runtime.getContext().cancel();await turn();
      assert(f.calls.some(call=>call[0]===kind&&call[1]==='keyOff'),'stopLoop releases '+action);
      assert.equal(f.calls.filter(call=>call[0]==='host').length,stops,'Per-loop cancellation does not hard-stop the entire APU');
    }finally{await f.runtime.stop();}
  });
});
