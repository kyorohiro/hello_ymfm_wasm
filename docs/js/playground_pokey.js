import {PokeySynth,POKEY_CLOCK} from './pokeysynth.js?v=pokey-mode-1';
import {attachChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';
import {preparePokeyTimeline,pokeyTimelineInteger,POKEY_TIMELINE_MAX_BYTES} from './pokey_timeline.js?v=pokey-prepare-1';
import {POKEY_TIMELINE_CHUNK_BYTES} from './pokey_timeline_upload.js?v=pokey-prepare-1';
import {validateChipClock} from './playground_chip_clock.js?v=pokey-prepare-1';
import {createPokeyTimelineBuilder} from './pokey_timeline_builder.js?v=pokey-prepare-1';

/** Applied snapshots are adopted without replaying register writes.
 * @param {(method:string,args:any[],channel?:number)=>void} send
 * @param {{clock?:number,close?:()=>void,request?:(method:string,args?:any[])=>Promise<any>,native?:boolean,lifecycle?:any,chunkedTimeline?:boolean}} [options] */
export function createPokeyRegisterClient(send,{clock=POKEY_CLOCK,close=()=>{},request,native=false,lifecycle={},chunkedTimeline=false}={}){
  let disposed=false,preparedTimeline=null,timelineRevision=0,timelinePlaying=false,playRevision=0;
  let uploadSequence=0,pendingUpload=null;
  const abortError=reason=>new DOMException(reason,'AbortError');
  const cancelPreparation=(reason='POKEY timeline preparation cancelled')=>{
    const upload=pendingUpload;if(!upload)return;
    pendingUpload=null;upload.controller.abort(abortError(reason));
    const caller=lifecycle.captureContext?.();
    try{
      lifecycle.restoreContext?.(upload.context);
      // Cleanup belongs to the upload's original owner. It has no RPC ID, so
      // an abort ACK cannot later restore that retired owner's context.
      send('abortTimelineUpload',[{uploadId:upload.id}]);
    }catch{}finally{lifecycle.restoreContext?.(caller);}
  };
  const check=context=>{if(disposed||lifecycle.isStopped?.(context))throw new DOMException('POKEY disposed or Run stopped','AbortError');};
  const api=new PokeySynth({clock,transport:{
    writeRegister(register,value,channel){if(disposed)throw new Error('POKEY disposed');send('writeRegister',[register,value],channel);},
    reset(){if(disposed)throw new Error('POKEY disposed');cancelPreparation('POKEY timeline reset');preparedTimeline=null;timelineRevision++;timelinePlaying=false;playRevision++;send('reset',[]);},
  }});
  const getState=api._getState.bind(api),adoptState=api._adoptState.bind(api),disposeSynth=api.dispose.bind(api);
  api.dispose=()=>{if(disposed)return;cancelPreparation('POKEY disposed');disposed=true;try{disposeSynth();send('dispose',[]);}finally{close();}};
  const control=(method,args=[],transfer)=>{if(disposed)throw new Error('POKEY disposed');return request?request(method,args):api._requestControl(method,args,transfer);};
  const timelineRequest=(method,args=[],context=lifecycle.captureContext?.(),transfer,signal)=>{
    check(context);
    let sent;try{sent=control(method,args,transfer);}catch(error){sent=Promise.reject(error);}
    const result=Promise.resolve(sent).catch(error=>{if(/stopped|cancelled|replaced|disposed/i.test(error.message))throw new DOMException(error.message,'AbortError');throw error;});
    if(!lifecycle.restoreContext)return result;
    const resume=callback=>new Promise((resolve,reject)=>setTimeout(()=>{try{if(signal?.aborted)throw signal.reason;check(context);lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    return result.then(value=>resume(()=>value),error=>resume(()=>{throw error;}));
  };
  async function uploadTimeline(trace,context){
    if(!trace||typeof trace!=='object'||Array.isArray(trace)||trace.version!==1)throw new TypeError('POKEY timeline: expected version 1');
    const clock=validateChipClock(trace.clock),durationSamples=pokeyTimelineInteger(trace.durationSamples,0xffffffff,'duration');
    if(clock!==api.clock)throw new RangeError('POKEY timeline clock must match its instance');
    if(!(trace.data instanceof Uint8Array)||trace.data.byteLength>POKEY_TIMELINE_MAX_BYTES||!(trace.data.buffer instanceof ArrayBuffer))throw new TypeError('POKEY timeline: expected ArrayBuffer-backed Uint8Array up to 8 MiB');
    if(timelinePlaying)throw new Error('POKEY timeline is busy');
    // Snapshot caller-owned bytes before the first await. Only small owned
    // chunks cross to the audio thread; decoding is performed there in bounds.
    const data=new Uint8Array(trace.data);
    cancelPreparation('POKEY timeline preparation replaced');
    const upload={id:++uploadSequence,controller:new AbortController(),context},revision=++timelineRevision;
    api._observe?.({method:'prepareTimeline',args:[]});pendingUpload=upload;
    const signal=upload.controller.signal;
    const step=(method,args,transfer)=>{
      check(context);if(signal.aborted)throw signal.reason;
      return new Promise((resolve,reject)=>{
        const cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});
        let result;try{result=timelineRequest(method,args,context,transfer,signal);}catch(error){result=Promise.reject(error);}
        Promise.resolve(result).then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
      });
    };
    try{
      await step('beginTimelineUpload',[{uploadId:upload.id,version:1,clock,durationSamples,byteLength:data.byteLength}]);
      for(let offset=0;offset<data.length;offset+=POKEY_TIMELINE_CHUNK_BYTES){
        const chunk=data.slice(offset,Math.min(data.length,offset+POKEY_TIMELINE_CHUNK_BYTES));
        await step('appendTimelineChunk',[{uploadId:upload.id,offset,data:chunk}],[chunk.buffer]);
      }
      const result=await step('commitTimelineUpload',[{uploadId:upload.id}]);
      check(context);if(signal.aborted)throw signal.reason;
      if(revision!==timelineRevision)throw abortError('POKEY timeline preparation cancelled');
      preparedTimeline={clock,durationSamples};return result;
    }catch(error){
      if(pendingUpload===upload)cancelPreparation('POKEY timeline preparation cancelled');
      throw error;
    }finally{if(pendingUpload===upload)pendingUpload=null;}
  }
  Object.defineProperties(api,{
    _adoptState:{value:state=>{if(state.clock!==undefined&&state.clock!==api.clock)api._adoptClock?.(state.clock);adoptState({...state,initialized:state.initialized??true,levels:state.levels??getState().levels});}},
    _forceKeyOff:{value:channel=>{if(!Number.isInteger(channel)||channel<0||channel>3)throw new RangeError('POKEY channel must be 0..3');const state=getState();state.registers[channel*2+1]&=240;adoptState(state);send('forceKeyOff',[channel],channel);}},
    _stopVoices:{value:()=>{cancelPreparation();timelinePlaying=false;playRevision++;const state=getState();for(let ch=0;ch<4;ch++)state.registers[ch*2+1]&=240;adoptState(state);return control('stopVoices');}},
    createTimeline:{value:(options={})=>{check(lifecycle.captureContext?.());return createPokeyTimelineBuilder({clock:api.clock,...options});}},
    prepareTimeline:{value:async trace=>{
      const context=lifecycle.captureContext?.();check(context);if(chunkedTimeline)return uploadTimeline(trace,context);
      const prepared=preparePokeyTimeline(trace);if(prepared.clock!==api.clock)throw new RangeError('POKEY timeline clock must match its instance');const revision=++timelineRevision;
      const result=await timelineRequest('prepareTimeline',[prepared]);if(revision!==timelineRevision)throw new DOMException('POKEY timeline preparation cancelled','AbortError');preparedTimeline=prepared;return result;
    }},
    getTimelineState:{value:()=>timelineRequest('getTimelineState')},
    playTimeline:{value:options=>{check(lifecycle.captureContext?.());if(!preparedTimeline)throw new Error('Prepare a POKEY timeline before playback');if(timelinePlaying)return Promise.reject(new Error('POKEY timeline is busy'));api._observe?.({method:'playTimeline',args:[]});timelinePlaying=true;const revision=++playRevision;return timelineRequest('playTimeline',[options??{}]).then(result=>{if(revision===playRevision&&result?.state)api._adoptState(result.state);return result;}).finally(()=>{if(revision===playRevision)timelinePlaying=false;});}},
    stopTimeline:{value:()=>{cancelPreparation();timelinePlaying=false;playRevision++;return timelineRequest('stopTimeline');}},
    _cancelTimeline:{value:()=>{cancelPreparation();timelinePlaying=false;playRevision++;return control('stopTimeline');}},
    _cancelPreparation:{value:()=>cancelPreparation()},
    _setTimelineLifecycle:{value:hooks=>{lifecycle=hooks??{};}},
  });
  api.readRegister=register=>{if(!Number.isInteger(register)||register<0||register>15)throw new RangeError('POKEY register must be 0..15');return timelineRequest('readRegister',[register]);};
  api.setChannelMuted=(ch,muted)=>{if(!Number.isInteger(ch)||ch<0||ch>3||typeof muted!=='boolean')throw new TypeError('Expected POKEY channel 0..3 and boolean mute');return timelineRequest('setChannelMuted',[ch,muted]);};
  let nesting=0;
  for(const method of ['initialize','reset','writeRegister','setFrequency','setNote','setVolume','setDistortion','setVolumeOnly','setHighClock','setJoined','setBaseClock','setPoly9','keyOn','keyOff','noteOn','allNotesOff']){
    const original=api[method].bind(api);api[method]=(...args)=>{
      if(disposed)throw new Error('POKEY disposed');
      if(timelinePlaying&&!['reset','allNotesOff'].includes(method))throw new Error('Stop/reset the POKEY timeline before editing its voices');
      if(method==='allNotesOff'){cancelPreparation();timelinePlaying=false;playRevision++;}
      const before=nesting++===0?getState().levels:null;
      try{const result=original(...args);if(before){const after=getState().levels;for(let ch=0;ch<4;ch++)if(before[ch]!==after[ch])send('setRetainedLevel',[ch,after[ch]],ch);}return result;}
      finally{nesting--;}
    };
  }
  return api;
}

export function createPokeyClient(port,options={},lifecycle={}){
  const api=createPokeyRegisterClient((method,args,channel)=>port.postMessage({method,args,...(channel===undefined?{}:{channel})}),{
    clock:options.clock??POKEY_CLOCK,close:()=>port.close(),native:options.native===true,chunkedTimeline:options.native!==true,lifecycle,
  });
  const controlled=attachChipClock(api,port,options.clock??POKEY_CLOCK);
  if(options.native){const setClock=controlled.setClock.bind(controlled);controlled.setClock=hz=>{const context=lifecycle.captureContext?.();if(lifecycle.isStopped?.(context))return Promise.reject(new DOMException('POKEY Run stopped','AbortError'));const resume=callback=>new Promise((resolve,reject)=>setTimeout(()=>{try{if(lifecycle.isStopped?.(context))throw new DOMException('POKEY Run stopped','AbortError');lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));return setClock(hz).then(value=>resume(()=>value),error=>resume(()=>{throw error;}));};}
  if(options.state)api._adoptState(options.state);
  return controlled;
}
