/** CPU-free SNES S-DSP instruments, eight fixed physical voices (0..7).
 * BRR is raw sample data, not a preset. Musical tuning must be declared by the
 * caller. DSP envelope values remain hardware register values, not seconds.
 */
import {decodeBrr} from './snes_brr.js?v=spc-pitch-comments-1';
import {noteToHz} from './soundchip_pitch.js';
export const SNES_CHANNEL_COUNT = 8;
export const SNES_SAMPLE_RATE = 32000;
const integer=(v,min,max,name)=>{if(!Number.isInteger(v)||v<min||v>max)throw new RangeError(`${name} must be an integer from ${min} to ${max}`);return v;};
const channel=v=>integer(v,0,7,'channel');
const positive=(v,name)=>{if(!Number.isFinite(v)||v<=0)throw new RangeError(`${name} must be positive finite Hz`);return v;};
function copyBytes(input) {
  if((input instanceof ArrayBuffer||ArrayBuffer.isView(input))&&input.byteLength>65536)throw new RangeError('BRR exceeds SNES sample RAM');
  if(input instanceof ArrayBuffer)return new Uint8Array(input.slice(0));
  if(ArrayBuffer.isView(input))return new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice();
  throw new TypeError('BRR data must be an ArrayBuffer or typed array');
}
/** @typedef {({rootNote:string|number,baseFrequencyHz?:never}|{baseFrequencyHz:number,rootNote?:never}) & {basePitch?:number,loopStartSamples?:number}} SnesBRROptions */
/** Validate raw BRR and explicit musical tuning without allocating native RAM.
 * @param {ArrayBuffer|ArrayBufferView} input
 * @param {SnesBRROptions} options
 */
export function prepareSnesBRR(input, options = {}) {
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('BRR options are required');
  const {rootNote,baseFrequencyHz,basePitch=0x1000,loopStartSamples}=options;
  if((rootNote===undefined)===(baseFrequencyHz===undefined))throw new TypeError('Supply exactly one rootNote or baseFrequencyHz for BRR tuning');
  const rootFrequencyHz=rootNote===undefined?positive(baseFrequencyHz,'baseFrequencyHz'):noteToHz(rootNote);
  integer(basePitch,1,0x3fff,'basePitch');
  const brr=copyBytes(input),decoded=decodeBrr(brr);
  if(!decoded.endReached)throw new RangeError('BRR requires an END block');
  if(decoded.blockCount*9!==brr.length)throw new RangeError('BRR has trailing blocks after END');
  if(decoded.loop&&loopStartSamples===undefined)throw new TypeError('Looped BRR requires explicit loopStartSamples');
  const loop=loopStartSamples===undefined?null:integer(loopStartSamples,0,decoded.pcm.length-1,'loopStartSamples');
  if(loop!==null&&loop%16)throw new RangeError('BRR loopStartSamples must be on a 16-sample block boundary');
  if(!decoded.loop&&loop!==null)throw new TypeError('BRR loop position requires LOOP on the END block');
  return {brr,rootNote:rootNote??null,rootFrequencyHz,basePitch,loop:decoded.loop,loopStartSamples:loop,frames:decoded.pcm.length};
}
/** @typedef {{id:number,startAddress:number,loopAddress:number,byteLength:number,frames:number,
 * rootNote:string|number|null,rootFrequencyHz:number,basePitch:number,loop:boolean,loopStartSamples:number|null}} SnesSample
 */
/** @typedef {{sample?:number|SnesSample,adsr1?:number,adsr2?:number,gain?:number,
 * volumeLeft?:number,volumeRight?:number,pitch?:number}} SnesPreset
 */
/** @typedef {{sample:number|null,adsr1:number,adsr2:number,gain:number,volumeLeft:number,volumeRight:number,pitch:number}} SnesVoiceState */
/** @typedef {{sampleRate:number,samples:SnesSample[],channels:SnesVoiceState[],nextAddress:number}} SnesState */
/** Authored instruments over SnesDspCore. RAM $0000..$03ff is the 256-entry
 * sample directory; BRR uploads grow from $0400. No compaction/voice allocator.
 * Echo writes are disabled. Raw DSP edits may overwrite directory/echo settings
 * and must respect these RAM reservations. reset retains/reuploads samples.
 */
export class SnesSynth {
  /** @param {{core:import('./spc.js?v=spc-events-1').SnesDspCore}} options */
  constructor({core}) {
    if(!core||typeof core.writeDsp!=='function'||typeof core.loadRam!=='function')throw new TypeError('SnesSynth requires SnesDspCore');
    this.core=core;this.sampleRate=SNES_SAMPLE_RATE;this.channelCount=SNES_CHANNEL_COUNT;/** @type {SnesSample[]} */ this.samples=[];this.sampleBytes=[];this.nextAddress=0x400;this.pendingKon=0;this.koff=255;
    this.reset();
  }
  /** DSP reset keeps sample uploads and their IDs; active voices are released. */
  reset() {
    this.timeline = null;
    this.core.reset();this.pendingKon=0;this.konFrame=-1;this.koff=255;
    /** @type {SnesVoiceState[]} */
    this.channels=Array.from({length:8},()=>({sample:null,adsr1:0,adsr2:0,gain:127,volumeLeft:100,volumeRight:100,pitch:0x1000}));
    this.core.writeDsp(0x6c,0x20);this.core.writeDsp(0x0c,127);this.core.writeDsp(0x1c,127);this.core.writeDsp(0x2c,0);this.core.writeDsp(0x3c,0);
    this.core.writeDsp(0x2d,0);this.core.writeDsp(0x3d,0);this.core.writeDsp(0x4d,0);this.core.writeDsp(0x0d,0);
    this.core.writeDsp(0x5d,0);this.core.writeDsp(0x5c,255);this.core.writeDsp(0x4c,0);
    for(let ch=0;ch<8;ch++)this._writeChannel(ch,this.channels[ch]);
    for(let i=0;i<this.samples.length;i++){this.core.loadRam(this.sampleBytes[i],this.samples[i].startAddress);this._directory(this.samples[i]);}
  }
  _directory(sample) {
    const {startAddress:start,loopAddress:loop}=sample;
    this.core.loadRam(new Uint8Array([start&255,start>>8,loop&255,loop>>8]),sample.id*4);
  }
  /** Upload complete raw BRR. Looped samples require explicit loopStartSamples;
   * tune with exactly one rootNote (note name/MIDI) or baseFrequencyHz.
   * basePitch is the raw DSP PITCH that plays this declared root (default4096).
   * @param {ArrayBuffer|ArrayBufferView} input
   * @param {SnesBRROptions} options
   * @returns {SnesSample} */
  loadBRR(input,options) {
    this._instrumentOnly();
    const p=prepareSnesBRR(input,options);
    if(this.samples.length>=256||this.nextAddress+p.brr.length>65536)throw new RangeError('SNES BRR sample RAM is full; create a fresh instance');
    const startAddress=this.nextAddress,loopAddress=startAddress+(p.loopStartSamples??0)/16*9;
    const sample={id:this.samples.length,startAddress,loopAddress,byteLength:p.brr.length,frames:p.frames,rootNote:p.rootNote,
      rootFrequencyHz:p.rootFrequencyHz,basePitch:p.basePitch,loop:p.loop,loopStartSamples:p.loopStartSamples};
    this.core.loadRam(p.brr,startAddress);this._directory(sample);
    this.samples.push(sample);this.sampleBytes.push(p.brr);this.nextAddress+=p.brr.length;
    return {...sample};
  }
  _preset(ch,preset) {
    this._instrumentOnly();
    channel(ch);
    if(!preset||typeof preset!=='object'||Array.isArray(preset))throw new TypeError('SNES preset must be an object');
    if(Object.keys(preset).some(key=>!['sample','adsr1','adsr2','gain','volumeLeft','volumeRight','pitch'].includes(key)))throw new TypeError('Unknown SNES preset parameter');
    const p={...this.channels[ch]};
    if(preset.sample!==undefined){const id=typeof preset.sample==='object'?preset.sample?.id:preset.sample;integer(id,0,this.samples.length-1,'sample');p.sample=id;}
    for(const key of ['adsr1','adsr2','gain'])if(preset[key]!==undefined)p[key]=integer(preset[key],0,255,key);
    for(const key of ['volumeLeft','volumeRight'])if(preset[key]!==undefined)p[key]=integer(preset[key],-128,127,key);
    if(preset.pitch!==undefined)p.pitch=integer(preset.pitch,0,0x3fff,'pitch');
    return p;
  }
  _writeChannel(ch,p) {
    const b=ch<<4;
    this.core.writeDsp(b,p.volumeLeft&255);this.core.writeDsp(b+1,p.volumeRight&255);
    this.core.writeDsp(b+2,p.pitch&255);this.core.writeDsp(b+3,p.pitch>>8);
    this.core.writeDsp(b+4,p.sample??0);this.core.writeDsp(b+5,p.adsr1);this.core.writeDsp(b+6,p.adsr2);this.core.writeDsp(b+7,p.gain);
  }
  /** Partial register-value preset; gain applies when ADSR1 bit7 is clear.
   * @param {number} ch Fixed physical voice0..7. @param {SnesPreset} preset */
  setPreset(ch,preset){const p=this._preset(ch,preset);this.channels[ch]=p;this._writeChannel(ch,p);}
  /** @param {number} ch @param {SnesPreset} params */
  setChannel(ch,params){this.setPreset(ch,params);}
  /** @param {number} ch @returns {SnesVoiceState} */
  getPreset(ch){this._instrumentOnly();channel(ch);return {...this.channels[ch]};}
  /** Explicit hardware PITCH0..16383; 4096 advances one source sample/frame.
   * @param {number} ch @param {number} pitch */
  setPitch(ch,pitch){this._instrumentOnly();channel(ch);integer(pitch,0,0x3fff,'pitch');this.channels[ch].pitch=pitch;this.core.writeDsp((ch<<4)+2,pitch&255);this.core.writeDsp((ch<<4)+3,pitch>>8);}
  /** Musical fundamental Hz relative to the uploaded sample's declared tuning.
   * @param {number} ch @param {number} hz */
  setFrequency(ch,hz){channel(ch);positive(hz,'frequency');const sample=this.samples[this.channels[ch].sample];if(!sample)throw new Error('Assign a BRR sample before setting musical pitch');const pitch=Math.round(sample.basePitch*hz/sample.rootFrequencyHz);if(pitch<1||pitch>0x3fff)throw new RangeError('Frequency is outside SNES PITCH range');this.setPitch(ch,pitch);}
  /** @param {number} ch @param {string|number} note Note name or integer MIDI. */
  setNote(ch,note){this.setFrequency(ch,noteToHz(note));}
  /** @param {number} ch */
  keyOn(ch){this._instrumentOnly();channel(ch);if(!this.samples[this.channels[ch].sample])throw new Error('Assign a BRR sample before keyOn');this.koff&=~(1<<ch);this.core.writeDsp(0x5c,this.koff);const frame=this.core.nativeFrames??0;if(frame!==this.konFrame){this.pendingKon=0;this.konFrame=frame;}this.pendingKon|=1<<ch;this.core.writeDsp(0x4c,this.pendingKon);}
  /** S-DSP KOFF release (fixed hardware release rate), no synthetic smoothing.
   * @param {number} ch */
  keyOff(ch){this._instrumentOnly();channel(ch);this.pendingKon&=~(1<<ch);if((this.core.nativeFrames??0)===this.konFrame)this.core.writeDsp(0x4c,this.pendingKon);this.koff|=1<<ch;this.core.writeDsp(0x5c,this.koff);}
  /** @param {number} ch @param {string|number} [note] */
  noteOn(ch,note){if(note!==undefined)this.setNote(ch,note);this.keyOn(ch);}
  /** @param {number} ch */
  noteOff(ch){this.keyOff(ch);}
  allNotesOff(){this._instrumentOnly();this.pendingKon=0;this.koff=255;this.core.writeDsp(0x4c,0);this.core.writeDsp(0x5c,255);}
  /** Raw register edits can bypass sample/channel bookkeeping.
   * @param {number} register @param {number} value */
  writeDsp(register,value){this._instrumentOnly();integer(register,0,127,'DSP register');integer(value,0,255,'DSP value');if(register===0x4c){this.pendingKon=value;this.konFrame=this.core.nativeFrames??0;}if(register===0x5c)this.koff=value;this.core.writeDsp(register,value);}
  /** @param {number} register @returns {number} */
  readDsp(register){return this.core.readDsp(integer(register,0,127,'DSP register'));}
  /** @returns {{ram:Uint8Array,dsp:Uint8Array,nativeFrames:number}} */
  snapshot(){return this.core.snapshot();}
  /** @returns {SnesState} */
  getState(){return {sampleRate:SNES_SAMPLE_RATE,samples:this.samples.map(s=>({...s})),channels:this.channels.map(p=>({...p})),nextAddress:this.nextAddress,...(this.timeline?{timeline:this.getTimelineState()}: {})};}
  _instrumentOnly(){if(this.timeline)throw new Error('SNES timeline mode is exclusive; reset() before editing instruments');}
  /** Prepare captured initial RAM/DSP plus editable 1,024,000-Hz DSP/RAM events.
   * Playback remains paused until playTimeline(). No SPC700 driver is executed.
   * @param {import('./spc.js?v=spc-events-1').SpcTimeline} trace */
  prepareTimeline(trace){const state=this.core.loadTimeline(trace);this.timeline={playing:false,totalFrames:state.totalFrames};return this.getTimelineState();}
  /** Restart the prepared timeline from its captured DSP phase. */
  playTimeline(){if(!this.timeline)throw new Error('Prepare an SNES timeline before playback');this.core.restartTimeline();this.timeline.playing=true;return this.getTimelineState();}
  stopTimeline(){if(this.timeline)this.timeline.playing=false;return this.getTimelineState();}
  getTimelineState(){return this.timeline?{...this.core.getTimelineState(),playing:this.timeline.playing}:{loaded:false,playing:false,positionFrames:0,totalFrames:0,ended:false};}
  /** Optional rendering convenience; core.renderInto() is equally supported.
   * Multiple keyOn calls at the same native frame form one KON mask.
   * @param {Float32Array} left @param {Float32Array} right @param {number} [frames] @param {number} [offset] */
  renderInto(left,right,frames=Math.min(left.length,right.length),offset=0){
    if(this.timeline&&!this.timeline.playing){left.fill(0,offset,offset+frames);right.fill(0,offset,offset+frames);return;}
    this.core.renderInto(left,right,frames,offset);
    if(this.timeline&&this.core.nativeFrames>=this.timeline.totalFrames)this.timeline.playing=false;
  }
  dispose(){this.core.dispose();}
}
