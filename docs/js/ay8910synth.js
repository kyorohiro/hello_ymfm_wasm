import {noteToHz} from './soundchip_pitch.js';
import {AY8910_CLOCK} from './ay8910.js?v=audio-stability-2';
export {AY8910_CLOCK} from './ay8910.js?v=audio-stability-2';
export {AY8910WorkletTransport} from './chip_worklet_transport.js?v=audio-numeric-bindings-1';

/** @typedef {{tone?:boolean,noise?:boolean,volume?:number,envelope?:boolean,
 * period?:number,frequency?:number,note?:string|number}} AY8910Voice
 * @typedef {{period?:number,frequency?:number,note?:string|number,volume?:number,envelope?:boolean}} AY8910Tone
 * @typedef {{writeRegister(register:number,value:number):void,reset?:()=>void,dispose?:()=>void}} AY8910Transport
 * @typedef {{registers:number[]|Uint8Array,levels?:number[]|Uint8Array}} AY8910State
 * @typedef {[number,number,number]} RegisterChange
 */
function integer(value,max,label) {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label} must be an integer 0..${max}`);
  return value;
}
function boolean(value,label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}
function options(value,keys,label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Reflect.ownKeys(value)) if (!keys.includes(key)) throw new TypeError(`Unknown ${label} field: ${String(key)}`);
}
function masterClock(clock) {
  if (!Number.isInteger(clock) || clock <= 0 || clock > 0x3fffffff) throw new RangeError('AY clock must be positive integer Hz, at most 0x3fffffff');
  return clock;
}
/** AY tone frequency = clock / (16 * period). Raw zero periods behave as one.
 * @param {number} frequency @param {number} [clock] @returns {number} */
export function ay8910PeriodFromHz(frequency,clock = AY8910_CLOCK) {
  masterClock(clock);
  if (!Number.isFinite(frequency) || frequency < clock/(16*4095) || frequency > clock/16) throw new RangeError('Frequency is outside the AY 12-bit tone-period range');
  return Math.max(1,Math.min(4095,Math.round(clock/(16*frequency))));
}

/** Borrow a synchronous AY chip. Its clock was fixed by Ay8910.create(); the
 * Synth's clock must match it. This adapter never owns or disposes the chip.
 * Native normalized DAC output retains a constant DC baseline at volume zero;
 * speaker transports additionally mute silent channels for exact zero PCM. */
export class AY8910DirectTransport {
  /** @param {import('./ay8910.js?v=audio-stability-2').Ay8910} chip */
  constructor(chip) {
    if (!chip || typeof chip.writeRegister !== 'function' || typeof chip.reset !== 'function') throw new TypeError('AY8910DirectTransport requires writeRegister() and reset()');
    this.chip = chip;
  }
  /** @param {number} register @param {number} value */
  writeRegister(register,value) {integer(register,15,'Register'); integer(value,255,'Value'); this.chip.writeRegister(register,value);}
  reset() {this.chip.reset();}
  sampleRate() {return this.chip.sampleRate();}
  /** @param {number} frames */
  generateStereo(frames) {return this.chip.generateStereo(frames);}
}

/** Three AY-3-8910 physical voices. Each mixes tone and the one shared noise
 * source, then uses fixed volume or the one shared envelope. Volume 0 is silent;
 * 15 is loudest. Construction never resets or writes a borrowed transport.
 *
 * keyOff() silences a voice while retaining its configured level. keyOn()
 * restores that level and preserves tone/noise gates, including noise-only
 * voices. Shared noise/envelope edits affect all voices using those sources.
 */
export class AY8910Synth {
  #registers = new Uint8Array(16);
  #levels = new Uint8Array(3).fill(9);
  /** @param {{transport:AY8910Transport,clock?:number}} settings */
  constructor({transport,clock = AY8910_CLOCK} = {}) {
    if (!transport || typeof transport.writeRegister !== 'function') throw new TypeError('AY8910Synth requires writeRegister(register,value)');
    this.transport = transport; this.clock = masterClock(clock); this.chip = 'ay8910'; this.channels = 3;
    /** @type {((register:number,value:number)=>boolean|void)|undefined} */ this._beforeWrite = undefined;
    /** @type {((event:{method:string,args:number[],channel?:number})=>void)|undefined} */ this._observe = undefined;
  }
  reset() {
    this.transport.reset?.(); this.#registers.fill(0); this.#levels.fill(9);
    this._observe?.({method:'reset',args:[]});
  }
  /** Reset to silent A4 tone-only voices. Actual volume registers are zero;
   * keyOn restores configured volume 9. I/O ports are untouched after reset. */
  initialize() {
    this.reset();
    // Disabling both generators with a nonzero volume creates DC on an AY;
    // use volume zero for silence, with the intended tone-only mixer retained.
    this.writeRegister(7,0x38); this.setNoisePeriod(16);
    for (let ch = 0; ch < 3; ch++) {this.setFrequency(ch,440); this.writeRegister(8+ch,0);}
    this.#levels.fill(9);
  }
  getRegisterSnapshot() {return this.#registers.slice();}
  /** Adopt raw registers without writes. Zero output levels lack keyOff's
   * retained-voice metadata, so they default to level 9 for a new audition.
   * Use _adoptState() to preserve an intentionally configured zero level.
   * @param {Uint8Array|number[]} snapshot */
  adoptRegisterSnapshot(snapshot) {
    if (!(snapshot instanceof Uint8Array || Array.isArray(snapshot)) || snapshot.length !== 16) throw new RangeError('Expected sixteen AY register bytes');
    const values = Array.from(snapshot,value => integer(value,255,'Register value'));
    this.#registers.set(values);
    for (let ch = 0; ch < 3; ch++) this.#levels[ch] = (values[8+ch]&31) || 9;
  }
  /** Full musical state includes the levels retained by keyOff(). */
  _getState() {return {registers:Array.from(this.#registers),levels:Array.from(this.#levels)};}
  /** No writes; validates the complete state before adoption.
   * @param {AY8910State} state */
  _adoptState(state) {
    options(state,['registers','levels'],'AY state');
    if (state.levels !== undefined && (!(state.levels instanceof Uint8Array || Array.isArray(state.levels)) || state.levels.length !== 3)) throw new RangeError('Expected three retained AY levels');
    const levels = state.levels === undefined ? undefined : Array.from(state.levels,value => integer(value,31,'Retained level'));
    this.adoptRegisterSnapshot(state.registers);
    if (levels) this.#levels.set(levels);
  }
  /** @param {number} register @param {number} value */
  writeRegister(register,value) {
    integer(register,15,'Register'); integer(value,255,'Value');
    if (this._beforeWrite?.(register,value) === false) return;
    this.transport.writeRegister(register,value); this.#registers[register] = value;
    if (register >= 8 && register <= 10) this.#levels[register-8] = value&31;
    const channel = register < 6 ? Math.floor(register/2) : register >= 8 && register <= 10 ? register-8 : undefined;
    this._observe?.({method:'writeRegister',args:[register,value],channel});
  }
  #channel(ch) {return integer(ch,2,'AY channel');}
  /** @param {RegisterChange[]} changes */
  #apply(changes) {for (const [register,mask,value] of changes) this.writeRegister(register,(this.#registers[register]&~mask)|value);}
  /** @param {number} ch @param {number} period @returns {RegisterChange[]} */
  #pitchChanges(ch,period) {this.#channel(ch); integer(period,4095,'Tone period'); return [[ch*2,255,period&255],[ch*2+1,15,period>>8]];}
  /** @param {number} ch @param {AY8910Voice} voice @returns {RegisterChange[]} */
  #voiceChanges(ch,voice) {
    this.#channel(ch); options(voice,['tone','noise','volume','envelope','period','frequency','note'],'AY voice');
    /** @type {RegisterChange[]} */ const changes = [];
    const pitches = ['period','frequency','note'].filter(name => voice[name] !== undefined);
    if (pitches.length > 1) throw new TypeError('Specify one of period, frequency or note');
    if (pitches.length) {
      const period = voice.period !== undefined ? integer(voice.period,4095,'Tone period') : ay8910PeriodFromHz(voice.frequency ?? noteToHz(voice.note),this.clock);
      changes.push(...this.#pitchChanges(ch,period));
    }
    if (voice.tone !== undefined) changes.push([7,1<<ch,boolean(voice.tone,'Tone gate') ? 0 : 1<<ch]);
    if (voice.noise !== undefined) changes.push([7,8<<ch,boolean(voice.noise,'Noise gate') ? 0 : 8<<ch]);
    if (voice.volume !== undefined || voice.envelope !== undefined) {
      const volume = voice.volume === undefined ? this.#levels[ch]&15 : integer(voice.volume,15,'Volume');
      const envelope = voice.envelope === undefined ? Boolean(this.#levels[ch]&16) : boolean(voice.envelope,'Envelope');
      changes.push([8+ch,31,volume|(envelope?16:0)]);
    }
    return changes;
  }
  /** Atomic partial voice edit. Pitch, mixer and loudness are independent.
   * @param {number} ch @param {AY8910Voice} voice */
  setVoice(ch,voice) {this.#apply(this.#voiceChanges(ch,voice));}
  /** Start a tone-only voice, preserving unspecified volume/envelope settings.
   * @param {number} ch @param {AY8910Tone} [settings] @returns {number} Tone period. */
  tone(ch,settings = {}) {
    this.#channel(ch); options(settings,['period','frequency','note','volume','envelope'],'AY tone');
    const voice = {volume:this.#levels[ch]&15,envelope:Boolean(this.#levels[ch]&16),...settings,tone:true,noise:false};
    const changes = this.#voiceChanges(ch,voice); this.#apply(changes);
    return this.#registers[ch*2]|((this.#registers[ch*2+1]&15)<<8);
  }
  /** @param {number} ch @param {AY8910Tone} [settings] */
  setTone(ch,settings = {}) {return this.tone(ch,settings);}
  /** Start a noise-only voice. The period belongs to the shared noise source.
   * @param {number} ch @param {{period?:number,volume?:number,envelope?:boolean}} [settings] */
  noise(ch,settings = {}) {
    this.#channel(ch); options(settings,['period','volume','envelope'],'AY noise');
    const period = settings.period === undefined ? this.#registers[6]&31 : integer(settings.period,31,'Noise period');
    const voice = {tone:false,noise:true,volume:settings.volume === undefined ? this.#levels[ch]&15 : settings.volume,envelope:settings.envelope === undefined ? Boolean(this.#levels[ch]&16) : settings.envelope};
    const changes = this.#voiceChanges(ch,voice); this.#apply([[6,31,period],...changes]);
  }
  /** Gates are independent; both tone and noise may be enabled on one voice.
   * @param {number} ch @param {{tone?:boolean,noise?:boolean}} gates */
  setMixer(ch,gates) {options(gates,['tone','noise'],'AY mixer'); this.setVoice(ch,gates);}
  /** Fixed loudness, 0=silent and 15=loudest; optional envelope selection.
   * Omitted envelope preserves the configured selection even after keyOff().
   * @param {number} ch @param {number} volume @param {boolean} [envelope] */
  setVolume(ch,volume,envelope = undefined) {integer(volume,15,'Volume'); this.setVoice(ch,{volume,envelope});}
  /** @param {number} ch @param {number} period */
  setTonePeriod(ch,period) {this.#apply(this.#pitchChanges(ch,period));}
  /** @param {number} ch @param {number} frequency */
  setFrequency(ch,frequency) {this.#channel(ch); const period = ay8910PeriodFromHz(frequency,this.clock); this.setTonePeriod(ch,period); return period;}
  /** @param {number} ch @param {string|number} note */
  setNote(ch,note) {return this.setFrequency(ch,noteToHz(note));}
  /** @param {number} period Shared five-bit noise period. */
  setNoisePeriod(period) {integer(period,31,'Noise period'); this.#apply([[6,31,period]]);}
  /** Shared envelope. Writing shape retriggers it; a period-only edit does not.
   * @param {{period?:number,shape?:number}} envelope */
  setEnvelope(envelope) {
    options(envelope,['period','shape'],'AY envelope');
    /** @type {RegisterChange[]} */ const changes = [];
    if (envelope.period !== undefined) {integer(envelope.period,65535,'Envelope period'); changes.push([11,255,envelope.period&255],[12,255,envelope.period>>8]);}
    if (envelope.shape !== undefined) changes.push([13,15,integer(envelope.shape,15,'Envelope shape')]);
    this.#apply(changes);
  }
  /** Restore configured level and retain the current tone/noise combination.
   * @param {number} ch */
  keyOn(ch) {this.#channel(ch); this.#apply([[8+ch,31,this.#levels[ch]]]);}
  /** Silence while retaining configured volume/envelope, pitch and mixer.
   * @param {number} ch */
  keyOff(ch) {this.#channel(ch); const level = this.#levels[ch]; this.#apply([[8+ch,31,0]]); this.#levels[ch] = level;}
  /** MIDI changes tone pitch; noise-only voices retain their noise sound.
   * @param {number} ch @param {string|number} note */
  noteOn(ch,note) {this.#channel(ch); const period = ay8910PeriodFromHz(noteToHz(note),this.clock); this.setTonePeriod(ch,period); this.keyOn(ch);}
  /** @param {number} ch */
  noteOff(ch) {this.keyOff(ch);}
  /** @param {number} ch */
  off(ch) {this.keyOff(ch);}
  allNotesOff() {for (let ch = 0; ch < 3; ch++) this.keyOff(ch);}
}
