import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
const source=await readFile(new URL('./spu_synth_audio.js',import.meta.url),'utf8');
async function setup(t){
 const timers=new Map(),errors=[];let timerId=0,createAudio,node,context,mode='reply';
 class Context{constructor(){context=this;this.state='suspended';this.currentTime=0;this.audioWorklet={addModule:async()=>{}};}addEventListener(){}removeEventListener(){}createGain(){return {gain:{value:0},connect(){},disconnect(){}};}async close(){this.state='closed';}async resume(){this.state='running';}}
 class Node{constructor(){node=this;this.port={postMessage:message=>{if(message.id===undefined)return;if(mode==='throw')throw new Error('Cannot clone request');if(mode==='drop')return;queueMicrotask(()=>this.port.onmessage?.({data:{id:message.id,...(mode==='error'?{error:'Rejected edit'}:{value:true})}}));},close(){}};queueMicrotask(()=>this.port.onmessage?.({data:{ready:true,state:{channels:[]}}}));}connect(){}disconnect(){this.disconnected=true;}}
 vm.runInNewContext(source.replace(/^import .*;\n/gm,'').replaceAll('export ','').replaceAll('import.meta.url',JSON.stringify(new URL('./spu_synth_audio.js',import.meta.url).href))+'\nprovide(createSpuAudio);',{
  URL,AudioContext:Context,AudioWorkletNode:Node,fetch:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)}),preparePs1Waveform:()=>({}),SPU_SYNTH_MIX_HEADROOM:4,SOUNDCHIP_MIXER_PRESETS:{calibrated:{factoryDefaults:{kinds:[{name:'ps1',volume:.128826}]}}},
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);},provide:value=>createAudio=value,
 });
 const audio=await createAudio({onError:error=>errors.push(error)});t.after(()=>audio.dispose());assert.equal(timers.size,0);
 return {audio,node,context,errors,timers,mode:value=>mode=value,expire(){const [id,timer]=timers.entries().next().value;assert.equal(timer.ms,15000);timers.delete(id);timer.fn();}};
}
test('SPU replies, rejected edits and uncloneable requests all cancel their deadline without killing audio',async t=>{
 const f=await setup(t);assert.equal(await f.audio.command('inspect'),true);assert.equal(f.timers.size,0);
 f.mode('error');await assert.rejects(f.audio.command('setInstrumentPreset'),/Rejected edit/);assert.equal(f.timers.size,0);
 f.mode('throw');await assert.rejects(f.audio.command('inspect'),/Cannot clone/);assert.equal(f.timers.size,0);
 assert.equal(f.errors.length,0);assert.equal(f.context.state,'suspended');
});
test('SPU stalled commands reject all pending operations, clean deadlines and permit explicit UI restart',async t=>{
 const f=await setup(t);f.mode('drop');const completed=Promise.allSettled([f.audio.command('inspect'),f.audio.stop()]);assert.equal(f.timers.size,2);f.expire();
 const results=await completed;assert(results.every(r=>r.status==='rejected'&&/timed out/.test(r.reason.message)));assert.equal(f.timers.size,0);assert.equal(f.errors.length,1);assert.equal(f.context.state,'closed');assert(f.node.disconnected);await assert.rejects(f.audio.command('inspect'),/Enable audio to restart/);
});
test('SPU unreadable port reply tears down pending work without leaving a waiting UI promise',async t=>{
 const f=await setup(t);f.mode('drop');const completed=Promise.allSettled([f.audio.command('inspect')]);f.node.port.onmessageerror();
 const [result]=await completed;assert.equal(result.status,'rejected');assert.match(result.reason.message,/unreadable/);assert.equal(f.errors.length,1);assert.equal(f.timers.size,0);assert.equal(f.context.state,'closed');
});
