// Original Tetorica controls. BSD-3-Clause; see LICENSE.
import {prepareMSM5205Sample} from './msm5205_sample.js?v=pcengine-cd-1';
/** One PC Engine CD ADPCM source. Offsets and lengths are nibble counts.
 * @param {{prepare:(bytes:Uint8Array,name:string,options?:{signal?:AbortSignal})=>Promise<unknown>,command:(action:any,timing?:{at?:number})=>Promise<any>,dispose:()=>void}} adapter
 * @param {{readFile?:(path:string)=>Promise<Uint8Array|ArrayBuffer>,signal?:AbortSignal,getMix?:()=>any}} [options]
 */
export function createMsm5205Player(adapter,{readFile,signal,getMix}={}){
  let generation=0,dead=false,operations=new AbortController(),tail=Promise.resolve(),sample=null;
  const cancel=()=>new DOMException('MSM5205 operation cancelled','AbortError');
  const check=token=>{signal?.throwIfAborted();if(dead||token!==generation)throw cancel();};
  const serial=fn=>{const token=generation,p=tail.then(()=>{check(token);return fn(token);});tail=p.catch(()=>{});return p;};
  const read=async(source,token)=>{if(typeof source==='string'){if(!readFile)throw new Error('MSM5205 file loading requires readFile');source=await readFile(source);check(token);}return source;};
  const ownSignal=()=>signal?AbortSignal.any([signal,operations.signal]):operations.signal;
  const install=async(data,info,token,loadSignal=ownSignal())=>{
    if(data instanceof ArrayBuffer)data=new Uint8Array(data);
    if(!(data instanceof Uint8Array)||!data.length||data.length>65536)throw new RangeError('MSM5205 encoded sample must contain 1..65536 bytes');
    check(token);
    try {await adapter.prepare(data,'pce-adpcm',{signal:loadSignal});check(token);loadSignal.throwIfAborted();}
    catch(error){if(loadSignal.aborted||token!==generation)sample=null;throw error;}
    sample=Object.freeze({bytes:data.length,frames:data.length*2,rate:15,...info});return sample;
  };
  return {
    /** Encoded four-bit OKI ADPCM, high nibble first, not WAV bytes. */
    /** @param {ArrayBuffer|Uint8Array|string} source */
    loadMemory(source){return serial(async token=>install(await read(source,token),{},token));},
    /** @param {any} source @param {{rate?:number,signal?:AbortSignal,decodeAudio?:(bytes:ArrayBuffer)=>Promise<any>}} [options] */
    loadSample(source,options={}){return serial(async token=>{
      const operationSignal=ownSignal(),combined=options.signal?AbortSignal.any([operationSignal,options.signal]):operationSignal;
      source=await read(source,token);check(token);
      const prepared=await prepareMSM5205Sample(source,{...options,signal:combined,clock:1536000});check(token);combined.throwIfAborted();
      const {data,...info}=prepared;return install(data,info,token,combined);
    });},
    /** @param {{offset?:number,length?:number,loop?:boolean,rate?:number,at?:number}} [options] */
    play(options={}){return serial(()=>{
      if(!sample)throw new Error('Load an MSM5205 sample before playback');
      const {at,...parameters}=options,offset=parameters.offset??0,length=parameters.length??sample.frames-offset,rate=parameters.rate??sample.rate;
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||offset+length>sample.bytes*2||!Number.isInteger(rate)||rate<0||rate>15||parameters.loop!==undefined&&typeof parameters.loop!=='boolean')throw new RangeError('Invalid MSM5205 sample range/rate');
      return adapter.command({type:'play',offset,length,loop:parameters.loop??false,rate},{at});
    });},
    /** @param {{at?:number}} [options] */
    stop(options={}){generation++;operations.abort(cancel());operations=new AbortController();tail=Promise.resolve();check(generation);return adapter.command({type:'stop'},options);},
    /** @param {{at?:number}} [options] */
    reset(options={}){generation++;operations.abort(cancel());operations=new AbortController();tail=Promise.resolve();check(generation);return adapter.command({type:'reset'},options);},
    /** @param {number} register @param {number} value @param {{at?:number}} [timing] */
    writeRegister(register,value,timing){return serial(()=>{if(!Number.isInteger(register)||register<0||register>7||!Number.isInteger(value)||value<0||value>15)throw new RangeError('Invalid MSM5205 register write');return adapter.command({type:'write-register',register,value},timing);});},
    getState(){return serial(async()=>{const state=await adapter.command({type:'state'}),mix=getMix?.();return {...state,sample,...(mix?{volume:mix.volume,pan:mix.pan,mute:mix.effectiveMuted??mix.muted}:{})};});},
    dispose(){if(dead)return;dead=true;generation++;operations.abort(cancel());sample=null;adapter.dispose();},
  };
}
