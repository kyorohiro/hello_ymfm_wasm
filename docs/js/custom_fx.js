/**
 * Browser AudioWorklet / Node. Named JavaScript effects applied after native FX,
 * in registration order. User code must be synchronous and bounded.
 */
export class LiveFX {
  constructor(rate) { this.rate=rate; this.effects=new Map(); this.hasProcessed=false; }
  command(d) {
    if(typeof d.name!=='string'||!d.name)throw new Error('liveFx requires a name');
    const previous=this.effects.get(d.name);
    if(d.action==='remove'){this.effects.delete(d.name);return;}
    if(d.action==='context'){
      if(!previous)throw new Error('Unknown liveFx: '+d.name);
      previous.context={...previous.context,...d.context};return;
    }
    if(d.action!=='register')throw new Error('Unknown liveFx command');
    if(!previous&&this.effects.size>=8)throw new Error('At most 8 liveFx effects');
    // Function syntax and object method syntax have different source representations.
    let fn;
    try { fn=new Function('"use strict"; return ('+d.source+');')(); }
    catch { fn=new Function('"use strict"; return ({'+d.source+'}).process;')(); }
    if(typeof fn!=='function'||fn.constructor.name!=='Function')throw new Error('process must be a synchronous function');
    this.effects.set(d.name,{fn,context:d.context,state:d.resetState?{}:(previous?.state??{}),bypass:false,
      // Adding an effect to a running rack must not step from dry to wet.
      fadeRemaining:!previous&&this.hasProcessed?Math.max(1,Math.round(this.rate*.005)):0});
  }
  clear(){this.effects.clear();this.hasProcessed=false;}
  process(channels,report,observe) {
    const n=channels[0].length;
    this.hasProcessed=true;
    if(!this.input||this.input.length!==channels.length||this.input[0].length!==n){
      this.input=channels.map(()=>new Float32Array(n));
      this.output=channels.map(()=>new Float32Array(n));
    }
    for(const [name,e] of this.effects){
      if(e.bypass){observe?.(name,channels,channels);continue;}
      for(let ch=0;ch<channels.length;ch++){this.input[ch].set(channels[ch]);this.output[ch].fill(0);}
      try {
        const result=e.fn(this.input,this.output,e.state,e.context);
        if(result&&typeof result.then==='function')throw new Error('Async process is not supported');
        for(const channel of this.output)for(const value of channel)if(!Number.isFinite(value))throw new Error('Non-finite output');
        const fadeFrames=Math.max(1,Math.round(this.rate*.005));
        for(let i=0;i<n;i++){
          const wet=e.fadeRemaining>0?1-e.fadeRemaining/fadeFrames:1;
          for(let ch=0;ch<channels.length;ch++){
            const processed=Math.max(-1,Math.min(1,this.output[ch][i]));
            channels[ch][i]=this.input[ch][i]*(1-wet)+processed*wet;
          }
          if(e.fadeRemaining>0)e.fadeRemaining--;
        }
      }catch(error){e.bypass=true;report(name+': '+error.message);}
      observe?.(name,this.input,channels);
    }
  }
}
