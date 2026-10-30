// SPDX-License-Identifier: BSD-3-Clause
import {ScspSynth} from './scspsynth.js?v=scsp-native-1';
export const SCSP_CONTROLS=Object.freeze(['setPreset','setEnvelope','setFrequency','setNote','setMix','keyOn','keyOff','noteOn','noteOff','allNotesOff','reset']);
export function createScspValidation() {
  return new ScspSynth({sampleRate:44100,nativeFrames:0,reset(){},write(){},loadRam(){},renderInto(){},dispose(){}});
}
/** Resolve cloned handles only at a transport boundary. Numeric IDs alone are
 * deliberately insufficient: two SCSP instances can allocate the same ID. */
export function scspCommandArgs(synth,method,args) {
  if(method==='setPreset'&&args[1]?.sample!=null)return [args[0],{...args[1],sample:synth._resolveSample(args[1].sample)}];
  return args;
}
/** Ordered Main/Worker facade; waveform upload/state reads are asynchronous. */
export function createScspClient(port,initial={},lifecycle={}) {
  const validation=createScspValidation(),pending=new Map();
  let disposed=false,failed=null,sequence=0,revision=0,bankRevision=0,bankEpoch=null,resourceRevision=-1,pendingClearFence=null;
  const abort=message=>new DOMException(message,'AbortError');
  function open(){if(disposed)throw abort('SCSP instance is disposed');if(failed)throw failed;}
  function check(context){open();if(lifecycle.isStopped?.(context))throw abort('Run stopped');}
  function fail(error){if(disposed||failed)return;failed=error;client.dispose();}
  function send(method,args=[],metadata={}){open();try{port.postMessage({method,args,...metadata});}catch(error){fail(error);throw error;}}
  function request(method,args=[],transfer=[]) {
    open();const id=++sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>fail(new Error('SCSP AudioWorklet did not respond')),15000);timer.unref?.();pending.set(id,{resolve,reject,timer});try{port.postMessage({method,args,id},transfer);}catch(error){fail(error);}});
  }
  function control(method,args) {
    check(lifecycle.captureContext?.());if(client._before?.({method,args})===false)return;
    const result=validation[method](...scspCommandArgs(validation,method,args));
    if(method==='reset'){revision++;if(args[0]?.clearRam){bankRevision++;pendingClearFence=revision;}else if(pendingClearFence!==null)pendingClearFence=revision;}
    send(method,args,method==='reset'?{resourceFence:revision}:{});client._observe?.({method,args});return result;
  }
  port.onmessage=({data})=>{
    if(disposed)return;
    if(data.type==='scsp-resources') {
      if(data.resourceFence!==revision||data.revision<resourceRevision)return;
      const ownClear=pendingClearFence===data.resourceFence;
      if(!ownClear&&bankEpoch!==null&&bankEpoch!==data.bankEpoch)bankRevision++;
      if(ownClear)pendingClearFence=null;bankEpoch=data.bankEpoch;resourceRevision=data.revision;
      if(data.reset&&!data.ownReset){bankRevision++;validation._adoptState(data.state);}else validation._adoptResources(data.state);if(Number.isInteger(data.editedSlot))validation._adoptEditorState(data.editedSlot,data.state);client._onStateChange?.();return;
    }
    if(data.fatal){fail(new Error(data.error??'SCSP AudioWorklet failed'));return;}
    if(data.state)validation._adoptResources(data.state);
    const p=pending.get(data.id);if(!p){if(data.error)fail(new Error(data.error));return;}
    pending.delete(data.id);clearTimeout(p.timer);
    if(data.error){const error=new Error(data.error);error.name=data.name??'Error';p.reject(error);}else p.resolve(data.value);
  };
  port.onmessageerror=()=>fail(new Error('Invalid SCSP AudioWorklet message'));port.start?.();
  const client={sampleRate:initial.sampleRate??44100,nativeSampleRate:44100,channelCount:32,
    _getState:()=>validation.getState(),_setLifecycle:options=>{lifecycle=options;},
    _applyAuthorEdit:edit=>{if(edit.resources)validation._adoptResources(edit.resources);if(Number.isInteger(edit.editedSlot))validation._adoptEditorState(edit.editedSlot,edit.resources);if(edit.preset)validation[edit.preset.method](...scspCommandArgs(validation,edit.preset.method,edit.preset.args));},
    _adoptState:state=>{if(state)validation._adoptState(state);},
    _stopVoices:()=>request('stopVoices').then(value=>{validation.stopVoices();return value;}),
    async loadPCM(input,options) {
      check(lifecycle.captureContext?.());const temp=createScspValidation();
      try{temp.loadPCM(input,options);}finally{temp.dispose();}
      const pcm=input.slice(),saved=structuredClone(options),at=revision,bank=bankRevision;
      const sample=await request('loadPCM',[pcm,saved],[pcm.buffer]);
      open();if(at!==revision||bank!==bankRevision)throw abort('SCSP upload cancelled by reset');
      return validation._resolveSample(sample);
    },
    getState:()=>request('getState'),
    dispose(){if(disposed)return;disposed=true;revision++;try{port.postMessage({method:'dispose',args:[]});}catch{}finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(failed??abort('SCSP instance is disposed'));}pending.clear();port.onmessage=null;port.onmessageerror=null;port.close();validation.dispose();}},
  };
  for(const method of SCSP_CONTROLS)client[method]=(...args)=>control(method,structuredClone(args));
  for(const method of ['loadPCM','getState']){
    const original=client[method];client[method]=(...args)=>{
      const context=lifecycle.captureContext?.();check(context);
      const resume=callback=>new Promise((resolve,reject)=>setTimeout(()=>{try{check(context);lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
      return original(...args).then(value=>resume(()=>value),error=>resume(()=>{throw error;}));
    };
  }
  if(initial.state)client._adoptState(initial.state);return client;
}
