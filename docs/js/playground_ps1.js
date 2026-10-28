/** Ordered Browser/logic-Worker controls for the experimental PS1 SPU. */
import {Ps1Synth,preparePs1ADPCM} from './ps1synth.js?v=ps1-voice-editor-1';
const TIMEOUT_MS=15000;
/** @param {MessagePort} port @param {{sampleRate?:number,state?:any}} [initial] */
export function createPs1Client(port,initial={},lifecycle={}) {
  const validation=new Ps1Synth({core:{reset(){},loadRam(){},write(){},read(){return 0;},readRam(){return new Uint8Array(0);},renderInto(){},dispose(){}}});
  let disposed=false,failed=null,sequence=0,revision=0,bankRevision=0;const pending=new Map();
  const abort=message=>new DOMException(message,'AbortError');
  function assertOpen(){if(disposed)throw abort('PS1 SPU instance is disposed');if(failed)throw failed;}
  function fail(error){if(disposed||failed)return;failed=error;for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();client.dispose();}
  function send(method,args=[]){assertOpen();try{port.postMessage({method,args});}catch(error){fail(error);throw error;}}
  function request(method,args=[],transfer=[]){assertOpen();const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>fail(new Error('PS1 SPU AudioWorklet did not respond')),TIMEOUT_MS);timer.unref?.();pending.set(id,{resolve,reject,timer});try{port.postMessage({method,args,id},transfer);}catch(error){fail(error);}});}
  function control(method,args=[]){assertOpen();if(lifecycle.isStopped?.(lifecycle.captureContext?.()))throw abort('Run stopped');if(client._before?.({method,args})===false)return;validation[method](...args);send(method,args);client._observe?.({method,args});if(method==='reset'){revision++;if(args[0]?.clearRam===true)bankRevision++;}}
  port.onmessage=({data})=>{if(disposed)return;if(data.fatal){fail(new Error(data.error??'PS1 SPU AudioWorklet failed'));return;}const p=pending.get(data.id);if(!p){if(data.error)fail(new Error(data.error));return;}pending.delete(data.id);clearTimeout(p.timer);if(data.error){const error=new Error(data.error);if(data.name)error.name=data.name;p.reject(error);}else p.resolve(data.value);};
  port.onmessageerror=()=>fail(new Error('Invalid PS1 SPU AudioWorklet message'));port.start?.();
  const client={
    sampleRate:initial.sampleRate??44100,nativeSampleRate:44100,channelCount:24,
    _getState(){return validation.getState();},
    _setLifecycle(options){lifecycle=options;},
    _adoptState(state){if(!state)return;validation.samples=structuredClone(state.samples??[]);validation.channels=(state.channels??validation.channels).map(({sample,volumeLeft,volumeRight,adsr1,adsr2,pitch,reverb=false})=>({sample,volumeLeft,volumeRight,adsr1,adsr2,pitch,reverb}));validation.gates=state.channels?.map(ch=>!!ch.gate)??validation.gates;validation.nextAddress=state.nextAddress??0x1000;if(state.reverb)validation.reverb=structuredClone(state.reverb);},
    _stopVoices(){return request('stopVoices').then(value=>{validation.gates.fill(false);return value;});},
    /** @param {ArrayBuffer|ArrayBufferView} input @param {import('./ps1synth.js?v=audio-stability-2').Ps1ADPCMOptions} options */
    async loadADPCM(input,options){assertOpen();const prepared=preparePs1ADPCM(input,options),bytes=prepared.adpcm,retained=bytes.slice(),saved=structuredClone(options),at=revision,bank=bankRevision;const sample=await request('loadADPCM',[bytes,saved],[bytes.buffer]);assertOpen();/* A default reset retains RAM, including this already-ordered upload. Keep its reservation even though the old continuation is cancelled. */if(bank===bankRevision)validation.loadADPCM(retained,saved);if(at!==revision)throw abort('PS1 SPU upload cancelled by reset');return sample;},
    /** @param {number} ch @param {import('./ps1synth.js?v=audio-stability-2').Ps1Preset} preset */
    setPreset(ch,preset){control('setPreset',[ch,structuredClone(preset)]);},
    /** @param {number} ch @param {import('./ps1synth.js?v=audio-stability-2').Ps1Preset} preset */
    setChannel(ch,preset){control('setChannel',[ch,structuredClone(preset)]);},
    /** Named ADSR register fields. Rates are table indexes, not milliseconds.
     * @param {number} ch @param {Partial<import('./ps1_parameters.js?v=chip-tabs-2').Ps1Envelope>} envelope */
    setEnvelope(ch,envelope){control('setEnvelope',[ch,structuredClone(envelope)]);},
    /** Shared SPU reverb preset and positive return levels; voices opt in separately.
     * @param {Partial<import('./ps1_parameters.js?v=chip-tabs-2').Ps1Reverb>} options */
    setReverb(options){control('setReverb',[structuredClone(options)]);},
    /** @param {number} ch @param {number} pitch */ setPitch(ch,pitch){control('setPitch',[ch,pitch]);},
    /** @param {number} ch @param {number} hz */ setFrequency(ch,hz){control('setFrequency',[ch,hz]);},
    /** @param {number} ch @param {string|number} note */ setNote(ch,note){control('setNote',[ch,note]);},
    /** @param {number} ch */ keyOn(ch){control('keyOn',[ch]);},
    /** @param {number} ch */ keyOff(ch){control('keyOff',[ch]);},
    /** @param {number} ch @param {string|number} [note] */ noteOn(ch,note){control('noteOn',note===undefined?[ch]:[ch,note]);},
    /** @param {number} ch */ noteOff(ch){control('noteOff',[ch]);},
    allNotesOff(){control('allNotesOff');},
    /** Immediate preparation barrier, including in Worker mode. Clears prior
     * reserved notes; later voice controls retain their normal lookahead.
     * @param {{clearRam?:boolean}} [options] */ reset(options){control('reset',options===undefined?[]:[options]);},
    /** @returns {Promise<ReturnType<Ps1Synth['getState']>>} */ getState(){return request('getState');},
    /** @param {number} ch @returns {Promise<ReturnType<Ps1Synth['getPreset']>>} */ getPreset(ch){validation.getPreset(ch);return request('getPreset',[ch]);},
    /** @returns {Promise<ReturnType<Ps1Synth['snapshot']>>} */ snapshot(){return request('snapshot');},
    dispose(){if(disposed)return;disposed=true;revision++;try{port.postMessage({method:'dispose',args:[]});}catch{}finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(abort('PS1 SPU instance is disposed'));}pending.clear();port.onmessage=null;port.onmessageerror=null;port.close();}},
  };
  {
    const check=context=>{assertOpen();if(lifecycle.isStopped?.(context))throw abort('Run stopped');};
    const resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{check(context);lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    for(const method of ['loadADPCM','getState','getPreset','snapshot']){const original=client[method].bind(client);client[method]=(...args)=>{if(!lifecycle.captureContext)return original(...args);const context=lifecycle.captureContext();check(context);return original(...args).then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;}));};}
  }
  if(initial.state)client._adoptState(initial.state);
  return client;
}
