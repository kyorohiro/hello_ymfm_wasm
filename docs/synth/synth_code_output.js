// Capture trusted timers before user Code installs its execution guards.
const nativeSetTimer=globalThis.setTimeout.bind(globalThis);
const nativeClearTimer=globalThis.clearTimeout.bind(globalThis);
const nativeNow=globalThis.performance?.now.bind(globalThis.performance)??Date.now.bind(Date);

export const CODE_STOP_FADE_SECONDS=.008;
const OPEN_FADE_SECONDS=.004;
const MAX_STOP_WAIT_MS=100;

/**
 * Smooth the dedicated Code output gate after FX and before the final output.
 * Await fadeOut BEFORE releasing notes, resetting chips, or disposing FX.
 * The caller opens the route only after that physical cleanup has completed.
 * This gate is independent of the author's Master and per-chip volume gains.
 */
export function createSynthCodeOutput({getContext,getGain,setTimer=nativeSetTimer,
  clearTimer=nativeClearTimer,nowMs=nativeNow}={}) {
  for(const callback of [getContext,getGain,setTimer,clearTimer,nowMs]) {
    if(typeof callback!=='function')throw TypeError('Code output requires host callbacks');
  }
  let state=null,pending=null,disposed=false;
  const time=context=>Number.isFinite(context?.currentTime)?context.currentTime:0;
  const current=()=>{
    const context=getContext(),gain=getGain();
    if(!context||!gain?.gain)return null;
    if(state?.context!==context||state?.gain!==gain) {
      const value=Math.max(0,Math.min(1,Number(gain.gain.value)||0));
      state={context,gain,mode:value===0?'closed':'open',from:value,to:value,start:time(context),end:time(context)};
    }
    return state;
  };
  const valueAt=(owner,at)=>owner.end<=owner.start||at>=owner.end?owner.to:
    at<=owner.start?owner.from:owner.from+(owner.to-owner.from)*(at-owner.start)/(owner.end-owner.start);
  function setImmediate(owner,value) {
    const at=time(owner.context),parameter=owner.gain.gain;
    parameter.cancelScheduledValues(at);parameter.setValueAtTime(value,at);
    Object.assign(owner,{mode:value===0?'closed':'open',from:value,to:value,start:at,end:at});
  }
  function settle(task,result) {
    if(pending!==task)return;
    pending=null;if(task.timer!==null)clearTimer(task.timer);task.resolve(result);
  }
  function open(options={}) {
    if(disposed)return;
    const notBefore=options?.notBefore??0;
    if(!Number.isFinite(notBefore)||notBefore<0)throw RangeError('Code output start must be a finite nonnegative audio time');
    // An older Stop must never close a route opened by a newer performance.
    if(pending)settle(pending,false);
    const owner=current();if(!owner||!options?.freshInput&&(owner.mode==='open'||owner.mode==='opening'))return;
    const at=time(owner.context),parameter=owner.gain.gain;
    if(owner.context.state!=='running'&&notBefore<=at){setImmediate(owner,1);return;}
    // Let the queued chip reset reach the worklet before revealing its output.
    // A fresh scheduled input can replace an earlier opening ramp. A retained
    // AudioBuffer may start later; fade in with that input rather
    // than opening fully during the silent gap preceding it.
    const start=Math.max(at+128/(owner.context.sampleRate||44100),notBefore),end=start+OPEN_FADE_SECONDS;
    parameter.cancelScheduledValues(at);parameter.setValueAtTime(0,at);
    parameter.setValueAtTime(0,start);parameter.linearRampToValueAtTime(1,end);
    Object.assign(owner,{mode:'opening',from:0,to:1,start,end});
  }
  function fadeOut() {
    if(disposed)return Promise.resolve(true);
    if(pending)return pending.promise;
    const owner=current();if(!owner)return Promise.resolve(true);
    if(owner.mode==='closed')return Promise.resolve(true);
    if(owner.context.state!=='running'){setImmediate(owner,0);return Promise.resolve(true);}
    const at=time(owner.context),from=valueAt(owner,at),end=at+CODE_STOP_FADE_SECONDS,parameter=owner.gain.gain;
    parameter.cancelScheduledValues(at);parameter.setValueAtTime(from,at);parameter.linearRampToValueAtTime(0,end);
    Object.assign(owner,{mode:'closing',from,to:0,start:at,end});
    let resolve;
    const task={owner,end,startedAt:nowMs(),timer:null,promise:new Promise(done=>{resolve=done;}),resolve};
    pending=task;
    const poll=()=>{
      if(pending!==task)return;
      if(getContext()!==owner.context||getGain()!==owner.gain){settle(task,false);return;}
      if(owner.context.state!=='running'||nowMs()-task.startedAt>=MAX_STOP_WAIT_MS) {
        // Suspended or stalled audio cannot render the scheduled ramp. Keep
        // the gate closed so later resume cannot expose the retired program.
        setImmediate(owner,0);settle(task,true);return;
      }
      if(time(owner.context)>=end) {owner.mode='closed';settle(task,true);return;}
      task.timer=setTimer(poll,2);
    };
    task.timer=setTimer(poll,CODE_STOP_FADE_SECONDS*1000);
    return task.promise;
  }
  function dispose() {
    if(disposed)return;
    disposed=true;if(pending)settle(pending,false);
    const owner=current();if(owner)setImmediate(owner,0);
  }
  return {fadeOut,open,dispose};
}
