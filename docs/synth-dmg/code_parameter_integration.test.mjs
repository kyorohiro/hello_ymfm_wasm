// Execute the real UI-to-audio edit function with a controllable queue.
// Native register / PCM behavior is covered by code_instrument.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDefaultPreset,readPreset} from './preset.js';
import {createGameboyCodeEdit,applyGameboyCodeEdit} from './code_parameter_edit.js';
const source=await readFile(new URL('./synth.js',import.meta.url),'utf8');
const start=source.indexOf('async function applyEditorChange('),end=source.indexOf('\nconst editor =',start);
assert(start>=0&&end>start);
const implementation=source.slice(start,end);
const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return{promise,resolve};};
function fixture({gate=Promise.resolve(),afterCommit=async()=>{}}={}){
  let backend=createDefaultPreset(),owner={current:true},running=true,queue=gate;
  const calls=[],client=()=>{const selected=owner;return Promise.resolve({isCurrent:()=>selected.current});};
  const engine={getGameboyClient:client,
    async applyCodeEdit(edit,{isCurrent}){assert(isCurrent());calls.push(edit);backend=applyGameboyCodeEdit(backend,edit);await afterCommit();if(!isCurrent())throw Object.assign(Error('retired'),{name:'AbortError'});return {preset:readPreset(backend)};},
    async read(){return {preset:readPreset(backend)};}};
  const context=vm.createContext({audio:engine,disposed:false,applySequence:0,preset:createDefaultPreset(),revision:0,
    createGameboyCodeEdit,readPreset,codeHost:{isRunning:()=>running,markSoundDirty(){}},
    enqueue(fn){const task=queue.then(fn);queue=task.catch(()=>{});return task;},
    readVoices(){},visualizer:{wake(){}},status(){},updatePresetUi(){},applyPreset(){assert.fail('Live edits must not apply a whole instrument');}});
  vm.runInContext(implementation,context);
  return {context,calls,run:(next,previous,channel=0)=>context.applyEditorChange(next,{previous,channel,origin:'Code'}),
    stop(){owner.current=false;running=false;},restart(){owner.current=false;owner={current:true};running=true;},
    read:()=>readPreset(backend)};
}
test('two quick field edits are queued independently and neither drops the other field',async()=>{
  const gate=deferred(),f=fixture({gate:gate.promise}),a=createDefaultPreset(),b=readPreset(a),c=readPreset(a);b.pulse.volume=11;c.pulse.volume=11;c.pulse.duty=.25;
  const first=f.run(b,a),second=f.run(c,b);gate.resolve();assert.equal(await first,true);assert.equal(await second,true);
  assert.equal(f.calls.length,2);assert.equal(f.read().pulse.volume,11);assert.equal(f.read().pulse.duty,.25);
});
test('a newer whole-instrument intent cancels a queued sparse edit before any DSP write',async()=>{
  const gate=deferred(),f=fixture({gate:gate.promise}),before=createDefaultPreset(),next=readPreset(before);next.pulse.volume=11;
  const pending=f.run(next,before);f.context.applySequence++;gate.resolve();assert.equal(await pending,false);assert.equal(f.calls.length,0);
});
test('a new Run cannot receive an edit pinned to the previous client',async()=>{
  const gate=deferred(),f=fixture({gate:gate.promise}),before=createDefaultPreset(),next=readPreset(before);next.pulse.volume=11;
  const pending=f.run(next,before);f.restart();gate.resolve();assert.equal(await pending,false);assert.equal(f.calls.length,0);
});
test('Stop after a native commit reconciles its latest authored field without restarting Code',async()=>{
  let f;f=fixture({afterCommit:async()=>f.stop()});const before=createDefaultPreset(),next=readPreset(before);next.pulse.duty=.25;
  assert.equal(await f.run(next,before),false);assert.equal(f.read().pulse.duty,.25);assert.equal(f.context.preset.pulse.duty,.25);assert.equal(f.context.codeHost.isRunning(),false);
});
