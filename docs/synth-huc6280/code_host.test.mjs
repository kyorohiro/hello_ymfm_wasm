// The actual scheduler and generated starter; no AudioContext is created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {HUC6280_STARTER_CODE} from './code_host.js';
import {resolveHuc6280CodeNoteTarget} from './code_audio.js';

const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(check){const end=performance.now()+2500;while(performance.now()<end){if(check())return;await turn();}throw Error('Code did not reach the expected physical voice');}
function fixture(source='wave',lfo=false,lfoMode='follow'){
  const calls=[],state={editorSource:source,editorLfoEnabled:lfo,editorLfoMode:lfoMode};
  const client={getState:async()=>({...state})};
  for(const method of ['noteOn','noteOff','keyOn','keyOff','setNote'])client[method]=async(...args)=>{calls.push({method,args});return method==='noteOff'?true:undefined;};
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>performance.now()/1000,supportedSoundChips:['huc6280'],useSoundChip:async()=>client,
    resolveNoteTarget:(...args)=>resolveHuc6280CodeNoteTarget(client,...args),
    stopSoundChips:async()=>calls.push({method:'hostStop',args:[]}),guardExecution:false,createTaskChannel:()=>null});
  return{runtime,client,calls,setSource(source,lfo=false,mode='follow'){Object.assign(state,{editorSource:source,editorLfoEnabled:lfo,editorLfoMode:mode});}};
}

test('HuC6280 starter follows Wave/Noise/DDA selections without restarting the scheduler',async()=>{
  const f=fixture();
  try{
    await f.runtime.run(HUC6280_STARTER_CODE);await until(()=>f.calls.some(call=>call.method==='noteOn'&&call.args[0]===0));
    const context=f.runtime.getContext();context.keep=42;
    f.setSource('noise');await until(()=>f.calls.some(call=>call.method==='noteOn'&&call.args[0]===4));
    const begin=f.calls.length;f.setSource('dda');await until(()=>f.calls.slice(begin).some(call=>call.method==='noteOn'&&call.args[0]===0));
    assert.equal(f.runtime.getContext(),context);assert.equal(context.keep,42);assert.deepEqual(f.runtime.getState().loopNames,['melody']);
    assert.equal(f.runtime.getState().bpm,120);assert.equal(f.calls.filter(call=>call.method==='hostStop').length,1,'only initial Run retires the previous session');
    assert(f.calls.some(call=>call.method==='noteOff'),'starter uses software release rather than a raw gate');
  }finally{await f.runtime.stop();}
});

test('starter tunes the hardware LFO source in follow mode and preserves recorded source periods',async t=>{
  for(const mode of ['follow','recorded'])await t.test(mode,async()=>{
    const f=fixture('wave',true,mode);
    try{
      await f.runtime.run(HUC6280_STARTER_CODE);await until(()=>f.calls.some(call=>call.method==='noteOn'));
      const on=f.calls.find(call=>call.method==='noteOn');assert.equal(on.args[0],0);
      if(mode==='follow'){
        const tune=f.calls.find(call=>call.method==='setNote');assert(tune);assert.equal(tune.args[0],1);assert.equal(tune.args[1],on.args[1]);
        assert(f.calls.indexOf(tune)<f.calls.indexOf(on));
      }else assert(!f.calls.some(call=>call.method==='setNote'),'recorded CH2 period stays unchanged');
    }finally{await f.runtime.stop();}
  });
});

test('physical note/key aliases retain newer per-loop owners when an older loop is stopped',async t=>{
  for(const [oldAction,newAction]of [['noteOn(CH1,"C4")','keyOn(CH1)'],['keyOn(CH5)','noteOn(CH5,"E4")']])await t.test(oldAction,async()=>{
    const f=fixture();
    try{
      await f.runtime.run(`const pce=await useSoundChip('huc6280');liveLoop('old',async()=>{await pce.${oldAction};await sleep(10);});`);
      await until(()=>f.calls.filter(call=>['noteOn','keyOn'].includes(call.method)).length===1);
      await f.runtime.apply(`const pce=await useSoundChip('huc6280');liveLoop('old',async()=>{await sleep(10);});liveLoop('new',async()=>{await pce.${newAction};await sleep(10);});`);
      await until(()=>f.calls.filter(call=>['noteOn','keyOn'].includes(call.method)).length===2);
      const offs=()=>f.calls.filter(call=>['keyOff','noteOff'].includes(call.method)).length,before=offs();
      await f.runtime.apply("stopLoop('old');liveLoop('new',async()=>{await sleep(10);});");await turn();assert.equal(offs(),before);
      await f.runtime.apply("stopLoop('new');");await turn();assert.equal(offs(),before+1,'current physical voice is released normally');
    }finally{await f.runtime.stop();}
  });
});

test('stopping one named loop releases its voice without stopping the physical chip or scheduler',async()=>{
  const f=fixture();
  try{
    await f.runtime.run("const pce=await useSoundChip('huc6280');context.cancel=()=>stopLoop('held');liveLoop('held',async()=>{await pce.noteOn(CH6,'C4');await sleep(10);});");
    await until(()=>f.calls.some(call=>call.method==='noteOn'));const stops=f.calls.filter(call=>call.method==='hostStop').length;
    f.runtime.getContext().cancel();await turn();assert(f.calls.some(call=>['noteOff','keyOff'].includes(call.method)&&call.args[0]===5));
    assert.equal(f.calls.filter(call=>call.method==='hostStop').length,stops);assert(f.runtime.getState().running);
  }finally{await f.runtime.stop();}
});
