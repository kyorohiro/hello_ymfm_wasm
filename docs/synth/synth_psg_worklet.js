// App-private software envelope host. The shared PSG core and SDK worklet are
// unchanged; Envelope Off renders the same chip PCM without envelope writes.
import {SegaPSG,SEGAPSG_CLOCK} from '../js/segapsg.js?v=audio-numeric-bindings-1';
import factory from '../generated/segapsg_wasm.js?v=audio-numeric-bindings-1';
import {createSynthPsgEnvelope} from './synth_psg_envelope.js?v=psg-envelope-1';
import {createSegaPsgApi} from '../js/segapsg_api.js?v=audio-numeric-bindings-1';
import {createSynthPsgVoice} from './synth_psg.js?v=psg-event-rec-1';
import {createSynthPsgRecordingPlayer} from './synth_psg_recording_player.js?v=psg-event-rec-1';

class SynthPsgProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();this.chip=null;this.dead=false;this.remote=null;this.latched=0;
    this.periods=[0,0,0];this.noiseMode=0;
    this.stereoEnabled=options.processorOptions.stereoEnabled??false;
    this.clock=options.processorOptions.clock??SEGAPSG_CLOCK;
    this.sampleRate=sampleRate;
    this.envelope=createSynthPsgEnvelope({sampleRate,setAttenuation:(ch,value)=>this.writeByte(0x90|(ch<<5)|value)});
    this.renderChip=this.renderChip.bind(this);
    this.renderEnvelopes=(left,right)=>this.envelope.render(left,right,this.renderChip);
    this.player=createSynthPsgRecordingPlayer({sampleRate,beginCycle:(settings,pitchClock)=>this.beginRecordingCycle(settings,pitchClock),
      onEnded:session=>this.port.postMessage({type:'psg-recording-ended',session})});
    this.port.onmessage=({data})=>{
      if(data?.port) {
        this.remote?.close();this.player.stop();this.envelope.stop();
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
  writeByte(value,register) {
    if(!this.chip)return;
    // Envelope attenuation writes also change the hardware latch. A tone high
    // byte must restore its intended tone register if a render ran meanwhile.
    if(!(value&128)&&Number.isInteger(register)&&register>=0&&register<8&&register!==this.latched) {
      const low=register&1?value&15:register===6?this.noiseMode:this.periods[register>>1]&15;
      this.writeByte(0x80|(register<<4)|low);
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
  }
  resetChip() {
    this.envelope.stop();this.chip.reset();this.latched=0;this.periods.fill(0);this.noiseMode=0;
    this.envelope=createSynthPsgEnvelope({sampleRate:this.sampleRate,setAttenuation:(ch,value)=>this.writeByte(0x90|(ch<<5)|value)});
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
    this.player.stop();this.envelope.stop();this.dead=true;this.chip?.dispose();this.chip=null;
    this.remote?.close();this.remote=null;
  }
  fail(error) {this.dispose();this.port.postMessage({error:error.message,fatal:true});}
  receive(data,port) {
    if(this.dead)return;
    try {
      if(Array.isArray(data)){for(const item of data)this.receive(item,port);return;}
      if(data?.method==='dispose'){this.dispose();return;}
      if(!this.chip)return;
      const args=data?.args??[];
      switch(data?.method) {
        case 'write':this.writeByte(args[0],data.psgRegister);break;
        case 'setStereo':if(this.stereoEnabled)this.chip.setStereo(args[0]);break;
        case 'reset':this.player.stop();this.resetChip();break;
        case 'allNotesOff':this.player.stop();this.envelope.stop();for(let ch=0;ch<4;ch++)this.writeByte(0x9f|(ch<<5));break;
        case 'envelopeNoteOn':this.envelope.noteOn(...args);break;
        case 'envelopeNoteOff':this.envelope.noteOff(...args);break;
        case 'stopEnvelopes':this.envelope.stop();break;
        case 'setEnvelopeAttenuation':this.envelope.setAttenuation(...args);break;
        case 'playRecording':this.player.play(args[1],{...args[2],session:args[0]});break;
        case 'stopRecording':this.player.stop(args[0]);break;
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
  process(inputs,outputs) {
    if(this.dead)return false;
    try {const [left,right]=outputs[0];this.player.render(left,right,this.renderEnvelopes);return true;}
    catch(error){this.fail(error);outputs[0].forEach(channel=>channel.fill(0));return false;}
  }
}
registerProcessor('tetorica-segapsg',SynthPsgProcessor);
