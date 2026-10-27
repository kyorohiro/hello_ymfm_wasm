import {createNativeGenesisPokeyEndpoint} from './native_genesis_extra_pokey.js?v=pokey-prepare-1';
/** Mode endpoints keep stable public clients while Native Stop retires the
 * callback rack. Replacement cores get fresh, increasing instance identities. */
export function createNativeGenesisPokeyPrimary(synth,{id='pokey',globalName='pokey',clock=1789790}={}){
  let instance=null,mixVolume=1,mixPan=0;
  const facade={
    get session(){return synth.session;},get generation(){return synth.generation;},get clock(){return synth.clock;},get stopping(){return synth.stopping;},get closing(){return synth.closing;},
    isReady:()=>synth.isReady()&&instance!==null,
    frameAt:time=>synth.frameAt(time),flush:()=>synth.flush(),
    enqueue:command=>{if(instance===null)throw new DOMException('Native POKEY core was retired','AbortError');synth.enqueue({...command,instance});},
    nativeRequest:(command,args)=>synth.nativeRequest(command,{...args,instance}),
    observeNativeSnapshot:(command,args)=>synth.observeNativeSnapshot(command,{...args,instance}),
    emit:event=>synth.emit(event),
  };
  const endpoint=createNativeGenesisPokeyEndpoint(facade,{clock,globalName,primary:true});
  Object.defineProperty(endpoint.client,'id',{value:id,enumerable:true});endpoint.client.dispose=()=>{};
  function nextInstance(){if(synth.nextExtraChipInstance>=Number.MAX_SAFE_INTEGER)throw new RangeError('Native sound chip instance limit reached');instance=++synth.nextExtraChipInstance;return instance;}
  return{...endpoint,id,globalName,
    async mix(volume=1,pan=0){await endpoint.mix(volume,pan);mixVolume=volume;mixPan=pan;},
    async initialize(){nextInstance();await synth.nativeRequest('native_genesis_extra_pokey_create',{instance,clock:endpoint.client.clock});await endpoint.initialize();endpoint.client.initialize();await synth.flush();},
    async restoreAfterStop(session){
      if(session!==synth.session)return;
      const state=endpoint.client._getState();for(let ch=0;ch<4;ch++)state.registers[ch*2+1]&=240;
      nextInstance();await synth.invoke('native_genesis_extra_pokey_create',{session,instance,clock:state.clock});
      const writes=[8,15,0,1,2,3,4,5,6,7,10,11,12,13,14,9].map(register=>({type:'extra-pokey',instance,frame:0,message:{method:'write',register,value:state.registers[register]}}));
      writes.push({type:'extra-pokey',instance,frame:0,message:{method:'mix',volume:mixVolume,pan:mixPan}});
      await synth.invoke('native_genesis_commands',{session,commands:writes});
      endpoint.client._adoptState(state);endpoint.adoptStopped();
    },
    reset(){instance=null;endpoint.reset();},
  };
}
