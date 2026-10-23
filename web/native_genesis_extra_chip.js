/** Lifetime and identity for independently owned Native chips. Audio stays on
 * the Native renderer; these ports carry ordered commands and explicit reads. */
export async function createNativeGenesisExtraChip(synth,{id,bridge,kind,label,clock,stereoEnabled,createEndpoint,signal,layout={},createArgs={}}) {
  signal?.throwIfAborted();
  if(!synth.isReady()||synth.stopping||synth.closing)throw new DOMException('Native audio is stopping','AbortError');
  if(typeof id!=='string'||!id.trim()||id.length>256)throw new TypeError('Mixer id must contain 1..256 characters');
  if(synth.extraDevices.size>=16)throw new RangeError('Native audio supports at most 16 additional sound chips');
  if(synth.nextExtraChipInstance>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native sound chip instance limit reached');
  const instance=++synth.nextExtraChipInstance,session=synth.session,generation=synth.generation;
  const familyDevices=kind==='pwm'?synth.extraPwmDevices:kind==='dx7'?synth.extraDx7Devices:kind==='huc6280'?synth.extraHuc6280Devices:kind==='nes'?synth.extraNesDevices:kind==='gameboy'?synth.extraGameboyDevices:kind==='okim6258'?synth.extraOkim6258Devices:kind==='rf5c164'?synth.extraRf5c164Devices:kind==='segapsg'?synth.extraPsgDevices:kind==='ym2203'?synth.extraYm2203Devices:kind==='ym2608'?synth.extraYm2608Devices:kind==='ym2610'?synth.extraYm2610Devices:kind==='ym2151'?synth.extraYm2151Devices:kind==='ym2413'?synth.extraYm2413Devices:kind==='ay8910'?synth.extraAy8910Devices:['ym3526','ym3812','y8950','ymf262'].includes(kind)?synth.extraOplDevices:synth.extraYm2612Devices;
  const nativeKind=kind==='segapsg'?'psg':kind;
  let disposed=false,created=false,released=false,connection,device;
  const current=()=>!disposed&&session===synth.session&&generation===synth.generation&&synth.isReady()&&!synth.stopping&&!synth.closing;
  const abort=()=>new DOMException(`Native additional ${label} was disposed`,'AbortError');
  const facade={
    get session(){return synth.session;},get generation(){return synth.generation;},get clock(){return synth.clock;},
    get stopping(){return synth.stopping;},get closing(){return synth.closing;},
    isReady:current,frameAt:time=>synth.frameAt(time),flush:()=>synth.flush(),
    enqueue:command=>{if(!current())throw abort();synth.enqueue({...command,instance});},
    enqueueMany:commands=>{if(!current())throw abort();synth.enqueueMany(commands.map(command=>({...command,instance})));},
    nativeRequest:(command,args)=>{if(!current())return Promise.reject(abort());return synth.nativeRequest(command,{...args,instance});},
    observeNativeSnapshot:(command,args)=>{if(!current())return Promise.reject(abort());return synth.observeNativeSnapshot(command,{...args,instance});},
    emit:event=>{if(current()){device?.onState?.(event.state,event.authorEdit);synth.chipInspector?.notify();}},
    notifyLayout:layout=>{if(current()){device.layout={...device.layout,...layout};synth.chipInspector?.notify();}},
    reportAsyncError:error=>{if(current())synth.reportAsyncError(error);},
  };
  const endpoint=createEndpoint(facade),client=endpoint.client;
  Object.defineProperty(client,'id',{value:id,enumerable:true});
  function releaseNative(){if(released||!created||session!==synth.session||generation!==synth.generation||!synth.isReady()||synth.stopping||synth.closing)return;released=true;synth.nativeRequest(`native_genesis_extra_${nativeKind}_dispose`,{instance}).catch(error=>{if(error?.name!=='AbortError')synth.reportAsyncError(error);});}
  device={native:true,ready:false,nativeInstance:instance,kind,label,client,endpoint,clock,stereoEnabled,layout,
    dispose(){
      if(disposed)return;
      disposed=true;device.ready=false;signal?.removeEventListener('abort',cancelCreation);connection?.dispose();endpoint.reset();synth.extraDevices.delete(instance);familyDevices.delete(instance);
      synth.chipInspector?.notify();
      releaseNative();
    },
    mix(settings){if(!current())return;endpoint.mix(settings.effectiveMuted?0:settings.volume,settings.pan).catch(error=>{if(current()&&error?.name!=='AbortError')synth.reportAsyncError(error);});},
  };
  client.dispose=()=>device.dispose();
  const cancelCreation=()=>device.dispose();signal?.addEventListener('abort',cancelCreation,{once:true});
  synth.extraDevices.set(instance,device);familyDevices.set(instance,device);
  try{
    await synth.nativeRequest(`native_genesis_extra_${nativeKind}_create`,{...createArgs,instance});created=true;if(!current()){releaseNative();throw abort();}
    await endpoint.initialize();if(!current())throw abort();
    if(bridge){connection=bridge.attachEndpoint((message,timing)=>endpoint.dispatch(message,timing),{
      cancelOwner:(performance,owner)=>endpoint.cancelOwner?.(performance,owner),stop:performance=>endpoint.cancelPerformance?.(performance),
    });device.port=connection.port;device.node={port:connection.controlPort};}
    device.ready=true;signal?.removeEventListener('abort',cancelCreation);synth.chipInspector?.notify();return device;
  }catch(error){device.dispose();throw signal?.aborted?signal.reason:error;}
}
