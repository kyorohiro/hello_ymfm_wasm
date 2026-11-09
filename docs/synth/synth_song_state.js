// Written-register observation for the independent reference YM2612. This is
// not arbitrary hardware register readback or an internal envelope-level probe.
const DEFAULT_CLOCK = 7670454;
const SLOT_OFFSETS = [0x00, 0x08, 0x04, 0x0c]; // Logical OP1, OP2, OP3, OP4.
const SPECIAL_LOW = [0xa9, 0xaa, 0xa8];
const integer = (value, maximum, label) => {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`${label} must be 0..${maximum}`);
  return value;
};
const stateArray = (value, length, maximum, label) => {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length !== length) throw new TypeError(`Invalid ${label}`);
  return Array.from(value, item => integer(item, maximum, label));
};

function frequency(low, high, clockHz) {
  const block = (high >> 3) & 7, fnum = ((high & 7) << 8) | low;
  const frequencyHz = fnum * clockHz * 2 ** (block - 1) / (144 * 2 ** 20);
  return {block, fnum, frequencyHz, midi:frequencyHz > 0 ? 69 + 12 * Math.log2(frequencyHz / 440) : null};
}

export function isYm2612ViewRegister(port, register) {
  if (port === 0 && [0x22,0x27,0x28,0x2b].includes(register)) return true;
  if (register >= 0x30 && register <= 0x9e && (register & 3) < 3) return true;
  if ((register >= 0xa0 && register <= 0xa2) || (register >= 0xa4 && register <= 0xa6)) return true;
  if (port === 0 && ((register >= 0xa8 && register <= 0xaa) || (register >= 0xac && register <= 0xae))) return true;
  return (register >= 0xb0 && register <= 0xb2) || (register >= 0xb4 && register <= 0xb6);
}

/** A pure decoder, with OPN high-byte latches and low-byte frequency commits. */
export function createYm2612RegisterState(clockHz=DEFAULT_CLOCK) {
  if (!Number.isFinite(clockHz) || clockHz <= 0) throw new RangeError('YM2612 clock must be positive');
  const registers = [new Uint8Array(256), new Uint8Array(256)];
  const highLatches = [0, 0], low = new Uint8Array(6), high = new Uint8Array(6);
  const specialLow = new Uint8Array(3), specialHigh = new Uint8Array(3);
  const keys = new Uint8Array(6), lastKeys = new Uint8Array(6), keyOnCounts = new Uint32Array(6);
  let revision = 0, cached = null;

  function reset() {
    for (const values of [...registers, highLatches, low, high, specialLow, specialHigh, keys, lastKeys, keyOnCounts]) values.fill(0);
    revision++; cached = null;
  }
  function write(port, register, value) {
    integer(port, 1, 'YM2612 port'); integer(register, 255, 'YM2612 register'); integer(value, 255, 'YM2612 value');
    if (!isYm2612ViewRegister(port, register)) return false;
    registers[port][register] = value;
    if (register >= 0xa4 && register <= 0xa6) highLatches[0] = value & 0x3f;
    else if (register >= 0xa0 && register <= 0xa2) {
      const channel = port * 3 + register - 0xa0;
      low[channel] = value; high[channel] = highLatches[0];
    } else if (port === 0 && register >= 0xac && register <= 0xae) highLatches[1] = value & 0x3f;
    else if (port === 0 && register >= 0xa8 && register <= 0xaa) {
      const index = register - 0xa8;
      specialLow[index] = value; specialHigh[index] = highLatches[1];
    } else if (port === 0 && register === 0x28 && (value & 3) !== 3) {
      const channel = (value & 3) + (value & 4 ? 3 : 0);
      keys[channel] = value >> 4;
      if (keys[channel]) {lastKeys[channel] = keys[channel]; keyOnCounts[channel]++;}
    }
    revision++; cached = null;
    return true;
  }
  function snapshot(frame=0) {
    if (!cached) {
      const lfo = Object.freeze({enabled:Boolean(registers[0][0x22] & 8), frequency:registers[0][0x22] & 7});
      const dacEnabled = Boolean(registers[0][0x2b] & 0x80), modeRegister = registers[0][0x27];
      const channels = Array.from({length:6}, (_, channel) => {
        const bank = registers[channel >= 3 ? 1 : 0], offset = channel % 3;
        const operators = {};
        for (let index = 0; index < 4; index++) {
          const address = SLOT_OFFSETS[index] + offset;
          operators[index + 1] = Object.freeze({
            dt:(bank[0x30 + address] >> 4) & 7, multi:bank[0x30 + address] & 15,
            tl:bank[0x40 + address] & 127, rs:(bank[0x50 + address] >> 6) & 3,
            ar:bank[0x50 + address] & 31, am:Boolean(bank[0x60 + address] & 0x80),
            d1r:bank[0x60 + address] & 31, d2r:bank[0x70 + address] & 31,
            sl:(bank[0x80 + address] >> 4) & 15, rr:bank[0x80 + address] & 15,
            ssg:bank[0x90 + address] & 15,
          });
        }
        const b4 = bank[0xb4 + offset], pitch = frequency(low[channel], high[channel], clockHz);
        const specialFrequencies = channel === 2 ? [
          ...SPECIAL_LOW.map(address => frequency(specialLow[address - 0xa8], specialHigh[address - 0xa8], clockHz)), pitch,
        ].map(Object.freeze) : [];
        return Object.freeze({channel, ...pitch, gate:keys[channel] !== 0,
          keyMask:keys[channel], lastKeyMask:lastKeys[channel], keyOnCount:keyOnCounts[channel], specialMode:channel === 2 && Boolean(modeRegister & 0xc0),
          specialFrequencies:Object.freeze(specialFrequencies),
          preset:Object.freeze({algorithm:bank[0xb0 + offset] & 7, feedback:(bank[0xb0 + offset] >> 3) & 7,
            ams:(b4 >> 4) & 3, pms:b4 & 7, b4,
            pan:Object.freeze({left:Boolean(b4 & 0x80), right:Boolean(b4 & 0x40)}), lfo,
            operators:Object.freeze(operators)}),
        });
      });
      cached = Object.freeze({kind:'ym2612', present:true, clockHz, revision, lfo, dacEnabled, modeRegister,
        csmEnabled:Boolean(modeRegister & 0x80), channels:Object.freeze(channels)});
    }
    return Object.freeze({...cached, frame});
  }
  function saveState() {
    return {version:1,clockHz,revision,registers:registers.map(values=>values.slice()),
      highLatches:[...highLatches],low:low.slice(),high:high.slice(),specialLow:specialLow.slice(),specialHigh:specialHigh.slice(),
      keys:keys.slice(),lastKeys:lastKeys.slice(),keyOnCounts:keyOnCounts.slice()};
  }
  function loadState(state) {
    if (state?.version !== 1 || state.clockHz !== clockHz || !Array.isArray(state.registers) || state.registers.length !== 2) throw new TypeError('Invalid YM2612 decoder state');
    // Validate every field before touching the current decoder or its cache.
    const nextRevision=integer(state.revision,Number.MAX_SAFE_INTEGER,'YM2612 revision');
    const nextRegisters=state.registers.map(values=>stateArray(values,256,255,'YM2612 registers'));
    const fields=[
      [highLatches,stateArray(state.highLatches,2,63,'YM2612 high latches')],
      [low,stateArray(state.low,6,255,'YM2612 low frequencies')],
      [high,stateArray(state.high,6,63,'YM2612 high frequencies')],
      [specialLow,stateArray(state.specialLow,3,255,'YM2612 special low frequencies')],
      [specialHigh,stateArray(state.specialHigh,3,63,'YM2612 special high frequencies')],
      [keys,stateArray(state.keys,6,15,'YM2612 keys')],
      [lastKeys,stateArray(state.lastKeys,6,15,'YM2612 last keys')],
      [keyOnCounts,stateArray(state.keyOnCounts,6,0xffffffff,'YM2612 key-on counts')],
    ];
    nextRegisters.forEach((values,index)=>registers[index].set(values));
    for(const [target,values] of fields)values.forEach((value,index)=>{target[index]=value;});
    revision=nextRevision;cached=null;
  }
  reset();
  return {write, reset, snapshot, saveState, loadState};
}

/**
 * Observe only this reference engine. Native render positions include the
 * VgmPlayer's own prefetch queue, not just the host's scheduled AudioBuffers.
 * Reads consume ordered events up to the audible frame and discard the past.
 */
export function createYm2612SongTimeline(engine, clockHz=DEFAULT_CLOCK) {
  const shadow = createYm2612RegisterState(clockHz);
  const original = {write:engine.writeYm2612, process:engine.processFrames, reset:engine.reset};
  let generatedFrames = 0, events = [], head = 0, lastReadFrame = 0, disposed = false;
  function write(port, register, value) {
    const result = original.write.call(this, port, register, value);
    if (!disposed && isYm2612ViewRegister(port, register)) events.push({frame:generatedFrames, port, register, value});
    return result;
  }
  function process(frames) {
    const result = original.process.call(this, frames);
    generatedFrames += frames;
    return result;
  }
  function reset(...args) {
    const result = original.reset.apply(this, args);
    generatedFrames = 0; lastReadFrame = 0; events = []; head = 0; shadow.reset();
    return result;
  }
  engine.writeYm2612 = write; engine.processFrames = process; engine.reset = reset;
  function read(frame) {
    const next = Math.max(0, Math.min(generatedFrames, Math.floor(frame)));
    if (next < lastReadFrame) throw new Error('Audible YM2612 state cannot move backwards without resetting');
    while (head < events.length && events[head].frame <= next) {
      const event = events[head++];
      shadow.write(event.port, event.register, event.value);
    }
    lastReadFrame = next;
    if (head === events.length) {events = []; head = 0;}
    else if (head > 256) {events = events.slice(head); head = 0;}
    return shadow.snapshot(next);
  }
  return {
    read,
    saveState() {
      if(disposed)throw new Error('YM2612 timeline is disposed');
      return {version:1,generatedFrames,lastReadFrame,decoder:shadow.saveState(),events:events.slice(head).map(event=>({...event}))};
    },
    loadState(state) {
      if(disposed)throw new Error('YM2612 timeline is disposed');
      if(state?.version!==1||!Array.isArray(state.events))throw new TypeError('Invalid YM2612 timeline state');
      const nextGenerated=integer(state.generatedFrames,Number.MAX_SAFE_INTEGER,'YM2612 generated frames');
      const nextRead=integer(state.lastReadFrame,nextGenerated,'YM2612 audible frame');
      let preceding=nextRead;
      const pending=state.events.map(event=>{
        const frame=integer(event?.frame,nextGenerated,'YM2612 event frame');
        const port=integer(event?.port,1,'YM2612 event port'),register=integer(event?.register,255,'YM2612 event register');
        const value=integer(event?.value,255,'YM2612 event value');
        if(frame<preceding||!isYm2612ViewRegister(port,register))throw new TypeError('Invalid YM2612 pending event');
        preceding=frame;
        return {frame,port,register,value};
      });
      shadow.loadState(state.decoder);
      generatedFrames=nextGenerated;lastReadFrame=nextRead;events=pending;head=0;
    },
    get pendingEvents() {return events.length - head;},
    dispose() {
      if (disposed) return;
      disposed = true; events = []; head = 0;
      if (engine.writeYm2612 === write) engine.writeYm2612 = original.write;
      if (engine.processFrames === process) engine.processFrames = original.process;
      if (engine.reset === reset) engine.reset = original.reset;
    },
  };
}
