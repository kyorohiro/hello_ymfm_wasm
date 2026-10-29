// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
/** Experimental CPU-free PlayStation SPU instruments. Samples are already encoded
 * SPU ADPCM, not SNES BRR, Yamaha ADPCM, PCM or a PSF/game soundtrack.
 */
import {noteToHz} from './soundchip_pitch.js';
import {PS1_SPU_SAMPLE_RATE, PS1_SPU_RAM_BYTES} from './ps1_spu.js?v=ps1-deferred-release-1';
import {decodePs1Envelope,patchPs1Envelope,PS1_REVERB_PRESETS} from './ps1_parameters.js?v=ps1-voice-editor-1';
export const PS1_CHANNEL_COUNT = 24;
const RAM_START = 0x1000; // Hardware capture buffers occupy the first 4 KiB.
const integer = (value,min,max,name) => {
  if (!Number.isSafeInteger(value) || value<min || value>max) throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
};
const channel = value => integer(value,0,23,'channel');
const positive = (value,name) => {
  if (!Number.isFinite(value) || value<=0) throw new RangeError(`${name} must be positive finite Hz`);
  return value;
};
const object = (value,name) => {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
};
const liveEnvelopeOption = options => {
  object(options,'PS1 envelope update options');
  if(Reflect.ownKeys(options).some(key=>key!=='live')||options.live!==undefined&&typeof options.live!=='boolean')throw new TypeError('Expected {live?:boolean}');
  return options.live!==false;
};
const defaultVoice = () => ({sample:null,volumeLeft:0.75,volumeRight:0.75,adsr1:0x000f,adsr2:0,pitch:0x1000,reverb:false});
const defaultReverb = () => ({preset:'off',volumeLeft:0.25,volumeRight:0.25});
const volumeRegister = value => Math.round(value*0x3fff)&0x7fff;
/** @typedef {({rootNote:string|number,baseFrequencyHz?:never}|{baseFrequencyHz:number,rootNote?:never}) & {loopStartSamples?:number}} Ps1ADPCMOptions */
/** Validate complete 16-byte / 28-frame SPU ADPCM packets and explicit tuning.
 * Predictors 0..4 and shifts 0..12 are accepted. END must be the final packet.
 * Looped data requires a packet-aligned loopStartSamples; any encoded LOOP START
 * marker must agree with it. The returned bytes are an owned copy.
 * @param {ArrayBuffer|ArrayBufferView} input @param {Ps1ADPCMOptions} options
 * @returns {{adpcm:Uint8Array,rootNote:string|number|null,rootFrequencyHz:number,basePitch:number,loop:boolean,loopStartSamples:number|null,decodedFrames:number}}
 */
export function preparePs1ADPCM(input,options) {
  object(options,'SPU ADPCM options');
  if (Reflect.ownKeys(options).some(key=>!['rootNote','baseFrequencyHz','loopStartSamples'].includes(key))) throw new TypeError('Unknown SPU ADPCM option');
  const {rootNote,baseFrequencyHz,loopStartSamples}=options;
  if ((rootNote===undefined)===(baseFrequencyHz===undefined)) throw new TypeError('Supply exactly one rootNote or baseFrequencyHz for SPU ADPCM tuning');
  const rootFrequencyHz=rootNote===undefined?positive(baseFrequencyHz,'baseFrequencyHz'):noteToHz(rootNote);
  if (!(input instanceof ArrayBuffer) && !ArrayBuffer.isView(input)) throw new TypeError('SPU ADPCM data must be an ArrayBuffer or typed array');
  if (!input.byteLength || input.byteLength%16) throw new RangeError('SPU ADPCM requires complete 16-byte packets');
  if (input.byteLength>PS1_SPU_RAM_BYTES-RAM_START) throw new RangeError('SPU ADPCM exceeds available sample RAM');
  const adpcm=input instanceof ArrayBuffer?new Uint8Array(input.slice(0)):new Uint8Array(input.buffer,input.byteOffset,input.byteLength).slice();
  let marker=null;
  const blocks=adpcm.length/16,decodedFrames=blocks*28;
  for (let block=0;block<blocks;block++) {
    const header=adpcm[block*16],flags=adpcm[block*16+1];
    if ((header>>4)>4 || (header&15)>12) throw new RangeError('SPU ADPCM predictor must be 0..4 and shift 0..12');
    if (flags&~7) throw new RangeError('Unsupported SPU ADPCM packet flags');
    if (!!(flags&1)!==(block===blocks-1)) throw new RangeError('SPU ADPCM requires END only on its final packet');
    if (flags&4) {
      if (marker!==null) throw new RangeError('SPU ADPCM has multiple LOOP START markers');
      marker=block*28;
    }
  }
  const loop=!!(adpcm[adpcm.length-15]&2);
  if (loop && loopStartSamples===undefined) throw new TypeError('Looped SPU ADPCM requires explicit loopStartSamples');
  if (!loop && (loopStartSamples!==undefined || marker!==null)) throw new TypeError('SPU ADPCM loop metadata requires LOOP on the END packet');
  const loopStart=loop?integer(loopStartSamples,0,decodedFrames-1,'loopStartSamples'):null;
  if (loopStart!==null && loopStart%28) throw new RangeError('SPU ADPCM loopStartSamples must be on a 28-sample packet boundary');
  if (marker!==null && marker!==loopStart) throw new RangeError('SPU ADPCM LOOP START marker disagrees with loopStartSamples');
  return {adpcm,rootNote:rootNote??null,rootFrequencyHz,basePitch:0x1000,loop,loopStartSamples:loopStart,decodedFrames};
}
/** An original sine loop: the editor's .65-amplitude, 112-frame Sine encoded
 * ahead of time with preparePs1Waveform(). No encoder runs in the AudioWorklet.
 * The four packets loop at source frame 0; at PITCH 4096 their fundamental is
 * 44100/112 Hz. Mixer owns chip gain; this factory only supplies an instrument.
 */
export function createPs1InitSample() {
  const adpcm=new Uint8Array([
    0,6,0,17,17,34,50,51,51,68,68,84,85,85,85,85,
    37,0,23,32,18,34,32,17,16,1,240,241,240,15,254,239,
    38,0,221,204,219,187,187,172,202,201,170,171,187,186,203,202,
    38,3,203,220,219,206,222,223,255,224,241,17,32,18,35,51,
  ]);
  return {adpcm,baseFrequencyHz:PS1_SPU_SAMPLE_RATE/112,loopStartSamples:0};
}
/** @typedef {{id:number,startAddress:number,repeatAddress:number,byteLength:number,decodedFrames:number,
 * rootNote:string|number|null,rootFrequencyHz:number,basePitch:number,loop:boolean,loopStartSamples:number|null,editorChannel?:number}} Ps1Sample */
/** @typedef {{sample?:number|Ps1Sample,volumeLeft?:number,volumeRight?:number,adsr1?:number,adsr2?:number,pitch?:number,reverb?:boolean}} Ps1Preset */
/** @typedef {{live?:boolean}} Ps1EnvelopeUpdateOptions */
/** @typedef {{sample:number|null,volumeLeft:number,volumeRight:number,adsr1:number,adsr2:number,pitch:number,reverb:boolean}} Ps1VoiceState */
/** @typedef {import('./ps1_parameters.js?v=chip-tabs-2').Ps1Reverb} Ps1ReverbState */
/** Fixed physical voices 0..23 over Ps1Spu. Uploads grow from byte address 0x1000
 * with 16-byte alignment; reset({clearRam:true}) starts a new bank. There is no
 * compaction, voice allocator, automatic gain normalization or PCM encoder.
 * Direct core edits bypass this class's bookkeeping and RAM reservations.
 */
export class Ps1Synth {
  /** @param {{core:import('./ps1_spu.js?v=audio-stability-2').Ps1Spu}} options */
  constructor({core}) {
    if (!core || !['reset','write','read','loadRam','readRam','renderInto','dispose'].every(key=>typeof core[key]==='function')) throw new TypeError('Ps1Synth requires Ps1Spu');
    this.core=core; this.sampleRate=PS1_SPU_SAMPLE_RATE; this.channelCount=PS1_CHANNEL_COUNT;
    /** @type {Ps1Sample[]} */ this.samples=[];
    /** @type {Uint8Array[]} */ this.sampleBytes=[];
    /** @type {Array<null|{sample:number,pcm:number[]}>} */ this.editorWaveforms=Array(24).fill(null);
    /** @type {Ps1VoiceState[]} */ this.channels=[];
    /** @type {boolean[]} */ this.gates=[];
    /** @type {Ps1ReverbState} */ this.reverb=defaultReverb();
    this.nextAddress=RAM_START; this.disposed=false;
    this.reset();
  }
  _open(){if(this.disposed)throw new Error('PS1 synth is disposed');}
  _enable(){this.core.write(0x180,0x3fff);this.core.write(0x182,0x3fff);this.core.write(0x1aa,0xc000);}
  /** Reset voice presets and gates. Samples/IDs are retained unless clearRam is
   * true, which clears RAM, descriptors and the upload allocator together.
   * @param {{clearRam?:boolean}} [options] */
  reset(options={}) {
    this._open();object(options,'PS1 reset options');
    if (Reflect.ownKeys(options).some(key=>key!=='clearRam')) throw new TypeError('Unknown PS1 reset option');
    const {clearRam=false}=options;if(typeof clearRam!=='boolean')throw new TypeError('clearRam must be boolean');
    this.core.reset({clearRam});
    if(clearRam){this.samples=[];this.sampleBytes=[];this.editorWaveforms=Array(24).fill(null);this.nextAddress=RAM_START;}
    this.channels=Array.from({length:24},defaultVoice);this.gates=Array(24).fill(false);
    this.reverb=defaultReverb();
    this._enable();for(let ch=0;ch<24;ch++)this._writeChannel(ch,this.channels[ch]);this._writeReverb(this.reverb);
  }
  /** Upload a complete, validated SPU ADPCM instrument; declared tuning is the
   * fundamental at hardware PITCH 4096 (one source frame per output frame).
   * @param {ArrayBuffer|ArrayBufferView} input @param {Ps1ADPCMOptions} options
   * @returns {Ps1Sample} */
  loadADPCM(input,options) {
    this._open();const p=preparePs1ADPCM(input,options);
    if(this.nextAddress+p.adpcm.length>PS1_SPU_RAM_BYTES)throw new RangeError('PS1 sample RAM is full; reset with clearRam:true for a new bank');
    const startAddress=this.nextAddress,repeatAddress=startAddress+(p.loopStartSamples??0)/28*16;
    const sample={id:this.samples.length,startAddress,repeatAddress,byteLength:p.adpcm.length,decodedFrames:p.decodedFrames,
      rootNote:p.rootNote,rootFrequencyHz:p.rootFrequencyHz,basePitch:p.basePitch,loop:p.loop,loopStartSamples:p.loopStartSamples};
    this.core.loadRam(p.adpcm,startAddress);this.samples.push(sample);this.sampleBytes.push(p.adpcm);this.nextAddress+=p.adpcm.length;
    return {...sample};
  }
  /** Internal editor upload. The fixed PCM cycle is encoded on the prepare
   * side; this method only validates and copies four packets. Its private slot
   * is reused, never shared with another physical voice or a public upload.
   * @param {number} ch @param {{pcm:number[],adpcm:Uint8Array}} value */
  _setWaveformPrepared(ch,value) {
    this._open();channel(ch);object(value,'PS1 prepared waveform');
    if(Reflect.ownKeys(value).some(key=>!['pcm','adpcm'].includes(key))||!Array.isArray(value.pcm)||value.pcm.length!==112)throw new RangeError('PS1 waveform requires exactly 112 PCM samples');
    for(const sample of value.pcm)if(!Number.isFinite(sample)||sample< -1||sample>1)throw new RangeError('PS1 waveform PCM must be finite and in [-1, 1]');
    if(!ArrayBuffer.isView(value.adpcm)||value.adpcm.byteLength!==64)throw new RangeError('PS1 waveform requires exactly 64 ADPCM bytes');
    const p=preparePs1ADPCM(value.adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0});
    if(p.adpcm.length!==64||p.adpcm[0]>>4!==0||p.adpcm[1]!==6||p.adpcm[17]!==0||p.adpcm[33]!==0||p.adpcm[49]!==3)throw new RangeError('PS1 waveform requires four looping ADPCM packets');
    const prior=this.editorWaveforms[ch];let sample=prior?this.samples[prior.sample]:null;
    if(sample&&(sample.editorChannel!==ch||sample.byteLength!==64))throw new Error('PS1 waveform slot is invalid');
    if(!sample){
      // loadADPCM checks capacity before touching RAM or sample bookkeeping.
      const loaded=this.loadADPCM(p.adpcm,{baseFrequencyHz:44100/112,loopStartSamples:0});sample=this.samples[loaded.id];sample.editorChannel=ch;
    }else{this.core.loadRam(p.adpcm,sample.startAddress);this.sampleBytes[sample.id]=p.adpcm;}
    this.editorWaveforms[ch]={sample:sample.id,pcm:value.pcm.slice()};return {...sample};
  }
  /** Resource-only synchronization. Authoring/lookahead voice settings are
   * deliberately excluded, so an editor snapshot cannot overwrite a future
   * note or a script's requested pitch/envelope. */
  _getResources(){return {samples:this.samples.map(value=>({...value})),nextAddress:this.nextAddress,waveforms:this.editorWaveforms.map(value=>value?{sample:value.sample,pcm:value.pcm.slice()}:null)};}
  _adoptResources(state){this.samples=state.samples.map(value=>({...value}));this.sampleBytes=[];this.nextAddress=state.nextAddress;this.editorWaveforms=(state.waveforms??Array(24).fill(null)).map(value=>value?{sample:value.sample,pcm:value.pcm.slice()}:null);}
  _preset(ch,preset) {
    this._open();channel(ch);object(preset,'PS1 preset');
    if(Reflect.ownKeys(preset).some(key=>!['sample','volumeLeft','volumeRight','adsr1','adsr2','pitch','reverb'].includes(key)))throw new TypeError('Unknown PS1 preset parameter');
    const p={...this.channels[ch]};
    if(preset.sample!==undefined){const id=typeof preset.sample==='object'?preset.sample?.id:preset.sample;p.sample=integer(id,0,this.samples.length-1,'sample');const owner=this.samples[p.sample].editorChannel;if(owner!==undefined&&owner!==ch)throw new RangeError('PS1 editor waveform belongs to another channel');}
    for(const key of ['volumeLeft','volumeRight'])if(preset[key]!==undefined){const v=preset[key];if(!Number.isFinite(v)||v< -1||v>1)throw new RangeError(`${key} must be finite from -1 to 1`);p[key]=v;}
    for(const key of ['adsr1','adsr2'])if(preset[key]!==undefined)p[key]=integer(preset[key],0,65535,key);
    if(preset.pitch!==undefined)p.pitch=integer(preset.pitch,0,0x3fff,'pitch');
    if(preset.reverb!==undefined){if(typeof preset.reverb!=='boolean')throw new TypeError('reverb must be boolean');p.reverb=preset.reverb;}
    return p;
  }
  _writeChannel(ch,p) {
    const b=ch*16,sample=this.samples[p.sample];
    for(const [offset,value] of [[0,volumeRegister(p.volumeLeft)],[2,volumeRegister(p.volumeRight)],[4,p.pitch],[6,sample?sample.startAddress>>3:RAM_START>>3],[8,p.adsr1],[10,p.adsr2],[14,sample?sample.repeatAddress>>3:RAM_START>>3]])this.core.write(b+offset,value);
    this._writeReverbSend(ch,p.reverb);
  }
  _writeReverbSend(ch,enabled){const address=0x198+(ch>=16?2:0),bit=1<<(ch%16),current=this.core.read(address);this.core.write(address,enabled?current|bit:current&~bit);}
  _reverb(settings){
    this._open();object(settings,'PS1 reverb settings');
    if(Reflect.ownKeys(settings).some(key=>!['preset','volumeLeft','volumeRight'].includes(key)))throw new TypeError('Unknown PS1 reverb parameter');
    const next={...this.reverb};
    if(settings.preset!==undefined){if(!PS1_REVERB_PRESETS.some(p=>p.id===settings.preset))throw new RangeError('Unsupported PS1 reverb preset');next.preset=settings.preset;}
    for(const key of ['volumeLeft','volumeRight'])if(settings[key]!==undefined){const value=settings[key];if(!Number.isFinite(value)||value<0||value>1)throw new RangeError(`${key} must be finite from 0 to 1`);next[key]=value;}
    return next;
  }
  _writeReverb(settings){
    const preset=PS1_REVERB_PRESETS.find(p=>p.id===settings.preset);
    for(let at=0;at<32;at++)this.core.write(0x1c0+at*2,preset.registers[at]);
    const enabled=settings.preset!=='off';
    this.core.write(0x184,enabled?Math.round(settings.volumeLeft*0x7fff):0);
    this.core.write(0x186,enabled?Math.round(settings.volumeRight*0x7fff):0);
    // Upstream does not gate its approximate reverb on SPUCNT bit 7. The exact
    // all-zero Off configuration above is what disables its processing.
    const control=this.core.read(0x1aa);this.core.write(0x1aa,enabled?control|0x80:control&~0x80);
  }
  /** Partial voice preset. Fixed signed volumes use -1..1; ADSR1/2 are raw 16-bit
   * registers. Changed ADSR words update the current envelope stage without
   * restarting its sample or level. Set live:false to defer them to key-on.
   * @param {number} ch @param {Ps1Preset} preset @param {Ps1EnvelopeUpdateOptions} [options] */
  setPreset(ch,preset,options={}){
    const live=liveEnvelopeOption(options),p=this._preset(ch,preset),previous=this.channels[ch];
    const changed=preset.adsr1!==undefined&&p.adsr1!==previous.adsr1||preset.adsr2!==undefined&&p.adsr2!==previous.adsr2;
    this._writeChannel(ch,p);this.channels[ch]=p;
    if(live&&changed)this.core.refreshEnvelope?.(ch);
  }
  /** @param {number} ch @param {Ps1Preset} params @param {Ps1EnvelopeUpdateOptions} [options] */
  setChannel(ch,params,options={}){this.setPreset(ch,params,options);}
  /** Partial named ADSR controls. Rates are raw indexes (zero is fastest), and
   * changed fields update the active stage at its current level by default.
   * Attack edits during sustain affect a future attack. live:false retains the
   * old stage parameters until the next key-on or explicit live edit.
   * @param {number} ch @param {Partial<import('./ps1_parameters.js?v=chip-tabs-2').Ps1Envelope>} settings
   * @param {Ps1EnvelopeUpdateOptions} [options] */
  setEnvelope(ch,settings,options={}){this._open();channel(ch);const p=this.channels[ch];this.setPreset(ch,patchPs1Envelope(p.adsr1,p.adsr2,settings),options);}
  /** One shared approximate reverb. Per-voice `reverb` selects the send; these
   * independent return levels add wet sound to the unchanged dry sound.
   * Off retains requested levels but bypasses processing. Existing tails clear
   * only on Stop/reset, not on preset selection. Changes affect active voices.
   * @param {Partial<Ps1ReverbState>} settings */
  setReverb(settings){const next=this._reverb(settings);this._writeReverb(next);this.reverb=next;}
  /** @param {number} ch @returns {Ps1VoiceState} */
  getPreset(ch){this._open();channel(ch);return {...this.channels[ch]};}
  /** Raw hardware pitch 0..16383. Zero holds the current sample position.
   * @param {number} ch @param {number} pitch */
  setPitch(ch,pitch){this._open();channel(ch);integer(pitch,0,0x3fff,'pitch');this.core.write(ch*16+4,pitch);this.channels[ch].pitch=pitch;}
  /** @param {number} ch @param {number} hz */
  setFrequency(ch,hz){this._open();channel(ch);positive(hz,'frequency');const sample=this.samples[this.channels[ch].sample];if(!sample)throw new Error('Assign an SPU ADPCM sample before setting musical pitch');if(sample.editorChannel!==undefined&&sample.editorChannel!==ch)throw new Error('PS1 editor waveform belongs to another channel');const pitch=Math.round(sample.basePitch*hz/sample.rootFrequencyHz);if(pitch<1||pitch>0x3fff)throw new RangeError('Frequency is outside the PS1 SPU PITCH range');this.setPitch(ch,pitch);}
  /** @param {number} ch @param {string|number} note */
  setNote(ch,note){this.setFrequency(ch,noteToHz(note));}
  /** @param {number} ch */
  keyOn(ch){this._open();channel(ch);const sample=this.samples[this.channels[ch].sample];if(!sample)throw new Error('Assign an SPU ADPCM sample before keyOn');if(sample.editorChannel!==undefined&&sample.editorChannel!==ch)throw new Error('PS1 editor waveform belongs to another channel');/* The upstream one-shot END clears the applied send bit. Restore the requested preset before a new note. */this._writeReverbSend(ch,this.channels[ch].reverb);this.core.write(0x188+(ch>=16?2:0),1<<(ch%16));this.gates[ch]=true;}
  /** Release via the programmed ADSR release register, without changing others.
   * @param {number} ch */
  keyOff(ch){this._open();channel(ch);this.core.write(0x18c+(ch>=16?2:0),1<<(ch%16));this.gates[ch]=false;}
  /** Editor-only transitions. Programmed notes keep the raw keyOn/keyOff API.
   * @param {number} ch */
  _auditionKeyOn(ch){this._open();channel(ch);const sample=this.samples[this.channels[ch].sample];if(!sample)throw new Error('Assign an SPU ADPCM sample before audition');if(sample.editorChannel!==undefined&&sample.editorChannel!==ch)throw new Error('PS1 editor waveform belongs to another channel');this._writeReverbSend(ch,this.channels[ch].reverb);this.core.auditionKey(ch,true);this.gates[ch]=true;}
  /** @param {number} ch */
  _auditionKeyOff(ch){this._open();channel(ch);this.core.auditionKey(ch,false);this.gates[ch]=false;}
  /** @param {number} ch */
  _refreshEnvelope(ch){this._open();channel(ch);this.core.refreshEnvelope(ch);}
  /** @param {number} ch @param {string|number} [note] */
  noteOn(ch,note){if(note!==undefined)this.setNote(ch,note);this.keyOn(ch);}
  /** @param {number} ch */
  noteOff(ch){this.keyOff(ch);}
  allNotesOff(){this._open();this.core.write(0x18c,0xffff);this.core.write(0x18e,0xff);this.gates.fill(false);}
  /** Immediate silence for transport Stop: clear decoder/envelopes/reverb while
   * preserving RAM, sample IDs, tuning and all programmed voice presets.
   * This also resets the core's native frame counter.
   */
  stopVoices(){this._open();this.core.reset({clearRam:false});this.gates.fill(false);this._enable();for(let ch=0;ch<24;ch++)this._writeChannel(ch,this.channels[ch]);this._writeReverb(this.reverb);}
  /** Serializable metadata and requested key gates; ENVX/END reflect the core.
   * Sample byte payloads are available through snapshot(). */
  getState(){this._open();return {sampleRate:this.sampleRate,channelCount:this.channelCount,nextAddress:this.nextAddress,nativeFrames:this.core.nativeFrames??0,
    samples:this.samples.map(s=>({...s})),reverb:{...this.reverb},channels:this.channels.map((p,ch)=>({...p,waveform:this.editorWaveforms[ch]?.sample===p.sample?{sample:p.sample,pcm:this.editorWaveforms[ch].pcm.slice()}:null,envelopeParameters:decodePs1Envelope(p.adsr1,p.adsr2),gate:this.gates[ch],envelope:this.core.read(ch*16+12),ended:!!(this.core.read(0x19c+(ch>=16?2:0))&(1<<(ch%16)))}))};}
  /** Explicit, potentially large copy of RAM/registers for inspection. */
  snapshot(){this._open();const registers=new Uint16Array(512);for(let at=0;at<512;at++)registers[at]=this.core.read(at*2);return {...this.getState(),ram:this.core.readRam(),registers};}
  /** @param {Float32Array} left @param {Float32Array} right @param {number} [frames] @param {number} [offset] */
  renderInto(left,right,frames=Math.min(left.length,right.length),offset=0){this._open();this.core.renderInto(left,right,frames,offset);}
  dispose(){if(!this.disposed){this.disposed=true;this.core.dispose();}}
}
