// App-private Event Rec host. The shared RF5C164 core / SDK worklet are unchanged.
import {Rf5c164} from '../js/rf5c164.js?v=audio-stability-2';
import factory from '../generated/rf5c164_wasm.js';
import {RF5C164Synth,RF5C164DirectTransport} from '../js/rf5c164synth.js?v=audio-stability-2';
import {createSynthPcmRecordingPlayer} from './synth_pcm_recording_player.js?v=pcm-release-1';
import {createSynthPcmRelease} from './synth_pcm_release.js?v=pcm-release-1';

class SynthPcmRecordingProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();this.chip=null;this.player=null;this.release=null;this.dead=false;
    this.renderChip=this.renderChip.bind(this);
    this.port.onmessage=({data})=>this.receive(data);
    Rf5c164.create({moduleFactory:factory,moduleOptions:{wasmBinary:options.processorOptions.wasmBinary},sampleRate}).then(chip=>{
      if(this.dead){chip.dispose();return;}
      this.chip=chip;
      const pcm=new RF5C164Synth({transport:new RF5C164DirectTransport(chip)});
      this.release=createSynthPcmRelease({pcm,sampleRate,renderAudio:this.renderChip});
      this.player=createSynthPcmRecordingPlayer({sampleRate,pcm:this.release.pcm,
        onEnded:session=>this.port.postMessage({type:'pcm-recording-ended',session})});
      this.port.postMessage({ready:true});
    }).catch(error=>this.fail(error));
  }
  receive(data) {
    if(this.dead)return;
    if(data?.method==='dispose'){this.dispose();return;}
    try {
      if(!this.player)throw Error('PCM Event Rec is not ready');
      const args=data?.args??[];let value;
      if(data?.method==='playRecording')value=this.player.play(args[1],{session:args[0],loop:args[2]?.loop??false});
      else if(data?.method==='stopRecording')value=this.player.stop(args[0]);
      else throw Error('Unknown PCM Event Rec command');
      if(data.id!==undefined)this.port.postMessage({id:data.id,value});
    } catch(error) {
      // Invalid transfers keep the existing sound alive. Rendering failures
      // are fatal and retire the owner through the ordinary endpoint watcher.
      if(data?.id!==undefined)this.port.postMessage({id:data.id,error:error.message});
    }
  }
  renderChip(left,right) {
    const output=this.chip.generateStereo(left.length);left.set(output.left);right.set(output.right);
  }
  dispose() {if(this.dead)return;this.player?.stop();this.dead=true;this.player=null;this.release=null;this.chip?.dispose();this.chip=null;}
  fail(error) {this.dispose();this.port.postMessage({error:error.message,fatal:true});}
  process(inputs,outputs) {
    if(this.dead)return false;
    try {
      const [left,right]=outputs[0];
      if(this.player)this.player.render(left,right,this.release.render);else{left.fill(0);right.fill(0);}
      return true;
    } catch(error) {outputs[0].forEach(channel=>channel.fill(0));this.fail(error);return false;}
  }
}
registerProcessor('tetorica-synth-pcm-recording',SynthPcmRecordingProcessor);
