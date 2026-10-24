/** Lifetime and identity for independently owned Native chips. Audio stays on
 * the Native renderer; these ports carry ordered commands and explicit reads. */
export async function createNativeGenesisExtraChip(synth,{id,bridge,kind,label,clock,stereoEnabled,createEndpoint,signal,layout={},createArgs={}}) {
  signal?.throwIfAborted();
  if(!synth.isReady()||synth.stopping||synth.closing)throw new DOMException('Native audio is stopping','AbortError');
  if(typeof id!=='string'||!id.trim()||id.length>256)throw new TypeError('Mixer id must contain 1..256 characters');
  if(synth.extraDevices.size>=16)throw new RangeError('Native audio supports at most 16 additional sound chips');
  if(synth.nextExtraChipInstance>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native sound chip instance limit reached');
  const instance=++synth.nextExtraChipInstance,session=synth.session,generation=synth.generation;
  const familyDevices=kind==='spc'?synth.extraSpcDevices:kind==='snes'?synth.extraSnesDevices:kind==='pwm'?synth.extraPwmDevices:kind==='dx7'?synth.extraDx7Devices:kind==='huc6280'?synth.extraHuc6280Devices:kind==='nes'?synth.extraNesDevices:kind==='gameboy'?synth.extraGameboyDevices:kind==='okim6258'?synth.extraOkim6258Devices:kind==='rf5c164'?synth.extraRf5c164Devices:kind==='segapsg'?synth.extraPsgDevices:kind==='ym2203'?synth.extraYm2203Devices:kind==='ym2608'?synth.extraYm2608Devices:kind==='ym2610'?synth.extraYm2610Devices:kind==='ym2610b'?synth.extraYm2610BDevices:kind==='ym2151'?synth.extraYm2151Devices:kind==='ym2413'?synth.extraYm2413Devices:kind==='ay8910'?synth.extraAy8910Devices:['ym3526','ym3812','y8950','ymf262'].includes(kind)?synth.extraOplDevices:synth.extraYm2612Devices;
  const nativeKind=kind==='segapsg'?'psg':kind;
  let disposed=false,created=false,released=false,connection,device,rejectCreation;
  const activeSession=()=>session===synth.session&&generation===synth.generation&&synth.isReady()&&!synth.stopping&&!synth.closing;
  const current=()=>!disposed&&activeSession();
  const abort=()=>new DOMException(`Native additional ${label} was disposed`,'AbortError');
  // Cancelling creation releases its caller and JS slot immediately. The IPC
  // still owns its admission count until it settles and releases any late core.
  const cancelled=new Promise((_,reject)=>{rejectCreation=reject;});
  cancelled.catch(()=>{});
  const duringCreation=promise=>Promise.race([promise,cancelled]);
  const facade={
    get session(){return synth.session;},get generation(){return synth.generation;},get clock(){return synth.clock;},
    get stopping(){return synth.stopping;},get closing(){return synth.closing;},
    isReady:current,frameAt:time=>synth.frameAt(time),flush:()=>synth.flush(),
    enqueue:command=>{if(!current())throw abort();synth.enqueue({...command,instance});},
    enqueueMany:commands=>{if(!current())throw abort();synth.enqueueMany(commands.map(command=>({...command,instance})));},
    nativeRequest:(command,args)=>{if(!current())return Promise.reject(abort());return synth.nativeRequest(command,{...args,instance});},
    nativeSpcRequest:(command,args)=>{if(!current())return Promise.reject(abort());return synth.nativeSpcRequest(command,{...args,instance});},
    observeNativeSnapshot:(command,args)=>{if(!current())return Promise.reject(abort());return synth.observeNativeSnapshot(command,{...args,instance});},
    emit:event=>{if(current()){device?.onState?.(event.state,event.authorEdit);synth.chipInspector?.notify();}},
    notifyLayout:layout=>{if(current()){device.layout={...device.layout,...layout};synth.chipInspector?.notify();}},
    reportAsyncError:error=>{if(current())synth.reportAsyncError(error);},
  };
  const endpoint=createEndpoint(facade),client=endpoint.client;
  Object.defineProperty(client,'id',{value:id,enumerable:true});
  function releaseNative(){if(released||!created||!activeSession())return;released=true;synth.nativeRequest(`native_genesis_extra_${nativeKind}_dispose`,{instance}).catch(error=>{if(activeSession()&&error?.name!=='AbortError')synth.reportAsyncError(error);});}
  function releaseConnection(){const previous=connection;connection=undefined;previous?.dispose();}
  device={native:true,ready:false,nativeInstance:instance,kind,label,client,endpoint,clock,stereoEnabled,layout,
    dispose(){
      if(disposed)return;
      disposed=true;device.ready=false;signal?.removeEventListener('abort',cancelCreation);
      rejectCreation(signal?.aborted?signal.reason:abort());
      try{releaseConnection();}finally{try{endpoint.reset();}finally{
        synth.extraDevices.delete(instance);familyDevices.delete(instance);
        try{synth.chipInspector?.notify();}finally{releaseNative();}
      }}
    },
    mix(settings){if(!current())return;endpoint.mix(settings.effectiveMuted?0:settings.volume,settings.pan).catch(error=>{if(current()&&error?.name!=='AbortError')synth.reportAsyncError(error);});},
  };
  client.dispose=()=>device.dispose();
  const cancelCreation=()=>{try{device.dispose();}catch{/* Preserve the caller's cancellation while completing every cleanup step. */}};signal?.addEventListener('abort',cancelCreation,{once:true});
  synth.extraDevices.set(instance,device);familyDevices.set(instance,device);
  try{
    if(signal?.aborted){cancelCreation();throw signal.reason;}if(!current())throw abort();
    const creating=Promise.resolve(synth.nativeRequest(`native_genesis_extra_${nativeKind}_create`,{...createArgs,instance})).then(()=>{created=true;if(!current()){releaseNative();throw abort();}});
    await duringCreation(creating);
    await duringCreation(endpoint.initialize());if(!current())throw abort();
    if(bridge){connection=bridge.attachEndpoint((message,timing)=>endpoint.dispatch(message,timing),{
      cancelOwner:(performance,owner)=>endpoint.cancelOwner?.(performance,owner),stop:performance=>endpoint.cancelPerformance?.(performance),
    });device.port=connection.port;device.node={port:connection.controlPort};}
    // attachEndpoint is synchronous, but its hooks can cancel this creation
    // before the returned ports become ours. Close those ports in that case.
    if(!current()){releaseConnection();throw abort();}
    device.ready=true;synth.chipInspector?.notify();if(!current())throw abort();
    signal?.removeEventListener('abort',cancelCreation);return device;
  }catch(error){try{device.dispose();}catch{/* Keep the creation failure as the primary error. */}throw signal?.aborted?signal.reason:error;}
}
