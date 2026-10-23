import {OKIM6258_DIVIDERS,oki6258Rate} from './okim6258synth.js?v=native-extra-gameboy-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';

const bool=(value,label)=>{if(typeof value!=='boolean')throw new TypeError(`${label} must be boolean`);return value;};
function object(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} must be an object`);for(const key of Object.keys(value))if(!keys.includes(key))throw new TypeError(`Unknown ${label} field: ${key}`);}
function identity(value){if(typeof value!=='string'||!value.length||value.length>128)throw new TypeError('Audition identity must contain 1..128 characters');return `voice-editor:${value}`;}
const channel=value=>{if(value!==0)throw new RangeError('OKIM6258 has one channel (0)');};

/** Applied single-stream state. Reads never decode memory, write, or advance audio. */
export class Oki6258VoiceInspector {
  /**
   * @param {import('./okim6258synth.js?v=native-extra-gameboy-1').Oki6258Stream} stream
   * @param {Omit<import('./playground_native_voice_inspector.js?v=nes-wasm-1').NativeVoiceInspectorOptions, 'clock'>} [options]
   */
  constructor(stream,{sampleRate=44100,dispatch,beginAudition=()=>{},endAudition=()=>{}}={}){
    this.stream=stream;this.sampleRate=sampleRate;this.dispatch=dispatch;
    this.beginAudition=beginAudition;this.endAudition=endAudition;this.audition=null;this.previewSequence=0;this.sample=null;this.memoryRevision=0;
  }
  held(){return !!this.audition;}
  owner(){return this.audition?identity(this.audition):undefined;}
  resetAudition(){if(this.audition){this.endAudition(0,this.owner());this.audition=null;}}
  loadMemory(bytes,metadata={}){
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>0x1000000)throw new RangeError('Expected 1 byte to 16 MiB of OKI ADPCM');
    object(metadata,['name','frames','sampleRate','waveform','source'],'OKIM6258 sample metadata');
    if(metadata.name!==undefined&&(typeof metadata.name!=='string'||metadata.name.length>256))throw new TypeError('Sample name must be at most 256 characters');
    if(metadata.frames!==undefined&&metadata.frames!==bytes.length*2&&metadata.frames!==bytes.length*2-1)throw new RangeError('Sample frame count does not match ADPCM bytes');
    const rate=metadata.sampleRate??this.stream.clock/this.stream.divider;
    if(!Number.isFinite(rate)||rate<=0)throw new RangeError('Invalid sample rate');
    if(metadata.source!==undefined&&!['raw','sample'].includes(metadata.source))throw new TypeError('Sample source must be raw or sample');
    let waveform=null;
    if(metadata.waveform!==undefined&&metadata.waveform!==null){if(!Array.isArray(metadata.waveform)||!metadata.waveform.length||metadata.waveform.length>512||metadata.waveform.some(v=>!Number.isFinite(v)||Math.abs(v)>1))throw new RangeError('Invalid OKIM6258 sample waveform');waveform=metadata.waveform.slice();}
    // Validate every metadata field before Stop can release a manual preview.
    this.invoke('auditionAllOff');this.stream.loadMemory(bytes);
    this.sample={name:metadata.name||'OKI ADPCM stream',bytes:bytes.length,frames:bytes.length*2,sampleRate:rate,durationSeconds:bytes.length*2/rate,waveform,source:metadata.source??'raw'};
    this.memoryRevision++;return {...this.sample,waveform:waveform?.slice()??null};
  }
  stage(commands){for(const command of commands)this.dispatch(command,this.owner());}
  invoke(method,args=[]){
    if(method==='auditionAllOff'){if(this.audition)return this.invoke('auditionOff',[0,this.audition]);return false;}
    if(method==='auditionOff'){
      const [ch,id]=args;channel(ch);const owner=identity(id);if(this.audition!==id)return false;
      try{this.dispatch({method:'stop',args:[]},owner);}finally{this.resetAudition();}return true;
    }
    if(method==='auditionOn'){
      const [ch,midi,id]=args;channel(ch);if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('MIDI note must be 0..127');const owner=identity(id);
      if(!this.stream.bytes.length)throw new Error('Load an OKIM6258 sample before audition');
      this.audition=id;this.beginAudition(0,owner);this.dispatch({method:'play',args:[{repeat:!!this.stream.repeat}]},owner);return true;
    }
    if(method==='play')return this.invoke('auditionOn',[0,60,`oki-preview:${++this.previewSequence}`]);
    if(method==='stop'){if(this.audition)return this.invoke('auditionOff',[0,this.audition]);this.stage([{method:'stop',args:[]}]);return true;}
    if(method==='setVoice'){
      const [patch]=args;object(patch,['divider','pan','repeat'],'OKIM6258 voice');const commands=[];
      if('divider'in patch){if(!OKIM6258_DIVIDERS.includes(patch.divider))throw new RangeError('OKIM6258 divider must be 1024, 768 or 512');this.stream._validateRate(this.stream.clock,patch.divider);commands.push({method:'writeRegister',args:[12,OKIM6258_DIVIDERS.indexOf(patch.divider)]});}
      if('pan'in patch){object(patch.pan,['left','right'],'pan');let value=this.stream.pan;if('left'in patch.pan)value=(value&1)|(bool(patch.pan.left,'Left pan')?0:2);if('right'in patch.pan)value=(value&2)|(bool(patch.pan.right,'Right pan')?0:1);commands.push({method:'writeRegister',args:[2,value]});}
      if('repeat'in patch)commands.push({method:'setRepeat',args:[bool(patch.repeat,'Repeat')]});
      this.stage(commands);return true;
    }
    if(method==='setClock'){const clock=validateChipClock(args[0]);this.stream._validateRate(clock,this.stream.divider);this.stage([{method:'clock',args:[clock]}]);return true;}
    if(method==='setPlaybackRate'){const rate=oki6258Rate(this.stream.clock,args[0]);this.invoke('setVoice',[{divider:rate.divider}]);return rate;}
    throw new Error('Unsupported OKIM6258 inspector operation');
  }
  read(){
    const s=this.stream,active=!!s.playing,frames=s.bytes.length*2;
    return {kind:'okim6258',clock:s.clock,sampleRate:this.sampleRate,divider:s.divider,playbackRate:s.clock/s.divider,pan:{left:!(s.pan&2),right:!(s.pan&1)},playing:active,streaming:!!s.streaming,repeat:!!s.repeat,positionFrames:Math.min(frames,s.position),fedBytes:s.fedBytes,memoryRevision:this.memoryRevision,sample:this.sample?{...this.sample,waveform:this.sample.waveform?.slice()??null}:null,channels:[{channel:0,type:'adpcm',active}]};
  }
}
