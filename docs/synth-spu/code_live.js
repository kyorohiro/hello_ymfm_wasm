// SPDX-License-Identifier: BSD-3-Clause
// Passive, bounded observation of the Code-owned SPU. This module never
// acquires a Code client, creates audio, or changes the authored instrument.
const nativeSchedule=globalThis.setTimeout.bind(globalThis);
const nativeCancel=globalThis.clearTimeout.bind(globalThis);
const copy=value=>value===null?null:structuredClone(value);

export function createSpuCodeLive({getAudio,isRunning,onUpdate=()=>{},schedule=nativeSchedule,cancel=nativeCancel,intervalMs=50}={}) {
  for(const fn of [getAudio,isRunning,onUpdate,schedule,cancel])if(typeof fn!=='function')throw new TypeError('SPU Code Live needs host callbacks');
  if(!Number.isFinite(intervalMs)||intervalMs<50)throw new RangeError('SPU Code Live interval must be at least 50 ms');
  let disposed=false,enabled=true,voice=0,epoch=0,owner=null,running=false,timer=null,inFlight=null;
  let snapshot=null,error='',waiting=false;
  const read=()=>({liveKind:'code',liveEnabled:enabled,liveVoice:voice,liveActive:Boolean(running&&enabled&&snapshot&&!error),
    liveWaiting:Boolean(running&&enabled&&waiting),liveState:copy(snapshot),liveError:Boolean(error),liveMessage:error,
    liveSource:{name:'Code'},playing:running,paused:false});
  const notify=()=>{if(!disposed)onUpdate(read());};
  const clearTimer=()=>{if(timer!==null){cancel(timer);timer=null;}};
  const current=(token,engine)=>!disposed&&running&&enabled&&token===epoch&&engine===owner&&engine===getAudio()&&isRunning();
  function queue(delay=intervalMs){
    if(disposed||!running||!enabled||!owner||timer!==null||inFlight)return;
    timer=schedule(()=>{timer=null;void poll();},delay);
  }
  async function poll(){
    if(disposed||!running||!enabled||!owner||inFlight)return;
    const engine=owner,token=epoch,request={engine,token};inFlight=request;
    try{
      const value=await engine.command('observeCode');
      if(!current(token,engine))return;
      if(value!==null&&(!value||typeof value!=='object'))throw new TypeError('SPU Code observation did not return a state');
      snapshot=copy(value);waiting=value===null;error='';notify();
    }catch(cause){
      if(!current(token,engine))return;
      if(cause?.name==='AbortError'){snapshot=null;waiting=true;error='';}
      else{waiting=false;error=`Code Live observation failed: ${cause?.message??String(cause)}`;}
      notify();
    }finally{
      if(inFlight===request)inFlight=null;
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
    if(typeof value!=='boolean')throw new TypeError('SPU Code Live enabled must be boolean');
    if(disposed||enabled===value)return read();
    enabled=value;epoch++;clearTimer();snapshot=null;error='';waiting=Boolean(running&&enabled);notify();sync(false);return read();
  }
  function setVoice(value){
    if(!Number.isInteger(value)||value<0||value>23)throw new RangeError('SPU Code Live channel must be an integer 0..23');
    if(disposed||voice===value)return read();
    voice=value;notify();return read();
  }
  return {read,sync,setEnabled,setVoice,dispose(){if(disposed)return;disposed=true;epoch++;clearTimer();running=false;owner=null;snapshot=null;error='';}};
}
