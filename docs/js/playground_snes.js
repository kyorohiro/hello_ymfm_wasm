/** Ordered Main/logic-Worker client for a CPU-free SNES DSP AudioWorklet. */
import {SnesSynth,prepareSnesBRR} from './snessynth.js?v=chip-tabs-2';
const TIMEOUT_MS=15000;
/** @param {MessagePort} port
 * @param {{sampleRate?:number,nativeSampleRate?:number}} [initial] */
export function createSnesClient(port,initial={}) {
  const validation=new SnesSynth({core:{reset(){},loadRam(){},writeDsp(){},dispose(){}}});
  let disposed=false,failed=null,sequence=0;const pending=new Map();
  function assertOpen(){if(disposed)throw new Error('SNES instance is disposed');if(failed)throw failed;}
  function fail(error){if(disposed||failed)return;failed=error;for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();client.dispose();}
  function send(method,args=[]){assertOpen();try{port.postMessage({method,args});}catch(error){fail(error);throw error;}}
  function request(method,args=[],transfer=[]){assertOpen();const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>fail(new Error('SNES AudioWorklet did not respond')),TIMEOUT_MS);timer.unref?.();pending.set(id,{resolve,reject,timer});try{port.postMessage({method,args,id},transfer);}catch(error){fail(error);}});}
  function control(method,args=[]){assertOpen();validation[method](...args);send(method,args);}
  port.onmessage=({data})=>{if(disposed)return;if(data.fatal){fail(new Error(data.error??'SNES AudioWorklet failed'));return;}const p=pending.get(data.id);if(!p){if(data.error)fail(new Error(data.error));return;}pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(new Error(data.error)):p.resolve(data.value);};
  port.onmessageerror=()=>fail(new Error('Invalid SNES AudioWorklet message'));port.start?.();
  const client={
    sampleRate:initial.sampleRate??48000,nativeSampleRate:32000,
    /** @param {ArrayBuffer|ArrayBufferView} input @param {import('./snessynth.js?v=chip-tabs-2').SnesBRROptions} options
     * @returns {Promise<import('./snessynth.js?v=chip-tabs-2').SnesSample>} */
    async loadBRR(input,options){assertOpen();const prepared=prepareSnesBRR(input,options);const data=prepared.brr,validationBytes=data.slice(),savedOptions=structuredClone(options);const sample=await request('loadBRR',[data,savedOptions],[data.buffer]);assertOpen();validation.loadBRR(validationBytes,savedOptions);return sample;},
    /** @param {number} ch @param {import('./snessynth.js?v=chip-tabs-2').SnesPreset} preset */
    setPreset(ch,preset){control('setPreset',[ch,structuredClone(preset)]);},
    /** @param {number} ch @param {import('./snessynth.js?v=chip-tabs-2').SnesPreset} params */
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
    /** @param {number} ch @returns {Promise<import('./snessynth.js?v=chip-tabs-2').SnesVoiceState>} */ getPreset(ch){validation.getPreset(ch);return request('getPreset',[ch]);},
    /** @returns {Promise<ReturnType<SnesSynth['snapshot']>>} */ snapshot(){return request('snapshot');},
    dispose(){if(disposed)return;disposed=true;try{port.postMessage({method:'dispose',args:[]});}catch{}finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('SNES instance is disposed'));}pending.clear();port.onmessage=null;port.onmessageerror=null;port.close();}},
  };
  return client;
}
