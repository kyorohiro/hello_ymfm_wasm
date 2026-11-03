/** Musical observations of S-DSP register writes, in Browser / Worker / Node.
 *
 * These are key requests and parameter changes, not a transcription of the
 * internal envelope or a guarantee that a voice is audible. In particular,
 * initial notes are inferred from KON/ENVX/OUTX and the persistent KOFF mask.
 * BRR contents and musical root notes cannot be inferred from DSP registers.
 * No control quantization, smoothing, pitch conversion or RAM copies are done.
 */
export const SPC_EVENT_CLOCK_RATE = 1024000;
const TYPES = new Set(['noteOn', 'noteOff', 'pitch', 'volume', 'instrument', 'dsp']);
const MAX_WRITES_PER_BATCH = 8192;

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
function dspCopy(input) {
  if (!(input instanceof Uint8Array) || input.length !== 128) throw new TypeError('dsp must contain 128 Uint8Array registers');
  return input.slice();
}
function filter(values, allowed, name) {
  if (values === undefined) return null;
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  for (const value of values) if (!allowed.has(value)) throw new RangeError(`Unknown ${name} value: ${value}`);
  return new Set(values);
}
function preset(dsp, channel) {
  const base = channel << 4;
  return {
    sourceNumber: dsp[base + 4], pitch: dsp[base + 2] | (dsp[base + 3] & 63) << 8,
    adsr1: dsp[base + 5], adsr2: dsp[base + 6], gain: dsp[base + 7],
    volumeLeft: dsp[base] << 24 >> 24, volumeRight: dsp[base + 1] << 24 >> 24,
  };
}
function equalInstrument(a, b) {
  return a.sourceNumber === b.sourceNumber && a.adsr1 === b.adsr1 && a.adsr2 === b.adsr2 && a.gain === b.gain;
}

/** Decode an ordered stream of flat [clock, register, value] triples.
 * Clocks are nonnegative safe integers in 1,024,000-Hz SPC clock units, NOT
 * 32,000-Hz PCM frames. Float64Array supports songs longer than 2^32 clocks.
 *
 * Consecutive same-clock PITCH low/high, volume and instrument writes are
 * combined; a key/global write is an ordering boundary. Every asserted KON
 * write emits noteOn, including repeated masks. keyOffHeld marks a simultaneous
 * persistent KOFF, which can prevent a sustained note. KOFF release requests
 * are emitted on newly asserted bits or currently held notes; clearing KOFF
 * alone does not start a note. Initial inferred notes include complete presets.
 *
 * A finite flush/watermark commits ONLY clocks strictly below that watermark,
 * so a same-clock PITCH pair may straddle batches. flush(Infinity) completes the
 * last group. At most 8,192 writes are accepted per call; callers stream larger
 * captures in chunks. No raw write history is retained. Filters affect output,
 * never the internal DSP/held-note state. Global dsp events bypass channels.
 *
 * @param {{dsp:Uint8Array,startClock?:number,channels?:number[],types?:string[],includeInitial?:boolean}} options
 */
export function createSpcEventDecoder({dsp, startClock = 0, channels, types, includeInitial = true} = {}) {
  const selectedChannels = filter(channels, new Set([0, 1, 2, 3, 4, 5, 6, 7]), 'channels');
  const selectedTypes = filter(types, TYPES, 'types');
  if (typeof includeInitial !== 'boolean') throw new TypeError('includeInitial must be boolean');
  let registers, baseline, initial, heldMask, lastClock, pendingClock;
  let dirty = [], dirtyKeys = new Set();
  const accepts = event => (!selectedTypes || selectedTypes.has(event.type)) &&
    (event.channel === undefined || !selectedChannels || selectedChannels.has(event.channel));
  const emit = (output, event) => { if (accepts(event)) output.push(event); };

  function reset(nextDsp, clock = 0) {
    const copy = dspCopy(nextDsp);
    integer(clock, 0, Number.MAX_SAFE_INTEGER, 'startClock');
    registers = copy;
    baseline = Array.from({length: 8}, (_, channel) => preset(registers, channel));
    initial = []; heldMask = 0; lastClock = -Infinity; pendingClock = null;
    dirty = []; dirtyKeys = new Set();
    for (let channel = 0; channel < 8; channel++) {
      const bit = 1 << channel, base = channel << 4;
      const tail = !!(registers[base + 8] || registers[base + 9]);
      const keyOffHeld = !!(registers[0x5c] & bit);
      if (!keyOffHeld && (tail || registers[0x4c] & bit)) {
        heldMask |= bit;
        if (includeInitial) initial.push({type: 'noteOn', clock, channel, ...baseline[channel], preset: {...baseline[channel]}, reason: 'initial', inferred: true, keyOffHeld: false});
      } else if (keyOffHeld && tail && includeInitial) {
        initial.push({type: 'noteOff', clock, channel, sourceNumber: baseline[channel].sourceNumber, reason: 'initial', inferred: true});
      }
    }
  }
  reset(dsp, startClock);

  function emitInitial(output) {
    for (const event of initial) emit(output, event);
    initial = [];
  }
  function mark(type, channel) {
    const key = `${type}:${channel}`;
    if (!dirtyKeys.has(key)) {dirtyKeys.add(key); dirty.push({type, channel});}
  }
  function commit(output) {
    for (const {type, channel} of dirty) {
      const current = preset(registers, channel), previous = baseline[channel];
      if (type === 'pitch' && current.pitch !== previous.pitch) {
        emit(output, {type, clock: pendingClock, channel, pitch: current.pitch});
        previous.pitch = current.pitch;
      } else if (type === 'volume' && (current.volumeLeft !== previous.volumeLeft || current.volumeRight !== previous.volumeRight)) {
        emit(output, {type, clock: pendingClock, channel, volumeLeft: current.volumeLeft, volumeRight: current.volumeRight});
        previous.volumeLeft = current.volumeLeft; previous.volumeRight = current.volumeRight;
      } else if (type === 'instrument' && !equalInstrument(current, previous)) {
        emit(output, {type, clock: pendingClock, channel, sourceNumber: current.sourceNumber,
          adsr1: current.adsr1, adsr2: current.adsr2, gain: current.gain, preset: current});
        previous.sourceNumber = current.sourceNumber; previous.adsr1 = current.adsr1;
        previous.adsr2 = current.adsr2; previous.gain = current.gain;
      }
    }
    dirty = []; dirtyKeys.clear();
  }
  function watermark(value) {
    if (value !== Infinity) integer(value, 0, Number.MAX_SAFE_INTEGER, 'watermarkClock');
    return value;
  }
  function flush(clock = Infinity) {
    watermark(clock);
    const output = []; emitInitial(output);
    if (pendingClock !== null && pendingClock < clock) commit(output);
    return output;
  }
  function pushWrites(writes, watermarkClock) {
    if (!writes || typeof writes === 'string' || !Number.isSafeInteger(writes.length) || writes.length < 0 || writes.length % 3) throw new TypeError('DSP writes must be flat [clock, register, value] triples');
    if (writes.length / 3 > MAX_WRITES_PER_BATCH) throw new RangeError('DSP write batch exceeds 8,192 writes; split it into chunks');
    if (watermarkClock !== undefined) watermark(watermarkClock);
    // Validate the entire batch before mutating state, including across batches.
    let previousClock = lastClock;
    for (let i = 0; i < writes.length; i += 3) {
      const clock = integer(writes[i], 0, Number.MAX_SAFE_INTEGER, 'clock');
      if (clock < previousClock) throw new RangeError('DSP writes must be ordered by clock');
      integer(writes[i + 1], 0, 127, 'register'); integer(writes[i + 2], 0, 255, 'value');
      previousClock = clock;
    }
    const output = []; emitInitial(output);
    for (let i = 0; i < writes.length; i += 3) {
      const clock = writes[i], register = writes[i + 1], value = writes[i + 2];
      if (pendingClock !== null && clock > pendingClock) commit(output);
      pendingClock = clock; lastClock = clock;
      const oldValue = registers[register];
      // Preserve control/key/global order at the same clock. Register changes
      // following a KON must never leak into that note's preset snapshot.
      if (register === 0x4c || register === 0x5c) {
        commit(output); registers[register] = value;
        for (let channel = 0; channel < 8; channel++) {
          const bit = 1 << channel;
          if (!(value & bit)) continue;
          if (register === 0x4c) {
            const current = preset(registers, channel), keyOffHeld = !!(registers[0x5c] & bit);
            emit(output, {type: 'noteOn', clock, channel, ...current, preset: current, reason: 'kon', keyOffHeld});
            if (keyOffHeld) heldMask &= ~bit; else heldMask |= bit;
          } else if (!(oldValue & bit) || heldMask & bit) {
            emit(output, {type: 'noteOff', clock, channel, sourceNumber: registers[(channel << 4) + 4], reason: 'koff'});
            heldMask &= ~bit;
          }
        }
      } else {
        const kind = register & 15, channel = register >> 4;
        if (kind <= 7) {
          registers[register] = value;
          mark(kind <= 1 ? 'volume' : kind <= 3 ? 'pitch' : 'instrument', channel);
        } else {
          commit(output); registers[register] = value;
          // ENDX is write-to-clear even when the written byte is unchanged.
          if (register === 0x7c) registers[register] = 0;
          emit(output, {type: 'dsp', clock, register, value});
        }
      }
    }
    if (watermarkClock !== undefined && pendingClock !== null && pendingClock < watermarkClock) commit(output);
    return output;
  }
  return {pushWrites, flush, reset, snapshot: () => registers.slice()};
}

/** Interpret DSP records from a full SPC timeline. RAM records are deliberately
 * ignored: extract BRR versions from the appropriate RAM snapshot separately.
 * This convenience method retains the output array (up to maxEvents); streaming
 * observation should use createSpcEventDecoder directly instead.
 * @param {{version:number,clockRate:number,initialState:{dsp:Uint8Array},events:Uint32Array|number[]}} trace
 */
export function convertSpcTraceEvents(trace, {maxEvents = 1000000, ...options} = {}) {
  if (trace?.version !== 1 || trace.clockRate !== SPC_EVENT_CLOCK_RATE) throw new RangeError('Expected SPC timeline version 1 with a 1,024,000-Hz clock');
  integer(maxEvents, 1, 10000000, 'maxEvents');
  const input = trace.events;
  if (!(input instanceof Uint32Array) && !Array.isArray(input)) throw new TypeError('SPC timeline events must be Uint32Array or number[]');
  if (input.length % 4) throw new RangeError('SPC timeline events require four words per record');
  const decoder = createSpcEventDecoder({dsp: trace.initialState?.dsp, ...options});
  const result = [], chunk = [];
  const append = events => {
    if (result.length + events.length > maxEvents) throw new RangeError('SPC musical event limit exceeded');
    result.push(...events);
  };
  let previousClock = -Infinity;
  for (let i = 0; i < input.length; i += 4) {
    const clock = integer(input[i], 0, Number.MAX_SAFE_INTEGER, 'clock');
    if (clock < previousClock) throw new RangeError('SPC timeline events must be ordered by clock');
    previousClock = clock;
    const kind = integer(input[i + 1], 0, 1, 'kind');
    integer(input[i + 2], 0, kind ? 65535 : 127, 'address'); integer(input[i + 3], 0, 255, 'value');
    if (kind) continue;
    chunk.push(clock, input[i + 2], input[i + 3]);
    if (chunk.length === 3072) {append(decoder.pushWrites(chunk)); chunk.length = 0;}
  }
  append(decoder.pushWrites(chunk)); append(decoder.flush());
  return result;
}
