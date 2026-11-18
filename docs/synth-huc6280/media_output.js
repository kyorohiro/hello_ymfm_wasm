// SPDX-License-Identifier: BSD-3-Clause
// Endpoint-local software edges. The native media clock and source Mixer stay
// untouched; a retired endpoint can never fade a newer endpoint or another chip.
const hostSetTimeout=globalThis.setTimeout.bind(globalThis);
const hostClearTimeout=globalThis.clearTimeout.bind(globalThis);
const aborted=()=>new DOMException('Media output operation cancelled','AbortError');
export function readMediaReleaseSeconds(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='releaseSeconds'))throw TypeError('Expected media release options');
  const seconds=options.releaseSeconds??0;
  if(!Number.isFinite(seconds)||seconds<0||seconds>.05)throw RangeError('Media release must be 0..0.05 seconds');
  return seconds;
}
export function createPceMediaOutput(context,source,input){
  const node=context.createGain(),waits=new Set();let dead=false;
  let ramp={from:1,to:1,start:context.currentTime,end:context.currentTime};
  node.gain.value=1;source.connect(node);node.connect(input);
  function value(at){return ramp.end<=ramp.start||at>=ramp.end?ramp.to:at<=ramp.start?ramp.from:ramp.from+(ramp.to-ramp.from)*(at-ramp.start)/(ramp.end-ramp.start);}
  function change(to,seconds){
    if(dead)throw aborted();
    const at=context.currentTime,from=value(at),parameter=node.gain;
    parameter.cancelScheduledValues(at);parameter.setValueAtTime(from,at);
    if(seconds)parameter.linearRampToValueAtTime(to,at+seconds);else parameter.setValueAtTime(to,at);
    ramp={from,to,start:at,end:at+seconds};return ramp.end;
  }
  function wait(deadline,signal){
    signal?.throwIfAborted();
    return new Promise((resolve,reject)=>{
      const item={timer:null,finish:null};
      const finish=reason=>{if(!waits.delete(item))return;hostClearTimeout(item.timer);signal?.removeEventListener('abort',cancel);reason?reject(reason):resolve();};
      const cancel=()=>finish(signal.reason??aborted());item.finish=finish;waits.add(item);
      function poll(){
        if(context.state!=='running'){change(0,0);finish();return;}
        if(context.currentTime>=deadline){finish();return;}
        item.timer=hostSetTimeout(poll,Math.max(1,Math.min(20,Math.ceil((deadline-context.currentTime)*1000))));
      }
      signal?.addEventListener('abort',cancel,{once:true});poll();
    });
  }
  return{node,
    open(seconds=.004){change(1,seconds);},
    async fadeOut(seconds=.004,{signal}={}){signal?.throwIfAborted();const deadline=change(0,context.state==='running'?seconds:0);await wait(deadline,signal);if(dead)throw aborted();signal?.throwIfAborted();},
    dispose(){if(dead)return;dead=true;for(const item of [...waits])item.finish(aborted());try{node.disconnect();}catch{}},
  };
}
