// App-private software envelope host. The shared PSG core and SDK worklet are
// unchanged; Envelope Off renders the same chip PCM without envelope writes.
import {SegaPSG,SEGAPSG_CLOCK} from '../js/segapsg.js?v=audio-numeric-bindings-1';
import factory from '../generated/segapsg_wasm.js?v=audio-numeric-bindings-1';
import {createSynthPsgEnvelope} from './synth_psg_envelope.js?v=psg-envelope-1';
import {createSegaPsgApi} from '../js/segapsg_api.js?v=audio-numeric-bindings-1';
import {createSynthPsgVoice} from './synth_psg.js?v=psg-event-rec-1';
import {createSynthPsgRecordingPlayer} from './synth_psg_recording_player.js?v=psg-event-rec-1';
import {createSynthPsgLoopPlayer} from './synth_psg_loop_player.js?v=pcm-looper-1';
import {createPsgTimedProcessor,psgTimedCommandCost} from '../js/segapsg_timed_processor.js';
import {createProcessorPerformance} from '../js/playground_performance_processor.js';

class SynthPsgProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();this.chip=null;this.dead=false;this.remote=null;this.latched=0;
    this.periods=[0,0,0];this.noiseMode=0;this.channelMutes=new Array(4).fill(false);
    this.stereoEnabled=options.processorOptions.stereoEnabled??false;
    this.clock=options.processorOptions.clock??SEGAPSG_CLOCK;
    this.sampleRate=sampleRate;
    this.renderedFrames=0;
    this.attenuations=[0,0,0,0];this.stereo=255;
    const instanceId=`segapsg:${Math.random()}`;
    const nowFrame=()=>this.absoluteFrame();
    this.performance=createProcessorPerformance({chip:'segapsg',nowFrame,rate:sampleRate,
      getPsgLatch:()=>this.latched,getPsgMode:()=>this.noiseMode,trackImmediateNotes:false,
      patternCommandCost:psgTimedCommandCost,
      onDiscard:(command,metadata)=>{if(command.method==='applyPsgTimedOperation')this.timed.discard(command,metadata);},
      apply:(command,port,frame,metadata)=>this.timed.apply(command,port,frame,metadata),
    });
    this.timed=createPsgTimedProcessor({performance:this.performance,nowFrame,sampleRate,
      getState:()=>({clock:this.clock,stereoEnabled:this.stereoEnabled,periods:this.periods,
        attenuations:this.attenuations,latched:this.latched,noiseMode:this.noiseMode,stereo:this.stereo}),
      getConfig:()=>({instanceId,clock:this.clock,stereoEnabled:this.stereoEnabled}),
      dispatch:(command,port,_frame,metadata)=>{
        if(command.method==='setStereo'){this.setStereo(command.args[0]);return;}
        const value=command.args[0],register=command.psgRegister??(value&128?(value>>4)&7:this.latched);
        if((register&1)&&!metadata.preserveOwner)this.envelope.clearVoice(register>>1);
        this.writeByte(value,register,metadata,port);
      },
      retainLevels:levels=>{this.attenuations=[...levels];},
    });
    this.loopPlayer=createSynthPsgLoopPlayer({sampleRate});
    this.envelope=this.createEnvelope();
    this.renderChip=this.renderChip.bind(this);
    this.renderEnvelopes=(left,right)=>this.envelope.render(left,right,this.renderChip);
    this.player=createSynthPsgRecordingPlayer({sampleRate,beginCycle:(settings,pitchClock)=>this.beginRecordingCycle(settings,pitchClock),
      onEnded:session=>this.port.postMessage({type:'psg-recording-ended',session})});
    this.renderPerformance=(left,right)=>this.player.render(left,right,this.renderEnvelopes);
    this.port.onmessage=({data})=>{
      if(data?.port) {
        this.remote?.close();this.timed.clear();this.performance.clear();this.loopPlayer.stop();this.player.stop();this.envelope.stop();
        if(this.dead){data.port.close();return;}
        const remote=this.remote=data.port;
        remote.onmessage=event=>{if(this.remote===remote)this.receive(event.data,remote);};remote.start();
      } else this.receive(data,this.port);
    };
    SegaPSG.create({moduleFactory:factory,moduleOptions:{wasmBinary:options.processorOptions.wasmBinary},sampleRate,
      clock:options.processorOptions.clock??SEGAPSG_CLOCK}).then(chip=>{
      if(this.dead){chip.dispose();return;}
      this.chip=chip;chip.reserveStereoFrames(128);this.port.postMessage({ready:true});
    }).catch(error=>this.fail(error));
  }
  createEnvelope() {
    return createSynthPsgEnvelope({sampleRate:this.sampleRate,
      setAttenuation:(ch,value)=>this.writeByte(0x90|(ch<<5)|value,undefined,undefined,this.port,false)});
  }
  setStereo(mask) {if(this.stereoEnabled){this.chip.setStereo(mask);this.stereo=mask;}}
  writeByte(value,register,metadata,port=this.port,authored=true) {
    if(!this.chip)return;
    // Envelope attenuation writes also change the hardware latch. A tone high
    // byte must restore its intended tone register if a render ran meanwhile.
    if(!(value&128)&&Number.isInteger(register)&&register>=0&&register<8&&register!==this.latched) {
      const low=register&1?value&15:register===6?this.noiseMode:this.periods[register>>1]&15;
      this.chip.write(0x80|(register<<4)|low);this.latched=register;
    }
    if(value&128)this.latched=(value>>4)&7;
    if(!(this.latched&1)) {
      if(this.latched===6)this.noiseMode=value&7;
      else {
        const ch=this.latched>>1;
        this.periods[ch]=value&128?(this.periods[ch]&0x3f0)|(value&15):(this.periods[ch]&15)|((value&63)<<4);
      }
    }
    this.chip.write(value);
    if(authored&&(this.latched&1)) {
      const attenuation=value&15;
      if(attenuation!==15)this.attenuations[this.latched>>1]=attenuation;
      if(!metadata?.preserveOwner)this.timed.observeWrite(this.latched,value,metadata,port);
    }
  }
  resetChip() {
    this.envelope.stop();this.chip.reset();this.latched=0;this.periods.fill(0);this.noiseMode=0;
    this.channelMutes.forEach((muted,ch)=>this.chip.setChannelMuted(ch,muted));
    this.attenuations.fill(0);this.stereo=255;this.envelope=this.createEnvelope();
  }
  beginRecordingCycle(settings,pitchClock) {
    this.resetChip();
    const psg=createSegaPsgApi({clock:this.clock,write:value=>this.writeByte(value)});
    psg.envelopeNoteOn=(ch,envelope,attenuation)=>this.envelope.noteOn(ch,envelope,attenuation);
    psg.envelopeNoteOff=ch=>this.envelope.noteOff(ch);
    psg.stopEnvelopes=()=>this.envelope.stop();
    psg.setEnvelopeAttenuation=value=>this.envelope.setAttenuation(value);
    psg.allNotesOff();
    return createSynthPsgVoice({getPsg:()=>psg,getPitchClock:()=>pitchClock,settings});
  }
  dispose() {
    if(this.dead)return;
    this.timed.clear();this.performance.clear();this.loopPlayer.stop();this.player.stop();this.envelope.stop();this.dead=true;this.channelMutes.fill(false);this.chip?.dispose();this.chip=null;
    this.remote?.close();this.remote=null;
  }
  fail(error) {this.dispose();this.port.postMessage({error:error.message,fatal:true});}
  receive(data,port) {
    if(this.dead)return;
    try {
      if(Array.isArray(data)){for(const item of data)this.receive(item,port);return;}
      if(data?.method==='dispose'){this.dispose();return;}
      if(!this.chip)return;
      if(this.timed.receive(data,port)||this.performance.receive(data,port))return;
      const args=data?.args??[];
      switch(data?.method) {
        case 'setChannelMuted':
          if(!Number.isInteger(args[0])||args[0]<0||args[0]>3)throw RangeError('PSG mute channel must be 0..3');
          if(typeof args[1]!=='boolean')throw TypeError('PSG muted must be a boolean');
          this.channelMutes[args[0]]=args[1];this.chip.setChannelMuted(...args);break;
        case 'write':this.writeByte(args[0],data.psgRegister,undefined,port);break;
        case 'setStereo':this.setStereo(args[0]);break;
        case 'psgConfiguredLevels': {
          const [levels,mask=15]=args;
          if(!Array.isArray(levels)||levels.length!==4||levels.some(value=>!Number.isInteger(value)||value<0||value>15)||
            !Number.isInteger(mask)||mask<0||mask>15)throw new RangeError('Invalid PSG retained levels');
          for(let ch=0;ch<4;ch++)if(mask&(1<<ch))this.attenuations[ch]=levels[ch];
          break;
        }
        case 'reset':this.timed.clear();this.loopPlayer.stop();this.player.stop();this.resetChip();break;
        case 'releaseTimedNotes':this.timed.releaseNotes();break;
        case 'allNotesOff':this.timed.clear();this.loopPlayer.stop();this.player.stop();this.envelope.stop();for(let ch=0;ch<4;ch++)this.writeByte(0x9f|(ch<<5));break;
        case 'envelopeNoteOn':
          this.timed.observeWrite(1|(args[0]<<1),15,undefined,port);
          this.envelope.noteOn(...args);this.attenuations[args[0]]=args[2];break;
        case 'envelopeNoteOff':this.envelope.noteOff(...args);break;
        case 'envelopeKeyOff':this.envelope.clearVoice(...args);break;
        case 'stopEnvelopes':this.envelope.stop();break;
        case 'setEnvelopeAttenuation':this.envelope.setAttenuation(...args);break;
        case 'playRecording':if(this.player.play(args[1],{...args[2],session:args[0]}))this.loopPlayer.stop();break;
        case 'stopRecording':this.player.stop(args[0]);break;
        case 'startLooper':
          if(this.loopPlayer.start(args[1],{session:args[0],currentFrame:this.absoluteFrame()})) {
            this.player.stop();this.envelope.stop();for(let ch=0;ch<4;ch++)this.writeByte(0x9f|(ch<<5));
          }
          break;
        case 'addLooperUnit':this.loopPlayer.add(args[0],args[1],{currentFrame:this.absoluteFrame(),copy:false});break;
        case 'addPreparedLooperUnit':this.loopPlayer.addPrepared(args[0],args[1],{currentFrame:this.absoluteFrame()});break;
        case 'removeLooperUnit':this.loopPlayer.remove(args[0],args[1]);break;
        case 'stopLooper':this.loopPlayer.stop(args[0]);break;
        default:throw new Error('Unknown Synth PSG command');
      }
      if(data.id!==undefined)port.postMessage({id:data.id,value:true});
    } catch(error) {this.fail(error);}
  }
  renderChip(left,right) {
    if(!this.chip){left.fill(0);right.fill(0);return;}
    const pcm=this.chip.generateStereoView(left.length);
    left.set(pcm.left.subarray(0,left.length));right.set(pcm.right.subarray(0,right.length));
  }
  absoluteFrame() {return typeof currentFrame==='number'?currentFrame:this.renderedFrames;}
  process(inputs,outputs) {
    if(this.dead)return false;
    try {
      const [left,right]=outputs[0],frame=this.absoluteFrame();
      this.performance.render(left,right,this.renderPerformance);this.loopPlayer.render(left,right,frame);
      this.renderedFrames=frame+left.length;return true;
    }
    catch(error){this.fail(error);outputs[0].forEach(channel=>channel.fill(0));return false;}
  }
}
registerProcessor('tetorica-segapsg',SynthPsgProcessor);
