// Original Tetorica code. BSD-3-Clause; see LICENSE.
import {createCDDAPCM} from './cdda_pcm.js?v=cdda-pcm-1';
class CddaProcessor extends AudioWorkletProcessor{
  constructor(options){super();this.queue=[];this.order=0;this.dead=false;this.track=null;this.failed=null;
    this.ready=createCDDAPCM({sampleRate,wasmBinary:options.processorOptions.wasmBinary}).then(core=>{this.core=core;}).catch(error=>{this.failed=error;});
    this.port.onmessage=({data})=>{this.receive(data).catch(error=>this.reply(data.id,undefined,error));};
  }
  reply(id,value,error){if(id!==undefined)this.port.postMessage({id,value,...(error?{error:String(error.message??error)}:{})});}
  async receive({id,action:a}){
    if(a?.type==='dispose'){this.dead=true;this.queue=[];this.core?.dispose?.();return;}
    await this.ready;if(this.dead)throw new Error('CD-DA endpoint closed');if(this.failed)throw this.failed;
    if(a.type==='prepare'){
      for(const item of this.queue)this.reply(item.id,undefined,new Error('CD-DA track replaced'));this.queue=[];
      await this.core.prepare(a.pcm);if(this.dead)return;this.track=a.track;this.reply(id,this.status());return;
    }
    if(a.type==='ready'||a.type==='state'){this.reply(id,this.status());return;}
    if(!['play','pause','resume','stop','seek','mix'].includes(a.type))throw new Error('Unknown CD-DA action');
    if(a.type==='mix'&&(a.pan!==undefined&&(!Number.isFinite(a.pan)||a.pan< -1||a.pan>1)))throw new RangeError('Invalid CD-DA pan');
    if(a.type==='mix'&&(a.volume!==undefined&&(!Number.isFinite(a.volume)||a.volume<0||a.volume>16)||a.mute!==undefined&&typeof a.mute!=='boolean'))throw new RangeError('Invalid CD-DA volume/mute');
    if((a.type==='seek'||a.type==='play'&&a.sourceFrame!==undefined)&&(!Number.isSafeInteger(a.sourceFrame)||a.sourceFrame<0||a.sourceFrame>this.core.status().durationFrames))throw new RangeError('CD-DA position is outside the track');
    if(a.type==='play'&&!this.core.status().durationFrames)throw new Error('Load a CD-DA track before playback');
    if(a.frame!==undefined&&(!Number.isSafeInteger(a.frame)||a.frame<0))throw new RangeError('Invalid CD-DA output frame');
    if(a.type==='stop'&&(a.frame===undefined||a.frame<=currentFrame)){for(const item of this.queue)this.reply(item.id,undefined,new Error('CD-DA playback stopped'));this.queue=[];}
    if(this.queue.length>=256)throw new Error('CD-DA command queue is full');
    const entry={id,action:a,frame:a.frame??currentFrame,order:++this.order};let i=this.queue.length;while(i&&this.queue[i-1].frame>entry.frame)i--;this.queue.splice(i,0,entry);
    if(entry.frame>currentFrame){this.reply(id,{...this.status(),scheduled:true,scheduledFrame:entry.frame});entry.id=undefined;}
  }
  status(){const status=this.core?.status?.()??{state:'empty',positionFrames:0,durationFrames:0};return {...status,positionSeconds:(status.positionFrames+(status.phase??0)/(status.sampleRate??sampleRate))/44100,durationSeconds:status.durationFrames/44100,volume:status.gain,mute:status.muted,track:this.track,outputFrame:this.clockFrame??currentFrame};}
  apply(item){const a=item.action;try{
    if(a.type==='stop'){this.queue=this.queue.filter(queued=>{if(queued.order<item.order){this.reply(queued.id,undefined,new Error('CD-DA playback stopped'));return false;}return true;});}
    if(a.type==='mix'){if(a.volume!==undefined)this.core.setGain(a.volume);if(a.mute!==undefined)this.core.setMuted(a.mute);this.pan=a.pan??this.pan??0;}
    else if(a.type==='play'){this.core.play();if(a.sourceFrame)this.core.seek(a.sourceFrame);}
    else if(a.type==='seek')this.core.seek(a.sourceFrame);else this.core[a.type]();
    this.reply(item.id,this.status());
  }catch(error){if(item.id===undefined)this.port.postMessage({type:'cdda-error',error:String(error.message??error)});else this.reply(item.id,undefined,error);}}
  process(_inputs,outputs){const [left,right]=outputs[0];if(this.dead)return false;if(!this.core)return true;
    let offset=0;while(offset<left.length){this.clockFrame=currentFrame+offset;while(this.queue[0]?.frame<=currentFrame+offset)this.apply(this.queue.shift());
      const end=Math.min(left.length,(this.queue[0]?.frame??Infinity)-currentFrame);
      // Reusable output views avoid changing the core's sample clock. At most
      // 256 queued controls can split a quantum; ordinary playback is one call.
      if(end>offset){const l=offset===0&&end===left.length?left:left.subarray(offset,end),r=offset===0&&end===right.length?right:right.subarray(offset,end);this.core.render(l,r,end-offset);
        const pan=this.pan??0,lg=1-Math.max(0,pan),rg=1+Math.min(0,pan);if(pan)for(let i=offset;i<end;i++){left[i]*=lg;right[i]*=rg;}}
      offset=end;
    }
    this.clockFrame=currentFrame+left.length;return true;
  }
}
registerProcessor('tetorica-cdda',CddaProcessor);
