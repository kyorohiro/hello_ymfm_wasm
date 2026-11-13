// SPDX-License-Identifier: BSD-3-Clause
// Bounded, passive observation of the Code-owned physical HuC6280.
export {huc6280CodeLiveView} from './code_state.js';
const nativeSchedule=globalThis.setTimeout.bind(globalThis),nativeCancel=globalThis.clearTimeout.bind(globalThis);
const copy=value=>value===null?null:structuredClone(value);
export function createHuc6280CodeLive({getAudio,isRunning,onUpdate=()=>{},schedule=nativeSchedule,cancel=nativeCancel,intervalMs=50,
  method='observeCode',retainSnapshot=true}={}) {
  for(const fn of [getAudio,isRunning,onUpdate,schedule,cancel])if(typeof fn!=='function')throw new TypeError('HuC6280 Code Live needs host callbacks');
  if(!Number.isFinite(intervalMs)||intervalMs<50)throw new RangeError('HuC6280 Code Live interval must be at least 50 ms');
  if(method!=='observeCode'||typeof retainSnapshot!=='boolean')throw new TypeError('Invalid HuC6280 observation mode');
  let disposed=false,enabled=true,voice=0,epoch=0,owner=null,running=false,timer=null,inFlight=null;
  let snapshot=null,error='',waiting=false,refreshing=null;
  const read=()=>({liveKind:method==='observeEditor'?'editor':'code',liveEnabled:enabled,liveVoice:voice,liveActive:Boolean(running&&(enabled||retainSnapshot)&&snapshot&&!error),
    liveWaiting:Boolean(running&&enabled&&waiting),liveState:copy(snapshot),liveError:Boolean(error),liveMessage:error,
    liveSource:{name:'Code'},playing:running,paused:false});
  const notify=()=>{if(!disposed)onUpdate(read());};
  const clearTimer=()=>{if(timer!==null){cancel(timer);timer=null;}};
  const current=(token,engine,force=false)=>!disposed&&running&&(enabled||force)&&token===epoch&&engine===owner&&engine===getAudio()&&isRunning();
  function queue(delay=intervalMs){
    if(disposed||!running||!enabled||!owner||timer!==null||inFlight)return;
    timer=schedule(()=>{timer=null;void poll();},delay);
  }
  async function poll(force=false){
    if(disposed||!running||!enabled&&!force||!owner||inFlight)return;
    let finish;
    const engine=owner,token=epoch,request={engine,token,done:new Promise(resolve=>finish=resolve)};inFlight=request;
    try{
      const value=await engine.command(method);
      if(!current(token,engine,force))return;
      if(value!==null&&(!value||typeof value!=='object'))throw new TypeError('HuC6280 Code observation did not return a state');
      snapshot=copy(value);waiting=value===null;error='';notify();
    }catch(cause){
      if(!current(token,engine,force))return;
      if(cause?.name==='AbortError'){snapshot=null;waiting=true;error='';}
      else{waiting=false;error=`Code Live observation failed: ${cause?.message??String(cause)}`;}
      notify();
    }finally{
      if(inFlight===request)inFlight=null;
      finish();
      // An old request may finish after Off/Stop or a later Run. Do not let its
      // result repaint that run; only allow its now-current poll to resume.
      if(!disposed){sync(false,false);queue();}
    }
  }
  function sync(emit=true,immediate=true){
    if(disposed)return read();
    const nextRunning=Boolean(isRunning()),nextOwner=nextRunning?getAudio():null;
    if(nextRunning!==running||nextOwner!==owner){
      epoch++;clearTimer();running=nextRunning;owner=nextOwner;snapshot=null;error='';waiting=Boolean(running&&enabled);
      if(emit)notify();
    }
    if(immediate&&running&&enabled&&owner&&!inFlight)queue(0);
    return read();
  }
  function setEnabled(value){
    if(typeof value!=='boolean')throw new TypeError('HuC6280 Code Live enabled must be boolean');
    if(disposed||enabled===value)return read();
    enabled=value;epoch++;clearTimer();if(!retainSnapshot)snapshot=null;error='';waiting=Boolean(running&&enabled&&!snapshot);notify();sync(false);return read();
  }
  function setVoice(value){
    if(!Number.isInteger(value)||value<0||value>5)throw new RangeError('HuC6280 Code Live channel must be an integer 0..5');
    if(disposed||voice===value)return read();
    voice=value;notify();return read();
  }
  function refresh(){
    if(refreshing)return refreshing;
    refreshing=(async()=>{sync(false,false);if(inFlight)await inFlight.done;if(!disposed)await poll(true);return read();})().finally(()=>{refreshing=null;});
    return refreshing;
  }
  // Auto Off retains the last observation; refresh() is an explicit one-shot
  // read used after a deliberate edit, without enabling periodic polling.
  return {read,sync,setEnabled,setVoice,refresh,dispose(){if(disposed)return;disposed=true;epoch++;clearTimer();running=false;owner=null;snapshot=null;error='';}};
}

