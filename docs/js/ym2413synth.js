import {noteToHz} from './soundchip_pitch.js';
import {YM2413_CLOCK} from './ym2413.js?v=audio-stability-2';
export {YM2413_CLOCK} from './ym2413.js?v=audio-stability-2';
export {YM2413WorkletTransport} from './chip_worklet_transport.js?v=audio-numeric-bindings-1';

/** @typedef {{am?:boolean|number,vibrato?:boolean|number,egt?:boolean|number,sustain?:boolean|number,
 * ksr?:boolean|number,multi?:number,mul?:number,ksl?:number,tl?:number,ar?:number,dr?:number,
 * sl?:number,rr?:number,waveform?:number}} YM2413UserOperatorParams
 * @typedef {{label?:string,feedback?:number,operators?:YM2413UserOperatorParams[]}} YM2413UserPatch
 * @typedef {{instrument?:number,attenuation?:number,sustain?:boolean}} YM2413Voice
 * @typedef {YM2413Voice & {userPatch?:YM2413UserPatch|Uint8Array|number[]}} YM2413Preset
 * @typedef {'bassDrum'|'snare'|'tom'|'cymbal'|'hiHat'} YM2413Drum
 * @typedef {{bassDrum?:number,snare?:number,tom?:number,cymbal?:number,hiHat?:number}} YM2413RhythmLevels
 * @typedef {{enabled?:boolean,bassDrum?:boolean,snare?:boolean,tom?:boolean,cymbal?:boolean,hiHat?:boolean}} YM2413Rhythm
 * @typedef {{writeRegister(register:number,value:number):void,reset?:()=>void,dispose?:()=>void}} YM2413Transport
 * @typedef {[number,number,number]} RegisterChange
 */

const userFields = {
  am:[0,7,1], vibrato:[0,6,1], egt:[0,5,1], sustain:[0,5,1],
  ksr:[0,4,1], multi:[0,0,15], mul:[0,0,15],
  ar:[4,4,15], dr:[4,0,15], sl:[6,4,15], rr:[6,0,15],
};
const rhythmBits = {enabled:5,bassDrum:4,snare:3,tom:2,cymbal:1,hiHat:0};
const rhythmLevels = {bassDrum:[0x36,0],snare:[0x37,0],tom:[0x38,4],cymbal:[0x38,0],hiHat:[0x37,4]};
function integer(value,maximum,label) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`${label} must be an integer 0..${maximum}`);
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
  if (!Number.isFinite(clock) || clock <= 0) throw new RangeError('Clock must be positive finite Hz');
  return clock;
}

/** OPLL's F-NUM is nine bits, unlike OPL's ten bits. At multiplier one,
 * frequency = (clock / 72) * F-NUM * 2^(BLOCK - 19).
 * @param {number} frequency Frequency in Hz. @param {number} [clock]
 * @returns {{fnum:number,block:number}} */
export function ym2413PitchFromHz(frequency,clock = YM2413_CLOCK) {
  masterClock(clock);
  if (!Number.isFinite(frequency) || frequency <= 0) throw new RangeError('Frequency must be positive finite Hz');
  const minimum = clock / (72 * 2 ** 19);
  if (frequency < minimum || frequency > minimum * 511 * 128) throw new RangeError('Frequency is outside the YM2413 BLOCK/F-NUM range');
  let best = {fnum:1,block:0}, error = Infinity;
  for (let block = 0; block < 8; block++) {
    const unit = minimum * 2 ** block, fnum = Math.round(frequency / unit);
    if (fnum < 1 || fnum > 511) continue;
    const difference = Math.abs(unit * fnum - frequency);
    if (difference < error) {best = {fnum,block}; error = difference;}
  }
  return best;
}

/** Borrow a synchronous YM2413 chip without creating or owning an audio device. */
export class YM2413DirectTransport {
  /** @param {import('./ym2413.js?v=audio-stability-2').Ym2413} chip @param {{clock?:number}} [options] */
  constructor(chip,{clock = YM2413_CLOCK} = {}) {
    if (!chip || typeof chip.write !== 'function' || typeof chip.reset !== 'function') throw new TypeError('YM2413DirectTransport requires a chip with write() and reset()');
    this.chip = chip; this.clock = masterClock(clock);
  }
  /** @param {number} offset @param {number} value */
  write(offset,value) {this.chip.write(offset,value);}
  /** @param {number} register @param {number} value */
  writeRegister(register,value) {
    integer(register,63,'Register'); integer(value,255,'Value');
    this.chip.write(0,register); this.chip.write(1,value);
  }
  reset() {this.chip.reset();}
  sampleRate() {return this.chip.sampleRate(this.clock);}
  /** Both melody and percussion buses are mono and summed to left and right.
   * @param {number} frames */
  generateStereo(frames) {return this.chip.generateStereo(frames);}
  readStatus() {return this.chip.readStatus();}
  getIrq() {return this.chip.getIrq();}
}

/** YM2413 OPLL: nine two-operator melody voices, or six melody voices and five
 * percussion instruments. Physical channels are zero-based. Instruments 1..15
 * use the chip's built-in voices; all instrument-0 channels share one user
 * patch in registers 0..7. Editing it changes every instrument-0 voice.
 *
 * Construction makes no writes. initialize() explicitly resets and installs
 * a useful shared user patch while leaving every channel silent. Attach to
 * existing playback with adoptRegisterSnapshot(), which makes no writes.
 */
export class YM2413Synth {
  #registers = new Uint8Array(64);
  /** @param {{transport:YM2413Transport,clock?:number}} options */
  constructor({transport,clock = YM2413_CLOCK} = {}) {
    if (!transport || typeof transport.writeRegister !== 'function') throw new TypeError('YM2413Synth requires writeRegister(register,value)');
    this.transport = transport; this.clock = masterClock(clock);
    this.chip = 'ym2413'; this.channels = 9;
    /** @type {((register:number,value:number)=>boolean|void)|undefined} */
    this._beforeWrite = undefined;
    /** @type {((event:{method:string,args:number[],channel?:number})=>void)|undefined} */
    this._observe = undefined;
  }
  reset() {
    this.transport.reset?.(); this.#registers.fill(0);
    this._observe?.({method:'reset',args:[]});
  }
  /** Reset, load the original sine user patch, and select silent Violin voices. */
  initialize() {
    this.reset(); this.setUserPatch(YM2413_USER_PRESETS.sine);
    for (let ch = 0; ch < 9; ch++) this.setVoice(ch,{instrument:1,attenuation:15,sustain:false});
  }
  getRegisterSnapshot() {return this.#registers.slice();}
  /** Replace the authoring shadow without replaying or resetting hardware.
   * @param {Uint8Array|number[]} snapshot */
  adoptRegisterSnapshot(snapshot) {
    if (!(snapshot instanceof Uint8Array || Array.isArray(snapshot)) || snapshot.length !== 64) throw new RangeError('Expected 64 register bytes');
    const values = Array.from(snapshot,value => integer(value,255,'Register value'));
    this.#registers.set(values);
  }
  /** @param {number} register Address 0..63. @param {number} value Byte 0..255. */
  writeRegister(register,value) {
    integer(register,63,'Register'); integer(value,255,'Value');
    if (this._beforeWrite?.(register,value) === false) return;
    this.transport.writeRegister(register,value); this.#registers[register] = value;
    const base = register & 0xf0, local = register & 15;
    const channel = base >= 0x10 && base <= 0x30 && local < 9 ? local : undefined;
    this._observe?.({method:'writeRegister',args:[register,value],channel});
  }
  #channel(ch) {return integer(ch,8,'YM2413 channel');}
  #melody(ch) {
    this.#channel(ch);
    if (ch >= 6 && (this.#registers[0x0e] & 0x20)) throw new RangeError('Rhythm mode reserves channels 6..8; use rhythm controls');
    return ch;
  }
  /** @param {RegisterChange[]} changes */
  #apply(changes) {
    for (const [register,mask,value] of changes) this.writeRegister(register,(this.#registers[register] & ~mask) | value);
  }
  /** @param {number} ch @param {YM2413Voice} voice @returns {RegisterChange[]} */
  #voiceChanges(ch,voice) {
    this.#melody(ch); options(voice,['instrument','attenuation','sustain'],'YM2413 voice');
    /** @type {RegisterChange[]} */ const changes = [];
    if (voice.instrument !== undefined) changes.push([0x30+ch,0xf0,integer(voice.instrument,15,'Instrument') << 4]);
    if (voice.attenuation !== undefined) changes.push([0x30+ch,15,integer(voice.attenuation,15,'Attenuation')]);
    if (voice.sustain !== undefined) changes.push([0x20+ch,32,boolean(voice.sustain,'Sustain') ? 32 : 0]);
    return changes;
  }
  /** Per-channel instrument and output attenuation. 0=loud, 15=quiet.
   * This does not allocate a separate instrument-0 patch for the channel.
   * @param {number} ch @param {YM2413Voice} voice */
  setVoice(ch,voice) {this.#apply(this.#voiceChanges(ch,voice));}
  /** @param {number} ch @param {number} instrument @param {number} [attenuation] */
  setInstrument(ch,instrument,attenuation = undefined) {this.setVoice(ch,{instrument,attenuation});}
  /** @param {number} ch @param {number} attenuation 0=loud, 15=quiet. */
  setAttenuation(ch,attenuation) {this.setVoice(ch,{attenuation});}
  /** Channel sustain flag; separate from the shared operators' EGT bits.
   * @param {number} ch @param {boolean} enabled */
  setSustain(ch,enabled) {this.#channel(ch); boolean(enabled,'Sustain'); this.#apply([[0x20+ch,32,enabled ? 32 : 0]]);}
  /** Select a built-in instrument, or apply a shared user patch and select 0.
   * A userPatch changes all existing instrument-0 voices, not just this channel.
   * The complete preset is validated before any writes.
   * @param {number} ch @param {number|YM2413Preset} preset */
  setPreset(ch,preset) {
    this.#melody(ch);
    if (typeof preset === 'number') {this.setInstrument(ch,preset); return;}
    options(preset,['instrument','attenuation','sustain','userPatch'],'YM2413 preset');
    const {userPatch,...voice} = preset;
    /** @type {RegisterChange[]} */ const changes = [];
    if (userPatch !== undefined) {
      if (voice.instrument !== undefined && voice.instrument !== 0) throw new RangeError('A userPatch requires instrument 0');
      changes.push(...this.#patchChanges(userPatch)); voice.instrument = 0;
    }
    changes.push(...this.#voiceChanges(ch,voice)); this.#apply(changes);
  }
  /** @param {number} op @param {YM2413UserOperatorParams} params @returns {RegisterChange[]} */
  #operatorChanges(op,params) {
    integer(op,1,'User operator');
    options(params,[...Object.keys(userFields),'ksl','tl','waveform'],'YM2413 user operator');
    /** @type {RegisterChange[]} */ const changes = [];
    const seen = new Set();
    for (const [name,value] of Object.entries(params)) {
      let field = userFields[name];
      if (field) field = [field[0]+op,field[1],field[2]];
      else if (name === 'ksl') field = [2+op,6,3];
      else if (name === 'tl') {
        if (op !== 0) throw new RangeError('Carrier level is per-channel attenuation; only the modulator has user-patch TL');
        field = [2,0,63];
      } else field = [3,3+op,1]; // OPLL's two independent rectified-wave flags.
      const [register,shift,max] = field, alias = `${register}:${shift}`;
      if (seen.has(alias)) throw new TypeError(`Duplicate YM2413 operator aliases: ${name}`);
      seen.add(alias);
      const normalized = max === 1 && typeof value === 'boolean' ? Number(value) : integer(value,max,name);
      changes.push([register,max << shift,normalized << shift]);
    }
    return changes;
  }
  /** Edit one of the two shared user-patch operators, preserving adjacent bits.
   * Operator 0 is the modulator, 1 the carrier. There is no per-channel user
   * patch. Carrier loudness is setAttenuation(channel, level), not operator TL.
   * @param {number} op @param {YM2413UserOperatorParams} params */
  setUserOperator(op,params) {this.#apply(this.#operatorChanges(op,params));}
  /** @param {YM2413UserPatch|Uint8Array|number[]} patch @returns {RegisterChange[]} */
  #patchChanges(patch) {
    if (patch instanceof Uint8Array || Array.isArray(patch)) {
      if (patch.length !== 8) throw new RangeError('A YM2413 user patch requires exactly eight bytes');
      return Array.from(patch,(value,register) => /** @type {RegisterChange} */ ([register,255,integer(value,255,'Patch byte')]));
    }
    options(patch,['label','feedback','operators'],'YM2413 user patch');
    if (patch.label !== undefined && typeof patch.label !== 'string') throw new TypeError('Patch label must be a string');
    /** @type {RegisterChange[]} */ const changes = [];
    if (patch.feedback !== undefined) changes.push([3,7,integer(patch.feedback,7,'Feedback')]);
    if (patch.operators !== undefined) {
      if (!Array.isArray(patch.operators) || patch.operators.length > 2) throw new RangeError('Expected up to two shared user-patch operators');
      for (let op = 0; op < patch.operators.length; op++) if (patch.operators[op] !== undefined) changes.push(...this.#operatorChanges(op,patch.operators[op]));
    }
    return changes;
  }
  /** Partial structured edits, or a complete eight-byte hardware patch.
   * Changes immediately affect every channel selecting instrument 0.
   * @param {YM2413UserPatch|Uint8Array|number[]} patch */
  setUserPatch(patch) {this.#apply(this.#patchChanges(patch));}
  /** Raw nine-bit F-NUM and three-bit BLOCK; preserves key/sustain/reserved bits.
   * In rhythm mode this also tunes the physical percussion voices on CH6..8.
   * @param {number} ch @param {number} fnum @param {number} [block] */
  setPitch(ch,fnum,block = 0) {
    this.#channel(ch); integer(fnum,511,'F-NUM'); integer(block,7,'Block');
    this.#apply([[0x10+ch,255,fnum & 255],[0x20+ch,15,(block << 1) | (fnum >> 8)]]);
  }
  /** @param {number} ch @param {number} frequency Hz at this synth's master clock. */
  setFrequency(ch,frequency) {
    this.#channel(ch); const pitch = ym2413PitchFromHz(frequency,this.clock);
    this.setPitch(ch,pitch.fnum,pitch.block); return pitch;
  }
  /** @param {number} ch @param {string|number} note A4 = MIDI 69 = 440 Hz. */
  setNote(ch,note) {return this.setFrequency(ch,noteToHz(note));}
  /** @param {number} ch */
  keyOn(ch) {this.#melody(ch); this.#apply([[0x20+ch,16,16]]);}
  /** Release the normal melodic key source, preserving pitch and sustain.
   * @param {number} ch */
  keyOff(ch) {this.#channel(ch); this.#apply([[0x20+ch,16,0]]);}
  /** Set pitch and assert a melodic key. For a new attack, release first and
   * allow PCM time between the release and next key-on.
   * @param {number} ch @param {string|number} note */
  noteOn(ch,note) {
    this.#melody(ch); const pitch = ym2413PitchFromHz(noteToHz(note),this.clock);
    this.setPitch(ch,pitch.fnum,pitch.block); this.keyOn(ch);
  }
  /** @param {number} ch */
  noteOff(ch) {this.keyOff(ch);}
  allNotesOff() {
    for (let ch = 0; ch < 9; ch++) this.#apply([[0x20+ch,16,0]]);
    this.#apply([[0x0e,31,0]]);
  }
  /** Enable percussion and/or partially edit its five trigger bits. Changing
   * mode releases the normal CH6..8 keys. Registers 0x36..0x38 stay shared:
   * disabling rhythm does not restore previous melodic instrument selections.
   * @param {YM2413Rhythm} settings */
  setRhythm(settings) {
    options(settings,Object.keys(rhythmBits),'YM2413 rhythm');
    /** @type {RegisterChange[]} */ const changes = [];
    for (const [name,value] of Object.entries(settings)) {
      boolean(value,name); const mask = 1 << rhythmBits[name];
      changes.push([0x0e,mask,value ? mask : 0]);
    }
    if (settings.enabled !== undefined && settings.enabled !== Boolean(this.#registers[0x0e] & 32)) {
      changes.unshift(...[6,7,8].map(ch => /** @type {RegisterChange} */ ([0x20+ch,16,0])));
    }
    this.#apply(changes);
  }
  /** Per-drum attenuation, 0=loud, 15=quiet. BD uses 0x36 low nibble;
   * HH/SD use 0x37 high/low, TOM/CYM use 0x38 high/low. While rhythm is off,
   * the HH and TOM nibbles are CH7/8's melodic instrument numbers: no separate
   * virtual copy is kept. These writes are permitted before enabling rhythm.
   * @param {YM2413RhythmLevels} levels */
  setRhythmLevels(levels) {
    options(levels,Object.keys(rhythmLevels),'YM2413 rhythm levels');
    /** @type {RegisterChange[]} */ const changes = [];
    for (const [name,value] of Object.entries(levels)) {
      const [register,shift] = rhythmLevels[name];
      changes.push([register,15 << shift,integer(value,15,name) << shift]);
    }
    this.#apply(changes);
  }
  /** @param {YM2413Drum} drum @param {number} attenuation */
  setRhythmLevel(drum,attenuation) {
    if (!Object.hasOwn(rhythmLevels,drum)) throw new RangeError('Expected bassDrum, snare, tom, cymbal or hiHat');
    this.setRhythmLevels({[drum]:attenuation});
  }
}

/** Built-in instrument names, indexed by hardware instrument number 0..15.
 * These are labels, not copied ROM patch bytes. Instrument 0 is caller-defined.
 * @type {readonly string[]} */
export const YM2413_INSTRUMENTS = Object.freeze(['User','Violin','Guitar','Piano','Flute','Clarinet','Oboe','Trumpet','Organ','Horn','Synthesizer','Harpsichord','Vibraphone','Synthesizer Bass','Acoustic Bass','Electric Guitar']);

const userOperator = {am:false,vibrato:false,egt:true,ksr:false,multi:1,ksl:0,ar:15,dr:0,sl:0,rr:12,waveform:0};
function freezePatch(patch) {
  for (const op of patch.operators) Object.freeze(op);
  Object.freeze(patch.operators); return Object.freeze(patch);
}
/** Original shared user patches, constructed from hardware parameters.
 * Carrier attenuation belongs to each voice and is not part of these patches.
 * @type {Readonly<Record<string,YM2413UserPatch>>} */
export const YM2413_USER_PRESETS = Object.freeze({
  sine:freezePatch({label:'Original sine',feedback:0,operators:[{...userOperator,tl:63},{...userOperator}]}),
  bell:freezePatch({label:'Original bell',feedback:0,operators:[{...userOperator,multi:3,tl:26,egt:false,dr:7,sl:8,rr:8},{...userOperator,egt:false,dr:4,sl:8,rr:7}]}),
});
