// SPDX-License-Identifier: BSD-3-Clause
// One authored ADPCM RAM source shared by the UI and revocable Code leases.
// Loading is passive; only Play/raw register writes borrow the Synth clock.
import {createMsm5205Audio} from '../js/msm5205_audio.js';
import {createMsm5205Player} from '../js/msm5205_player.js';
import {prepareMsm5205Asset} from './msm5205_asset.js';

let nextSource=0;
const aborted=()=>new DOMException('MSM5205 source operation cancelled','AbortError');
const isAbort=error=>error?.name==='AbortError';

export function createMsm5205Source({ensureAudio,getAudio,readFile,onState=()=>{},onError=()=>{},
  prepareAsset=prepareMsm5205Asset,createAudio=createMsm5205Audio,createPlayer=createMsm5205Player}={}){
  if([ensureAudio,getAudio,onState,onError,prepareAsset,createAudio,createPlayer].some(fn=>typeof fn!=='function')||
    readFile!==undefined&&typeof readFile!=='function')throw TypeError('MSM5205 source requires the Synth audio owner and callbacks');
  const sourceId=`huc6280-synth:msm5205-source:${++nextSource}`,listeners=new Set(),leases=new Set();
  let dead=false,revision=0,rateRevision=0,asset=null,defaults={rate:12,loop:false},actual=null,error=null;
  let pendingLoad=null,loadSerial=0,operation=0,codeEpoch=0,leaseSerial=0,endpoint=null,starting=null,tail=Promise.resolve(),stopping=null;
  const checkLease=lease=>{if(dead||lease&&(lease.closed||lease.epoch!==codeEpoch||!lease.isCurrent()))throw aborted();};
  const check=(token,lease)=>{checkLease(lease);if(token!==operation)throw aborted();};
  const publicAsset=()=>asset?Object.freeze({name:asset.info.name,path:asset.info.path,format:asset.info.format,info:asset.info,wave:asset.wave}):null;
  function read(){return Object.freeze({sourceId,revision,asset:publicAsset(),defaults:Object.freeze({...defaults}),
    actual:actual?Object.freeze({...actual}):null,state:actual?.state??(asset?'ready':'empty'),busy:!!pendingLoad,error});}
  function emit(){const state=read();onState(state);for(const listener of listeners)listener(state);return state;}
  function fail(reason){if(!isAbort(reason)){error=reason?.message??String(reason);emit();onError(reason);}}
  function validateTiming(options={}){
    if(!options||typeof options!=='object'||Array.isArray(options))throw TypeError('MSM5205 timing requires an options object');
    const at=options.at,rate=getAudio()?.context?.sampleRate??384000;
    if(at!==undefined&&(!Number.isFinite(at)||at<0||!Number.isSafeInteger(Math.round(at*rate))))throw RangeError('MSM5205 at must be nonnegative audio-clock seconds');
    return at===undefined?{}:{at};
  }
  function retire(item){
    if(!item||item.closed)return;item.closed=true;item.controller.abort(aborted());
    if(endpoint===item){endpoint=null;actual=null;}if(starting===item)starting=null;
    try{item.adapter?.node?.disconnect();}catch{}
    if(item.player)item.player.dispose();else item.adapter?.dispose();
  }
  const existing=()=>{
    if(endpoint&&(endpoint.engine!==getAudio()||endpoint.context.state==='closed'))retire(endpoint);
    return endpoint;
  };
  async function rpc(item,token,run){
    try{return await run();}catch(reason){
      // Errors from a retired operation (for example a scheduled Play rejected
      // by Stop) do not invalidate the same node's newer authorized operation.
      // A current transport failure does: the next Play rebuilds that one
      // endpoint on the existing Synth clock from the retained authored bytes.
      if(!isAbort(reason)&&token===operation&&endpoint===item&&!item.closed){retire(item);fail(reason);}
      throw reason;
    }
  }
  function cancelLoad(){
    if(!pendingLoad)return;
    const old=pendingLoad;pendingLoad=null;old.controller.abort(aborted());
    if(endpoint?.uploadOwner===old)retire(endpoint);
    emit();
  }
  const checkLoad=item=>{checkLease(item.lease);item.signal.throwIfAborted();if(pendingLoad!==item)throw aborted();};
  function serial(fn,lease){
    const token=operation;
    const task=tail.then(async()=>{check(token,lease);if(stopping)await stopping;check(token,lease);return fn(token);});
    tail=task.catch(()=>{});return task;
  }
  async function install(item,value,token,lease,owner=null){
    item.preparing=true;item.uploadOwner=owner;
    try{
      await rpc(item,token,()=>item.player.loadMemory(value.data));check(token,lease);owner&&checkLoad(owner);
      if(endpoint!==item||item.closed)throw aborted();
      item.installedAsset=value;
    }catch(reason){const current=token===operation&&(endpoint===item||starting===item)&&!item.closed;retire(item);if(current)fail(reason);throw reason;}
    finally{item.preparing=false;item.uploadOwner=null;}
  }
  async function ensureEndpoint(token,lease){
    check(token,lease);const ready=existing();if(ready){if(asset&&ready.installedAsset!==asset)await install(ready,asset,token,lease);return ready;}
    const item={engine:null,context:null,controller:new AbortController(),adapter:null,player:null,closed:false,preparing:false,uploadOwner:null};
    starting=item;
    try{
      await ensureAudio();check(token,lease);item.controller.signal.throwIfAborted();
      const engine=getAudio(),context=engine?.context;
      if(!context||context.state==='closed'||typeof engine.getChipInputNode!=='function')throw Error('MSM5205 needs the Synth AudioContext and chip input');
      item.engine=engine;item.context=context;
      const adapter=await createAudio(context,{signal:item.controller.signal,onError(reason){
        if(endpoint===item||starting===item){retire(item);fail(reason);}
      }});
      item.adapter=adapter;check(token,lease);item.controller.signal.throwIfAborted();
      if(getAudio()!==engine)throw aborted();
      const input=engine.getChipInputNode('msm5205');
      if(!input||input.context!==context||adapter.node?.context!==context)throw Error('MSM5205 must use the Synth clock and chip input');
      adapter.node.connect(input);
      item.player=createPlayer(adapter,{signal:item.controller.signal,getMix:()=>engine.getChipMix?.('msm5205')});
      endpoint=item;if(starting===item)starting=null;
      if(asset)await install(item,asset,token,lease);
      check(token,lease);return item;
    }catch(reason){const current=token===operation&&(endpoint===item||starting===item)&&!item.closed;retire(item);if(current)fail(reason);throw reason;}
  }
  async function observe(item,token,lease){
    const state=await rpc(item,token,()=>item.player.getState());check(token,lease);
    if(endpoint!==item||item.closed||item.engine!==getAudio())throw aborted();
    actual={...state,sample:asset?.info??null};emit();return stateSnapshot();
  }
  function stateSnapshot(){const mix=getAudio()?.getChipMix?.('msm5205');return{
    state:asset?'ready':'empty',mode:'pce',positionNibbles:0,cursor:0,sourceBytes:asset?.data.length??0,
    offset:0,length:asset?.info.frames??0,rate:defaults.rate,loop:defaults.loop,
    outputFrame:0,sampleRate:getAudio()?.context?.sampleRate??0,clock:1536000,
    effectiveSampleRate:1536000/(48*(16-defaults.rate)),volume:mix?.volume??1,pan:0,mute:mix?.effectiveMuted??mix?.muted??false,
    ...actual,
    sourceId,revision,sample:asset?.info??null,defaults:{...defaults}};}
  async function load(source,options,format,lease){
    checkLease(lease);cancelLoad();error=null;
    const controller=new AbortController(),signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;
    const item={serial:++loadSerial,controller,signal,lease,rateRevision};pendingLoad=item;emit();
    try{
      checkLoad(item);const path=options.path??(typeof source==='string'?source:null);
      if(typeof source==='string'){
        const reader=lease?.readFile??readFile;if(!reader)throw Error('MSM5205 file loading requires readFile');
        source=await reader(source);checkLoad(item);
      }
      const prepared=await prepareAsset(source,{...options,format,rate:options.rate??defaults.rate,path,signal});checkLoad(item);
      const commit=async token=>{
        checkLoad(item);const physical=existing();
        if(physical)await install(physical,prepared,token,lease,item);
        checkLoad(item);asset=prepared;revision++;
        if(rateRevision===item.rateRevision)defaults={...defaults,rate:prepared.info.rate};
        actual=null;error=null;
        pendingLoad=null;emit();return asset.info;
      };
      // Code Stop revokes Code work, while an independently authorized UI
      // import may still finish. Retry its commit after that Stop fence only
      // while it is still the current, non-cancelled UI import.
      for(;;){try{return await serial(commit,lease);}catch(reason){
        if(!isAbort(reason)||lease||pendingLoad!==item||signal.aborted||dead)throw reason;
      }}
    }catch(reason){if(pendingLoad===item){pendingLoad=null;fail(reason);emit();}throw reason;}
  }
  async function play(options={},lease){
    checkLease(lease);if(!asset)throw Error('Load an MSM5205 sample before playback');
    validateTiming(options);
    const parameters={rate:defaults.rate,loop:defaults.loop,...options};
    parameters.offset??=0;parameters.length??=asset.info.frames-parameters.offset;
    if(!Number.isSafeInteger(parameters.offset)||parameters.offset<0||!Number.isSafeInteger(parameters.length)||parameters.length<1||
      parameters.offset+parameters.length>asset.data.length*2||!Number.isInteger(parameters.rate)||parameters.rate<0||parameters.rate>15||typeof parameters.loop!=='boolean'||
      parameters.at!==undefined&&(!Number.isFinite(parameters.at)||parameters.at<0))throw RangeError('Invalid MSM5205 sample range/rate');
    return serial(async token=>{
      const item=await ensureEndpoint(token,lease);check(token,lease);
      validateTiming(parameters);
      await rpc(item,token,()=>item.player.play(parameters));check(token,lease);
      error=null;
      return observe(item,token,lease);
    },lease);
  }
  function stopPhysical(options={}){
    options=validateTiming(options);operation++;const token=operation;tail=Promise.resolve();retire(starting);
    const item=existing();
    // A transferred upload may finish after a cancellation. Closing that one
    // node makes it inaudible; the retained authored asset reuploads on Play.
    if(item?.preparing)retire(item);
    const physical=existing();
    const task=Promise.resolve().then(async()=>{
      if(physical&&!physical.closed){
        await rpc(physical,token,()=>physical.player.stop(options));
        const state=await rpc(physical,token,()=>physical.player.getState());
        if(token===operation&&endpoint===physical&&!physical.closed){actual={...state,sample:asset?.info??null};emit();}
      }else{actual=null;emit();}
    });
    const settled=task.finally(()=>{if(stopping===settled)stopping=null;});stopping=settled;return settled;
  }
  function stop(options={}){checkLease();cancelLoad();return stopPhysical(options);}
  function stopCode(){
    if(dead)return Promise.resolve();codeEpoch++;
    for(const lease of leases)lease.closed=true;leases.clear();
    if(pendingLoad?.lease)cancelLoad();return stopPhysical();
  }
  async function reset(options={},lease){
    checkLease(lease);options=validateTiming(options);cancelLoad();await stopPhysical(options);checkLease(lease);
    const item=existing();if(!item)return stateSnapshot();
    const token=operation;await rpc(item,token,()=>item.player.reset(options));check(token,lease);item.installedAsset=null;return observe(item,token,lease);
  }
  async function getState(lease){
    checkLease(lease);const item=existing();if(!item)return stateSnapshot();
    return serial(token=>observe(item,token,lease),lease);
  }
  async function writeRegister(register,value,timing,lease){
    checkLease(lease);timing=validateTiming(timing);
    if(!Number.isInteger(register)||register<0||register>7||!Number.isInteger(value)||value<0||value>15)throw RangeError('Invalid MSM5205 register write');
    return serial(async token=>{
      const item=await ensureEndpoint(token,lease);await rpc(item,token,()=>item.player.writeRegister(register,value,timing));check(token,lease);
      return observe(item,token,lease);
    },lease);
  }
  function setDefaults(patch){
    checkLease();if(!patch||typeof patch!=='object'||Object.keys(patch).some(key=>!['rate','loop'].includes(key)))throw TypeError('Unknown MSM5205 playback default');
    const next={...defaults,...patch};
    if(!Number.isInteger(next.rate)||next.rate<0||next.rate>15||typeof next.loop!=='boolean')throw RangeError('MSM5205 rate must be 0..15 and Loop boolean');
    if(defaults.rate!==next.rate)rateRevision++;
    defaults=next;error=null;emit();return read();
  }
  async function useCodeClient({isCurrent=()=>true,readFile:codeReadFile,onDispose=()=>{}}={}){
    if(typeof isCurrent!=='function'||typeof onDispose!=='function'||codeReadFile!==undefined&&typeof codeReadFile!=='function')throw TypeError('MSM5205 Code lease requires host callbacks');
    const lease={epoch:codeEpoch,serial:++leaseSerial,closed:false,isCurrent,readFile:codeReadFile};checkLease(lease);leases.add(lease);
    const client={id:`${sourceId}:code:${lease.serial}`,chip:'msm5205',sourceId,
      loadMemory:(source,options={})=>load(source,options,'adpcm',lease),
      loadSample:(source,options={})=>load(source,options,'wav',lease),
      play:options=>play(options,lease),stop:options=>{checkLease(lease);if(pendingLoad?.lease===lease)cancelLoad();return stopPhysical(options);},
      reset:options=>reset(options,lease),writeRegister:(register,value,timing)=>writeRegister(register,value,timing,lease),
      getState:()=>getState(lease),async dispose(){checkLease(lease);lease.closed=true;leases.delete(lease);if(pendingLoad?.lease===lease)cancelLoad();await stopPhysical();onDispose();}};
    // Method slots remain writable for the common runtime's guarded Proxy.
    for(const key of ['id','chip','sourceId'])Object.defineProperty(client,key,{writable:false});
    return Object.seal(client);
  }
  return{read,subscribe(listener){if(typeof listener!=='function')throw TypeError('Expected an MSM5205 source listener');listeners.add(listener);return()=>listeners.delete(listener);},
    loadMemory:(source,options={})=>load(source,options,'adpcm'),loadSample:(source,options={})=>load(source,options,'wav'),
    setDefaults,play,stop,reset,writeRegister,getState,useCodeClient,stopCode,cancelLoad,
    async clear(){checkLease();cancelLoad();await stopCode();retire(endpoint);asset=null;revision++;actual=null;error=null;emit();},
    async dispose(){if(dead)return;cancelLoad();try{await stopCode();}finally{dead=true;retire(starting);retire(endpoint);listeners.clear();}},
  };
}
