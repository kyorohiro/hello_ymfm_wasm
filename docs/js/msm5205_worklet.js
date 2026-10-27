// Original Tetorica transport. BSD-3-Clause; see LICENSE.
import {createMSM5205PCM} from './msm5205_pcm.js?v=pcengine-cd-1';
class Msm5205Processor extends AudioWorkletProcessor{
  constructor(options){super();this.queue=[];this.order=0;this.dead=false;this.failed=null;this.pan=0;
    this.ready=createMSM5205PCM({sampleRate,wasmBinary:options.processorOptions.wasmBinary,clock:1536000}).then(core=>{if(this.dead){core.dispose();return;}this.core=core;core.stop();}).catch(error=>{this.failed=error;});
    this.port.onmessage=({data})=>{this.receive(data).catch(error=>this.reply(data.id,undefined,error));};
  }
  reply(id,value,error){if(id!==undefined)this.port.postMessage({id,value,...(error?{error:String(error.message??error)}:{})});}
  status(){const s=this.core?.readState?.()??this.core?.status?.()??{};return {...s,volume:s.gain,mute:s.muted,pan:this.pan,outputFrame:this.clockFrame??currentFrame};}
  async receive({id,action:a}){
    if(a?.type==='dispose'){this.dead=true;this.queue=[];this.core?.dispose?.();return;}
    await this.ready;if(this.dead)throw new Error('MSM5205 endpoint closed');if(this.failed)throw this.failed;
    if(a.type==='prepare'){
      if(!(a.data instanceof Uint8Array)||!a.data.length||a.data.length>65536)throw new RangeError('Invalid MSM5205 ADPCM data');
      this.queue=this.queue.filter(item=>{if(item.action.type==='mix')return true;this.reply(item.id,undefined,new Error('MSM5205 sample replaced'));return false;});
      this.core.prepare(a.data);this.reply(id,this.status());return;
    }
    if(a.type==='state'||a.type==='ready'){this.reply(id,this.status());return;}
    if(!['play','stop','reset','mix','write-register'].includes(a.type))throw new Error('Unknown MSM5205 action');
    if(a.frame!==undefined&&(!Number.isSafeInteger(a.frame)||a.frame<0))throw new RangeError('Invalid MSM5205 output frame');
    if(a.type==='mix'&&(a.volume!==undefined&&(!Number.isFinite(a.volume)||a.volume<0||a.volume>16)||a.mute!==undefined&&typeof a.mute!=='boolean'||a.pan!==undefined&&(!Number.isFinite(a.pan)||a.pan< -1||a.pan>1)))throw new RangeError('Invalid MSM5205 mix');
    if(a.type==='write-register'&&(!Number.isInteger(a.register)||a.register<0||a.register>7||!Number.isInteger(a.value)||a.value<0||a.value>15))throw new RangeError('Invalid MSM5205 register write');
    if(a.type==='play'){
      const bytes=this.status().sourceBytes,offset=a.offset??0,length=a.length??bytes*2-offset,rate=a.rate??15;
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||offset+length>bytes*2||!Number.isInteger(rate)||rate<0||rate>15||a.loop!==undefined&&typeof a.loop!=='boolean')throw new RangeError('Invalid MSM5205 playback');
    }
    if(['stop','reset'].includes(a.type)&&(a.frame===undefined||a.frame<=currentFrame)){this.queue=this.queue.filter(item=>{if(item.action.type==='mix')return true;this.reply(item.id,undefined,new Error('MSM5205 stopped'));return false;});}
    if(this.queue.length>=256)throw new Error('MSM5205 command queue is full');
    const entry={id,action:a,frame:a.frame??currentFrame,order:++this.order};let i=this.queue.length;while(i&&this.queue[i-1].frame>entry.frame)i--;this.queue.splice(i,0,entry);
    if(entry.frame>currentFrame){this.reply(id,{...this.status(),scheduled:true,scheduledFrame:entry.frame});entry.id=undefined;}
  }
  apply(item){const a=item.action;try{
    if(['stop','reset'].includes(a.type))this.queue=this.queue.filter(queued=>{if(queued.order<item.order&&queued.action.type!=='mix'){this.reply(queued.id,undefined,new Error('MSM5205 stopped'));return false;}return true;});
    if(a.type==='mix'){if(a.volume!==undefined)this.core.setGain(a.volume);if(a.mute!==undefined)this.core.setMuted(a.mute);if(a.pan!==undefined)this.pan=a.pan;}
    else if(a.type==='play')this.core.play(a);
    else if(a.type==='write-register')this.core.writeRegister(a.register,a.value);
    else {this.core[a.type]();if(a.type==='reset'&&!this.core.readState().sourceBytes)this.core.stop();}
    this.reply(item.id,this.status());
  }catch(error){if(item.id===undefined)this.port.postMessage({type:'msm5205-error',error:String(error.message??error)});else this.reply(item.id,undefined,error);}}
  process(_inputs,outputs){if(this.dead)return false;const [left,right]=outputs[0];if(!this.core)return true;let offset=0;
    while(offset<left.length){this.clockFrame=currentFrame+offset;while(this.queue[0]?.frame<=this.clockFrame)this.apply(this.queue.shift());const end=Math.min(left.length,(this.queue[0]?.frame??Infinity)-currentFrame);
      if(end>offset){this.core.render(offset===0&&end===left.length?left:left.subarray(offset,end),offset===0&&end===right.length?right:right.subarray(offset,end),end-offset);
        if(this.pan)for(let i=offset;i<end;i++){left[i]*=1-Math.max(0,this.pan);right[i]*=1+Math.min(0,this.pan);}}
      offset=end;
    }this.clockFrame=currentFrame+left.length;return true;
  }
}
registerProcessor('tetorica-msm5205',Msm5205Processor);
