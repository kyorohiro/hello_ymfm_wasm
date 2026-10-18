/**
 * Browser AudioWorklet / Node. Named JavaScript effects applied after native FX,
 * in registration order. User code must be synchronous and bounded.
 */
export class LiveFX {
  constructor(rate) { this.rate=rate; this.effects=new Map(); this.hasProcessed=false; this.buffers=new Map(); }
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
    if(this.effects.size===0)return;
    if(!this.input||this.input.length!==channels.length||this.input[0].length!==n){
      let lengths=this.buffers.get(channels.length);
      if(!lengths){lengths=new Map();if(channels.length<=2)this.buffers.set(channels.length,lengths);}
      let buffers=lengths.get(n);
      if(!buffers){
        buffers={input:channels.map(()=>new Float32Array(n)),output:channels.map(()=>new Float32Array(n))};
        // A render quantum can be split at any sample. Cache those bounded
        // lengths; arbitrary standalone block sizes retain only the last size.
        if(n<=128&&channels.length<=2)lengths.set(n,buffers);
      }
      this.input=buffers.input;this.output=buffers.output;
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
            // A DSP may sanitize a nonfinite source sample. Multiplying the
            // original NaN/Infinity by zero would poison its valid wet output.
            if(wet===1)channels[ch][i]=processed;
            else{
              const source=this.input[ch][i],dry=Number.isFinite(source)?source:0;
              channels[ch][i]=dry*(1-wet)+processed*wet;
            }
          }
          if(e.fadeRemaining>0)e.fadeRemaining--;
        }
      }catch(error){e.bypass=true;report('[liveFx:'+name+'] '+(error?.stack??String(error))+'\nEffect bypassed. Fix the code and Apply to retry.');}
      observe?.(name,this.input,channels);
    }
  }
}
