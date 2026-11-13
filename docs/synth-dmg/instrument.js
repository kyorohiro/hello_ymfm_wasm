// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {GameboySynth, GameboyDirectTransport} from '../js/gameboysynth.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {validateGameboyCodeCall,gameboyCodeCancelled} from './code_endpoint.js';
import {readGameboyCodeEdit,applyGameboyCodeEdit} from './code_parameter_edit.js?v=dmg-unified-channel-1';
import {createGameboyChannelBank,readGameboyChannelBank,applyGameboyChannelEdit,updateGameboyChannelBank,createGameboyCommonChannelEdits} from './channel_bank.js?v=dmg-unified-channel-1';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const poolFor = (preset,bank) => preset.source === 'pulse' ? (bank?.[0]??preset).pulse.sweep.enabled ? [0] : [0, 1] : preset.source === 'wave' ? [2] : [3];

/** One physical Game Boy APU. Round robin uses the selected sound source;
 * fixed keys use that physical channel's own desired settings. */
export class GameboyInstrument {
  constructor(core) {
    if (!core || typeof core.generateStereo !== 'function' || typeof core.writeRegister !== 'function') throw new TypeError('Expected a Game Boy APU');
    this.core = core;
    this.synth = new GameboySynth({transport: new GameboyDirectTransport(core)});
    this.synth.initialize();
    this.preset = createDefaultPreset();
    this.channelPresets=createGameboyChannelBank(this.preset);
    this.pitch = 0; this.cursor = 0; this.sequence = 0;
    this.voices = new Map(); this.slots = Array(4).fill(null); this.disposed = false;
    this.codeEpoch = 0; this.codeActive = false; this.codeCheckpoint = null; this.codeFrames = 0;
    this.gateOwners=Array(4).fill(null);
    this._applyBank(null, this.channelPresets);
    this.stop();
  }
  _open() { if (this.disposed) throw new Error('Game Boy instrument is disposed'); }
  _pool(){
    if(this.codeActive&&this.preset.source==='pulse')return this.synth._getState().voice[0]&0x77?[0]:[0,1];
    return poolFor(this.preset,this.channelPresets);
  }
  _forgetKeyboard(channel){const voice=this.slots[channel];if(voice)this.voices.delete(voice.id);this.slots[channel]=null;}
  _ownCode(channel){this._forgetKeyboard(channel);this.gateOwners[channel]='code';}
  _frequency(midi, pitch = this.pitch, source = this.preset.source) {
    const hz = 440 * 2 ** ((midi - 69 + pitch) / 12), divisor = source === 'wave' ? 64 : 32;
    const period = Math.round(2048 - this.synth.clock / (divisor * hz));
    if (!Number.isInteger(period) || period < 0 || period > 2047) throw new RangeError(`Note is outside the Game Boy ${source === 'wave' ? 'Wave' : 'Pulse'} frequency range`);
    return hz;
  }
  _applyBank(previous, next) {
    for (let ch = 0; ch < 2; ch++) {
      const patch={};
      for(const key of ['duty','volume','envelope'])if(!previous||!equal(previous[ch].pulse[key],next[ch].pulse[key]))patch[key]=next[ch].pulse[key];
      // Envelope register writes have hardware side effects. Defer authored
      // initial volume/envelope edits on held channels until their next trigger.
      const live = this.slots[ch] ? ('duty' in patch ? {duty: patch.duty} : {}) : patch;
      if (Object.keys(live).length) this.synth.pulse.setVoice(ch, live);
    }
    if (!previous||!equal(previous[0].pulse.sweep,next[0].pulse.sweep)) {
      const sweep = next[0].pulse.sweep;
      if (!this.slots[0]) this.synth.pulse.setSweep(sweep.enabled ? {direction: sweep.direction, period: sweep.period, shift: sweep.shift} : {direction: 'up', period: 0, shift: 0});
    }
    if (!previous||!equal(previous[2].wave.samples,next[2].wave.samples)) this.synth.wave.stopAndSetWaveform(next[2].wave.samples);
    if (!previous||previous[2].wave.level!==next[2].wave.level) this.synth.wave.setLevel(next[2].wave.level);
    const noise = {};
    for (const key of ['volume', 'envelope', 'divisor', 'shift', 'width']) if (!previous||!equal(previous[3].noise[key],next[3].noise[key])) noise[key] = next[3].noise[key];
    const liveNoise = this.slots[3] ? Object.fromEntries(Object.entries(noise).filter(([key]) => key !== 'volume' && key !== 'envelope')) : noise;
    if (Object.keys(liveNoise).length) this.synth.noise.setVoice(liveNoise);
    for(let ch=0;ch<4;ch++)if(!previous||!equal(previous[ch].pan,next[ch].pan))this.synth.setPan(ch,next[ch].pan.left,next[ch].pan.right);
  }
  read() {
    this._open();
    return {preset: readPreset(this.preset),channelPresets:readGameboyChannelBank(this.channelPresets), voices: [...this.voices.values()].map(({id, midi, channel}) => ({id, midi, channel})),
      capacity: this._pool().length, pitch: this.pitch,
      registers: Array.from(this.codeCheckpoint?.synth.registers ?? this.synth._getState().registers)};
  }
  observeEditor(...args){
    this._open();if(args.length)throw new TypeError('Game Boy editor observation takes no arguments');
    const state=this.codeCheckpoint?.synth??this.synth._getState();
    return {...state,registers:Array.from(state.registers),voice:Array.from(state.voice),channelPresets:readGameboyChannelBank(this.channelPresets),
      observation:{registers:'sent',voice:'configured',author:true,hardwareEnvelope:false,hardwareSweep:false}};
  }
  _commitAuthorBank(bank,preset,{replace=false}={}){
    if(this.codeActive)throw new Error('Release the borrowed Code APU before editing an idle channel');
    const native=this.core.saveState(),shadow=this.synth._getState(),previous=this.preset,previousBank=this.channelPresets;
    const voices=new Map(this.voices),slots=this.slots.slice(),owners=this.gateOwners.slice(),cursor=this.cursor,pitch=this.pitch;
    const waveChanged=!equal(previousBank[2].wave.samples,bank[2].wave.samples);
    try{
      if(replace){for(let channel=0;channel<4;channel++)this.synth.keyOff(channel);this.slots=Array(4).fill(null);}
      this._applyBank(replace?null:previousBank,bank);
      if(replace){for(let channel=0;channel<4;channel++)this.synth.keyOff(channel);this.voices.clear();this.gateOwners.fill(null);this.cursor=0;this.pitch=0;}
      else if(waveChanged){this._forgetKeyboard(2);this.gateOwners[2]=null;}
      this.channelPresets=bank;this.preset=preset;return this.read();
    }catch(error){
      this.core.loadState(native);this.synth._adoptState(shadow);this.preset=previous;this.channelPresets=previousBank;
      this.voices=voices;this.slots=slots;this.gateOwners=owners;this.cursor=cursor;this.pitch=pitch;throw error;
    }
  }
  loadChannelBank(value){
    this._open();const bank=readGameboyChannelBank(value);
    return this._commitAuthorBank(bank,this.preset,{replace:true});
  }
  applyChannelEdit(value){
    this._open();const edit=readGameboyCodeEdit(value),bank=applyGameboyChannelEdit(this.channelPresets,edit),preset=applyGameboyCodeEdit(this.preset,edit);
    if(!Object.keys(edit.changes).length){if(this.codeActive)throw new Error('Release the borrowed Code APU before editing an idle channel');return this.read();}
    return this._commitAuthorBank(bank,preset);
  }
  setPreset(value) {
    this._open();
    const next = readPreset(value), previous = this.preset,bank=updateGameboyChannelBank(this.channelPresets,previous,next);
    if (this.codeActive) this.stop();
    const clear = previous.source !== next.source || !equal(poolFor(previous,this.channelPresets), poolFor(next,bank)) || !equal(this.channelPresets[2].wave.samples, bank[2].wave.samples);
    if (clear) this.stop();
    this._applyBank(this.channelPresets,bank);this.channelPresets=bank;this.preset = next;
    return this.read();
  }
  loadPreset(value) {
    this._open();
    const next = readPreset(value),bank=createGameboyChannelBank(next);
    this.stop(); this._applyBank(null,bank);
    for(let channel=0;channel<4;channel++)this.synth.keyOff(channel);
    this.channelPresets=bank;this.preset = next; this.pitch = 0;
    return this.read();
  }
  /** Replace editor settings without retiring the borrowed Code APU. Native
   * checkpoint work is synchronous; no audio frames are generated between
   * saving the live machine, preparing Stop's new editor state and restoring it. */
  applyCodePreset(session, value, edit = null, replace = true) {
    this._open();
    if (!this.codeActive || session !== this.codeEpoch) throw gameboyCodeCancelled();
    if(typeof replace!=='boolean')throw new TypeError('Game Boy preset replacement must be boolean');
    if(edit)edit=readGameboyCodeEdit(edit);
    const next = readPreset(value), previous = this.preset, checkpoint = this.codeCheckpoint,previousBank=this.channelPresets;
    const common=!edit&&!replace;
    const bank=edit?applyGameboyChannelEdit(previousBank,edit):updateGameboyChannelBank(previousBank,previous,next,{replace});
    const native = this.core.saveState(), shadow = this.synth._getState(), pitch = this.pitch;
    if((edit||common)&&!shadow.initialized)throw new Error('Initialize the Game Boy APU before editing Code channel parameters');
    const voices=new Map(this.voices),slots=this.slots.slice(),owners=this.gateOwners.slice(),cursor=this.cursor;
    try {
      this.core.loadState(checkpoint.native); this.synth._adoptState(checkpoint.synth);
      this.slots=Array(4).fill(null);
      this._applyBank(null,bank);
      for (let channel = 0; channel < 4; channel++) this.synth.keyOff(channel);
      const restored = {native:this.core.saveState(),synth:this.synth._getState(),pitch:0};
      this.core.loadState(native); this.synth._adoptState(shadow);
      this.slots=slots.slice();
      if(edit||common){
        for(const patch of edit?[edit]:createGameboyCommonChannelEdits(previous,next))this._applyCodeFields(patch,next,shadow);
        this.preset=next;this.channelPresets=bank;this.codeCheckpoint=restored;
        return this.read();
      }
      this.releaseKeyboard();
      if (!shadow.initialized) this.synth.initialize();
      const live = this.synth._getState();
      const {duty,volume,envelope,sweep} = next.pulse;
      const env = (volume<<4)|(envelope.direction==='up'?8:0)|envelope.period;
      for (let channel = 0; channel < 2; channel++) {
        const base=channel*5,patch={};
        if([.125,.25,.5,.75][live.voice[base+1]>>6]!==duty)patch.duty=duty;
        if(live.voice[base+2]!==env){patch.volume=volume;patch.envelope=envelope;}
        if(Object.keys(patch).length)this.synth.pulse.setVoice(channel,patch);
      }
      const sweepBits=sweep.enabled?(sweep.period<<4)|(sweep.direction==='down'?8:0)|sweep.shift:0;
      if(live.voice[0]!==sweepBits)this.synth.pulse.setSweep(sweep.enabled ? {direction:sweep.direction,period:sweep.period,shift:sweep.shift} : {direction:'up',period:0,shift:0});
      const wave = next.wave.samples;
      const packed = Array.from({length:16},(_,index)=>(wave[index*2]<<4)|wave[index*2+1]);
      if (!equal(live.registers.slice(32,48),packed)) this.synth.wave.stopAndSetWaveform(wave);
      if([0,1,.5,.25][(live.voice[12]>>5)&3]!==next.wave.level)this.synth.wave.setLevel(next.wave.level);
      const noise={},noiseEnv=(next.noise.volume<<4)|(next.noise.envelope.direction==='up'?8:0)|next.noise.envelope.period;
      if(live.voice[17]!==noiseEnv){noise.volume=next.noise.volume;noise.envelope=next.noise.envelope;}
      const noiseBits=(next.noise.shift<<4)|(next.noise.width===7?8:0)|next.noise.divisor;
      if(live.voice[18]!==noiseBits)Object.assign(noise,{divisor:next.noise.divisor,shift:next.noise.shift,width:next.noise.width});
      if(Object.keys(noise).length)this.synth.noise.setVoice(noise);
      for (let channel = 0; channel < 4; channel++) {
        if(Boolean(live.voice[21]&(16<<channel))!==next.pan.left||Boolean(live.voice[21]&(1<<channel))!==next.pan.right)this.synth.setPan(channel,next.pan.left,next.pan.right);
      }
      this.preset = next;this.channelPresets=bank; this.pitch = 0; this.codeCheckpoint = restored;
      return this.read();
    } catch (error) {
      this.core.loadState(native); this.synth._adoptState(shadow);
      this.preset = previous;this.channelPresets=previousBank; this.pitch = pitch; this.codeCheckpoint = checkpoint;
      this.voices=voices;this.slots=slots;this.gateOwners=owners;this.cursor=cursor;
      throw error;
    }
  }
  applyCodeEdit(session,edit){
    this._open();if(!this.codeActive||session!==this.codeEpoch)throw gameboyCodeCancelled();
    const validated=readGameboyCodeEdit(edit),next=applyGameboyCodeEdit(this.preset,validated);
    return Object.keys(validated.changes).length?this.applyCodePreset(session,next,validated):this.read();
  }
  _applyCodeFields({channel,changes},next,live){
    const own=key=>Object.hasOwn(changes,key),pulse={},noise={};
    for(const key of ['duty','volume'])if(own('pulse.'+key))pulse[key]=changes['pulse.'+key];
    for(const key of ['direction','period'])if(own('pulse.envelope.'+key))(pulse.envelope??={})[key]=changes['pulse.envelope.'+key];
    if(Object.keys(pulse).length)this.synth.pulse.setVoice(channel,pulse);
    if(Object.keys(changes).some(key=>key.startsWith('pulse.sweep.'))){
      const bits=live.voice[0],sweep={direction:bits&8?'down':'up',period:bits>>4&7,shift:bits&7};
      for(const key of ['direction','period','shift'])if(own('pulse.sweep.'+key))sweep[key]=changes['pulse.sweep.'+key];
      this.synth.pulse.setSweep(own('pulse.sweep.enabled')&&!changes['pulse.sweep.enabled']?{direction:'up',period:0,shift:0}:sweep);
    }
    if(own('wave.samples')){this.synth.wave.stopAndSetWaveform(next.wave.samples);this._forgetKeyboard(2);this.gateOwners[2]=null;}
    if(own('wave.level'))this.synth.wave.setLevel(next.wave.level);
    for(const key of ['volume','divisor','shift','width'])if(own('noise.'+key))noise[key]=changes['noise.'+key];
    for(const key of ['direction','period'])if(own('noise.envelope.'+key))(noise.envelope??={})[key]=changes['noise.envelope.'+key];
    if(Object.keys(noise).length)this.synth.noise.setVoice(noise);
    if(own('pan.left')||own('pan.right'))this.synth.setPan(channel,own('pan.left')?changes['pan.left']:Boolean(live.voice[21]&(16<<channel)),own('pan.right')?changes['pan.right']:Boolean(live.voice[21]&(1<<channel)));
  }
  noteOn(id, midi, options = {}) {
    this._open();
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='channel'))throw new TypeError('Expected keyboard channel options');
    if(options.channel!==undefined&&(!Number.isInteger(options.channel)||options.channel<0||options.channel>3))throw new RangeError('An explicit keyboard channel must be 0..3');
    if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Expected a note identity of 1–128 characters');
    if (this.voices.has(id)) throw new Error('Note identity is already active');
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Expected a MIDI note 0–127');
    const pool=options.channel===undefined?this._pool():[options.channel];
    const source=options.channel===undefined?this.preset.source:options.channel<2?'pulse':options.channel===2?'wave':'noise';
    const hz=source==='noise'?null:this._frequency(midi,this.pitch,source);
    if(this.codeActive&&!this.synth._getState().initialized)throw new Error('Initialize the Game Boy APU before playing its keyboard');
    let channel;
    for (let offset = 0; offset < pool.length; offset++) {
      const candidate = pool[(this.cursor + offset) % pool.length];
      if (this.slots[candidate] === null) { channel = candidate; break; }
    }
    if (channel === undefined) channel = pool.reduce((oldest, candidate) => this.slots[candidate].order < this.slots[oldest].order ? candidate : oldest, pool[0]);
    const previous = this.slots[channel];
    if (previous) { this.synth.keyOff(channel); this.voices.delete(previous.id); }
    if(this.codeActive){
      if(source!=='noise')this.synth.setFrequency(channel,hz);
      this.synth.keyOn(channel);
    } else if (source === 'pulse') {
      const {duty, volume, envelope} = this.channelPresets[channel].pulse;
      this.synth.pulse.setVoice(channel, {duty, volume, envelope});
      if (channel === 0) {
        const sweep = this.channelPresets[0].pulse.sweep;
        this.synth.pulse.setSweep(sweep.enabled ? {direction: sweep.direction, period: sweep.period, shift: sweep.shift} : {direction: 'up', period: 0, shift: 0});
      }
      this.synth.setFrequency(channel, hz); this.synth.keyOn(channel);
    } else if (source === 'wave') {
      this.synth.wave.setLevel(this.channelPresets[2].wave.level);
      this.synth.setFrequency(2, hz); this.synth.keyOn(2);
    } else {
      this.synth.noise.setVoice(this.channelPresets[3].noise); this.synth.noise.keyOn();
    }
    const voice = {id, midi, channel, source, order: ++this.sequence};
    this.gateOwners[channel]=voice;
    this.slots[channel] = voice; this.voices.set(id, voice); this.cursor = (pool.indexOf(channel) + 1) % pool.length;
    return {channel, stolenId: previous?.id ?? null};
  }
  noteOff(id) {
    this._open();
    const voice = this.voices.get(id);
    if (!voice || this.slots[voice.channel] !== voice || this.gateOwners[voice.channel]!==voice) return false;
    this.synth.keyOff(voice.channel); this.voices.delete(id); this.slots[voice.channel] = null;
    this.gateOwners[voice.channel]=null;
    return true;
  }
  setPitch(semitones) {
    this._open();
    if (!Number.isFinite(semitones) || semitones < -24 || semitones > 24) throw new RangeError('Pitch must be between -24 and +24 semitones');
    const updates=[...this.voices.values()].filter(voice=>this.gateOwners[voice.channel]===voice&&voice.source!=='noise').map(voice=>[voice.channel,this._frequency(voice.midi,semitones,voice.source)]);
    for (const [channel, hz] of updates) this.synth.setFrequency(channel, hz);
    this.pitch = semitones;
    return this.read();
  }
  stop() {
    this._open();
    const restored = this._endCode();
    if (!restored) for (let ch = 0; ch < 4; ch++) this.synth.keyOff(ch);
    this.voices.clear(); this.slots.fill(null); this.cursor = 0;
    this.gateOwners.fill(null);
    return this.read();
  }
  releaseKeyboard(...args){
    this._open();if(args.length)throw new TypeError('Game Boy keyboard release takes no arguments');
    for(const voice of this.voices.values())if(this.gateOwners[voice.channel]===voice){this.synth.keyOff(voice.channel);this.gateOwners[voice.channel]=null;}
    this.voices.clear();this.slots.fill(null);this.cursor=0;this.pitch=0;return this.read();
  }
  _endCode() {
    const checkpoint = this.codeCheckpoint;
    this.codeEpoch++; this.codeActive = false; this.codeCheckpoint = null;
    this.voices.clear();this.slots.fill(null);this.gateOwners.fill(null);
    if (!checkpoint) return false;
    this.core.loadState(checkpoint.native);
    this.synth._adoptState(checkpoint.synth);
    this.pitch = checkpoint.pitch;
    return true;
  }
  beginCode() {
    this._open();
    if (!this.core.supportsState?.()) throw new Error('DMG Synth Code requires native APU checkpoint support');
    this.stop();
    const checkpoint = {native:this.core.saveState(),synth:this.synth._getState(),pitch:this.pitch};
    this.codeCheckpoint = checkpoint; this.codeActive = true; this.codeFrames = 0;
    return {session:this.codeEpoch,clock:this.synth.clock,channels:4,editorSource:this.preset.source};
  }
  observeCode(...args) {
    this._open();
    if (args.length) throw new TypeError('Game Boy Code observation takes no arguments');
    if (!this.codeActive) return null;
    return {...this.synth._getState(),positionFrames:this.codeFrames,activeMask:null,
      observation:{registers:'sent',voice:'configured',hardwareEnvelope:false,hardwareSweep:false}};
  }
  code(session, method, args = []) {
    this._open();
    if (!this.codeActive || session !== this.codeEpoch) throw gameboyCodeCancelled();
    validateGameboyCodeCall(method,args,this.synth.clock);
    if (method === 'getState') return {...this.synth._getState(),editorSource:this.preset.source,positionFrames:this.codeFrames};
    if (method === 'dispose') { this._endCode(); return this.read(); }
    if (method === 'setClock') return this.synth.clock;
    if (method === 'allNotesOff') { for (let ch = 0; ch < 4; ch++) this.synth.keyOff(ch);this.voices.clear();this.slots.fill(null);this.gateOwners.fill(null);return; }
    const on=['noteOn','keyOn','pulse.noteOn','pulse.keyOn','wave.noteOn','wave.keyOn','noise.keyOn'].includes(method);
    const off=['keyOff','pulse.keyOff','wave.keyOff','noise.keyOff'].includes(method);
    const channel=method.startsWith('wave.')?2:method.startsWith('noise.')?3:args[0];
    if(off&&this.slots[channel]&&this.gateOwners[channel]===this.slots[channel])return false;
    const [group, member] = method.split('.');
    const result=member ? this.synth[group][member](...args) : this.synth[group](...args);
    if(on)this._ownCode(channel);
    else if(off)this.gateOwners[channel]=null;
    else if(method==='initialize'||method==='reset'){
      this.voices.clear();this.slots.fill(null);this.gateOwners.fill(null);this.cursor=0;
    }else if(method==='wave.setWaveform'||method==='wave.stopAndSetWaveform'){
      this._forgetKeyboard(2);this.gateOwners[2]=null;
    }else if(method==='writeRegister'){
      const [register,value]=args;
      if([4,9,14,19].includes(register)&&(value&128))this._ownCode([4,9,14,19].indexOf(register));
      else if(register===22&&!(value&128)){this.voices.clear();this.slots.fill(null);this.gateOwners.fill(null);}
      else if([2,7,17].includes(register)&&!(value&0xf8)){const ch={2:0,7:1,17:3}[register];this._forgetKeyboard(ch);this.gateOwners[ch]=null;}
      else if(register===10&&!(value&128)){this._forgetKeyboard(2);this.gateOwners[2]=null;}
    }
    return result;
  }
  generateStereo(frames) {
    this._open(); const pcm = this.core.generateStereo(frames);
    if (this.codeActive) this.codeFrames += frames;
    return pcm;
  }
  dispose() {
    if (this.disposed) return;
    this.stop(); this.synth.dispose(); this.core.dispose(); this.disposed = true;
  }
}
