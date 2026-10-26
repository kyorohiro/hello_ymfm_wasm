/** Full SPC700/S-DSP file player. The public Browser and Worker client keeps
 * its ordinary RPC/event protocol; only this private endpoint speaks Native. */
import {createNativeVoiceContext,nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=wonderswan-native-1';
import {createNativeGenesisExtraChip} from './native_genesis_extra_chip.js?v=wonderswan-native-1';

const abort=()=>new DOMException('Native SPC player disposed or operation cancelled','AbortError');
const integer=(value,max,label)=>{if(!Number.isSafeInteger(value)||value<0||value>max)throw new RangeError(`Invalid Native SPC ${label}`);return value;};
export const EXTRA_SPC_ADMISSION_ERRORS=Object.freeze(['Invalid SPC file size','Load an SPC file before playback','Native SPC operation cancelled','Native SPC seek cancelled','Invalid SPC seek block',
  'Native SPC owner limit reached (1024)','Native SPC pending command limit reached','Native SPC pending RAM snapshot limit reached (16)',
  'Native SPC pending RAM snapshot limit reached (16 across shared rack)',
  'Native SPC command result expired or unknown','Native SPC snapshot has not applied']);
export const isExtraSpcRejection=message=>EXTRA_SPC_ADMISSION_ERRORS.includes(message)||message.startsWith('Native SPC load rejected: ')||message.startsWith('Invalid Native SPC ');

export function createNativeGenesisExtraSpcEndpoint(synth){
  const context=createNativeVoiceContext(synth,{backend:'extra-spc',statusCommand:'native_genesis_extra_spc_status',label:'additional SPC'}),{capture,current}=context;
  let initialized=false,closed=false,failed=false,connection=null,serial=Promise.resolve(),revision=-1,loadVersion=0,seekVersion=0,activeSeek=null;
  let cached={ready:true,loaded:false,playing:false,paused:false,muteMask:0,sampleRate:synth.clock.sampleRate||48000,nativeSampleRate:32000,playbackNativeFrames:0,positionSeconds:0,renderedNativeFrames:0};
  const operations=new Set(),owners=new Map(),cancelled=new Set();let nextOwner=0,stoppedSession=0;
  let observing=false,eventEpoch=0,intervalMs=16,eventTimer=null,eventBusy=false,eventVersion=0;
  const send=message=>context.send('spc',message,{});
  const notify=()=>synth.emit?.({type:'native-state',name:'spc',state:{...cached}});
  function validOwner(owner){
    if(owner==null)return undefined;
    if(!Number.isSafeInteger(owner.session)||owner.session<1||typeof owner.owner!=='string'||!owner.owner.length||owner.owner.length>256)throw new TypeError('Invalid SPC performance owner');
    const key=`${owner.session}:${owner.owner}`;if(owner.session<=stoppedSession||cancelled.has(key))throw abort();
    if(!owners.has(key)){if(owners.size>=1024)throw new RangeError('Native SPC performance owner limit reached');owners.set(key,++nextOwner);}
    return {session:owner.session,owner:owners.get(key),key};
  }
  function operation(owner){if(operations.size>=256)throw new RangeError('Native SPC request queue is full');const token=capture(),scope=validOwner(owner),op={scope,cancelled:false};operations.add(op);op.check=()=>{current(token);if(closed||failed||op.cancelled||scope&&(scope.session<=stoppedSession||cancelled.has(scope.key)))throw abort();};return op;}
  function cancel(matches){for(const op of operations)if(matches(op))op.cancelled=true;}
  function resourceFailure(){
    if(closed||failed)return;failed=true;observing=false;eventVersion++;clearTimeout(eventTimer);eventTimer=null;cancel(()=>true);
    // Match the Browser's fatal player lifetime without failing unrelated
    // Native instruments. Let the transferred port deliver its fatal first.
    post({fatal:true,error:'Native SPC file playback failed'});setTimeout(()=>client.dispose(),0);
  }
  function state(data){
    if(data?.failed===true){resourceFailure();throw abort();}
    if(!data||typeof data.ready!=='boolean'||typeof data.loaded!=='boolean'||typeof data.playing!=='boolean'||typeof data.paused!=='boolean'||data.nativeSampleRate!==32000||!Number.isFinite(data.positionSeconds)||data.positionSeconds<0)throw new Error('Native SPC returned an invalid state');
    integer(data.muteMask,255,'mute mask');integer(data.sampleRate,1000000,'sample rate');if(!Number.isFinite(data.playbackNativeFrames)||data.playbackNativeFrames<0||data.playbackNativeFrames>Number.MAX_SAFE_INTEGER)throw new Error('Native SPC returned an invalid playback frame');integer(data.renderedNativeFrames,Number.MAX_SAFE_INTEGER,'rendered frame');return {...data};
  }
  async function snapshot(op,args={}){
    try{const response=args.after===undefined?await synth.nativeRequest('native_genesis_extra_spc_status',args):await synth.observeNativeSnapshot('native_genesis_extra_spc_status',args);op.check();const value=state(response?.spc);integer(response?.revision,Number.MAX_SAFE_INTEGER,'revision');if(response.revision>=revision){revision=response.revision;cached=value;}return {response,value};}catch(error){op.check();throw error;}
  }
  async function transmit(message,op){const id=context.identity(),full={...message,id,...(op.scope?{sourceOwner:{session:op.scope.session,owner:op.scope.owner}}:{})};op.check();send(full);await synth.flush();op.check();return id;}
  function admit(message,op){const result=serial.then(()=>transmit(message,op));serial=result.then(()=>{},()=>{});return result;}
  async function apply(message,op){const id=await admit(message,op);return snapshot(op,{after:id});}
  function updateEpoch(epoch){if(epoch===undefined)return;integer(epoch,Number.MAX_SAFE_INTEGER,'event epoch');if(epoch!==eventEpoch){eventEpoch=epoch;eventVersion++;}}
  function post(message,transfer=[]){if(!closed&&connection)connection.command.port1.postMessage(message,transfer);}
  function eventMessage(packet,epoch){
    const type=packet.type;
    if(type==='spc-events-reset'){nativeSnapshotArray(packet.dsp,128,255,'SPC event DSP');const dsp=Uint8Array.from(packet.dsp);post({...packet,epoch,dsp},[dsp.buffer]);return;}
    if(type==='spc-events-suspended'){post({type,epoch});return;}
    integer(packet.sequence,Number.MAX_SAFE_INTEGER,'event sequence');integer(packet.clock,Number.MAX_SAFE_INTEGER,'event clock');integer(packet.count,2048,'event count');integer(packet.droppedWrites,Number.MAX_SAFE_INTEGER,'event overflow');
    if(!Array.isArray(packet.writes)||packet.writes.length<packet.count*3||packet.writes.length>2048*3)throw new Error('Native SPC returned invalid event writes');
    for(let i=0;i<packet.count;i++){integer(packet.writes[i*3],Number.MAX_SAFE_INTEGER,'write clock');integer(packet.writes[i*3+1],127,'write register');integer(packet.writes[i*3+2],255,'write value');}
    const writes=new Float64Array(2048*3);writes.set(packet.writes);let dsp;if(packet.dsp!==undefined){nativeSnapshotArray(packet.dsp,128,255,'SPC overflow DSP');dsp=Uint8Array.from(packet.dsp);}
    post({...packet,type:'spc-events',epoch,writes,...(dsp?{dsp}:{})},[writes.buffer,...(dsp?[dsp.buffer]:[])]);
  }
  function scheduleEvents(delay=intervalMs){if(closed||!observing||eventTimer!==null)return;eventTimer=setTimeout(()=>{eventTimer=null;void pumpEvents();},delay);eventTimer.unref?.();}
  async function pumpEvents(){
    if(closed||!observing||eventBusy)return;eventBusy=true;const version=eventVersion,epoch=eventEpoch;
    try{
      const token=capture(),data=await synth.nativeSpcRequest('native_genesis_extra_spc_events',{epoch});current(token);if(closed||!observing||epoch!==eventEpoch||data.epoch!==eventEpoch)return;
      // Interval changes share an epoch: the Native drain already reserved
      // these batch credits, so deliver and acknowledge them after reconfiguration.
      if(data.failed===true){resourceFailure();return;}
      if(data.reset)eventMessage({type:'spc-events-reset',...data.reset},epoch);
      if(data.suspended)eventMessage({type:'spc-events-suspended'},epoch);
      if(!Array.isArray(data.batches)||data.batches.length>4)throw new Error('Native SPC returned an invalid event batch');
      for(const packet of data.batches)eventMessage(packet,epoch);
    }catch(error){if(!closed&&observing&&version===eventVersion&&error?.name!=='AbortError'){observing=false;post({type:'spc-events-unavailable',epoch,error:String(error.message??error)});}}
    finally{eventBusy=false;scheduleEvents();}
  }
  async function configureObservation(enabled,epoch,interval,op){
    if(typeof enabled!=='boolean'||!Number.isFinite(interval)||interval<16||interval>1000)throw new RangeError('Invalid SPC observation options');integer(epoch,Number.MAX_SAFE_INTEGER,'event epoch');
    const version=++eventVersion;clearTimeout(eventTimer);eventTimer=null;observing=enabled;eventEpoch=epoch;intervalMs=interval;
    try{const result=await apply({method:'observe',enabled,epoch,intervalMs:interval},op);if(version===eventVersion&&observing)scheduleEvents(0);return result.value;}catch(error){if(version===eventVersion)observing=false;throw error;}
  }
  async function execute(message){
    const method=message.method,args=message.args??[],owner=['observe','eventAck','dispose'].includes(method)?undefined:message.spcPerformance;
    if(!Array.isArray(args))throw new TypeError('SPC arguments must be an array');
    if(method==='dispose'){client.dispose();return undefined;}
    if(method==='eventAck'){
      const [epoch,sequence,buffer]=args;integer(epoch,Number.MAX_SAFE_INTEGER,'ack epoch');integer(sequence,Number.MAX_SAFE_INTEGER,'ack sequence');if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==2048*3*8)return;
      if(epoch!==eventEpoch)return;const op=operation();try{await admit({method:'event-ack',epoch,sequence},op);scheduleEvents(0);}finally{operations.delete(op);}return;
    }
    const op=operation(owner);updateEpoch(message.spcEventEpoch);
    if(['loadSPC','stop'].includes(method)){loadVersion++;seekVersion++;activeSeek=null;}
    else if(['play','pause'].includes(method)){seekVersion++;activeSeek=null;}
    // A later Stop fences the load result, while queued load admission retains
    // Browser port order so Stop rewinds the newly selected file.
    const load=loadVersion;
    try{
      if(method==='observe')return await configureObservation(args[0],args[1],args[2],op);
      if(method==='loadSPC'){
        const bytes=args[0] instanceof Uint8Array?args[0].slice():args[0] instanceof ArrayBuffer?new Uint8Array(args[0].slice(0)):null;if(!bytes)throw new TypeError('SPC data must be a Uint8Array or ArrayBuffer');if(bytes.length<0x10180||bytes.length>16*1024*1024)throw new RangeError('Invalid SPC file size');
        // The Browser pauses before validating the SPC header. Keep its old
        // loaded song retryable, and resynchronize observations if loading fails.
        const admission=serial.then(async()=>{const pause=await transmit({method:'pause',eventEpoch},op);try{return {pause,loaded:await transmit({method:'load-spc',data:Array.from(bytes),eventEpoch},op)};}catch(error){return {pause,error};}});serial=admission.then(()=>{},()=>{});
        const result=await admission;
        if(result.error){op.check();await snapshot(op,{after:result.pause});if(load!==loadVersion)throw abort();if(observing)await apply({method:'observe',enabled:true,epoch:eventEpoch,intervalMs},op);scheduleEvents(0);throw result.error;}
        const {value}=await snapshot(op,{after:result.loaded});op.check();if(load!==loadVersion)throw abort();notify();scheduleEvents(0);return value;
      }
      if(method==='getState')return (await apply({method:'barrier'},op)).value;
      if(method==='snapshot'){
        const {response}=await apply({method:'snapshot'},op),data=response.snapshot;nativeSnapshotArray(data?.ram,65536,255,'SPC RAM');nativeSnapshotArray(data.dsp,128,255,'SPC DSP');integer(data.nativeFrames,Number.MAX_SAFE_INTEGER,'snapshot frame');integer(data.muteMask,255,'snapshot mute mask');if(data.nativeSampleRate!==32000||!Number.isFinite(data.positionSeconds)||data.positionSeconds<0||!Number.isFinite(data.playbackNativeFrames)||data.playbackNativeFrames<0||data.playbackNativeFrames>Number.MAX_SAFE_INTEGER)throw new Error('Native SPC returned an invalid snapshot');return {ram:Uint8Array.from(data.ram),dsp:Uint8Array.from(data.dsp),nativeFrames:data.nativeFrames,positionSeconds:data.positionSeconds,playbackNativeFrames:data.playbackNativeFrames,nativeSampleRate:32000,muteMask:data.muteMask};
      }
      if(method==='seekBegin'){
        if(typeof args[0]!=='string'||!args[0].length||args[0].length>128)throw new TypeError('Invalid SPC seek identity');const version=++seekVersion,seek={external:args[0],id:context.identity(),version,scope:op.scope};activeSeek=seek;const {value}=await apply({method:'seek-begin',seekId:seek.id,eventEpoch},op);op.check();if(activeSeek!==seek)throw abort();return value;
      }
      if(method==='seekStep'||method==='seekEnd'){
        const seek=activeSeek;if(!seek||seek.external!==args[0]||seek.scope?.key!==op.scope?.key)throw abort();
        if(method==='seekStep'){integer(args[1],16000,'seek block');await serial;op.check();if(activeSeek!==seek)throw abort();const data=await synth.nativeSpcRequest('native_genesis_extra_spc_seek_step',{seekId:seek.id,frames:args[1],...(op.scope?{sourceOwner:{session:op.scope.session,owner:op.scope.owner}}:{})});op.check();if(activeSeek!==seek)throw abort();return state(data.spc??data);}
        const {value}=await apply({method:'seek-end',seekId:seek.id,resume:args[1]===true,eventEpoch},op);op.check();if(activeSeek!==seek)throw abort();activeSeek=null;scheduleEvents(0);notify();return value;
      }
      if(['play','pause','stop','setMuteMask'].includes(method)){
        if(method==='setMuteMask')integer(args[0],255,'mute mask');const {value}=await apply({method:method==='setMuteMask'?'mute':method,...(method==='setMuteMask'?{mask:args[0]}:{}),eventEpoch},op);notify();scheduleEvents(0);return value;
      }
      throw new Error(`Unknown SPC player method: ${method}`);
    }catch(error){op.check();if(['Native SPC operation cancelled','Native SPC seek cancelled'].includes(error?.message??String(error)))throw abort();throw error;}finally{operations.delete(op);}
  }
  function receive(message,reply){
    if(closed||!message)return;
    if(message.type==='performance-start'){try{integer(message.session,Number.MAX_SAFE_INTEGER,'performance session');if(message.session<=stoppedSession)throw abort();reply.postMessage({type:'performance-result',id:message.id});}catch(error){reply.postMessage({type:'performance-result',id:message.id,error:String(error.message??error)});}return;}
    if(['performance-stop','performance-cancel-owner'].includes(message.type)){
      try{integer(message.session,Number.MAX_SAFE_INTEGER,'performance session');let native;
        if(message.type==='performance-stop'){stoppedSession=Math.max(stoppedSession,message.session);cancel(op=>op.scope?.session===message.session);native={method:'cancel-performance',session:message.session};}
        else{const owner=validOwner(message);cancelled.add(owner.key);cancel(op=>op.scope?.key===owner.key);native={method:'cancel-owner',session:owner.session,owner:owner.owner};}
        send(native);void synth.flush().catch(error=>{if(!closed&&error?.name!=='AbortError')synth.reportAsyncError(error);});
      }catch(error){if(error?.name!=='AbortError')synth.reportAsyncError(error);}return;
    }
    void execute(message).then(value=>{if(!closed&&message.id!==undefined)reply.postMessage({id:message.id,value});},error=>{if(!closed&&message.id!==undefined)reply.postMessage({id:message.id,error:String(error.message??error),name:error.name});else if(!closed&&error?.name!=='AbortError')synth.reportAsyncError(error);});
  }
  const client={_getState:()=>({...cached}),dispose(){}};
  return {client,
    connect(){if(connection)throw new Error('Native SPC endpoint is already connected');connection={command:new MessageChannel(),control:new MessageChannel()};for(const channel of [connection.command,connection.control]){channel.port1.onmessage=({data})=>receive(data,channel.port1);channel.port1.start?.();}return {port:connection.command.port2,node:{port:connection.control.port2}};},
    async initialize(){const token=capture();context.enable('spc');if(initialized)return;const op=operation();try{await snapshot(op);current(token);initialized=true;}finally{operations.delete(op);}},
    async mix(volume=1,pan=0){if(!Number.isFinite(volume)||volume<0||volume>4||!Number.isFinite(pan)||Math.abs(pan)>1)throw new RangeError('Invalid SPC mix');const op=operation();try{await transmit({method:'mix',volume,pan},op);}finally{operations.delete(op);}},
    reset(){closed=true;cancel(()=>true);loadVersion++;seekVersion++;activeSeek=null;observing=false;eventVersion++;clearTimeout(eventTimer);eventTimer=null;context.invalidate();context.disable('spc');if(connection)for(const channel of [connection.command,connection.control])for(const port of [channel.port1,channel.port2]){port.onmessage=null;port.close();}connection=null;owners.clear();cancelled.clear();},
  };
}
export async function createNativeGenesisExtraSpc(synth,options={}){const device=await createNativeGenesisExtraChip(synth,{...options,bridge:undefined,kind:'spc',label:'SPC file player',createEndpoint:createNativeGenesisExtraSpcEndpoint});Object.assign(device,device.endpoint.connect(),{sampleRate:synth.clock.sampleRate,nativeSampleRate:32000});return device;}
