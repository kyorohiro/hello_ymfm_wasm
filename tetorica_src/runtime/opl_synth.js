import {noteToHz} from './soundchip_pitch.js';

/** @typedef {'ym3526'|'ym3812'|'y8950'|'ymf262'} OPLChip
 * @typedef {OPLChip} OPLChipName
 * @typedef {{am?:boolean|number,vibrato?:boolean|number,egt?:boolean|number,sustain?:boolean|number,
 * ksr?:boolean|number,multi?:number,mul?:number,ksl?:number,tl?:number,ar?:number,dr?:number,
 * sl?:number,rr?:number,waveform?:number}} OPLOperatorParams
 * @typedef {{label?:string,name?:string,algorithm?:number,feedback?:number,fourOp?:boolean,
 * pan?:{left?:boolean,right?:boolean},operators?:OPLOperatorParams[]}} OPLPreset
 * @typedef {{writeRegister(register:number,value:number,port?:number):void,reset?:()=>void,dispose?:()=>void}} OPLTransport
 * @typedef {[number,number,number]} RegisterChange
 */

const configurations = Object.freeze({
  ym3526: {clock:3579545, channels:9, divider:72, waveform:0},
  ym3812: {clock:3579545, channels:9, divider:72, waveform:3},
  y8950: {clock:3579545, channels:9, divider:72, waveform:0},
  ymf262: {clock:14318180, channels:18, divider:288, waveform:7},
});
const operatorSlots = [0,1,2,8,9,10,16,17,18];
const operatorFields = {
  am:[0x20,7,1], vibrato:[0x20,6,1], egt:[0x20,5,1], sustain:[0x20,5,1],
  ksr:[0x20,4,1], multi:[0x20,0,15], mul:[0x20,0,15],
  ksl:[0x40,6,3], tl:[0x40,0,63], ar:[0x60,4,15], dr:[0x60,0,15],
  sl:[0x80,4,15], rr:[0x80,0,15], waveform:[0xe0,0,7],
};
const operatorDefaults = {am:false, vibrato:false, egt:true, ksr:false, multi:1, ksl:0, tl:63, ar:15, dr:0, sl:0, rr:12, waveform:0};

function integer(value, maximum, label) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`${label} must be an integer 0..${maximum}`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean`);
  return value;
}
function options(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  for (const key of Reflect.ownKeys(value)) if (!keys.includes(key)) throw new TypeError(`Unknown ${label} field: ${String(key)}`);
}
function configuration(chip) {
  if (!Object.hasOwn(configurations, chip)) throw new RangeError('Expected ym3526, ym3812, y8950 or ymf262');
  return configurations[chip];
}
function masterClock(clock) {
  if (!Number.isFinite(clock) || clock <= 0) throw new RangeError('Clock must be positive finite Hz');
  return clock;
}

/** Convert Hz to the closest representable OPL BLOCK/F-NUM pair.
 * OPL/OPL2 generate at clock/72; OPL3 uses clock/288. A multiplier of one
 * advances the 20-bit phase by F-NUM * 2^BLOCK each native PCM sample.
 * @param {number} frequency @param {number} [clock] @param {OPLChip} [chip]
 * @returns {{fnum:number,block:number}} */
export function oplPitchFromHz(frequency, clock = undefined, chip = 'ym3812') {
  const config = configuration(chip);
  clock = masterClock(clock ?? config.clock);
  if (!Number.isFinite(frequency) || frequency <= 0) throw new RangeError('Frequency must be positive finite Hz');
  const minimum = clock / (config.divider * 2 ** 20);
  if (frequency < minimum || frequency > minimum * 1023 * 128) throw new RangeError('Frequency is outside the OPL BLOCK/F-NUM range');
  let best = {fnum:1, block:0}, error = Infinity;
  for (let block = 0; block < 8; block++) {
    const unit = minimum * 2 ** block;
    const fnum = Math.round(frequency / unit);
    if (fnum < 1 || fnum > 1023) continue;
    const difference = Math.abs(unit * fnum - frequency);
    if (difference < error) {best = {fnum,block}; error = difference;}
  }
  return best;
}

/** Borrow a synchronous chip. The transport does not own or dispose the chip. */
export class OPLDirectTransport {
  /** @param {{write(offset:number,value:number):void,reset():void,sampleRate?:(clock?:number)=>number,
   * generateStereo?:(frames:number)=>{left:Float32Array,right:Float32Array},readStatus?:()=>number,getIrq?:()=>boolean}} chip
   * @param {{chip?:OPLChip,clock?:number}} [options] */
  constructor(chip, {chip:kind = 'ym3812', clock = undefined} = {}) {
    const config = configuration(kind);
    if (!chip || typeof chip.write !== 'function' || typeof chip.reset !== 'function') throw new TypeError('OPLDirectTransport requires a chip with write() and reset()');
    this.chip = chip;
    this.kind = kind;
    this.clock = masterClock(clock ?? config.clock);
  }
  /** @param {number} offset @param {number} value */
  write(offset, value) {this.chip.write(offset,value);}
  /** Byte register plus port, or a flattened OPL3 register address (0..511).
   * @param {number} register @param {number} value @param {number} [port] */
  writeRegister(register, value, port = 0) {
    integer(register, this.kind === 'ymf262' ? 511 : 255, 'Register');
    integer(value,255,'Value'); integer(port,this.kind === 'ymf262' ? 1 : 0,'Port');
    if (register > 255 && port !== 0) throw new RangeError('Use a flattened register or a port, not both');
    const bank = port || (register >> 8);
    this.chip.write(bank * 2,register & 255); this.chip.write(bank * 2 + 1,value);
  }
  reset() {this.chip.reset();}
  sampleRate() {return this.chip.sampleRate?.(this.clock);}
  /** @param {number} frames */
  generateStereo(frames) {
    if (!this.chip.generateStereo) throw new TypeError('Chip does not provide generateStereo()');
    return this.chip.generateStereo(frames);
  }
  readStatus() {return this.chip.readStatus?.();}
  getIrq() {return this.chip.getIrq?.() ?? false;}
}

/** Nine-channel OPL/OPL2 or eighteen-channel OPL3 instrument authoring.
 * Channels are physical, zero-based. Logical operator order is modulator,
 * carrier (0,1); a four-operator voice appends the paired channel's operators
 * (2,3). OPL3 four-operator primaries are 0..2 and 9..11; each borrows CH+3.
 *
 * Construction never resets a borrowed chip. Call initialize() for silent,
 * centered defaults, or adoptRegisterSnapshot() when attaching to live state.
 * Raw writes made through this instance remain authoritative for partial edits.
 */
export class OPLSynth {
  #registers;
  /** @param {{transport:OPLTransport,chip?:OPLChip,clock?:number}} options */
  constructor({transport, chip = 'ym3812', clock = undefined} = {}) {
    const config = configuration(chip);
    if (!transport || typeof transport.writeRegister !== 'function') throw new TypeError('OPLSynth requires writeRegister(register,value,port)');
    this.transport = transport;
    this.chip = chip;
    this.clock = masterClock(clock ?? config.clock);
    this.channels = config.channels;
    this.#registers = new Uint8Array(chip === 'ymf262' ? 512 : 256);
    /** @type {((register:number,value:number,port:number)=>boolean|void)|undefined} */
    this._beforeWrite = undefined;
    /** @type {((event:{method:string,args:number[],channel?:number})=>void)|undefined} */
    this._observe = undefined;
  }
  /** Reset chip/core state without applying an instrument. */
  reset() {
    this.transport.reset?.(); this.#registers.fill(0);
    this._observe?.({method:'reset',args:[]});
  }
  /** Reset and install silent two-operator voices; enable OPL2/OPL3 waveforms. */
  initialize() {
    this.reset();
    if (this.chip === 'ym3812') this.writeRegister(1,0x20);
    if (this.chip === 'ymf262') this.writeRegister(5,1,1);
    for (let ch = 0; ch < this.channels; ch++) {
      this.setPreset(ch,{algorithm:0,feedback:0,pan:{left:true,right:true},operators:[operatorDefaults,operatorDefaults]});
    }
  }
  /** Copy of hardware register authoring state, indexed by (port << 8)|register. */
  getRegisterSnapshot() {return this.#registers.slice();}
  /** Adopt an entire register image without writing or resetting the hardware.
   * @param {Uint8Array|number[]} snapshot */
  adoptRegisterSnapshot(snapshot) {
    if (!(snapshot instanceof Uint8Array || Array.isArray(snapshot)) || snapshot.length !== this.#registers.length) throw new RangeError(`Expected ${this.#registers.length} register bytes`);
    const values = Array.from(snapshot,value => integer(value,255,'Register value'));
    this.#registers.set(values);
  }
  /** Raw byte register plus port, or flattened OPL3 register (0..511).
   * @param {number} register @param {number} value @param {number} [port] */
  writeRegister(register, value, port = 0) {
    integer(register,this.#registers.length - 1,'Register'); integer(value,255,'Value'); integer(port,this.chip === 'ymf262' ? 1 : 0,'Port');
    if (register > 255 && port !== 0) throw new RangeError('Use a flattened register or a port, not both');
    const address = register | (port << 8), bank = address >> 8, byte = address & 255;
    if (this._beforeWrite?.(byte,value,bank) === false) return;
    this.transport.writeRegister(byte,value,bank);
    this.#registers[address] = value;
    const local = byte & 15;
    const channel = byte >= 0xa0 && byte <= 0xc8 && local < 9 ? bank * 9 + local : undefined;
    this._observe?.({method:'writeRegister',args:[byte,value,bank],channel});
  }
  #channel(ch) {return integer(ch,this.channels - 1,`${this.chip.toUpperCase()} channel`);}
  #channelAddress(base,ch) {return ((Math.floor(ch / 9)) << 8) | (base + ch % 9);}
  #pairBit(ch) {return ch % 9 < 3 ? Math.floor(ch / 9) * 3 + ch % 9 : -1;}
  /** Whether this channel is an enabled four-operator primary. @param {number} ch */
  isFourOp(ch) {
    this.#channel(ch); const bit = this.#pairBit(ch);
    return this.chip === 'ymf262' && bit >= 0 && Boolean(this.#registers[0x104] & (1 << bit));
  }
  #voice(ch) {
    this.#channel(ch);
    if (ch % 9 >= 3 && ch % 9 < 6 && this.isFourOp(ch - 3)) throw new RangeError(`Channel ${ch} belongs to four-operator channel ${ch - 3}`);
    return ch;
  }
  /** @param {RegisterChange[]} changes */
  #apply(changes) {
    for (const [address,mask,value] of changes) this.writeRegister(address,(this.#registers[address] & ~mask) | value);
  }
  /** @param {number} ch @param {boolean} enabled @returns {RegisterChange[]} */
  #fourOpChanges(ch,enabled) {
    this.#channel(ch); boolean(enabled,'Four-operator mode');
    if (this.chip !== 'ymf262') {
      if (enabled) throw new RangeError('Four-operator mode requires YMF262');
      return [];
    }
    const bit = this.#pairBit(ch);
    if (bit < 0) {
      if (enabled) throw new RangeError('Four-operator primaries are channels 0..2 and 9..11');
      return [];
    }
    if (this.isFourOp(ch) === enabled) return [];
    // Clearing both physical keys before changing the operator map prevents a
    // held two-operator key from reviving later when the pair is disconnected.
    return [[this.#channelAddress(0xb0,ch),0x20,0],[this.#channelAddress(0xb0,ch+3),0x20,0],[0x104,1 << bit,enabled ? 1 << bit : 0]];
  }
  /** Enable/disable one YMF262 four-operator pair, stopping both keys first.
   * @param {number} ch Primary channel (0..2 or 9..11). @param {boolean} enabled */
  setFourOp(ch,enabled) {
    this.#channel(ch);
    if (this.chip === 'ymf262' && this.#pairBit(ch) < 0) throw new RangeError('Four-operator primaries are channels 0..2 and 9..11');
    this.#apply(this.#fourOpChanges(ch,enabled));
  }
  /** @param {number} ch @param {number} op @param {OPLOperatorParams} params @param {boolean} fourOp
   * @returns {RegisterChange[]} */
  #operatorChanges(ch,op,params,fourOp) {
    integer(op,fourOp ? 3 : 1,'Operator');
    options(params,Object.keys(operatorFields),'OPL operator');
    const channel = ch + (op >= 2 ? 3 : 0);
    const offset = (Math.floor(channel / 9) << 8) | (operatorSlots[channel % 9] + (op & 1) * 3);
    /** @type {RegisterChange[]} */ const changes = [];
    const seen = new Set();
    for (const [name,value] of Object.entries(params)) {
      const [base,shift,maximum] = operatorFields[name];
      const field = `${base}:${shift}`;
      if (seen.has(field)) throw new TypeError(`Duplicate OPL operator aliases: ${name}`);
      seen.add(field);
      const max = name === 'waveform' ? configurations[this.chip].waveform : maximum;
      const normalized = maximum === 1 && typeof value === 'boolean' ? Number(value) : integer(value,max,name);
      changes.push([base + offset,max << shift,normalized << shift]);
    }
    return changes;
  }
  /** Partial operator updates preserve adjacent bits, including prior raw writes.
   * KSL is the raw two-bit hardware code, not a sorted attenuation scale.
   * @param {number} ch @param {number} op @param {OPLOperatorParams} params */
  setOperator(ch,op,params) {this.#voice(ch); this.#apply(this.#operatorChanges(ch,op,params,this.isFourOp(ch)));}
  /** @param {number} ch @param {{left?:boolean,right?:boolean}} pan @param {boolean} fourOp
   * @returns {RegisterChange[]} */
  #panChanges(ch,pan,fourOp) {
    options(pan,['left','right'],'pan');
    /** @type {RegisterChange[]} */ const changes = [];
    for (const [name,value] of Object.entries(pan)) {
      boolean(value,name);
      if (this.chip !== 'ymf262') {
        if (!value) throw new RangeError('Stereo pan requires YMF262; OPL/OPL2 are mono');
        continue;
      }
      const mask = name === 'left' ? 0x10 : 0x20;
      changes.push([this.#channelAddress(0xc0,ch),mask,value ? mask : 0]);
      if (fourOp) changes.push([this.#channelAddress(0xc0,ch+3),mask,value ? mask : 0]);
    }
    return changes;
  }
  /** Validate the complete patch before issuing any hardware writes.
   * Algorithms: two-op 0=FM, 1=additive. Four-op: 0=1→2→3→4,
   * 1=1+(2→3→4), 2=(1→2)+(3→4), 3=1+(2→3)+4.
   * @param {number} ch @param {OPLPreset} preset */
  setPreset(ch,preset) {
    this.#voice(ch);
    options(preset,['label','name','algorithm','feedback','pan','fourOp','operators'],'OPL preset');
    for (const key of ['label','name']) if (preset[key] !== undefined && typeof preset[key] !== 'string') throw new TypeError(`${key} must be a string`);
    const fourOp = preset.fourOp === undefined ? this.isFourOp(ch) : boolean(preset.fourOp,'Four-operator mode');
    /** @type {RegisterChange[]} */ const changes = [];
    if (preset.fourOp !== undefined) changes.push(...this.#fourOpChanges(ch,fourOp));
    if (preset.algorithm !== undefined) {
      const algorithm = integer(preset.algorithm,fourOp ? 3 : 1,'Algorithm');
      changes.push([this.#channelAddress(0xc0,ch),1,algorithm & 1]);
      if (fourOp) changes.push([this.#channelAddress(0xc0,ch+3),1,(algorithm >> 1) & 1]);
    }
    if (preset.feedback !== undefined) changes.push([this.#channelAddress(0xc0,ch),14,integer(preset.feedback,7,'Feedback') << 1]);
    if (preset.pan !== undefined) changes.push(...this.#panChanges(ch,preset.pan,fourOp));
    if (preset.operators !== undefined) {
      if (!Array.isArray(preset.operators) || preset.operators.length > (fourOp ? 4 : 2)) throw new RangeError(`Expected up to ${fourOp ? 4 : 2} operators`);
      for (let op = 0; op < preset.operators.length; op++) if (preset.operators[op] !== undefined) changes.push(...this.#operatorChanges(ch,op,preset.operators[op],fourOp));
    }
    this.#apply(changes);
  }
  /** @param {number} ch @param {number} algorithm @param {number} [feedback] */
  setAlgo(ch,algorithm,feedback = undefined) {this.setPreset(ch,{algorithm,feedback});}
  /** OPL3 stereo routing; preserves the additional hardware C/D output bits.
   * @param {number} ch @param {boolean} left @param {boolean} right */
  setPan(ch,left,right) {this.#voice(ch); this.#apply(this.#panChanges(ch,{left,right},this.isFourOp(ch)));}
  /** Raw F-NUM (0..1023) and BLOCK (0..7); preserves key-on and reserved bits.
   * @param {number} ch @param {number} fnum @param {number} [block] */
  setPitch(ch,fnum,block = 0) {
    this.#voice(ch); integer(fnum,1023,'F-NUM'); integer(block,7,'Block');
    this.#apply([[this.#channelAddress(0xa0,ch),255,fnum & 255],[this.#channelAddress(0xb0,ch),31,(block << 2) | (fnum >> 8)]]);
  }
  /** @param {number} ch @param {number} frequency Frequency in Hz. */
  setFrequency(ch,frequency) {
    this.#voice(ch); const pitch = oplPitchFromHz(frequency,this.clock,this.chip);
    this.setPitch(ch,pitch.fnum,pitch.block); return pitch;
  }
  /** Note name or MIDI integer; A4 = MIDI 69 = 440 Hz.
   * @param {number} ch @param {string|number} note */
  setNote(ch,note) {return this.setFrequency(ch,noteToHz(note));}
  /** Key a melodic voice; rhythm mode reserves physical channels 6..8.
   * @param {number} ch */
  keyOn(ch) {
    this.#voice(ch);
    if (ch >= 6 && ch <= 8 && (this.#registers[0xbd] & 0x20)) throw new RangeError('Rhythm mode reserves channels 6..8; use setRhythm() triggers');
    this.#apply([[this.#channelAddress(0xb0,ch),0x20,0x20]]);
  }
  /** @param {number} ch */
  keyOff(ch) {this.#voice(ch); this.#apply([[this.#channelAddress(0xb0,ch),0x20,0]]);}
  /** @param {number} ch @param {string|number} note */
  noteOn(ch,note) {
    this.#voice(ch);
    const pitch = oplPitchFromHz(noteToHz(note),this.clock,this.chip);
    if (ch >= 6 && ch <= 8 && (this.#registers[0xbd] & 0x20)) throw new RangeError('Rhythm mode reserves channels 6..8; use setRhythm() triggers');
    this.setPitch(ch,pitch.fnum,pitch.block); this.keyOn(ch);
  }
  /** @param {number} ch */
  noteOff(ch) {this.keyOff(ch);}
  /** Release every physical key and all percussion triggers, preserving patches. */
  allNotesOff() {
    for (let ch = 0; ch < this.channels; ch++) this.#apply([[this.#channelAddress(0xb0,ch),0x20,0]]);
    this.#apply([[0xbd,31,0]]);
  }
  /** Enable the hardware rhythm section and/or partially edit trigger bits.
   * High-level melodic key-on is unavailable on CH6..8 while enabled.
   * @param {{enabled?:boolean,bassDrum?:boolean,snare?:boolean,tom?:boolean,cymbal?:boolean,hiHat?:boolean}} settings */
  setRhythm(settings) {
    const fields = {enabled:5,bassDrum:4,snare:3,tom:2,cymbal:1,hiHat:0};
    options(settings,Object.keys(fields),'rhythm');
    /** @type {RegisterChange[]} */ const changes = [];
    for (const [name,value] of Object.entries(settings)) {
      boolean(value,name); const mask = 1 << fields[name];
      changes.push([0xbd,mask,value ? mask : 0]);
    }
    if (settings.enabled !== undefined && settings.enabled !== Boolean(this.#registers[0xbd] & 0x20)) {
      // Normal and rhythm key sources are independent in OPL. Release the old
      // melodic keys when changing ownership of these three physical voices.
      changes.unshift(...[6,7,8].map(ch => /** @type {RegisterChange} */ ([this.#channelAddress(0xb0,ch),0x20,0])));
    }
    this.#apply(changes);
  }
  /** Fixed-rate hardware LFO depth flags (false=shallow, true=deep).
   * Enable AM/vibrato individually on operators to hear the LFO.
   * @param {{amDepth?:boolean,pmDepth?:boolean}} settings */
  setLFO(settings) {
    options(settings,['amDepth','pmDepth'],'LFO');
    /** @type {RegisterChange[]} */ const changes = [];
    for (const [name,value] of Object.entries(settings)) {
      boolean(value,name); const mask = name === 'amDepth' ? 0x80 : 0x40;
      changes.push([0xbd,mask,value ? mask : 0]);
    }
    this.#apply(changes);
  }
}

// Original patches, built from hardware parameters; no external sound bank.
const carrier = {...operatorDefaults,tl:12,ar:15,rr:10};
function freezePreset(preset) {
  Object.freeze(preset.pan);
  for (const op of preset.operators) Object.freeze(op);
  Object.freeze(preset.operators); return Object.freeze(preset);
}
/** Original two-operator patches shared by the OPL family, plus an OPL3 patch.
 * The sine patch silences its modulator; every patch explicitly selects mode.
 * @type {Readonly<Record<string,OPLPreset>>} */
export const OPL_PRESETS = Object.freeze({
  sine:freezePreset({label:'Sine',fourOp:false,algorithm:0,feedback:0,pan:{left:true,right:true},operators:[{...operatorDefaults},{...carrier}]}),
  bell:freezePreset({label:'Bell',fourOp:false,algorithm:0,feedback:0,pan:{left:true,right:true},operators:[{...operatorDefaults,multi:3,tl:24,egt:false,dr:7,sl:8,rr:8},{...carrier,egt:false,dr:4,sl:8,rr:7}]}),
  organ:freezePreset({label:'Organ',fourOp:false,algorithm:1,feedback:0,pan:{left:true,right:true},operators:[{...carrier,multi:2,tl:23},{...carrier,tl:18}]}),
  'four-op-bell':freezePreset({label:'Four-operator bell',fourOp:true,algorithm:2,feedback:0,pan:{left:true,right:true},operators:[{...operatorDefaults,multi:3,tl:30,egt:false,dr:6,sl:8},{...carrier,tl:20,egt:false,dr:4,sl:8},{...operatorDefaults,multi:2,tl:27,egt:false,dr:5,sl:7},{...carrier,multi:2,tl:26,egt:false,dr:4,sl:8}]}),
});
