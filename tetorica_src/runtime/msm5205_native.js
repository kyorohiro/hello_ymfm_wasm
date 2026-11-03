// Original Tetorica code. BSD-3-Clause; see LICENSE.
/** Native uses the shared ADPCM renderer inside the existing chip callback.
 * Only bounded encoded RAM uploads cross IPC; playback never requests UI samples.
 * @param {any} synth
 * @param {{signal?:AbortSignal}} [options]
 */
export function createNativeMsm5205(synth,{signal}={}){
  const session=synth.session,generation=synth.generation;let disposed=false,loads=Promise.resolve();
  const check=()=>{signal?.throwIfAborted();if(disposed||session!==synth.session||generation!==synth.generation||!synth.isReady()||synth.stopping||synth.closing)throw new DOMException('MSM5205 session ended','AbortError');};
  const request=(command,args={})=>{check();return synth.nativeRequest(command,args).then(value=>{check();return value;});};
  return {
    prepare(pcm,name,{signal:operationSignal}={}){
      const pending=loads.then(async()=>{
      check();operationSignal?.throwIfAborted();if(!(pcm instanceof Uint8Array)||!pcm.length||pcm.length>65536)throw new RangeError('MSM5205 requires 1..65536 encoded bytes');const result=await synth.nativeRequest('native_genesis_msm5205_load_begin',{bytes:pcm.byteLength,name});let upload=result.upload;
      try{
        check();operationSignal?.throwIfAborted();
        for(let offset=0;offset<pcm.length;){
          check();operationSignal?.throwIfAborted();const length=Math.min(64*1024,result.maxChunkBytes,pcm.length-offset);
          if(!Number.isSafeInteger(length)||length<1)throw new Error('Invalid Native MSM5205 chunk limit');
          await synth.invoke('native_genesis_msm5205_load_chunk',pcm.subarray(offset,offset+length),{headers:{'x-msm5205-session':String(session),'x-msm5205-upload':String(upload),'x-msm5205-offset':String(offset)}});
          check();offset+=length;
        }
        operationSignal?.throwIfAborted();await request('native_genesis_msm5205_load_finalize',{upload});upload=null;
      }finally{if(upload!==null){const old=upload;upload=null;await synth.invoke('native_genesis_msm5205_load_abort',{session,upload:old}).catch(()=>{});}}
      });loads=pending.catch(()=>{});return pending;
    },
    /** @param {{type:string,[key:string]:any}} action @param {{at?:number}} [timing] */
    command(action,{at}={}){
      check();if(action.type==='state')return request('native_genesis_msm5205_state').then(state=>({...state,sampleRate:synth.clock.sampleRate}));
      if(at!==undefined&&(!Number.isFinite(at)||at<0))return Promise.reject(new RangeError('Invalid MSM5205 audio-clock time'));
      return request('native_genesis_msm5205_action',{frame:at===undefined?0:synth.frameAt(at),action});
    },
    dispose(){if(disposed)return;disposed=true;if(session===synth.session&&generation===synth.generation&&synth.isReady()&&!synth.stopping&&!synth.closing)synth.nativeRequest('native_genesis_msm5205_action',{frame:0,action:{type:'stop'}}).catch(()=>{});},
  };
}
