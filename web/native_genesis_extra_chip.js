/** Lifetime and identity for independently owned Native chips. Audio stays on
 * the Native renderer; these ports carry ordered commands and explicit reads. */
export async function createNativeGenesisExtraChip(synth,{id,bridge,kind,label,clock,stereoEnabled,createEndpoint}) {
  if(!synth.isReady()||synth.stopping||synth.closing)throw new DOMException('Native audio is stopping','AbortError');
  if(typeof id!=='string'||!id.trim()||id.length>256)throw new TypeError('Mixer id must contain 1..256 characters');
  if(synth.extraDevices.size>=16)throw new RangeError('Native audio supports at most 16 additional sound chips');
  if(synth.nextExtraChipInstance>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native sound chip instance limit reached');
  const instance=++synth.nextExtraChipInstance,session=synth.session,generation=synth.generation;
  const familyDevices=kind==='segapsg'?synth.extraPsgDevices:synth.extraYm2612Devices;
  const nativeKind=kind==='segapsg'?'psg':kind;
  let disposed=false,created=false,connection,device;
  const current=()=>!disposed&&session===synth.session&&generation===synth.generation&&synth.isReady()&&!synth.stopping&&!synth.closing;
  const abort=()=>new DOMException(`Native additional ${label} was disposed`,'AbortError');
  const facade={
    get session(){return synth.session;},get generation(){return synth.generation;},get clock(){return synth.clock;},
    get stopping(){return synth.stopping;},get closing(){return synth.closing;},
    isReady:current,frameAt:time=>synth.frameAt(time),flush:()=>synth.flush(),
    enqueue:command=>{if(!current())throw abort();synth.enqueue({...command,instance});},
    enqueueMany:commands=>{if(!current())throw abort();synth.enqueueMany(commands.map(command=>({...command,instance})));},
    nativeRequest:(command,args)=>{if(!current())return Promise.reject(abort());return synth.nativeRequest(command,{...args,instance});},
    emit:event=>{if(current()){device?.onState?.(event.state);synth.chipInspector?.notify();}},
  };
  const endpoint=createEndpoint(facade),client=endpoint.client;
  Object.defineProperty(client,'id',{value:id,enumerable:true});
  device={native:true,nativeInstance:instance,kind,label,client,endpoint,clock,stereoEnabled,
    dispose(){
      if(disposed)return;const releaseNative=current()&&created;
      disposed=true;connection?.dispose();endpoint.reset();synth.extraDevices.delete(instance);familyDevices.delete(instance);
      synth.chipInspector?.notify();
      if(releaseNative)synth.nativeRequest(`native_genesis_extra_${nativeKind}_dispose`,{instance}).catch(error=>{if(error?.name!=='AbortError')synth.reportAsyncError(error);});
    },
    mix(settings){if(!current())return;endpoint.mix(settings.effectiveMuted?0:settings.volume,settings.pan).catch(error=>{if(current()&&error?.name!=='AbortError')synth.reportAsyncError(error);});},
  };
  client.dispose=()=>device.dispose();
  synth.extraDevices.set(instance,device);familyDevices.set(instance,device);
  try{
    await synth.nativeRequest(`native_genesis_extra_${nativeKind}_create`,{instance});created=true;if(!current())throw abort();
    await endpoint.initialize();if(!current())throw abort();
    if(bridge){connection=bridge.attachEndpoint((message,timing)=>endpoint.dispatch(message,timing));device.port=connection.port;device.node={port:connection.controlPort};}
    synth.chipInspector?.notify();return device;
  }catch(error){device.dispose();throw error;}
}
