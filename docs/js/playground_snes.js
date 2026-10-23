/** Ordered Main/logic-Worker client for a CPU-free SNES DSP AudioWorklet. */
import {SnesSynth,prepareSnesBRR} from './snessynth.js?v=spc-song-js-1';
import {prepareSpcTimeline} from './spc.js?v=spc-events-1';
const TIMEOUT_MS=15000;
/** @param {MessagePort} port
 * @param {{sampleRate?:number,nativeSampleRate?:number}} [initial] */
export function createSnesClient(port,initial={},lifecycle={}) {
  const validation=new SnesSynth({core:{reset(){},loadRam(){},writeDsp(){},dispose(){}}});
  let disposed=false,failed=null,sequence=0,timelinePrepared=false,timelineRevision=0,stateRevision=0,pendingPreparations=0;const pending=new Map();
  function assertOpen(){if(disposed)throw new Error('SNES instance is disposed');if(failed)throw failed;if(initial.native&&lifecycle.isStopped?.(lifecycle.captureContext?.()))throw new Error('SNES disposed or Run stopped');}
  function fail(error){if(disposed||failed)return;failed=error;for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();client.dispose();}
  function send(method,args=[]){assertOpen();try{port.postMessage({method,args});}catch(error){fail(error);throw error;}}
  function request(method,args=[],transfer=[],timeout=TIMEOUT_MS){assertOpen();const id=++sequence;return new Promise((resolve,reject)=>{const timer=timeout?setTimeout(()=>fail(new Error('SNES AudioWorklet did not respond')),timeout):null;timer?.unref?.();pending.set(id,{resolve,reject,timer});try{port.postMessage({method,args,id},transfer);}catch(error){fail(error);}});}
  function instrumentOnly(){if(timelinePrepared)throw new Error('SNES timeline mode is exclusive; reset() before editing instruments');}
  function control(method,args=[]){assertOpen();if(method!=='reset')instrumentOnly();validation[method](...args);send(method,args);if(method==='reset'){timelinePrepared=false;timelineRevision++;}}
  port.onmessage=({data})=>{if(disposed)return;if(data.fatal){fail(new Error(data.error??'SNES AudioWorklet failed'));return;}const p=pending.get(data.id);if(!p){if(data.error)fail(new Error(data.error));return;}pending.delete(data.id);clearTimeout(p.timer);if(data.error){const error=new Error(data.error);if(data.name)error.name=data.name;p.reject(error);}else p.resolve(data.value);};
  port.onmessageerror=()=>fail(new Error('Invalid SNES AudioWorklet message'));port.start?.();
  const client={
    _getState(){return {...validation.getState(),...(initial.native?{stateRevision}:{})};},
    _stopVoices(){return request('stopVoices');},
    _adoptState(state){if(!state)return;if(initial.native&&(state.stateRevision??0)<stateRevision)return false;stateRevision=state.stateRevision??stateRevision;validation.samples=structuredClone(state.samples??[]);validation.channels=structuredClone(state.channels??validation.channels);validation.nextAddress=state.nextAddress??0x400;if(initial.native&&!pendingPreparations)timelinePrepared=state.timeline?.loaded===true;},
    _applyAuthorEdit(edit){if(edit.samples){for(const sample of edit.samples)validation.samples[sample.id]=structuredClone(sample);validation.nextAddress=edit.nextAddress;}if(edit.preset)Object.assign(validation.channels[edit.channel],structuredClone(edit.preset));},
    sampleRate:initial.sampleRate??48000,nativeSampleRate:32000,
    /** @param {ArrayBuffer|ArrayBufferView} input @param {import('./snessynth.js?v=spc-song-js-1').SnesBRROptions} options
     * @returns {Promise<import('./snessynth.js?v=spc-song-js-1').SnesSample>} */
    async loadBRR(input,options){assertOpen();instrumentOnly();const prepared=prepareSnesBRR(input,options);const data=prepared.brr,validationBytes=data.slice(),savedOptions=structuredClone(options);const sample=await request('loadBRR',[data,savedOptions],[data.buffer]);assertOpen();if(initial.native){validation.samples[sample.id]=structuredClone(sample);validation.sampleBytes[sample.id]=validationBytes;validation.nextAddress=Math.max(validation.nextAddress,sample.startAddress+sample.byteLength);}else validation.loadBRR(validationBytes,savedOptions);return sample;},
    /** Resource upload; clocks are 1,024,000 Hz, not native PCM frames.
     * @param {import('./spc.js?v=spc-events-1').SpcTimeline} trace */
    async prepareTimeline(trace){
      assertOpen();const data=prepareSpcTimeline(trace),previous=timelinePrepared,revision=++timelineRevision;timelinePrepared=true;pendingPreparations++;
      try{const state=await request('prepareTimeline',[data],[data.initialState.ram.buffer,data.initialState.dsp.buffer,data.events.buffer]);assertOpen();if(revision!==timelineRevision)throw new DOMException('SNES timeline preparation cancelled','AbortError');return state;}
      catch(error){if(!disposed&&revision===timelineRevision)timelinePrepared=previous;throw error;}finally{pendingPreparations--;}
    },
    /** Resolves at the output end. Stop/dispose rejects pending playback. */
    playTimeline(){assertOpen();if(!timelinePrepared)throw new Error('Prepare an SNES timeline before playback');return request('playTimeline',[],[],0);},
    stopTimeline(){timelineRevision++;return request('stopTimeline');},
    getTimelineState(){return request('getTimelineState');},
    /** @param {number} ch @param {import('./snessynth.js?v=spc-song-js-1').SnesPreset} preset */
    setPreset(ch,preset){control('setPreset',[ch,structuredClone(preset)]);},
    /** @param {number} ch @param {import('./snessynth.js?v=spc-song-js-1').SnesPreset} params */
    setChannel(ch,params){control('setChannel',[ch,structuredClone(params)]);},
    /** @param {number} ch @param {number} pitch */
    setPitch(ch,pitch){control('setPitch',[ch,pitch]);},
    /** @param {number} ch @param {number} hz */
    setFrequency(ch,hz){control('setFrequency',[ch,hz]);},
    /** @param {number} ch @param {string|number} note */
    setNote(ch,note){control('setNote',[ch,note]);},
    /** @param {number} ch */ keyOn(ch){control('keyOn',[ch]);},
    /** @param {number} ch */ keyOff(ch){control('keyOff',[ch]);},
    /** @param {number} ch @param {string|number} [note] */ noteOn(ch,note){control('noteOn',note===undefined?[ch]:[ch,note]);},
    /** @param {number} ch */ noteOff(ch){control('noteOff',[ch]);},
    allNotesOff(){control('allNotesOff');},
    reset(){control('reset');},
    /** @param {number} register @param {number} value */ writeDsp(register,value){control('writeDsp',[register,value]);},
    /** @param {number} register @returns {Promise<number>} */ readDsp(register){assertOpen();if(!Number.isInteger(register)||register<0||register>127)throw new RangeError('DSP register must be0..127');return request('readDsp',[register]);},
    /** Applied audio state; queued future changes may not yet be audible.
     * @returns {Promise<ReturnType<SnesSynth['getState']>>} */ getState(){return request('getState');},
    /** @param {number} ch @returns {Promise<import('./snessynth.js?v=spc-song-js-1').SnesVoiceState>} */ getPreset(ch){instrumentOnly();validation.getPreset(ch);return request('getPreset',[ch]);},
    /** @returns {Promise<ReturnType<SnesSynth['snapshot']>>} */ snapshot(){return request('snapshot');},
    dispose(){if(disposed)return;disposed=true;timelineRevision++;try{port.postMessage({method:'dispose',args:[]});}catch{}finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new DOMException('SNES instance is disposed','AbortError'));}pending.clear();port.onmessage=null;port.onmessageerror=null;port.close();}},
  };
  if(initial.native){
    const check=context=>{if(disposed||lifecycle.isStopped?.(context))throw new Error('SNES disposed or Run stopped');};
    const resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{check(context);lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    for(const method of ['loadBRR','prepareTimeline','playTimeline','stopTimeline','getTimelineState','readDsp','getState','getPreset','snapshot']){const original=client[method].bind(client);client[method]=(...args)=>{const context=lifecycle.captureContext?.();check(context);return original(...args).then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;}));};}
  }
  if(initial.state)client._adoptState(initial.state);
  return client;
}
