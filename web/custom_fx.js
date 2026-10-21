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
        const input=channels.map(()=>new Float32Array(n)),output=channels.map(()=>new Float32Array(n));
        // Compatible effects can replace a channel with their own PCM. Retain
        // the rack's storage separately so malformed or replaced references
        // cannot leak into the next effect or render quantum.
        buffers={input,output,inputStorage:input.slice(),outputStorage:output.slice()};
        // A render quantum can be split at any sample. Cache those bounded
        // lengths; arbitrary standalone block sizes retain only the last size.
        if(n<=128&&channels.length<=2)lengths.set(n,buffers);
      }
      this.input=buffers.input;this.output=buffers.output;
      this.inputStorage=buffers.inputStorage;this.outputStorage=buffers.outputStorage;
      this.channelBuffers=buffers;
    }
    for(const [name,e] of this.effects){
      if(e.bypass){observe?.(name,channels,channels);continue;}
      for(let ch=0;ch<channels.length;ch++){this.input[ch].set(channels[ch]);this.output[ch].fill(0);}
      try {
        const result=e.fn(this.input,this.output,e.state,e.context);
        if(result&&typeof result.then==='function')throw new Error('Async process is not supported');
        if(this.input.length!==channels.length||this.output.length!==channels.length)throw new Error('Invalid channel count');
        for(let ch=0;ch<channels.length;ch++){
          if(!(this.input[ch] instanceof Float32Array)||this.input[ch].length!==n)throw new Error('Invalid input channel');
          const channel=this.output[ch];
          if(!(channel instanceof Float32Array)||channel.length!==n)throw new Error('Invalid output channel');
          // Validate the numeric samples mixed below without creating a sample iterator.
          for(let i=0;i<n;i++)if(!Number.isFinite(channel[i]))throw new Error('Non-finite output');
        }
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
      }catch(error){
        e.bypass=true;
        const stack=error?.stack,message=error?.message;
        // Some engines expose stack frames without the Error's message.
        const detail=typeof stack==='string'&&stack.length
          ? typeof message==='string'&&message.length&&!stack.includes(message)?`${error.name??'Error'}: ${message}\n${stack}`:stack
          : String(error);
        report('[liveFx:'+name+'] '+detail+'\nEffect bypassed. Fix the code and Apply to retry.');
      }
      finally{
        try{
          this.input.length=this.output.length=channels.length;
          for(let ch=0;ch<channels.length;ch++){
            this.input[ch]=this.inputStorage[ch];this.output[ch]=this.outputStorage[ch];
          }
        }catch{
          // A callback can also freeze or seal its mutated outer arrays.
          // Recover only in that exceptional path; ordinary rendering never
          // creates replacement channel lists or PCM storage.
          this.input=this.channelBuffers.input=this.inputStorage.slice();
          this.output=this.channelBuffers.output=this.outputStorage.slice();
        }
      }
      observe?.(name,this.input,channels);
    }
  }
}
