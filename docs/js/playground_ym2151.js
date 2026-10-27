import {noteToHz, opmPitchFromHz} from './soundchip_pitch.js';
import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=pokey-mode-1';
/** Independent OPM client. Operator indices follow register order M1, C1, M2, C2. */
/** @param {MessagePort} port */
export function createYm2151RegisterClient(transportSend,{clock=CHIP_CLOCKS.ym2151,close=()=>{}}={}) {
  let disposed = false;
  const registers = new Uint8Array(256);
  const integer = (value, max, label) => {
    if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label} must be 0..${max}`);
    return value;
  };
  const channel = ch => integer(ch, 7, 'YM2151 channel');
  const send = (method, args = []) => {
    if (disposed) throw new Error('YM2151 disposed');
    transportSend(method,args);
  };
  const writeRegister = (register, value) => {
    integer(register, 255, 'Register'); integer(value, 255, 'Value');
    send('writeRegister', [register, value]); registers[register] = value;
  };
  const fields = {
    dt1: [0x40, 4, 7], mul: [0x40, 0, 15], tl: [0x60, 0, 127],
    ks: [0x80, 6, 3], ar: [0x80, 0, 31], am: [0xa0, 7, 1], d1r: [0xa0, 0, 31],
    dt2: [0xc0, 6, 3], d2r: [0xc0, 0, 31], d1l: [0xe0, 4, 15], rr: [0xe0, 0, 15],
  };
  const client = {
    _getState() {return {clock:client.clock,registers:Array.from(registers)};},
    _adoptState(state) {if(state?.registers)registers.set(state.registers);if(state?.clock!==undefined)client._adoptClock(state.clock);},
    writeRegister,
    reset() { send('reset'); registers.fill(0); },
    setOperator(ch, operator, options) {
      channel(ch); integer(operator, 3, 'Operator');
      const updates = Object.entries(options).map(([key, value]) => {
        if (!fields[key]) throw new Error(`Unknown YM2151 operator field: ${key}`);
        const [base, shift, max] = fields[key];
        integer(value, max, key); return [base + operator * 8 + ch, shift, max, value];
      });
      for (const [r, shift, max, value] of updates) writeRegister(r, (registers[r] & ~(max << shift)) | (value << shift));
    },
    setAlgo(ch, algorithm, feedback = 0) {
      channel(ch); integer(algorithm, 7, 'Algorithm'); integer(feedback, 7, 'Feedback');
      writeRegister(0x20 + ch, (registers[0x20 + ch] & 0xc0) | (feedback << 3) | algorithm);
    },
    setPan(ch, left, right) {
      channel(ch); writeRegister(0x20 + ch, (registers[0x20 + ch] & 0x3f) | (left ? 0x40 : 0) | (right ? 0x80 : 0));
    },
    /** Note name or integer MIDI 0..127; hardware KC/KF range applies. */
    setNote(ch, note) { return client.setFrequency(ch, noteToHz(note)).keyCode; },
    setFrequency(ch, hz) {
      channel(ch); const pitch = opmPitchFromHz(hz, client.clock);
      client.setPitch(ch, pitch.keyCode, pitch.keyFraction); return pitch;
    },
    noteOn(ch, note) { client.setNote(ch, note); client.keyOn(ch); },
    /** Raw key code and 6-bit key fraction; useful for bends and VGM values. */
    setPitch(ch, keyCode, keyFraction = 0) {
      channel(ch); integer(keyCode, 127, 'Key code'); integer(keyFraction, 63, 'Key fraction');
      writeRegister(0x28 + ch, keyCode); writeRegister(0x30 + ch, keyFraction << 2);
    },
    keyOn(ch, mask = 15) { channel(ch); integer(mask, 15, 'Operator mask'); writeRegister(8, ch | (mask << 3)); },
    keyOff(ch) { channel(ch); writeRegister(8, ch); },
    _forceKeyOff(ch) {channel(ch);send('forceKeyOff',[ch]);},
    /** @returns {Promise<void>} */
    _stopVoices() {return client._requestControl('stopVoices').then(()=>{});},
    allNotesOff() {send('allNotesOff');},
    setNoise(enabled, frequency = 0) { integer(frequency, 31, 'Noise frequency'); writeRegister(15, (enabled ? 128 : 0) | frequency); },
    dispose() { if (disposed) return; send('dispose'); disposed = true; close(); },
  };
  Object.defineProperty(client,'clock',{value:clock,writable:true,configurable:true,enumerable:true});
  return client;
}

/** The public port facade and Native endpoint share the same register authoring. */
export function createYm2151Client(port,options={},lifecycle={}) {
  const client=createYm2151RegisterClient((method,args)=>port.postMessage({method,args}),{close:()=>port.close()});
  const result=attachChipClock(client,port,options.clock??CHIP_CLOCKS.ym2151);
  if(options.native){
    result._adoptState(options.state);
    const setClock=result.setClock.bind(result);let disposed=false;
    const resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{if(disposed||lifecycle.isStopped?.(context))throw new Error('Run stopped');lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    result.setClock=hz=>{const context=lifecycle.captureContext?.();return setClock(hz).then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;}));};
    const dispose=result.dispose.bind(result);result.dispose=()=>{disposed=true;dispose();};
  }
  return result;
}
