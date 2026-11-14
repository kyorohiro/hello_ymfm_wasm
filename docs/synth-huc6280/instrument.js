// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {Huc6280Synth, Huc6280DirectTransport, HUC6280_CLOCK} from '../js/huc6280synth.js';
import {createDefaultPreset, readPreset, isWaveOnlyEdit} from './preset.js?v=wave-held-1';
import {decodeDdaData} from './dda_pcm.js';
import {noteToHz} from '../js/soundchip_pitch.js';
import {validateHuc6280CodeCall,huc6280CodeCancelled} from './code_endpoint.js';
import {readHuc6280CodeEdit,applyHuc6280CodeEdit,createHuc6280CodeChanges,copyHuc6280CodeValue} from './code_parameter_edit.js';
import {huc6280CodeLiveView} from './code_state.js';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const hasLfo = preset => preset.source === 'wave' && preset.lfo.enabled;
const poolFor = preset => preset.source === 'noise' ? [4,5] : hasLfo(preset) ? [0] : [0,1,2,3,4,5];
// Software volume automation is quantized to the real 1.5 dB channel steps.
// A fixed timeline makes rendering independent of AudioWorklet block sizes.
const ENVELOPE_QUANTUM = 16;
// Recover exact sample boundaries after floating-point rate conversion. Keep
// the tolerance below a quarter output frame, even at very slow playback.
const ddaBoundary = (position, step, length) => {
  const nearest = Math.round(position);
  const tolerance = Math.min(8 * Number.EPSILON * Math.max(1, Math.abs(position), length), step / 4);
  return Math.abs(position - nearest) <= tolerance ? nearest : position;
};

/** One physical six-channel PSG, with host keyboard allocation and optional
 * software ADSR. It does not invent extra Noise channels or FM routing. */
export class Huc6280Instrument {
  constructor(core) {
    if (!core || typeof core.processFrames !== 'function' || typeof core.writeHuc6280 !== 'function' ||
        typeof core.sampleRate !== 'function') throw new TypeError('Expected a HuC6280AudioEngine');
    this.core = core;
    this.synth = new Huc6280Synth({transport:new Huc6280DirectTransport(core)});
    this.synth.initialize();
    this.rate = core.sampleRate(); this.preset = createDefaultPreset();
    this.pitch = 0; this.cursor = 0; this.sequence = 0; this.frame = 0;
    this.voices = new Map(); this.slots = Array(6).fill(null); this.levels = Array(6).fill(null); this.disposed = false;
    this.ddaSamples=decodeDdaData(this.preset.dda.data); this.ddaValues=Array(6).fill(null);
    this.codeActive=false;this.codeEpoch=0;this.codeFrames=0;this.gateOwners=Array(6).fill(null);this.codeBaseVolumes=Array(6).fill(24);
    this.editorPresets=[];this.editorDirty=false;
    this._restoreAuthor(); this.stop();
  }
  _open() { if (this.disposed) throw new Error('HuC6280 instrument is disposed'); }
  _frequency(midi, pitch = this.pitch) {
    const hz = 440 * 2 ** ((midi - 69 + pitch) / 12);
    // Notes outside the 12-bit period range reach the hardware endpoint.
    return Math.max(HUC6280_CLOCK / (32 * 4096), Math.min(HUC6280_CLOCK / 32, hz));
  }
  _setPeriod(channel, period) {
    const encoded = period & 4095;
    this.synth.writeRegister(0, channel);
    this.synth.writeRegister(2, encoded & 255);
    this.synth.writeRegister(3, encoded >> 8);
  }
  _tuneVoice(voice, pitch = this.pitch) {
    if(voice.dda) {
      voice.step=this.preset.dda.sampleRate*this.preset.dda.speed*2**((voice.midi-this.preset.dda.rootNote+pitch)/12)/this.rate;
      return;
    }
    if (hasLfo(this.preset) && this.preset.lfo.mode === 'recorded') {
      const period = Math.max(1, Math.min(4096, Math.round(this.preset.lfo.carrierPeriod * 2 ** ((60 - voice.midi - pitch) / 12))));
      this._setPeriod(voice.channel, period);
      this._setPeriod(1, this.preset.lfo.modulatorPeriod);
    } else {
      const hz = this._frequency(voice.midi, pitch);
      this.synth.setFrequency(voice.channel, hz);
      if (hasLfo(this.preset)) this.synth.setFrequency(1, hz);
    }
  }
  _heldLevel(voice, frame = this.frame) {
    const env = voice.envelope;
    if (!env.enabled) return 1;
    const time = Math.max(0, (frame - voice.startFrame) / this.rate);
    if (env.attack > 0 && time < env.attack) return time / env.attack;
    if (env.decay > 0 && time < env.attack + env.decay) return 1 - (1 - env.sustain) * (time - env.attack) / env.decay;
    return env.sustain;
  }
  _level(voice) {
    let level=this._heldLevel(voice);
    if(voice.released) {
      const elapsed = (this.frame - voice.releaseFrame) / this.rate;
      level=voice.envelope.release<=0||elapsed>=voice.envelope.release?0:voice.releaseLevel*(1-elapsed/voice.envelope.release);
    }
    // A one-shot has a known end. Reuse the authored software Release to ease
    // that edge, without modifying the five-bit PCM or crossfading loop data.
    if(voice.dda&&voice.envelope.enabled&&!(voice.ddaSettings??this.preset.dda).loop&&voice.envelope.release>0) {
      const remaining=((voice.samples??this.ddaSamples).length-voice.position)/voice.step/this.rate;
      level*=Math.max(0,Math.min(1,remaining/voice.envelope.release));
    }
    return level;
  }
  _setLevel(channel, level, base = this.preset.volume) {
    const volume = level <= 0 || base === 0 ? 0 : Math.max(0, Math.min(31, base + Math.round(20 * Math.log10(level) / 1.5)));
    if (this.levels[channel] !== volume) { this.synth.setVolume(channel, volume); this.levels[channel] = volume; }
  }
  _setVoiceLevel(voice, level) {
    this._setLevel(voice.channel, level,voice.baseVolume??this.preset.volume);
    if (voice.paired) this._setLevel(1, level, voice.lfoSettings?.output.volume??this.preset.lfo.output.volume);
  }
  _retire(voice) {
    if(this.codeActive&&this.gateOwners[voice.channel]!==voice){this._forgetLiveVoice(voice.channel,voice);return;}
    this.synth.keyOff(voice.channel);
    if(voice.dda) this._writeDda(voice.channel,16);
    if (voice.paired) this.synth.keyOff(1);
    if (this.voices.get(voice.id) === voice) this.voices.delete(voice.id);
    if (this.slots[voice.channel] === voice) this.slots[voice.channel] = null;
    if(this.gateOwners[voice.channel]===voice)this.gateOwners[voice.channel]=null;
  }
  _advanceEnvelopes() {
    for (const voice of this.slots) {
      if (!voice) continue;
      if(voice.ended) continue;
      const level = this._level(voice);
      if (voice.released && level <= 0) this._retire(voice);
      else this._setVoiceLevel(voice, level);
    }
  }
  _apply(previous, next) {
    const changed = getter => !previous || !same(getter(previous), getter(next));
    const lfo = hasLfo(next);
    const routingChanged=changed(p=>p.source)||changed(p=>p.lfo.enabled),uploaded=[];
    for(let channel=0;channel<6;channel++) {
      const modulator=lfo&&channel===1;
      if(routingChanged||next.source==='wave'&&changed(p=>modulator?p.lfo.wave:p.wave)) {
        this.synth.setWaveform(channel,modulator?next.lfo.wave:next.wave);
        this.levels[channel]=null;uploaded.push(channel);
      }
    }
    if(routingChanged) for(let channel=0;channel<6;channel++) {
      this.synth.setDda(channel,next.source==='dda');
      if(next.source==='dda') this._writeDda(channel,16);
    }
    if (changed(p => p.pan) || changed(p => p.source) || changed(p => p.lfo.enabled)) {
      for (let ch = 0; ch < 6; ch++) this.synth.setPan(ch, next.pan.left, next.pan.right);
    }
    if (changed(p => p.source) || changed(p => p.noise.frequency)) for (const ch of [4,5]) {
      this.synth.setNoise(ch, {enabled:next.source === 'noise', frequency:next.noise.frequency});
    }
    if (changed(p => p.source) || changed(p => p.lfo.enabled) || changed(p => p.lfo.frequency) || changed(p => p.lfo.depth) || changed(p => p.lfo.reset)) {
      this.synth.setLfo({frequency:next.lfo.frequency, depth:lfo ? next.lfo.depth : 0, reset:lfo && next.lfo.reset});
    }
    if (lfo) {
      this.synth.setPan(1, next.lfo.output.pan.left, next.lfo.output.pan.right);
      if (!this.slots[0]?.paired || !next.lfo.output.enabled) {
        this.synth.setVolume(1, next.lfo.output.volume); this.synth.keyOff(1); this.levels[1] = next.lfo.output.volume;
      }
    }
    return uploaded;
  }
  read() {
    this._open();
    const state = this.synth._getState();
    return {preset:readPreset(this.preset), voices:[...this.voices.values()].map(({id,midi,channel}) => ({id,midi,channel})),
      tails:this.slots.filter(voice => voice?.released).map(({id,channel}) => ({id,channel})),
      capacity:poolFor(this.preset).length, pitch:this.pitch, registers:state.registers, globals:state.globals,
      dda:{samples:this.ddaSamples.length,sampleRate:this.preset.dda.sampleRate,duration:this.ddaSamples.length/this.preset.dda.sampleRate,
        voices:this.slots.filter(voice=>voice?.dda).map(({id,channel,position,ended})=>({id,channel,position,ended}))}};
  }
  setPreset(value) {
    this._open();
    const next = readPreset(value);if(this.codeActive)this.stop();const previous = this.preset;
    if(this.editorDirty){
      const changes=createHuc6280CodeChanges(previous,next);
      const routing=['source','lfo.enabled','lfo.mode','lfo.output.enabled','envelope.enabled','dda.data'].some(path=>Object.hasOwn(changes,path));
      if(routing){this.stop();this.preset=next;this.ddaSamples=decodeDdaData(next.dda.data);this._restoreAuthor();return this.read();}
      for(let ch=0;ch<6;ch++){
        const patch={...changes};delete patch['dda.name'];
        if(hasLfo(next)&&ch===1)for(const field of ['wave','volume','pan.left','pan.right'])delete patch[field];
        const physical=applyHuc6280CodeEdit(this.editorPresets[ch],{channel:ch,changes:patch});
        this._applyLiveFields(ch,patch,physical,{shared:ch===0});this.editorPresets[ch]=physical;
      }
      this.preset=next;return this.read();
    }
    const waveOnly=isWaveOnlyEdit(previous,next);
    const activeWaveChanged=next.source==='wave'&&(!same(previous.wave,next.wave)||hasLfo(next)&&!same(previous.lfo.wave,next.lfo.wave));
    if(waveOnly&&!activeWaveChanged){this.preset=next;this._resetEditorBank();return this.read();}
    const clear = previous.source !== next.source || !same(previous.wave, next.wave) || previous.lfo.enabled !== next.lfo.enabled ||
      !same(previous.lfo.wave, next.lfo.wave) || previous.lfo.mode !== next.lfo.mode ||
      previous.lfo.output.enabled !== next.lfo.output.enabled || previous.envelope.enabled !== next.envelope.enabled || previous.dda.data!==next.dda.data;
    if (clear&&!waveOnly) this.stop();
    const gates=waveOnly?this.synth._getState().registers.map(registers=>Boolean(registers[4]&128)):null;
    const uploaded=this._apply(previous, next); this.preset = next;
    if(previous.dda.data!==next.dda.data) this.ddaSamples=decodeDdaData(next.dda.data);
    if (next.source === 'wave' && (!same(previous.lfo.carrierPeriod, next.lfo.carrierPeriod) || !same(previous.lfo.modulatorPeriod, next.lfo.modulatorPeriod))) {
      for (const voice of this.slots) if (voice) this._tuneVoice(voice);
    }
    if(next.source==='dda') for(const voice of this.slots) if(voice) this._tuneVoice(voice);
    this._advanceEnvelopes();
    if(waveOnly&&uploaded.length) {
      // setWaveform gates output and resets its write/oscillator index. Restore
      // only already-enabled owned channels, without noteOn, retuning, replacing
      // the owner, or restarting the host envelope/release timeline.
      const owned=new Set();
      for(const voice of this.slots)if(voice&&!voice.ended) {
        owned.add(voice.channel);if(voice.paired)owned.add(1);
      }
      for(const channel of uploaded)if(gates[channel]&&owned.has(channel))this.synth.keyOn(channel);
    }
    this._resetEditorBank();return this.read();
  }
  loadPreset(value) {
    this._open(); const next = readPreset(value);
    this.stop();this.preset=next;this.ddaSamples=decodeDdaData(next.dda.data);this._restoreAuthor();
    return this.read();
  }
  noteOn(id, midi, channel) {
    this._open();
    if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Expected a note identity of 1–128 characters');
    if (this.voices.has(id)) throw new Error('Note identity is already active');
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Expected a MIDI note 0–127');
    if(channel!==undefined&&(!Number.isInteger(channel)||channel<0||channel>5))throw new RangeError('Physical channel must be 0..5');
    if(this.codeActive){
      const pool=channel===undefined?poolFor(this.preset):[channel];
      const ch=pool.find(ch=>!this.slots[ch])??pool.reduce((a,b)=>(this.slots[b]?.order??-1)<(this.slots[a]?.order??-1)?b:a,pool[0]);
      return this._liveNoteOn(id,midi,ch,'keyboard');
    }
    if(channel!==undefined){
      if(channel===1&&(this.synth._getState().globals[9]&3))throw Error('Hardware LFO reserves CH2 as the CH1 modulator. Play CH1 or disable LFO.');
      return this._liveNoteOn(id,midi,channel,'keyboard');
    }
    if(this.preset.source==='dda'&&!this.ddaSamples.length) throw new Error('Load audio before playing DDA PCM');
    const pool = channel===undefined?poolFor(this.preset):[channel];
    channel=undefined;
    for (let offset = 0; offset < pool.length; offset++) {
      const candidate = pool[(this.cursor + offset) % pool.length];
      if (this.slots[candidate] === null) { channel = candidate; break; }
    }
    if (channel === undefined) channel = pool.reduce((oldest, candidate) => {
      const a = this.slots[oldest], b = this.slots[candidate];
      const idleA=a.released||a.ended,idleB=b.released||b.ended;
      return idleB&&!idleA||Boolean(idleA)===Boolean(idleB)&&b.order<a.order?candidate:oldest;
    }, pool[0]);
    const previous = this.slots[channel];
    if (previous) this._retire(previous);
    if(this.editorDirty){
      const settings=this._editorPresetFor(this.preset,channel),changes={source:settings.source,wave:settings.wave,volume:settings.volume,'pan.left':settings.pan.left,'pan.right':settings.pan.right,'noise.frequency':settings.noise.frequency};
      this._applyLiveFields(channel,changes,settings,{shared:false});this.editorPresets[channel]=settings;
      this.synth.setLfo({frequency:this.preset.lfo.frequency,depth:hasLfo(this.preset)?this.preset.lfo.depth:0,reset:hasLfo(this.preset)&&this.preset.lfo.reset});
      if(hasLfo(this.preset)){
        const modulator=this._editorPresetFor(this.preset,1);
        this._applyLiveFields(1,{source:'wave',wave:modulator.wave,volume:modulator.volume,'pan.left':modulator.pan.left,'pan.right':modulator.pan.right},modulator,{shared:false});this.editorPresets[1]=modulator;
      }
      for(const configuration of this.editorPresets)configuration.lfo=copyHuc6280CodeValue(this.preset.lfo);
    }
    const voice = {id,midi,channel,order:++this.sequence,startFrame:this.frame,released:false,
      paired:hasLfo(this.preset) && this.preset.lfo.output.enabled,envelope:{...this.preset.envelope},
      dda:this.preset.source==='dda',position:0,positionCompensation:0,ended:false};
    if (this.preset.source === 'wave'||voice.dda) this._tuneVoice(voice);
    if(voice.dda) this._writeDda(channel,this.ddaSamples[0]);
    this._setVoiceLevel(voice, this._level(voice));
    if (voice.paired) this.synth.keyOn(1);
    this.synth.keyOn(channel);
    this.slots[channel] = voice; this.voices.set(id, voice); this.cursor = (pool.indexOf(channel) + 1) % pool.length;
    this.gateOwners[channel]=voice;
    return {channel, stolenId:previous?.released ? null : previous?.id ?? null};
  }
  noteOff(id) {
    this._open(); const voice = this.voices.get(id);
    if (!voice || this.slots[voice.channel] !== voice || this.codeActive&&this.gateOwners[voice.channel]!==voice) return false;
    this.voices.delete(id);
    if (voice.ended || !voice.envelope.enabled || voice.envelope.release <= 0) this._retire(voice);
    else {
      voice.releaseLevel = this._heldLevel(voice); voice.releaseFrame = this.frame; voice.released = true;
      if (voice.releaseLevel <= 0) this._retire(voice);
      else this._setVoiceLevel(voice, this._level(voice));
    }
    return true;
  }
  setPitch(semitones) {
    this._open();
    if (!Number.isFinite(semitones) || semitones < -24 || semitones > 24) throw new RangeError('Pitch must be between -24 and +24 semitones');
    if(this.codeActive){
      for(const voice of this.slots)if(voice?.owner==='keyboard'&&voice.pitchOwned&&this.gateOwners[voice.channel]===voice)this._tuneLiveVoice(voice,semitones);
      this.pitch=semitones;return this.read();
    }
    for (const voice of this.slots) {
      if (!voice) continue;
      if(voice.editor)this._tuneLiveVoice(voice,semitones);else if(this.preset.source==='wave'||this.preset.source==='dda')this._tuneVoice(voice, semitones);
    }
    this.pitch = semitones; return this.read();
  }
  stop() {
    this._open();
    if(this.codeActive){this.codeActive=false;this.codeEpoch++;this._restoreAuthor();}
    this.synth.allNotesOff();
    for(let channel=0;channel<6;channel++){
      if(this.synth._getState().registers[channel][4]&64)this._writeDda(channel,16);
      this.synth.setVolume(channel,this.editorPresets[channel].volume);this.levels[channel]=null;
    }
    this.voices.clear(); this.slots.fill(null); this.cursor = 0;
    this.gateOwners.fill(null);
    return this.read();
  }
  _forgetLiveVoice(channel,expected=this.slots[channel]) {
    const voice=this.slots[channel];if(!voice||voice!==expected)return;
    this.voices.delete(voice.id);this.slots[channel]=null;
    if(this.gateOwners[channel]===voice)this.gateOwners[channel]=null;
  }
  _restoreAuthor() {
    this.voices.clear();this.slots.fill(null);this.gateOwners.fill(null);this.levels.fill(null);this.ddaValues.fill(null);this.cursor=0;
    this.synth.initialize();this._apply(null,this.preset);
    for(let ch=0;ch<6;ch++){
      const volume=hasLfo(this.preset)&&ch===1?this.preset.lfo.output.volume:this.preset.volume;
      this.synth.setVolume(ch,volume);this.synth.keyOff(ch);this.codeBaseVolumes[ch]=volume;
    }
    if(hasLfo(this.preset)&&this.preset.lfo.mode==='recorded'){this._setPeriod(0,this.preset.lfo.carrierPeriod);this._setPeriod(1,this.preset.lfo.modulatorPeriod);}
    this._resetEditorBank();
    this.pitch=0;
  }
  _editorPresetFor(preset,channel){
    const settings=readPreset(preset);
    if(settings.source==='noise'&&channel<4)settings.source='wave';
    if(hasLfo(preset)&&channel===1){settings.wave=[...preset.lfo.wave];settings.volume=preset.lfo.output.volume;settings.pan={...preset.lfo.output.pan};}
    return settings;
  }
  _resetEditorBank(){this.editorPresets=Array.from({length:6},(_,ch)=>this._editorPresetFor(this.preset,ch));this.editorDirty=false;}
  beginCode(...args) {
    this._open();if(args.length)throw TypeError('HuC6280 Code begin takes no arguments');
    this.stop();this._restoreAuthor();this.codeActive=true;this.codeFrames=0;this.codeEpoch++;
    return {session:this.codeEpoch,clock:HUC6280_CLOCK,channels:6,editorSource:this.preset.source};
  }
  observeCode(...args) {
    this._open();if(args.length)throw TypeError('HuC6280 Code observation takes no arguments');
    if(!this.codeActive)return null;
    return {...this.synth._getState(),editorSource:this.preset.source,editorLfoEnabled:hasLfo(this.preset),editorLfoMode:this.preset.lfo.mode,
      positionFrames:this.codeFrames,dda:{samples:this.ddaSamples.length,sampleRate:this.preset.dda.sampleRate,rootNote:this.preset.dda.rootNote,
        loop:this.preset.dda.loop,speed:this.preset.dda.speed},ddaVoices:this.slots.map(voice=>voice?.dda?{channel:voice.channel,position:voice.position,ended:voice.ended,
          sampleRate:voice.ddaSettings.sampleRate,rootNote:voice.ddaSettings.rootNote,loop:voice.ddaSettings.loop,speed:voice.ddaSettings.speed}:null),
      envelopes:this.slots.map(voice=>voice?{...voice.envelope}:null),observation:{registers:'sent',waveforms:'configured',softwareEnvelope:true}};
  }
  observeEditor(...args){
    this._open();if(args.length)throw TypeError('HuC6280 editor observation takes no arguments');
    if(this.codeActive)return null;
    const metadata=settings=>({samples:this.ddaSamples.length,sampleRate:settings.dda.sampleRate,rootNote:settings.dda.rootNote,loop:settings.dda.loop,speed:settings.dda.speed});
    return {...this.synth._getState(),editorSource:this.preset.source,editorLfoEnabled:Boolean(this.synth._getState().globals[9]&3),editorLfoMode:this.editorPresets[0].lfo.mode,
      positionFrames:this.frame,dda:metadata(this.preset),ddaVoices:this.editorPresets.map((settings,ch)=>({channel:ch,...metadata(settings),position:this.slots[ch]?.dda?this.slots[ch].position:0,ended:Boolean(this.slots[ch]?.ended)})),
      envelopes:this.editorPresets.map(settings=>({...settings.envelope})),observation:{kind:'editor',registers:'sent',waveforms:'configured',softwareEnvelope:true}};
  }
  _tuneLiveVoice(voice,pitch=0) {
    if(voice.dda){const dda=voice.ddaSettings;voice.step=dda.sampleRate*dda.speed*2**((voice.midi-dda.rootNote+pitch)/12)/this.rate;}
    else if(voice.editor&&voice.channel===0&&voice.lfoSettings?.enabled){
      const lfo=voice.lfoSettings;
      if(lfo.mode==='recorded'){this._setPeriod(0,Math.max(1,Math.min(4096,Math.round(lfo.carrierPeriod*2**((60-voice.midi-pitch)/12)))));this._setPeriod(1,lfo.modulatorPeriod);}
      else{const hz=this._frequency(voice.midi,pitch);this.synth.setFrequency(0,hz);this.synth.setFrequency(1,hz);}
    }
    else if(!voice.noise)this.synth.setFrequency(voice.channel,this._frequency(voice.midi,pitch));
  }
  _liveNoteOn(id,midi,channel,owner) {
    const state=this.synth._getState();if(!state.initialized)throw Error('Initialize the HuC6280 before playing');
    const registers=state.registers[channel],noise=channel>=4&&Boolean(registers[7]&128),dda=!noise&&Boolean(registers[4]&64);
    if(dda&&!this.ddaSamples.length)throw Error('Load audio before playing DDA PCM; writeDda() is available for direct DAC values');
    const old=this.slots[channel];if(old)this._retire(old);
    const settings=this.codeActive?this.preset:this.editorPresets[channel],lfo=!this.codeActive&&channel===0&&Boolean(state.globals[9]&3)?copyHuc6280CodeValue(this.editorPresets[0].lfo):null;
    const voice={id,midi,channel,owner,editor:!this.codeActive,order:++this.sequence,startFrame:this.frame,released:false,paired:Boolean(lfo?.output.enabled),lfoSettings:lfo,
      envelope:{...settings.envelope},baseVolume:this.codeActive?this.codeBaseVolumes[channel]:settings.volume,noise,dda,pitchOwned:true,position:0,positionCompensation:0,ended:false,
      ...(dda?{samples:this.ddaSamples,ddaSettings:{...settings.dda}}:{})};
    this._tuneLiveVoice(voice,owner==='keyboard'?this.pitch:0);
    if(dda){this.ddaValues[channel]=null;this._writeDda(channel,voice.samples[0]);}
    this._setVoiceLevel(voice,this._level(voice));if(voice.paired)this.synth.keyOn(1);this.synth.keyOn(channel);
    this.slots[channel]=voice;this.gateOwners[channel]=voice;this.voices.set(id,voice);
    return {channel,stolenId:old?.released?null:old?.id??null};
  }
  releaseKeyboard(...args) {
    this._open();if(args.length)throw TypeError('Keyboard release takes no arguments');
    if(!this.codeActive)return this.stop();
    for(const voice of [...this.voices.values()])if(voice.owner==='keyboard'&&this.gateOwners[voice.channel]===voice)this._retire(voice);
    for(let channel=0;channel<6;channel++)if(this.gateOwners[channel]?.manualEdit){this.synth.keyOff(channel);this.gateOwners[channel]=null;}
    this.pitch=0;return this.read();
  }
  code(session,method,args=[]) {
    this._open();if(!this.codeActive||session!==this.codeEpoch)throw huc6280CodeCancelled();
    validateHuc6280CodeCall(method,args);
    if(method==='getState')return this.observeCode();
    if(method==='dispose')return this.stop();
    if(method==='noteOn'){
      const midi=Math.round(69+12*Math.log2(noteToHz(args[1])/440));
      return this._liveNoteOn(`code:${session}:${++this.sequence}`,midi,args[0],'code');
    }
    if(method==='noteOff'){
      const voice=this.slots[args[0]];return voice?.owner==='code'?this.noteOff(voice.id):false;
    }
    if(method==='keyOff'){
      if(this.gateOwners[args[0]]?.owner==='keyboard')return false;
      this._forgetLiveVoice(args[0]);this.gateOwners[args[0]]=null;this.synth.keyOff(args[0]);return;
    }
    if(method==='keyOn'){
      this._forgetLiveVoice(args[0]);this.gateOwners[args[0]]={owner:'code'};this.synth.keyOn(args[0]);return;
    }
    if(method==='allNotesOff'){
      this.synth.allNotesOff();this.voices.clear();this.slots.fill(null);this.gateOwners.fill(null);return;
    }
    if(method==='initialize'||method==='reset'){
      this.voices.clear();this.slots.fill(null);this.gateOwners.fill(null);this.levels.fill(null);this.ddaValues.fill(null);
      const value=this.synth[method]();this.codeBaseVolumes=this.synth._getState().registers.slice(0,6).map(r=>r[4]&31);return value;
    }
    if(method==='setWaveform'||method==='writeDda'||method==='setDda'){
      this._forgetLiveVoice(args[0]);this.gateOwners[args[0]]=null;this.ddaValues[args[0]]=null;
    }
    if(method==='writeRegister'){
      const state=this.synth._getState(),ch=state.selectedChannel;
      if(ch<6&&(args[0]===4||args[0]===6)){this._forgetLiveVoice(ch);this.gateOwners[ch]={owner:'code'};this.ddaValues[ch]=null;}
      if(ch<6&&args[0]===4)this.codeBaseVolumes[ch]=args[1]&31;
      if(ch<6&&[2,3].includes(args[0])&&this.slots[ch])this.slots[ch].pitchOwned=false;
    }
    const value=this.synth[method](...args);
    if(['setFrequency','setNote'].includes(method)&&this.slots[args[0]])this.slots[args[0]].pitchOwned=false;
    if(method==='setVolume'){
      this.codeBaseVolumes[args[0]]=args[1];const voice=this.slots[args[0]];
      if(voice)voice.baseVolume=args[1];this.levels[args[0]]=null;
    }
    return value;
  }
  applyCodePreset(session,value,options={}) {
    this._open();if(!this.codeActive||session!==this.codeEpoch)throw huc6280CodeCancelled();
    if(!options||typeof options!=='object'||Object.keys(options).some(key=>key!=='replace')||options.replace!==undefined&&typeof options.replace!=='boolean')throw TypeError('Preset replacement must be boolean');
    const next=readPreset(value),previous=this.preset,changes=options.replace===false?createHuc6280CodeChanges(previous,next):createHuc6280CodeChanges(createDefaultPreset(),next);
    if(options.replace!==false)for(const path of ['source','wave','volume','pan.left','pan.right','noise.frequency','lfo.enabled','lfo.wave','lfo.frequency','lfo.depth','lfo.reset','lfo.output.volume','lfo.output.pan.left','lfo.output.pan.right']){
      let v=next;for(const part of path.split('.'))v=v[part];changes[path]=copyHuc6280CodeValue(v);
    }
    for(let ch=0;ch<6;ch++){
      const patch={...changes},modulator=next.source==='wave'&&next.lfo.enabled&&ch===1;
      if(modulator)for(const path of ['wave','volume','pan.left','pan.right'])delete patch[path];
      const physical=modulator?{...next,wave:next.lfo.wave,volume:next.lfo.output.volume,pan:next.lfo.output.pan}:next;
      this._applyLiveFields(ch,patch,physical,{shared:ch===0});
    }
    this.preset=next;this.ddaSamples=decodeDdaData(next.dda.data);return this.read();
  }
  applyCodeEdit(session,value) {
    this._open();if(!this.codeActive||session!==this.codeEpoch)throw huc6280CodeCancelled();
    const edit=readHuc6280CodeEdit(value),next=applyHuc6280CodeEdit(this.preset,edit),live=applyHuc6280CodeEdit(huc6280CodeLiveView(this.observeCode(),edit.channel,this.preset).preset,edit);
    this._applyLiveFields(edit.channel,edit.changes,live);this.preset=next;this.ddaSamples=decodeDdaData(next.dda.data);return this.read();
  }
  applyEditorEdit(value){
    this._open();if(this.codeActive)throw huc6280CodeCancelled();
    const edit=readHuc6280CodeEdit(value),channel=edit.channel,changes=edit.changes,next=applyHuc6280CodeEdit(this.editorPresets[channel],edit);
    if(next.source==='noise'&&channel<4)throw Error('Noise is available on CH5 and CH6 only.');
    const shared=Object.keys(changes).some(path=>path.startsWith('lfo.'))||channel===0&&Object.hasOwn(changes,'source');
    if(channel===1&&next.source!=='wave'&&(this.synth._getState().globals[9]&3))throw Error('Hardware LFO requires Wave on its CH2 modulator.');
    if(Object.hasOwn(changes,'lfo.enabled')&&next.lfo.enabled&&(this.editorPresets[0].source!=='wave'||this.editorPresets[1].source!=='wave'))throw Error('Hardware LFO requires Wave on CH1 and CH2.');
    if(channel===0&&next.source!=='wave')next.lfo.enabled=false;
    const hardwareChanges={...changes};
    if(changes['lfo.enabled']===true){
      hardwareChanges['lfo.wave']=next.lfo.wave;hardwareChanges['lfo.output.volume']=next.lfo.output.volume;
      hardwareChanges['lfo.output.enabled']=next.lfo.output.enabled;
      hardwareChanges['lfo.output.pan.left']=next.lfo.output.pan.left;hardwareChanges['lfo.output.pan.right']=next.lfo.output.pan.right;
    }
    this._applyLiveFields(channel,hardwareChanges,next,{shared});this.editorPresets[channel]=next;this.editorDirty=true;
    if(shared){for(const settings of this.editorPresets)settings.lfo=copyHuc6280CodeValue(next.lfo);
      if(Object.hasOwn(hardwareChanges,'lfo.output.volume'))this.editorPresets[1].volume=next.lfo.output.volume;
      if(Object.hasOwn(hardwareChanges,'lfo.output.pan.left'))this.editorPresets[1].pan.left=next.lfo.output.pan.left;
      if(Object.hasOwn(hardwareChanges,'lfo.output.pan.right'))this.editorPresets[1].pan.right=next.lfo.output.pan.right;
      if(Object.hasOwn(hardwareChanges,'lfo.wave'))this.editorPresets[1].wave=[...next.lfo.wave];
      const carrier=this.slots[0];if(carrier?.editor){carrier.lfoSettings=next.lfo.enabled?copyHuc6280CodeValue(next.lfo):null;carrier.paired=Boolean(next.lfo.enabled&&next.lfo.output.enabled);}
    }else if(channel===1){
      for(const settings of this.editorPresets){
        if(Object.hasOwn(changes,'wave'))settings.lfo.wave=[...next.wave];
        if(Object.hasOwn(changes,'volume'))settings.lfo.output.volume=next.volume;
        if(Object.hasOwn(changes,'pan.left'))settings.lfo.output.pan.left=next.pan.left;
        if(Object.hasOwn(changes,'pan.right'))settings.lfo.output.pan.right=next.pan.right;
      }
    }
    return this.read();
  }
  _applyLiveFields(channel,changes,next,{shared=true}={}) {
    const own=path=>Object.hasOwn(changes,path),state=this.synth._getState(),registers=state.registers[channel];
    if(own('source')||own('dda.data')){
      const voice=this.slots[channel];if(voice)this._retire(voice);this._forgetLiveVoice(channel);this.gateOwners[channel]=null;
      this.synth.setDda(channel,next.source==='dda');this.ddaValues[channel]=null;
      if(next.source==='dda')this._writeDda(channel,16);
      if(channel>=4)this.synth.setNoise(channel,{enabled:next.source==='noise',frequency:next.noise.frequency});
    }
    if((own('wave')||own('source'))&&next.source==='wave'){
      const gate=Boolean(this.synth._getState().registers[channel][4]&128);this.synth.setWaveform(channel,next.wave);this.levels[channel]=null;
      if(gate)this.synth.keyOn(channel);
    }
    if(own('volume')){this.synth.setVolume(channel,next.volume);this.codeBaseVolumes[channel]=next.volume;this.levels[channel]=null;if(this.slots[channel])this.slots[channel].baseVolume=next.volume;}
    if(own('pan.left')||own('pan.right'))this.synth.setPan(channel,own('pan.left')?next.pan.left:registers[5]>>4,own('pan.right')?next.pan.right:registers[5]&15);
    if(own('noise.frequency')&&channel>=4)this.synth.setNoise(channel,{enabled:Boolean(this.synth._getState().registers[channel][7]&128),frequency:next.noise.frequency});
    if(shared&&own('lfo.wave')&&next.lfo.enabled){const gate=Boolean(this.synth._getState().registers[1][4]&128);this.synth.setWaveform(1,next.lfo.wave);if(gate)this.synth.keyOn(1);}
    if(shared&&['lfo.enabled','lfo.frequency','lfo.depth','lfo.reset','source'].some(own)){
      const live=this.synth._getState().globals;
      this.synth.setLfo({frequency:own('lfo.frequency')?next.lfo.frequency:live[8],depth:own('lfo.enabled')||own('source')?(next.source==='wave'&&next.lfo.enabled?next.lfo.depth:0):own('lfo.depth')&&next.lfo.enabled?next.lfo.depth:live[9]&3,reset:own('lfo.reset')?next.lfo.reset:Boolean(live[9]&128)});
    }
    if(shared&&own('lfo.carrierPeriod')){this._setPeriod(0,next.lfo.carrierPeriod);if(this.slots[0])this.slots[0].pitchOwned=false;}
    if(shared&&own('lfo.modulatorPeriod')){this._setPeriod(1,next.lfo.modulatorPeriod);if(this.slots[1])this.slots[1].pitchOwned=false;}
    if(shared&&own('lfo.output.enabled')){
      this._forgetLiveVoice(1);
      if(next.lfo.output.enabled){this.synth.keyOn(1);this.gateOwners[1]={owner:'keyboard',manualEdit:true};}
      else{this.synth.keyOff(1);this.gateOwners[1]=null;}
    }
    if(shared&&own('lfo.output.volume')){this.synth.setVolume(1,next.lfo.output.volume);this.codeBaseVolumes[1]=next.lfo.output.volume;if(this.slots[1])this.slots[1].baseVolume=next.lfo.output.volume;}
    if(shared&&(own('lfo.output.pan.left')||own('lfo.output.pan.right'))){
      const pan=this.synth._getState().registers[1][5];this.synth.setPan(1,own('lfo.output.pan.left')?next.lfo.output.pan.left:pan>>4,own('lfo.output.pan.right')?next.lfo.output.pan.right:pan&15);
    }
    const voice=this.slots[channel];
    if(voice){
      if(Object.keys(changes).some(path=>path.startsWith('envelope.')))voice.envelope={...next.envelope};
      if(voice.dda&&['dda.sampleRate','dda.speed','dda.rootNote','dda.loop'].some(own)){voice.ddaSettings={...next.dda};this._tuneLiveVoice(voice,voice.owner==='keyboard'?this.pitch:0);}
      this._setVoiceLevel(voice,this._level(voice));
    }
  }
  generateStereo(frames) {
    this._open();
    if (!Number.isInteger(frames) || frames < 0 || frames > 0x1000000) throw new RangeError('Invalid frame count');
    const left = new Float32Array(frames), right = new Float32Array(frames);
    if(this.preset.source==='dda'||this.slots.some(voice=>voice?.dda)) {const pcm=this._generateDda(frames,left,right);if(this.codeActive)this.codeFrames+=frames;return pcm;}
    let offset = 0;
    while (offset < frames) {
      if (this.frame % ENVELOPE_QUANTUM === 0) this._advanceEnvelopes();
      const count = Math.min(frames - offset, ENVELOPE_QUANTUM - this.frame % ENVELOPE_QUANTUM);
      const output = this.core.processFrames(count);
      left.set(output.left, offset); right.set(output.right, offset);
      this.frame += count; offset += count;
    }
    if (this.frame % ENVELOPE_QUANTUM === 0) this._advanceEnvelopes();
    if(this.codeActive)this.codeFrames+=frames;
    return {left,right};
  }
  _writeDda(channel,value) {
    if(this.ddaValues[channel]===value) return;
    this.synth.writeDda(channel,value);this.ddaValues[channel]=value;
  }
  _endDda(voice) {
    voice.ended=true;voice.position=(voice.samples??this.ddaSamples).length;voice.positionCompensation=0;
    this.synth.keyOff(voice.channel);this._writeDda(voice.channel,16);
    if(voice.released) this._retire(voice);
  }
  _generateDda(frames,left,right) {
    const playing=[];
    for(let offset=0;offset<frames;offset++) {
      playing.length=0;
      for(const voice of this.slots) if(voice?.dda&&!voice.ended) playing.push(voice);
      if(!playing.length) {
        const output=this.core.processFrames(frames-offset);left.set(output.left,offset);right.set(output.right,offset);
        this.frame+=frames-offset;break;
      }
      if(this.frame%ENVELOPE_QUANTUM===0) this._advanceEnvelopes();
      for(const voice of playing) if(this.slots[voice.channel]===voice&&!voice.ended) {
        const samples=voice.samples??this.ddaSamples;
        this._writeDda(voice.channel,samples[Math.min(samples.length-1,Math.floor(ddaBoundary(voice.position,voice.step,samples.length)))]);
      }
      const output=this.core.processFrames(1);left[offset]=output.left[0];right[offset]=output.right[0];this.frame++;
      for(const voice of playing) if(this.slots[voice.channel]===voice&&!voice.ended) {
        // Compensated summation prevents a rational step such as 1/6 from
        // accumulating into a sample one output frame late.
        const increment=voice.step-voice.positionCompensation, next=voice.position+increment;
        voice.positionCompensation=(next-voice.position)-increment;
        const samples=voice.samples??this.ddaSamples,settings=voice.ddaSettings??this.preset.dda;
        const boundary=ddaBoundary(next,voice.step,samples.length);
        voice.position=boundary;
        if(Number.isInteger(boundary)) voice.positionCompensation=0;
        if(boundary>=samples.length) {
          if(settings.loop) {
            voice.position=boundary%samples.length;
          }
          else this._endDda(voice);
        }
      }
    }
    if(this.frame%ENVELOPE_QUANTUM===0) this._advanceEnvelopes();
    return {left,right};
  }
  dispose() {
    if (this.disposed) return;
    this.stop(); this.synth.dispose(); this.core.dispose(); this.disposed = true;
  }
}
