import {encodeNativeLiveFxContext,decodeNativeLiveFxContext} from './native_livefx_context.js';

export const NATIVE_LIVEFX_COMMAND_BYTES=256*1024;
const CONTEXT_BYTES=128*1024;
const utf8=new TextEncoder();

/** The same public liveFx API, with explicit portable context and wire bounds. */
export function nativeGenesisLiveFxMessage(message) {
  if(message?.op!=='live-fx'||!['register','context','remove','clear'].includes(message.action))throw new TypeError('Invalid Native liveFx command');
  const result={op:'live-fx',action:message.action};
  if(message.action!=='clear') {
    if(typeof message.name!=='string'||!message.name.length||utf8.encode(message.name).byteLength>128)throw new RangeError('Native liveFx name must contain 1 to 128 UTF-8 bytes');
    result.name=message.name;
  }
  if(message.action==='register') {
    if(typeof message.source!=='string'||!message.source.length)throw new TypeError('Native liveFx requires a function source');
    if(utf8.encode(message.source).byteLength>192*1024)throw new RangeError('Native liveFx source exceeds 192 KiB');
    result.source=message.source;result.resetState=Boolean(message.resetState);
  }
  if(message.action==='register'||message.action==='context') {
    if(Object.prototype.hasOwnProperty.call(message,'contextGraph')) {
      // A Worker controller has already encoded this context. Validate it
      // before transport, then retain its graph rather than encoding it twice.
      decodeNativeLiveFxContext(message.contextGraph,{maxBytes:CONTEXT_BYTES});
      result.contextGraph=structuredClone(message.contextGraph);
    } else result.contextGraph=encodeNativeLiveFxContext(message.context??{},{maxBytes:CONTEXT_BYTES});
  }
  if(utf8.encode(JSON.stringify(result)).byteLength>NATIVE_LIVEFX_COMMAND_BYTES)throw new RangeError('Native liveFx command exceeds 256 KiB');
  return result;
}

const empty=()=>Object.freeze({active:0,initialized:false,latencyFrames:0,blockFrames:128,underruns:0,overruns:0,queuedCommands:0,error:null});
/** Low-frequency control diagnostics. Does not share the audio command queue,
 * reanchor its clock, transfer PCM or create an AudioContext/AudioNode. */
export function createNativeGenesisLiveFxStatus({invoke,getSession,getGeneration,isReady,
  onChange=()=>{},onError=()=>{},now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  let current=empty(),timer=null,inflight=null,watching=false,epoch=0,watchRevision=0,watchUntil=0;
  const seen=new Set();
  const report=message=>{
    if(seen.has(message))return;
    seen.add(message);if(seen.size>64)seen.delete(seen.values().next().value);
    onError(message);
  };
  const schedule=(delay=250)=>{
    if(!watching||timer!==null||inflight||!isReady())return;
    timer=setTimer(()=>{timer=null;void poll();},delay);timer?.unref?.();
  };
  function observe(status,revision=watchRevision) {
    if(revision!==watchRevision||status?.session!==getSession()||!status.liveFx)return;
    const data=status.liveFx;
    const integer=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
    if(!integer(data.active,8)||!integer(data.latencyFrames,65536)||!integer(data.underruns)||!integer(data.overruns)||
        data.error!=null&&(typeof data.error!=='string'||data.error.length>16384)||
        data.reports!==undefined&&(!Array.isArray(data.reports)||data.reports.length>64||data.reports.some(value=>typeof value!=='string'||value.length>16384))) {
      report('Native liveFx returned invalid diagnostics');return;
    }
    const next=Object.freeze({active:data.active,initialized:Boolean(data.initialized),latencyFrames:data.latencyFrames,
      blockFrames:integer(data.blockFrames,4096)&&data.blockFrames?data.blockFrames:128,
      underruns:data.underruns,overruns:data.overruns,queuedCommands:integer(data.queuedCommands)?data.queuedCommands:0,error:data.error??null});
    const changed=Object.keys(next).some(key=>current[key]!==next[key]);current=next;
    if(changed)onChange(next);
    for(const message of [...(data.reports??[]),...(data.error?[data.error]:[])])report(message);
    if(!next.active&&!next.latencyFrames&&!next.queuedCommands&&now()>=watchUntil) {
      watching=false;if(timer!==null){clearTimer(timer);timer=null;}
    }
  }
  async function poll() {
    if(inflight||!watching||!isReady())return;
    const version=epoch,revision=watchRevision,session=getSession(),generation=getGeneration();
    const request=Promise.resolve().then(()=>invoke('native_genesis_status',{session}));inflight=request;
    const valid=()=>version===epoch&&session===getSession()&&generation===getGeneration()&&isReady();
    try{const status=await request;if(valid())observe(status,revision);}
    catch(error){if(valid()&&error?.name!=='AbortError')report(`Native liveFx diagnostics: ${error.message??String(error)}`);}
    finally{if(inflight===request)inflight=null;schedule();}
  }
  return {
    get status(){return current;},observe,
    // Call after command admission. queuedCommands keeps future work watched;
    // a canceled future command must not leave a timer running until its date.
    track() {
      // A status snapshot can straddle completion of the first compilation.
      // Brief wall-clock grace also observes its later error/activation report.
      ++watchRevision;watchUntil=now()+1000;watching=true;schedule(0);
    },
    reset() {
      ++epoch;++watchRevision;watching=false;watchUntil=0;seen.clear();
      if(timer!==null){clearTimer(timer);timer=null;}
      current=empty();onChange(current);
    },
    poll,
  };
}
