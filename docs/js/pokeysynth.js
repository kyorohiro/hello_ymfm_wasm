import {noteToHz} from './soundchip_pitch.js';
import {POKEY_CLOCK} from './pokey.js?v=pokey-mode-1';
export {POKEY_CLOCK};
export {PokeyWorkletTransport} from './chip_worklet_transport.js?v=pokey-mode-1';

function integer(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid POKEY ${label}: expected ${minimum}..${maximum}`);
  return value;
}
function boolean(value) {if (typeof value !== 'boolean') throw new TypeError('Expected boolean POKEY option'); return value;}

/** Borrow a synchronous core; disposing this transport never destroys it. */
export class PokeyDirectTransport {
  /** @param {import('./pokey.js?v=pokey-mode-1').Pokey} chip */
  constructor(chip) {
    if (!chip || typeof chip.writeRegister !== 'function' || typeof chip.reset !== 'function') throw new TypeError('Expected POKEY core');
    this.chip=chip; this.clock=chip.clock;
  }
  writeRegister(register,value) {this.chip.writeRegister(register,value);}
  readRegister(register) {return this.chip.readRegister(register);}
  reset() {this.chip.reset();}
}

/** Four physical channels, zero based. AUDCTL clock/join/filter settings are
 * shared by the chip. A joined pair sounds on its upper channel (1 or 3),
 * consuming the lower channel's timer. Two objects never share authored state.
 * Readback belongs to the transport/core: this shadow records writes only.
 */
export class PokeySynth {
  #transport; #disposed=false; #initialized=false;
  #registers=new Uint8Array(16); #levels=new Uint8Array(4).fill(8);
  /** @param {{transport:{writeRegister(register:number,value:number,channel?:number):void,reset():void,dispose?():void,clock?:number},clock?:number}} options */
  constructor({transport,clock=transport?.clock??POKEY_CLOCK}={}) {
    if (!transport || typeof transport.writeRegister!=='function' || typeof transport.reset!=='function') throw new TypeError('Expected POKEY transport');
    this.clock=integer(clock,1,100000000,'clock');
    if (transport.clock!==undefined && transport.clock!==clock) throw new RangeError('POKEY Synth and transport clocks must match');
    this.#transport=transport;this.chip='pokey';this.channels=4;
    /** @type {((register:number,value:number,channel?:number)=>boolean|void)|undefined} */ this._beforeWrite=undefined;
    /** @type {((event:{method:string,args:number[],channel?:number})=>void)|undefined} */ this._observe=undefined;
  }
  #alive(){if(this.#disposed)throw new Error('POKEY Synth is disposed');}
  #ready(){this.#alive();if(!this.#initialized)throw new Error('Call initialize() before POKEY high-level operations');}
  #channel(channel){this.#alive();return integer(channel,0,3,'channel');}
  #send(register,value,channel=register<8?register>>1:undefined){
    if(this._beforeWrite?.(register,value,channel)===false)return;
    this.#transport.writeRegister(register,value,channel);this.#registers[register]=value;
    this._observe?.({method:'writeRegister',args:[register,value],...(channel===undefined?{}:{channel})});
  }
  /** Write-only hardware bank, local offsets 0..15. */
  writeRegister(register,value){this.#alive();integer(register,0,15,'register');integer(value,0,255,'byte');this.#send(register,value);if(register<8&&(register&1))this.#levels[register>>1]=value&15;}
  reset(){this.#alive();this.#transport.reset();this.#registers.fill(0);this.#levels.fill(8);this.#initialized=false;this._observe?.({method:'reset',args:[]});}
  /** Silent pure-tone voices, distortion 5, retained volume 8, 64 kHz timers.
   * SKCTL=3 starts the timers/polynomials; STIMER restarts all four counters. */
  initialize(){this.reset();this.#initialized=true;this.#send(15,3);this.#send(8,0);for(let ch=0;ch<4;ch++){this.#send(ch*2+1,0xa0);this.setFrequency(ch,440);}this.#send(9,0);}
  adoptRegisterState(){this.#alive();this.#initialized=true;}
  getRegisterSnapshot(){this.#alive();return this.#registers.slice();}
  /** Hardware volume 0..15; silent voices retain it until keyOn(). */
  setVolume(channel,volume){this.#ready();this.#channel(channel);integer(volume,0,15,'volume');this.#levels[channel]=volume;const reg=channel*2+1;if(this.#registers[reg]&15)this.#send(reg,(this.#registers[reg]&240)|volume,channel);}
  /** AUDC bits 7..5; 5 (0xa0) is a pure square tone. */
  setDistortion(channel,distortion){this.#ready();this.#channel(channel);integer(distortion,0,7,'distortion');const reg=channel*2+1;this.#send(reg,(this.#registers[reg]&31)|(distortion<<5),channel);}
  /** AUDC volume-only DAC mode; phase/timers continue in the core. */
  setVolumeOnly(channel,enabled){this.#ready();this.#channel(channel);boolean(enabled);const reg=channel*2+1;this.#send(reg,(this.#registers[reg]&239)|(enabled?16:0),channel);}
  /** Master-clock timers exist on physical channels 0 and 2 only. */
  setHighClock(channel,enabled){this.#ready();this.#channel(channel);if(channel!==0&&channel!==2)throw new RangeError('POKEY high clock requires channel 0 or 2');boolean(enabled);const mask=channel===0?64:32;this.#send(8,(this.#registers[8]&~mask)|(enabled?mask:0));}
  /** Join pair 0=(0,1), pair 1=(2,3). The lower helper is silenced. */
  setJoined(pair,enabled){this.#ready();integer(pair,0,1,'pair');boolean(enabled);if(enabled)this.keyOff(pair*2);const mask=pair===0?16:8;this.#send(8,(this.#registers[8]&~mask)|(enabled?mask:0));}
  /** Shared base divisor: 28 or 114 input clocks. */
  setBaseClock(clock){this.#ready();if(clock!=='64khz'&&clock!=='15khz')throw new RangeError('Expected POKEY base clock 64khz or 15khz');this.#send(8,(this.#registers[8]&254)|(clock==='15khz'?1:0));}
  setPoly9(enabled){this.#ready();boolean(enabled);this.#send(8,(this.#registers[8]&127)|(enabled?128:0));}
  /** Set pure-tone frequency without changing gates; noise modes retain the
   * same timer period but their audible pitch depends on polynomial selection.
   * Joined lower channels cannot be tuned independently. Returns quantized Hz. */
  setFrequency(channel,hz){
    this.#ready();this.#channel(channel);if(!Number.isFinite(hz)||hz<=0)throw new RangeError('Expected finite positive POKEY Hz');
    const control=this.#registers[8],lower=channel&2,joined=!!(control&(lower===0?16:8));
    if(joined&&channel===lower)throw new RangeError('Tune the upper channel of a joined POKEY pair');
    const high=!!(control&(lower===0?64:32))&&(joined||channel===lower),divisor=high?1:(control&1?114:28),offset=high?(joined?7:4):1,max=joined?65535:255;
    const period=Math.round(this.clock/(2*divisor*hz)-offset);integer(period,0,max,'tone divisor');
    if(joined){this.#send(lower*2,period&255,lower);this.#send(channel*2,period>>8,channel);}else this.#send(channel*2,period,channel);
    return this.clock/(2*divisor*(period+offset));
  }
  setNote(channel,note){return this.setFrequency(channel,noteToHz(note));}
  keyOn(channel){this.#ready();this.#channel(channel);if(!(channel&1)&&(this.#registers[8]&(channel===0?16:8)))throw new RangeError('Joined POKEY lower channel is a timer helper');const reg=channel*2+1;this.#send(reg,(this.#registers[reg]&240)|this.#levels[channel],channel);}
  keyOff(channel){this.#alive();this.#channel(channel);const reg=channel*2+1;this.#send(reg,this.#registers[reg]&240,channel);}
  noteOn(channel,note){this.setNote(channel,note);this.keyOn(channel);}
  allNotesOff(){this.#alive();for(let ch=0;ch<4;ch++)this.keyOff(ch);}
  _getState(){this.#alive();return {clock:this.clock,initialized:this.#initialized,registers:Array.from(this.#registers),levels:Array.from(this.#levels)};}
  /** Adopt authored state without triggering the hardware read-only map. */
  _adoptState(state){
    this.#alive();if(!state||typeof state.initialized!=='boolean'||state.registers?.length!==16||state.levels?.length!==4)throw new TypeError('Invalid POKEY authoring state');
    const clock=integer(state.clock??this.clock,1,100000000,'clock');if(clock!==this.clock)throw new RangeError('POKEY state clock must match the transport');
    const registers=Uint8Array.from(state.registers,value=>integer(value,0,255,'byte')),levels=Uint8Array.from(state.levels,value=>integer(value,0,15,'level'));
    this.#registers.set(registers);this.#levels.set(levels);this.#initialized=state.initialized;
  }
  dispose(){if(this.#disposed)return;this.#disposed=true;this.#transport.dispose?.();}
}
