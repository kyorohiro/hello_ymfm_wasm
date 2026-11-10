// App-private raw PCM layer mixer. No native chip, JSON decoder or audio device.
import {createSynthPcmLoopPlayer,normalizeSynthPcmLoopConfig,normalizeSynthPcmPreparedLoopUnit,
  PCM_LOOP_MAX_UNITS,PCM_LOOP_MAX_PCM_BYTES} from './synth_pcm_loop_player.js?v=pcm-looper-1';
const positive=value=>{if(!Number.isSafeInteger(value)||value<1)throw new TypeError('Invalid PCM loop token / session');return value;};
export class SynthPcmLoopProcessor extends AudioWorkletProcessor {
  constructor() {
    super();this.dead=false;this.latestSession=0;this.renderedFrames=0;this.configuration=null;
    this.player=createSynthPcmLoopPlayer({sampleRate});this.prepared=new Map();this.preparedBytes=0;
    this.port.onmessage=({data})=>this.receive(data);this.port.postMessage({ready:true});
  }
  absoluteFrame() {return typeof currentFrame==='number'?currentFrame:this.renderedFrames;}
  discard(token) {const entry=this.prepared.get(token);if(!entry)return false;this.prepared.delete(token);this.preparedBytes-=entry.bytes;return true;}
  clearPrepared() {this.prepared.clear();this.preparedBytes=0;}
  receive(data) {
    if(this.dead)return;
    if(data?.method==='dispose'){this.dispose();return;}
    try {
      const args=data?.args??[];let value;
      switch(data?.method) {
        case 'prepareLooperUnit': {
          const token=positive(args[0]),packet=args[1];
          if(this.prepared.has(token))throw Error('PCM loop token already exists');
          const config=normalizeSynthPcmLoopConfig({loopLength:packet?.loopLength,startTime:0},{sampleRate});
          const normalized=normalizeSynthPcmPreparedLoopUnit(packet?.unit,{sampleRate,loopLength:config.loopLength});
          const unit={...normalized,frameCount:packet.unit.frameCount,prefixCount:packet.unit.prefixCount};
          const active=this.player.snapshot(),bytes=unit.left.byteLength+unit.right.byteLength;
          if(active.units.some(entry=>entry.id===unit.id)||[...this.prepared.values()].some(entry=>entry.unit.id===unit.id))throw Error('PCM loop unit already exists');
          if(active.units.length+this.prepared.size>=PCM_LOOP_MAX_UNITS||active.byteLength+this.preparedBytes+bytes>PCM_LOOP_MAX_PCM_BYTES)throw RangeError('PCM loop PCM storage limit reached');
          this.prepared.set(token,{unit,loopLength:config.loopLength,bytes});this.preparedBytes+=bytes;value=true;break;
        }
        case 'discardLooperUnit':value=this.discard(positive(args[0]));break;
        case 'startLooper': {
          const session=positive(args[0]);
          if(session<=this.latestSession){value=false;break;}
          const config=normalizeSynthPcmLoopConfig(args[1],{sampleRate}),tokens=args[2]??[];
          if(!Array.isArray(tokens)||tokens.length>PCM_LOOP_MAX_UNITS||new Set(tokens).size!==tokens.length)throw TypeError('Invalid PCM initial loop tokens');
          const units=tokens.map(token=>{
            const entry=this.prepared.get(positive(token));
            if(!entry||entry.loopLength!==config.loopLength)throw TypeError('PCM loop token has not been prepared for this length');
            return entry.unit;
          });
          // Validate the entire initial batch before replacing the audible set.
          const next=createSynthPcmLoopPlayer({sampleRate}),frame=this.absoluteFrame();
          next.start(config,{session,currentFrame:frame});
          for(const unit of units)next.addPrepared(session,unit,{currentFrame:frame});
          this.player.stop();this.player=next;this.latestSession=session;this.configuration=config;
          for(const token of tokens)this.discard(token);value=true;break;
        }
        case 'addPreparedLooperUnit': {
          const session=positive(args[0]),token=positive(args[1]);
          if(session!==this.latestSession||!this.player.snapshot().playing){value=false;break;}
          const entry=this.prepared.get(token);
          if(!entry||entry.loopLength!==this.configuration.loopLength)throw TypeError('PCM loop token has not been prepared for this length');
          value=this.player.addPrepared(session,entry.unit,{currentFrame:this.absoluteFrame()});
          if(value)this.discard(token);break;
        }
        case 'removeLooperUnit':value=this.player.remove(positive(args[0]),args[1]);break;
        case 'stopLooper': {
          const session=positive(args[0]);
          if(session<this.latestSession){value=false;break;}
          this.latestSession=session;this.player.stop(session);this.configuration=null;this.clearPrepared();value=true;break;
        }
        default:throw Error('Unknown PCM loop command');
      }
      if(data.id!==undefined)this.port.postMessage({id:data.id,value});
    } catch(error) {if(data?.id!==undefined)this.port.postMessage({id:data.id,error:error.message});}
  }
  dispose() {if(this.dead)return;this.dead=true;this.player.stop();this.configuration=null;this.clearPrepared();}
  process(inputs,outputs) {
    if(this.dead)return false;
    const [left,right]=outputs[0];left.fill(0);right.fill(0);
    try {const frame=this.absoluteFrame();this.player.render(left,right,frame);this.renderedFrames=frame+left.length;return true;}
    catch(error){left.fill(0);right.fill(0);this.dispose();this.port.postMessage({error:error.message,fatal:true});return false;}
  }
}
registerProcessor('tetorica-synth-pcm-looper',SynthPcmLoopProcessor);
