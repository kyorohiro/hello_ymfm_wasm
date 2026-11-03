// Original Tetorica code. BSD-3-Clause; see LICENSE.
/** Native uses the same PCM16 renderer inside the existing chip callback.
 * Only bounded PCM16 uploads cross IPC; playback never requests UI samples.
 * @param {any} synth
 * @param {{signal?:AbortSignal}} [options]
 */
export function createNativeCdda(synth,{signal}={}){
  const session=synth.session,generation=synth.generation;let disposed=false,loads=Promise.resolve();
  const check=()=>{signal?.throwIfAborted();if(disposed||session!==synth.session||generation!==synth.generation||!synth.isReady()||synth.stopping||synth.closing)throw new DOMException('CD-DA session ended','AbortError');};
  const request=(command,args={})=>{check();return synth.nativeRequest(command,args).then(value=>{check();return value;});};
  return {
    prepare(pcm,track,{signal:operationSignal}={}){
      const pending=loads.then(async()=>{
      check();operationSignal?.throwIfAborted();const result=await request('native_genesis_cdda_load_begin',{bytes:pcm.byteLength,track});let upload=result.upload;
      try{
        for(let offset=0;offset<pcm.length;){
          check();operationSignal?.throwIfAborted();const length=Math.min(64*1024,result.maxChunkBytes,pcm.length-offset);
          if(!Number.isSafeInteger(length)||length<1)throw new Error('Invalid Native CD-DA chunk limit');
          await synth.invoke('native_genesis_cdda_load_chunk',pcm.subarray(offset,offset+length),{headers:{'x-cdda-session':String(session),'x-cdda-upload':String(upload),'x-cdda-offset':String(offset)}});
          check();offset+=length;
        }
        operationSignal?.throwIfAborted();await request('native_genesis_cdda_load_finalize',{upload});upload=null;
      }finally{if(upload!==null){const old=upload;upload=null;await synth.invoke('native_genesis_cdda_load_abort',{session,upload:old}).catch(()=>{});}}
      });loads=pending.catch(()=>{});return pending;
    },
    /** @param {{type:string,[key:string]:any}} action @param {{at?:number}} [timing] */
    command(action,{at}={}){
      check();if(action.type==='state')return request('native_genesis_cdda_state').then(state=>({...state,sourceRate:44100,sampleRate:synth.clock.sampleRate}));
      if(at!==undefined&&(!Number.isFinite(at)||at<0))return Promise.reject(new RangeError('Invalid CD-DA audio-clock time'));
      return request('native_genesis_cdda_action',{frame:at===undefined?0:synth.frameAt(at),action});
    },
    dispose(){if(disposed)return;disposed=true;if(session===synth.session&&generation===synth.generation&&synth.isReady()&&!synth.stopping&&!synth.closing)synth.nativeRequest('native_genesis_cdda_action',{frame:0,action:{type:'stop'}}).catch(()=>{});},
  };
}
