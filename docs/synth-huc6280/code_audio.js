// Code borrows the editor's HuC6280/shared ADPCM and owns its FX rack and CD-DA.
import {createNativeFXRack} from '../js/native_fx_rack.js?v=prepared-fx-rerun-2';
import {createSynthCodeOutput} from '../synth/synth_code_output.js';
import {createHuc6280Cdrom2Audio} from './cdrom2_audio.js?v=huc-cdrom2-1';

const cancelled=()=>new DOMException('HuC6280 Code audio stopped','AbortError');

/** Resolve nested aliases to the same physical channel for per-loop ownership.
 * Only gate methods participate; a note name is not a channel number. */
export function resolveHuc6280CodeNoteTarget(client,target,method,args){
  if(target!==client||!['noteOn','keyOn','noteOff','keyOff'].includes(method)||!Array.isArray(args))return null;
  const channel=args[0];return Number.isInteger(channel)&&channel>=0&&channel<6?{target:client,channel}:null;
}

/** Keep one source -> FX -> software Stop fade -> Master route. The final
 * monitor/Desktop output remain attached to the engine's post-Master node.
 * No independent HuC6280, AudioContext or speaker connection is created.
 */
export function createHuc6280CodeAudio({ensureReady,getAudio,onLog=()=>{},createFxRack=createNativeFXRack,
  createOutput=createSynthCodeOutput,readFile,createMedia=createHuc6280Cdrom2Audio,msm5205Source}={}) {
  for(const callback of [ensureReady,getAudio,onLog,createFxRack,createOutput,createMedia])
    if(typeof callback!=='function')throw new TypeError('HuC6280 Code audio requires host callbacks');
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
    item.media?.dispose();
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
    if(!context||context.state==='closed'||!input||!destination||typeof engine.getHuc6280Client!=='function')throw new Error('HuC6280 Code needs the editor audio route');
    if(owner?.engine===engine&&!owner.closed)return owner.promise;
    retire(owner);
    const item=owner={engine,context,input,destination,client:null,rack:null,media:null,msmClient:null,closed:false,routed:false,names:new Set(),promise:null};
    const current=()=>!disposed&&epoch===token&&owner===item&&!item.closed&&getAudio()===engine;
    const rack=Promise.resolve().then(()=>createFxRack(context)).then(rack=>{
      if(!current()){rack.dispose();throw cancelled();}
      item.rack=rack;rack.onError=message=>onLog(`[liveFx] ${message}`);return rack;
    });
    item.promise=Promise.all([engine.getHuc6280Client(),rack]).then(([client])=>{
      if(!current())throw cancelled();item.client=client;return item;
    }).catch(error=>{
      const wasCurrent=current();retire(item);if(owner===item)owner=null;
      if(wasCurrent)void engine.command('stop').catch(()=>{});
      throw error;
    });
    return item.promise;
  }
  async function useSoundChip(name) {
    if(!['huc6280','msm5205','cdda'].includes(name))throw new Error('HuC6280 Synth Code supports huc6280, msm5205 and cdda');
    const token=epoch,item=await prepare();check(token);
    if(name==='huc6280')return item.client;
    if(name==='msm5205'&&msm5205Source){
      if(!item.msmClient){
        const pending=msm5205Source.useCodeClient({readFile,isCurrent:()=>!disposed&&epoch===token&&owner===item&&!item.closed&&getAudio()===item.engine,
          onDispose(){if(item.msmClient===pending)item.msmClient=null;}});
        item.msmClient=pending;
      }
      const client=await item.msmClient;check(token);return client;
    }
    item.media??=createMedia({engine:item.engine,readFile,isCurrent:()=>!disposed&&epoch===token&&owner===item&&!item.closed&&getAudio()===item.engine,
      onError:error=>onLog(`[CD-ROM²] ${error?.message??String(error)}`)});
    const client=await item.media.useSoundChip(name);check(token);return client;
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
    const task=Promise.resolve().then(async()=>{
      try{await msm5205Source?.stopCode();}finally{await engine?.command('stop');}
    }).then(()=>undefined);
    stopping=task.finally(()=>{if(stopping===result)stopping=null;});const result=stopping;
    return result;
  }
  async function dispose() {
    if(disposed)return;
    disposed=true;output.dispose();await stop();
  }
  return {prepare,useSoundChip,fx,resolveNoteTarget:(target,method,args)=>resolveHuc6280CodeNoteTarget(owner?.client,target,method,args),
    beforeStop:()=>output.fadeOut(),open:()=>output.open(),stop,dispose};
}
