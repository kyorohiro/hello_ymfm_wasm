// Game Boy Code borrows the editor's instrument. Only its FX rack is owned here.
import {createNativeFXRack} from '../js/native_fx_rack.js?v=prepared-fx-rerun-2';
import {createSynthCodeOutput} from '../synth/synth_code_output.js';

const cancelled=()=>new DOMException('Game Boy Code audio stopped','AbortError');

/** Resolve nested aliases to the same physical channel for per-loop ownership.
 * Only gate methods participate; a note name is not a channel number. */
export function resolveGameboyCodeNoteTarget(client,target,method,args){
  if(!client||!['noteOn','keyOn','noteOff','keyOff'].includes(method)||!Array.isArray(args))return null;
  let channel;
  if(target===client)channel=Number.isInteger(args[0])&&args[0]>=0&&args[0]<=3?args[0]:null;
  else if(target===client.pulse)channel=Number.isInteger(args[0])&&args[0]>=0&&args[0]<=1?args[0]:null;
  else if(target===client.wave)channel=2;
  else if(target===client.noise)channel=3;
  else return null;
  return channel===null?null:{target:client,channel};
}

/** Keep one source -> FX -> software Stop fade -> Master route. The final
 * monitor/Desktop output remain attached to the engine's post-Master node.
 * No independent Game Boy, AudioContext or speaker connection is created.
 */
export function createGameboyCodeAudio({ensureReady,getAudio,onLog=()=>{},createFxRack=createNativeFXRack,
  createOutput=createSynthCodeOutput}={}) {
  for(const callback of [ensureReady,getAudio,onLog,createFxRack,createOutput])
    if(typeof callback!=='function')throw new TypeError('Game Boy Code audio requires host callbacks');
  let epoch=0,owner=null,disposed=false,stopping=null;
  const output=createOutput({getContext:()=>getAudio()?.context,getGain:()=>getAudio()?.codeFadeNode});
  const check=token=>{if(disposed||token!==epoch)throw cancelled();};
  function restoreDirect(item) {
    if(!item?.routed)return;
    try{item.input.disconnect(item.rack.node);}catch{}
    try{item.rack.node.disconnect(item.destination);}catch{}
    if(item.context.state!=='closed')item.input.connect(item.destination);
    item.routed=false;
  }
  function retire(item) {
    if(!item||item.closed)return;
    restoreDirect(item);item.closed=true;
    try{item.rack?.stop();}catch(error){onLog(`[cleanup] ${error?.message??String(error)}`);}
    try{item.rack?.dispose();}catch(error){onLog(`[cleanup] ${error?.message??String(error)}`);}
  }
  function activate(item) {
    if(!item?.rack||item!==owner||item.closed)throw cancelled();
    if(item.routed)return;
    item.input.disconnect(item.destination);
    item.input.connect(item.rack.node);item.rack.node.connect(item.destination);item.routed=true;
  }
  async function prepare() {
    const token=epoch;check(token);
    if(stopping)await stopping;check(token);
    await ensureReady();check(token);
    const engine=getAudio(),context=engine?.context,input=engine?.codeInputNode,destination=engine?.codeOutputNode;
    if(!context||context.state==='closed'||!input||!destination||typeof engine.getGameboyClient!=='function')throw new Error('Game Boy Code needs the editor audio route');
    if(owner?.engine===engine&&!owner.closed)return owner.promise;
    retire(owner);
    const item=owner={engine,context,input,destination,client:null,rack:null,closed:false,routed:false,names:new Set(),promise:null};
    const current=()=>!disposed&&epoch===token&&owner===item&&!item.closed&&getAudio()===engine;
    const rack=Promise.resolve().then(()=>createFxRack(context)).then(rack=>{
      if(!current()){rack.dispose();throw cancelled();}
      item.rack=rack;rack.onError=message=>onLog(`[liveFx] ${message}`);return rack;
    });
    item.promise=Promise.all([engine.getGameboyClient(),rack]).then(([client])=>{
      if(!current())throw cancelled();item.client=client;return item;
    }).catch(error=>{
      const wasCurrent=current();retire(item);if(owner===item)owner=null;
      if(wasCurrent)void engine.command('stop').catch(()=>{});
      throw error;
    });
    return item.promise;
  }
  async function useSoundChip(name) {
    if(name!=='gameboy')throw new Error('Game Boy Synth Code supports useSoundChip("gameboy")');
    const token=epoch,item=await prepare();check(token);return item.client;
  }
  const fx=new Proxy({}, {get(_target,key){
    const item=owner,controller=item?.rack?.controller;
    if(key==='then')return undefined;
    if(typeof controller?.[key]!=='function')return controller?.[key];
    return(...args)=>{
      if(item!==owner||item.closed||disposed)throw cancelled();
      const result=controller[key](...args);
      if(key==='liveFx'){item.names.add(args[0]);activate(item);}
      else if(key==='removeLiveFx'){
        item.names.delete(args[0]);if(!item.names.size&&!controller.getChain().length)restoreDirect(item);
      }else if(key==='setChain'){
        if(item.names.size||controller.getChain().length)activate(item);else restoreDirect(item);
      }else if(key==='clear'||key==='dispose'){
        if(key==='dispose')item.names.clear();
        if(!item.names.size)restoreDirect(item);
      }
      return result;
    };
  }});
  function stop() {
    if(stopping)return stopping;
    epoch++;const item=owner;owner=null;
    // The runtime awaits beforeStop() before it reaches this physical cleanup.
    retire(item);
    const engine=item?.engine??getAudio();
    const task=Promise.resolve().then(()=>engine?.command('stop')).then(()=>undefined);
    stopping=task.finally(()=>{if(stopping===result)stopping=null;});const result=stopping;
    return result;
  }
  async function dispose() {
    if(disposed)return;
    disposed=true;output.dispose();await stop();
  }
  return {prepare,useSoundChip,fx,resolveNoteTarget:(target,method,args)=>resolveGameboyCodeNoteTarget(owner?.client,target,method,args),
    beforeStop:()=>output.fadeOut(),open:()=>output.open(),stop,dispose};
}
