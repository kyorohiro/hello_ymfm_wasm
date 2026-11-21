// SPDX-License-Identifier: BSD-3-Clause
import {NesApuSynth, NesApuDirectTransport} from '../js/nesapusynth.js';
import {createDefaultPreset, readPreset} from './preset.js';
import {noteToHz} from '../js/soundchip_pitch.js';
import {validateNesCodeCall,nesCodeChannel,nesCodeCancelled} from './code_endpoint.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const poolFor = preset => preset.source === 'pulse' ? [0, 1] : preset.source === 'triangle' ? [2] : preset.source === 'noise' ? [3] : preset.source === 'dmc' ? [4] : [5];
const sourceFor = channel => ['pulse','pulse','triangle','noise','dmc','fds'][channel];
const validChannel = channel => {if(!Number.isInteger(channel)||channel<0||channel>5)throw new RangeError('NES physical channel must be an integer 0..5');};
const quietSweep = {enabled: false, period: 0, negate: true, shift: 0};

/** Host keyboard allocation around one physical NES APU and FDS expansion. */
export class NesInstrument {
  constructor(core) {
    if (!core || typeof core.generateStereo !== 'function' || typeof core.writeRegister !== 'function' || !core.fdsEnabled) throw new TypeError('Expected an NES APU with FDS enabled');
    this.core = core; this.synth = new NesApuSynth({transport: new NesApuDirectTransport(core), fds: true});
    this.preset = createDefaultPreset(); this.pitch = 0; this.cursor = 0; this.sequence = 0;
    this.voices = new Map(); this.slots = Array(6).fill(null); this.disposed = false;
    this.owners=Array(6).fill(null);this.channelPresets=Array.from({length:6},(_,ch)=>({...readPreset(this.preset),source:sourceFor(ch)}));
    this.codeSession=0;this.codeActive=false;this.codeRaw=Array(6).fill(false);this.codeFrames=0;
    this.codePresets=Array(6).fill(null);this.codeFdsVolume=null;
    this.memoryVersion=0;this.sampleCache=null;
    this.assets={dmc:null,wave:null,modulation:null};this.dmcTimedSelection=null;
    this._apply(null, this.preset); this.stop();
  }
  _open() {if (this.disposed) throw new Error('NES instrument is disposed');}
  _frequency(midi, pitch = this.pitch, source = this.preset.source) {
    const hz = 440 * 2 ** ((midi - 69 + pitch) / 12);
    const period = source === 'fds' ? Math.round(hz * 4194304 / this.synth.clock)
      : Math.round(this.synth.clock / ((source === 'triangle' ? 32 : 16) * hz) - 1);
    if (period < (source === 'fds' ? 1 : 8) || period > (source === 'fds' ? 4095 : 2047)) throw new RangeError(`Note is outside the NES ${source} frequency range`);
    return {hz, period};
  }
  _pulseVoice(channel, preset, {live = false} = {}) {
    const {duty, volume, envelope, sweep, lengthHalt} = preset.pulse;
    const base = 0x4000 + channel * 4, active = this.synth._getState().registers[channel * 4];
    // Envelope, shared loop/length halt and Sweep wait for the next attack.
    // Live fixed-volume/Duty editing must preserve the active shared bit,
    // rather than using the public fixed-volume helper that always sets it.
    const control = live
      ? (active & 16) && !envelope.enabled ? (active & 0x30) | volume : active & 0x3f
      : ((envelope.enabled ? envelope.loop : lengthHalt) ? 32 : 0) | (envelope.enabled ? envelope.period : 16 | volume);
    this.synth.writeRegister(base, ([.125, .25, .5, .75].indexOf(duty) << 6) | control);
    if (!live) {
      const value = sweep.enabled ? sweep : quietSweep;
      this.synth.writeRegister(base + 1, (value.enabled ? 128 : 0) | (value.period << 4) | (value.negate ? 8 : 0) | value.shift);
    }
  }
  _noiseVoice(preset, {live = false} = {}) {
    const {volume, period, shortMode, envelope, lengthHalt} = preset.noise;
    const active = this.synth._getState().registers[0x0c], constantVolume = Boolean(active & 16);
    // Match Pulse editing: keep a held envelope's mode and decay state until
    // the next attack. LFSR clock/mode remain live without a trigger write.
    if (!live || constantVolume && !envelope.enabled) {
      this.synth.writeRegister(0x400c, live ? (active & 0x30) | volume
        : ((envelope.enabled ? envelope.loop : lengthHalt) ? 32 : 0) | (envelope.enabled ? envelope.period : 16 | volume));
    }
    this.synth.writeRegister(0x400e, (shortMode ? 128 : 0) | period);
  }
  _fdsVolume(preset, {live = false} = {}) {
    const {volume, master, envelope} = preset.fds;
    const constantVolume = Boolean(this.synth._getState().registers[0x80] & 128);
    // setVolume writes fixed gain, so an active or pending envelope must keep
    // its mode, seed and timer until a new key. Master scale alone stays live.
    if (!live || constantVolume && !envelope.enabled) this.synth.fds.setVolume(volume, master);
    else this.synth.writeRegister(0x4089, master);
  }
  _fdsDepth(preset, {live = false} = {}) {
    const {depth, envelope} = preset.fds.modulation;
    const constantDepth = Boolean(this.synth._getState().registers[0x84] & 128);
    // The depth envelope has its own divider. Live FM clock / bias changes
    // must not rewrite its control or reset that divider's current phase.
    if (!live || constantDepth && !envelope.enabled) this.synth.writeRegister(0x4084, 128 | depth);
  }
  _triangleControl(preset) {
    const {control, linearReload} = preset.triangle;
    this.synth.writeRegister(0x4008, (control ? 128 : 0) | linearReload);
  }
  _apply(previous, next, only = null) {
    const changed = (path, value) => !previous || !equal(path(previous), value);
    if (changed(p => p.pulse, next.pulse)) for (let channel = 0; channel < 2; channel++) if(only===null||only===channel)this._pulseVoice(channel, next, {live: Boolean(this.owners[channel])});
    // Authored gate settings wait for a fresh attack while a key owns CH3,
    // including after a hardware counter has already stopped its sequencer.
    if ((only===null||only===2) && changed(p => p.triangle, next.triangle) && !this.owners[2]) this._triangleControl(next);
    if ((only===null||only===3) && changed(p => p.noise, next.noise)) this._noiseVoice(next, {live:Boolean(this.owners[3])});
    if((only===null||only===4)&&changed(p=>p.dmc.data,next.dmc.data)&&!next.dmc.data.length)this.dmcTimedSelection=null;
    if ((only===null||only===4) && changed(p => p.dmc.data, next.dmc.data) && next.dmc.data.length) {
      // This instrument runs inside the Worklet with a DirectTransport, so
      // the public low-level memory upload completes synchronously. Padding
      // matches dmc.loadSample(), without introducing a Promise into commands.
      const length = Math.ceil((next.dmc.data.length - 1) / 16) * 16 + 1;
      const bytes = new Uint8Array(length).fill(0xaa); bytes.set(next.dmc.data);
      this.synth.loadMemory(bytes, 0xc000);
      this.memoryVersion++;this.assets.dmc=Array.from(next.dmc.data);this.dmcTimedSelection={address:0xc000,length};
    }
    if ((only===null||only===4) && changed(p => [p.dmc.rate, p.dmc.loop], [next.dmc.rate, next.dmc.loop])) this.synth.writeRegister(0x4010, (next.dmc.loop ? 64 : 0) | next.dmc.rate);
    if ((only===null||only===5) && changed(p => p.fds.wave, next.fds.wave)){this.synth.fds.setWave(next.fds.wave);this.assets.wave=Array.from(next.fds.wave);}
    if ((only===null||only===5) && changed(p => [p.fds.volume, p.fds.master, p.fds.envelope], [next.fds.volume, next.fds.master, next.fds.envelope])) this._fdsVolume(next, {live:Boolean(this.owners[5])});
    const mod = next.fds.modulation;
    if ((only===null||only===5) && changed(p => p.fds.modulation.table, mod.table)){this.synth.fds.setModulation(mod);this.assets.modulation=Array.from(mod.table);}
    else if(only===null||only===5) {
      // Avoid rewriting the modulation RAM and resetting its clock for an
      // ordinary rate/depth/bias adjustment on a held FDS note.
      if (changed(p => [p.fds.modulation.depth, p.fds.modulation.envelope], [mod.depth, mod.envelope])) this._fdsDepth(next, {live:Boolean(this.owners[5])});
      if (changed(p => p.fds.modulation.bias, mod.bias)) this.synth.writeRegister(0x4085, mod.bias & 127);
      if (changed(p => p.fds.modulation.rate, mod.rate)) this.synth.writeRegister(0x4086, mod.rate & 255);
      if (changed(p => [p.fds.modulation.rate, p.fds.modulation.enabled], [mod.rate, mod.enabled])) this.synth.writeRegister(0x4087, (mod.enabled ? 0 : 128) | (mod.rate >> 8));
    }
  }
  _retune(channel, period, {trigger = false, lengthIndex} = {}) {
    if (channel === 5) {
      this.synth.writeRegister(0x4082, period & 255);
      this.synth.writeRegister(0x4083, (this.synth._getState().registers[0x83] & 0xc0) | (period >> 8));
      return;
    }
    const base = 0x4000 + channel * 4, previous = this.synth._getState().registers[channel * 4 + 3];
    this.synth.writeRegister(base + 2, period & 255);
    // NES timer-high writes restart the hardware envelope/length. Skip them
    // while the high bits are unchanged. Crossing a timer-byte boundary still
    // has that hardware side effect; the host voice identity stays unchanged.
    // Length index 0 is meaningful for every tone channel. Pitch retains the
    // active index instead of applying a pending authored gate setting.
    const length = lengthIndex === undefined ? previous & 0xf8 : lengthIndex << 3;
    if (trigger || (previous & 7) !== (period >> 8)) this.synth.writeRegister(base + 3, length | (period >> 8));
  }
  read() {
    this._open();
    const coreState = this.core.getState?.();
    return {preset: readPreset(this.preset), voices: [...this.voices.values()].map(({id, midi, channel}) => ({id, midi, channel})),
      channelPresets:this.channelPresets.map(readPreset),codeActive:this.codeActive,codeSession:this.codeSession,positionFrames:this.codeFrames,
      owners:this.owners.map(owner=>owner?{kind:owner.kind??'keyboard',channel:owner.channel,session:owner.session??null}:null),
      capacity: poolFor(this.preset).length, pitch: this.pitch, registers: this.synth._getState().registers,dmcSample:this._dmcSample(), ...(coreState ? {coreState} : {})};
  }
  _dmcSample() {
    if(typeof this.core.readMemory!=='function')return null;
    const registers=this.synth._getState().registers,address=0xc000+registers[0x12]*64,length=registers[0x13]*16+1;
    const key=`${this.memoryVersion}:${address}:${length}`;
    if(this.sampleCache?.key!==key)this.sampleCache={key,address,length,data:Array.from({length},(_,i)=>this.core.readMemory(address+i<65536?address+i:0x8000+(address+i-65536)))};
    const {data}=this.sampleCache;return {address,length,data:data.slice()};
  }
  setPreset(value) {
    this._open(); const next = readPreset(value), previous = this.preset;
    if (!this.codeActive && (previous.source !== next.source || !equal(previous.dmc.data, next.dmc.data) || !equal(previous.fds.wave, next.fds.wave) || !equal(previous.fds.modulation.table, next.fds.modulation.table))) this.stop();
    this._apply(previous, next); this.preset = next;
    this.channelPresets=Array.from({length:6},(_,ch)=>({...readPreset(next),source:sourceFor(ch)}));this.codeRaw.fill(false);this.codePresets.fill(null);return this.read();
  }
  loadPreset(value) {
    this._open(); const next = readPreset(value);
    if(this.codeActive)return this.setPreset(next);
    this.stop(); this.synth.reset();this.dmcTimedSelection=null;this.memoryVersion++; this.pitch = 0; this._apply(null, next); this.preset = next;this.channelPresets=Array.from({length:6},(_,ch)=>({...readPreset(next),source:sourceFor(ch)}));this.codeRaw.fill(false); return this.read();
  }
  noteOn(id, midi, physicalChannel) {
    this._open();
    if (typeof id !== 'string' || !id.length || id.length > 128) throw new TypeError('Expected a note identity of 1–128 characters');
    if (this.voices.has(id)) throw new Error('Note identity is already active');
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Expected a MIDI note 0–127');
    if(physicalChannel!==undefined)validChannel(physicalChannel);
    const preset=physicalChannel===undefined?this.preset:this.channelPresets[physicalChannel],source=preset.source;
    const tone=source==='noise'||source==='dmc'?null:this._frequency(midi,this.pitch,source),pool=physicalChannel===undefined?poolFor(preset):[physicalChannel];
    if (source === 'dmc' && !preset.dmc.data.length) throw new Error('Load a DPCM sample or choose Demo DPCM before playing DMC');
    let channel;
    for (let offset = 0; offset < pool.length; offset++) {
      const candidate = pool[(this.cursor + offset) % pool.length];
      if (this.owners[candidate] === null) {channel = candidate; break;}
    }
    if (channel === undefined) channel = pool.reduce((oldest, candidate) => this.owners[candidate].order < this.owners[oldest].order ? candidate : oldest, pool[0]);
    const previous=this.owners[channel];
    this._forget(channel);
    if(previous)this._stopChannel(channel);
    this._attack(channel,tone,preset);
    const voice = {id, midi, channel, order: ++this.sequence};
    this.slots[channel] = voice; this.owners[channel]=voice; this.voices.set(id, voice); this.cursor = (pool.indexOf(channel) + 1) % pool.length;
    return {channel, stolenId: previous?.id ?? null};
  }
  _attack(channel,tone,preset) {
    const source=sourceFor(channel);
    if (source === 'pulse') {
      this._pulseVoice(channel, preset);
      this._retune(channel, tone.period, {trigger: true, lengthIndex:preset.pulse.lengthIndex}); this.synth.keyOn(channel);
    } else if (source === 'triangle') {
      this._triangleControl(preset);
      this._retune(2, tone.period, {trigger:true, lengthIndex:preset.triangle.lengthIndex}); this.synth.keyOn(2);
    } else if (source === 'noise') {
      this._noiseVoice(preset);
      // The high-level Noise attack selects length index 1. Enable first,
      // then load the authored index so all 32 hardware entries remain usable.
      this.synth.writeRegister(0x4015, this.synth._getState().enabled | 8);
      this.synth.writeRegister(0x400f, preset.noise.lengthIndex << 3);
    }
    else if (source === 'dmc') {
      const {rate, loop, level, data} = preset.dmc;
      if(!equal(this.assets.dmc,data)) {
        const bytes=new Uint8Array(Math.ceil((data.length-1)/16)*16+1).fill(0xaa);bytes.set(data);
        this.synth.loadMemory(bytes,0xc000);this.memoryVersion++;this.assets.dmc=Array.from(data);this.dmcTimedSelection={address:0xc000,length:bytes.length};
      }
      this.synth.noteOff(4);
      this.synth.writeRegister(0x4010, (loop ? 64 : 0) | rate);
      this.synth.writeRegister(0x4011, level);
      this.synth.writeRegister(0x4012, 0);
      this.synth.writeRegister(0x4013, Math.ceil((data.length - 1) / 16));
      // One selected source owns the core. An explicit DMC off/on trigger
      // follows hardware output-unit continuation; it does not reset the APU.
      this.synth.writeRegister(0x4015, this.synth._getState().enabled | 16);
    }
    else {
      if(!equal(this.assets.wave,preset.fds.wave)){this.synth.fds.setWave(preset.fds.wave);this.assets.wave=Array.from(preset.fds.wave);}
      if(!equal(this.assets.modulation,preset.fds.modulation.table)){this.synth.fds.setModulation(preset.fds.modulation);this.assets.modulation=Array.from(preset.fds.modulation.table);}
      // Refresh the high-level keyOn cache while silent. keyOn intentionally
      // selects fixed gain and stops envelopes; program the authored hardware
      // envelope only afterwards so the public API cannot overwrite it.
      this.synth.fds.setVolume(preset.fds.volume, preset.fds.master);
      this._retune(5, tone.period); this.synth.fds.keyOn();
      const envelope = preset.fds.envelope, depthEnvelope = preset.fds.modulation.envelope;
      // Restore a pending fixed-depth change as well as seeding every enabled
      // envelope. The master clock and halt line are shared by both units.
      this.synth.writeRegister(0x4084, 128 | preset.fds.modulation.depth);
      if (envelope.enabled || depthEnvelope.enabled) {
        const clock = preset.fds.envelopeClock;
        if (envelope.enabled) this.synth.writeRegister(0x4080, 128 | envelope.initialGain);
        if (depthEnvelope.enabled) this.synth.writeRegister(0x4084, 128 | depthEnvelope.initialGain);
        this.synth.writeRegister(0x408a, clock.masterSpeed);
        if (envelope.enabled) this.synth.writeRegister(0x4080, (envelope.increase ? 64 : 0) | envelope.period);
        if (depthEnvelope.enabled) this.synth.writeRegister(0x4084, (depthEnvelope.increase ? 64 : 0) | depthEnvelope.period);
        this.synth.writeRegister(0x4083, (this.synth._getState().registers[0x83] & 15) | (clock.halt ? 64 : 0));
      }
    }
  }
  noteOff(id) {
    this._open(); const voice = this.voices.get(id);
    if (!voice || this.owners[voice.channel] !== voice) return false;
    this._stopChannel(voice.channel); this._forget(voice.channel); return true;
  }
  setPitch(semitones) {
    this._open();
    if (!Number.isFinite(semitones) || semitones < -24 || semitones > 24) throw new RangeError('Pitch must be between -24 and +24 semitones');
    const updates = [...this.voices.values()].filter(voice=>![3,4].includes(voice.channel)).map(voice => [voice.channel, this._frequency(voice.midi, semitones,sourceFor(voice.channel)).period]);
    for (const [channel, period] of updates) this._retune(channel, period);
    this.pitch = semitones; return this.read();
  }
  _forget(channel) {
    const voice=this.slots[channel];if(voice)this.voices.delete(voice.id);
    this.slots[channel]=null;this.owners[channel]=null;
  }
  releaseKeyboard(...args) {
    this._open();if(args.length)throw new TypeError('Keyboard release takes no arguments');
    for(const voice of [...this.voices.values()])this.noteOff(voice.id);
    this.cursor=0;return this.read();
  }
  applyPhysicalPreset(channel,value) {
    this._open();validChannel(channel);const next={...readPreset(value),source:sourceFor(channel)},previous=this.channelPresets[channel];
    this._apply(previous,next,channel);this.channelPresets[channel]=next;this.codeRaw[channel]=false;this.codePresets[channel]=null;
    return this.read();
  }
  applyTimedWrite(register,value,owner,{nesRetriggerDmc=false,fdsState,preserveOwner=false,nesFdsOff=false}={}) {
    this._open();
    const state=this.synth._getState();
    if(nesFdsOff&&this.owners[5]&&this.owners[5].timedOwner!==owner)return;
    if(register===0x4083&&!preserveOwner){
      if(value&128){if(this.owners[5]&&this.owners[5].timedOwner!==owner)return;this._forget(5);}
      else {this._ownCode(5,this.codeSession);this.owners[5].timedOwner=owner;this.codeRaw[5]=true;}
    }
    if(fdsState&&register>=0x4023)this.synth._adoptState({...state,fdsGain:fdsState.fdsGain,fdsMaster:fdsState.fdsMaster});
    if(register===0x4015){
      const enabled=(state.enabled&15)|(this.core.getState().dmcRemaining>0?16:0);
      for(let ch=0;ch<5;ch++)if(!(value&(1<<ch))&&this.owners[ch]&&this.owners[ch].timedOwner!==owner&&!(ch===4&&nesRetriggerDmc))value=(value&~(1<<ch))|(enabled&(1<<ch));
      for(let ch=0;ch<5;ch++){
        if(!(value&(1<<ch))&&this.owners[ch]?.timedOwner===owner||ch===4&&nesRetriggerDmc&&!(value&16))this._forget(ch);
        else if((value&(1<<ch))&&!(enabled&(1<<ch))){this._ownCode(ch,this.codeSession);this.owners[ch].timedOwner=owner;this.codeRaw[ch]=true;}
      }
    }
    const channel=[0x4003,0x4007,0x400b,0x400f].indexOf(register);
    if(channel>=0&&(state.enabled&(1<<channel))){this._ownCode(channel,this.codeSession);this.owners[channel].timedOwner=owner;this.codeRaw[channel]=true;}
    this.synth.writeRegister(register,value);
    if(register>=0x4040&&register<=0x407f)this.assets.wave=null;
    if(register===0x4088)this.assets.modulation=null;
  }
  cancelTimedOwner(owner){
    for(let ch=0;ch<6;ch++)if(this.owners[ch]?.timedOwner===owner){this._stopChannel(ch);this._forget(ch);}
  }
  beginCode(...args) {
    this._open();if(args.length)throw new TypeError('Code session takes no arguments');
    if(this.codeActive)this.endCode(this.codeSession);
    this.codeActive=true;this.codeRaw.fill(false);this.codePresets.fill(null);this.codeFdsVolume=null;this.codeFrames=0;
    return {session:++this.codeSession,clock:this.synth.clock,channels:6,editorSource:this.preset.source};
  }
  endCode(session) {
    this._open();if(!this.codeActive||session!==this.codeSession)return false;
    for(let ch=0;ch<6;ch++)if(this.owners[ch]?.kind==='code'&&this.owners[ch].session===session){this._stopChannel(ch);this._forget(ch);}
    // Restore edited sounds only on unowned channels. A newer keyboard Gate
    // keeps sounding; its following attack selects its authored assets below.
    for(let ch=0;ch<6;ch++)if(!this.owners[ch])this._apply(null,this.channelPresets[ch],ch);
    this.codeActive=false;return this.read();
  }
  _ownCode(channel,session) {
    this._forget(channel);this.owners[channel]={kind:'code',session,channel,order:++this.sequence};
  }
  _codeAttack(channel,note,session,keyOnly=false) {
    const source=sourceFor(channel),preset=this.codePresets[channel]??this.channelPresets[channel];
    if(source==='dmc'&&!preset.dmc.data.length&&!this.synth._getState().sample)throw new Error('Load a DPCM sample before playing DMC');
    const hz=keyOnly||[3,4].includes(channel)?null:noteToHz(note);
    // Validate pitch before retiring any previous keyboard owner.
    const tone=hz===null?null:{hz,period:source==='fds'?Math.round(hz*4194304/this.synth.clock):Math.round(this.synth.clock/((source==='triangle'?32:16)*hz)-1)};
    if(!this.codeRaw[channel]&&!keyOnly) this._attack(channel,tone,preset);
    else if(!this.codeRaw[channel]&&keyOnly) {
      const registers=this.synth._getState().registers;
      const period=channel===5?registers[0x82]|((registers[0x83]&15)<<8):channel<3?registers[channel*4+2]|((registers[channel*4+3]&7)<<8):0;
      this._attack(channel,{period},preset);
    } else if(channel===3)this.synth.noise.noteOn();
    else if(channel===4){const registers=this.synth._getState().registers;this.synth.dmc.play({rate:registers[0x10]&15,loop:Boolean(registers[0x10]&64),level:registers[0x11]&127});}
    else if(channel===5){
      // Public FDS keyOn selects fixed gain. Preserve explicit Code envelope
      // controls after that trigger rather than silently discarding them.
      const before=this.synth._getState().registers;
      if(!keyOnly)this.synth.setNote(channel,note);this.synth.keyOn(channel);
      const volume=this.codeFdsVolume??before[0x80];
      if(!(volume&128)||(volume&63))this.synth.writeRegister(0x4080,volume);
      for(const address of [0x4084,0x408a])this.synth.writeRegister(address,before[address-0x4000]);
      this.synth.writeRegister(0x4083,(this.synth._getState().registers[0x83]&15)|(before[0x83]&64));
    } else {if(!keyOnly)this.synth.setNote(channel,note);this.synth.keyOn(channel);}
    this._ownCode(channel,session);return {channel};
  }
  code(session,method,args=[]) {
    this._open();if(!this.codeActive||session!==this.codeSession)throw nesCodeCancelled();
    validateNesCodeCall(method,args,this.synth.clock);
    if(method==='getState')return {...this.read(),...this.synth._getState()};
    if(method==='dispose')return this.endCode(session);
    if(method==='allNotesOff'){this.stop();return;}
    if(method==='dmc.play'&&!this.synth._getState().sample) {
      const authored=this.channelPresets[4],options=args[0]??{};
      if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('DMC playback options must be an object');
      const dmc={...authored.dmc,...options};
      // Validate through the existing preset reader before writing any gates.
      const next=readPreset({...authored,dmc});
      if(!next.dmc.data.length)throw new Error('Load a DPCM sample before play()');
      this._attack(4,null,next);this._ownCode(4,session);return {channel:4};
    }
    const channel=nesCodeChannel(method,args),on=method==='noteOn'||method==='keyOn'||method.endsWith('.noteOn')||method.endsWith('.keyOn');
    const off=method==='noteOff'||method.endsWith('.noteOff')||method==='dmc.stop';
    const rawOff=method==='keyOff'||method.endsWith('.keyOff');
    if(on)return this._codeAttack(channel,args[method.startsWith('triangle.')||method.startsWith('fds.')?0:1],session,method.endsWith('keyOn'));
    if(off||rawOff){
      const owner=this.owners[channel];
      if(!rawOff&&(!owner||owner.kind!=='code'||owner.session!==session))return false;
      this._stopChannel(channel);this._forget(channel);return true;
    }
    const [group,member]=method.split('.');
    const result=member?this.synth[group][member](...args):this.synth[group](...args);
    if(method==='reset'||method==='resetRegisters') {this.voices.clear();this.slots.fill(null);this.owners.fill(null);this.codeRaw.fill(true);this.codePresets.fill(null);this.memoryVersion++;this.assets={dmc:null,wave:null,modulation:null};this.dmcTimedSelection=null;}
    else if(method==='writeRegister'){this.observeExternalWrite(args[0],args[1],session);if(args[0]===0x4080)this.codeFdsVolume=args[1];}
    else if(method==='dmc.play'){this._ownCode(4,session);this.codeRaw[4]=true;}
    else if(method==='dmc.loadSample'){
      // DirectTransport uploads synchronously; the public method resolves its
      // sample metadata in a microtask. The processor serializes that Promise.
      this._forget(4);this.codeRaw[4]=true;this.memoryVersion++;this.assets.dmc=null;this.dmcTimedSelection=null;
    } else if(method==='loadMemory') {
      this.memoryVersion++;this.assets.dmc=null;this.dmcTimedSelection=null;
    } else if(['pulse.setVoice','noise.setVoice','fds.setWave','fds.setVolume','fds.setModulation'].includes(method))this._codeVoicePatch(channel,method,args);
    return result;
  }
  _codeVoicePatch(channel,method,args) {
    const next=readPreset(this.codePresets[channel]??this.channelPresets[channel]);
    if(method==='pulse.setVoice') {
      const patch=args[1];
      if(patch.duty!==undefined)next.pulse.duty=patch.duty;
      if(patch.volume!==undefined){next.pulse.volume=patch.volume;next.pulse.envelope.enabled=false;next.pulse.lengthHalt=true;}
      if(patch.envelope!==undefined)next.pulse.envelope={enabled:true,period:patch.envelope.period,loop:patch.envelope.loop??false};
      if(patch.sweep!==undefined)next.pulse.sweep={enabled:false,period:0,negate:false,shift:0,...patch.sweep};
    } else if(method==='noise.setVoice') {
      Object.assign(next.noise,{volume:8,period:6,shortMode:false,...args[0],lengthHalt:true});next.noise.envelope.enabled=false;
    } else if(method==='fds.setWave'){next.fds.wave=Array.from(args[0]);this.assets.wave=Array.from(args[0]);}
    else if(method==='fds.setVolume'){next.fds.volume=args[0];next.fds.master=args[1]??0;next.fds.envelope.enabled=false;}
    else if(method==='fds.setModulation'){
      const {table,rate=0,depth=0,bias=0,enabled=true}=args[0];
      Object.assign(next.fds.modulation,{table:Array.from(table),rate,depth,bias,enabled});next.fds.modulation.envelope.enabled=false;
      this.assets.modulation=Array.from(table);
    }
    this.codePresets[channel]=next;
  }
  /** A raw hardware trigger replaces the preceding owner; ordinary register
   * modulation keeps it. Also useful to a reference-song register writer. */
  observeExternalWrite(address,value,session=null) {
    let ch=null;
    if([0x4003,0x4007,0x400b,0x400f].includes(address))ch=[0x4003,0x4007,0x400b,0x400f].indexOf(address);
    else if(address===0x4083)ch=5;
    if(ch!==null){this._forget(ch);if(session!==null){this.codeRaw[ch]=true;if(ch!==5||!(value&128))this._ownCode(ch,session);}}
    if(address===0x4015)for(let channel=0;channel<5;channel++)if(!(value&(1<<channel)))this._forget(channel);
    if(address===0x4015&&(value&16)&&session!==null)this._ownCode(4,session);
    if(address>=0x4000&&address<=0x400f)this.codeRaw[(address-0x4000)>>2]=true;
    else if(address>=0x4010&&address<=0x4013)this.codeRaw[4]=true;
    else if(address>=0x4040&&address<=0x408a)this.codeRaw[5]=true;
    if(address>=0x4040&&address<=0x407f)this.assets.wave=null;
    if(address===0x4088)this.assets.modulation=null;
  }
  stop() {
    this._open(); for (let channel = 0; channel < 6; channel++) this._stopChannel(channel);
    this.voices.clear(); this.slots.fill(null);this.owners.fill(null); this.cursor = 0; return this.read();
  }
  _stopChannel(channel) {
    this.synth.noteOff(channel);
    // The hardware DAC can retain its last level after the sample ends.
    // An explicit Synth release clears that level instead of leaving DC.
    if (channel === 4) this.synth.writeRegister(0x4011, 0);
  }
  generateStereo(frames) {this._open();if(this.codeActive)this.codeFrames+=frames; return this.core.generateStereo(frames);}
  dispose() {if (this.disposed) return; this.stop(); this.core.dispose(); this.disposed = true;}
}
