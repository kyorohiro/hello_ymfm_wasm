// Timed CH2 output captures, not recovered instrument/sample boundaries.
const TIMEBASE = 44100;
const WINDOW_SAMPLES = TIMEBASE * 10;
const CHUNK_WRITES = 4096;
const CHUNK_BYTES = CHUNK_WRITES * 7; // time u32 + register/value/PCM byte u8.
const CHUNK_WORK_BYTES = CHUNK_BYTES + 512; // Typed-array/chunk bookkeeping headroom.
const CAPTURE_WORK_BYTES = 1024; // Includes initial snapshots and interval metadata.
const DEFAULT_LIMITS = {maxSamples:100000, maxEvents:100000, maxPayloadBytes:64 * 1024 * 1024};
const CAPTURE_REGISTERS = new Set([9, 16, 17, 20, 30]);

function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid WonderSwan Voice PCM ${name}`);
  return value;
}
function gcd(a, b) { while (b) {const next = a % b; a = b; b = next;} return a; }

/** Single-chip one-pass timed captures. Input registers are relative 0..31 and
 * times are original 44100-Hz positions, before the writes at that position.
 * No array/object is allocated per source register write. Completed captures
 * own their typed storage; the temporary chunk allocation/copy peak is bounded.
 */
export function createWonderSwanVoiceSamples(clock = 3072000, {limits = {}} = {}) {
  integer(clock, 1, 0x3fffffff, 'clock');
  const budget = {...DEFAULT_LIMITS, ...limits};
  for (const name of Object.keys(DEFAULT_LIMITS)) integer(budget[name], 0, Number.MAX_SAFE_INTEGER, `${name} budget`);
  const registers = new Uint8Array(32), heldRegisters = new Uint8Array(32);
  const engineRate = Math.floor(clock / 128), periodSamples = TIMEBASE / gcd(engineRate, TIMEBASE);
  const samples = [], events = [], warnings = new Set();
  let active = null, lastTime = 0, retainedBytes = 0, stagingBytes = 0, writeCount = 0, pcmWriteCount = 0;
  let ended = false, pcmValueKnown = false, heldPcmValueKnown = false, intervalWork = 0;
  const enabled = value => (value & 0x22) === 0x22;
  const checkTime = time => {
    integer(time, 0, Number.MAX_SAFE_INTEGER, 'source time');
    if (time < lastTime) throw new RangeError('WonderSwan Voice PCM source time must not go backwards');
    if (ended) throw new Error('WonderSwan Voice PCM capture is already finished');
  };
  const reserve = bytes => {
    if (retainedBytes + stagingBytes + bytes > budget.maxPayloadBytes) throw new Error(`WonderSwan Voice PCM capture exceeds the ${budget.maxPayloadBytes}-byte payload/work limit`);
  };
  // Compare the two parts instead of multiplying a potentially very large
  // source timestamp by the clock. Each remainder product is exactly integral.
  function tickTo(time) {
    const seconds = Math.floor(time / TIMEBASE), previousSeconds = Math.floor(lastTime / TIMEBASE);
    const tick = Math.floor((time % TIMEBASE) * engineRate / TIMEBASE);
    const previousTick = Math.floor((lastTime % TIMEBASE) * engineRate / TIMEBASE);
    if (engineRate && (seconds > previousSeconds || tick > previousTick)) {heldRegisters.set(registers); heldPcmValueKnown = pcmValueKnown;}
    lastTime = time;
  }
  function begin(time, reason) {
    if (samples.length >= budget.maxSamples || ++intervalWork > budget.maxEvents) throw new Error('WonderSwan Voice PCM capture exceeds its interval/event limit');
    reserve(CAPTURE_WORK_BYTES);
    active = {startTime:time, startReason:reason, chunks:[], count:0, pcmCount:0,
      initial:{registers:registers.slice(), heldRegisters:heldRegisters.slice(), pcmValueKnown, heldPcmValueKnown}};
    stagingBytes += CAPTURE_WORK_BYTES;
  }
  function record(register, value, time) {
    let chunk = active.chunks.at(-1);
    if (!chunk || chunk.count === CHUNK_WRITES) {
      reserve(CHUNK_WORK_BYTES);
      chunk = {times:new Uint32Array(CHUNK_WRITES), registers:new Uint8Array(CHUNK_WRITES),
        values:new Uint8Array(CHUNK_WRITES), data:new Uint8Array(CHUNK_WRITES), count:0, pcmCount:0};
      active.chunks.push(chunk); stagingBytes += CHUNK_WORK_BYTES;
    }
    const index = chunk.count++;
    chunk.times[index] = time - active.startTime; chunk.registers[index] = register; chunk.values[index] = value;
    if (register === 9) {chunk.data[chunk.pcmCount++] = value; active.pcmCount++; pcmWriteCount++;}
    active.count++; writeCount++;
  }
  function complete(time, reason) {
    if (!active) return;
    const durationSamples = time - active.startTime;
    if (durationSamples === 0) {
      const previous = samples.at(-1), observation = events.at(-1);
      // advance() may already have opened a window at this exact boundary.
      // Preserve a subsequent off/end batch on the old window's endpoint rather
      // than inventing an audible zero-duration sample or losing those writes.
      if (active.startReason === '10-second window' && previous && observation.endTime === time) {
        if (active.count) {
          reserve(previous.times.byteLength + previous.registers.byteLength + previous.values.byteLength + previous.data.byteLength + active.count * 6 + active.pcmCount);
          const times = new Uint32Array(previous.times.length + active.count), capturedRegisters = new Uint8Array(times.length), values = new Uint8Array(times.length), data = new Uint8Array(previous.data.length + active.pcmCount);
          times.set(previous.times); capturedRegisters.set(previous.registers); values.set(previous.values); data.set(previous.data);
          let position = previous.times.length, pcmPosition = previous.data.length;
          for (const chunk of active.chunks) {
            times.fill(previous.durationSamples, position, position + chunk.count);
            capturedRegisters.set(chunk.registers.subarray(0, chunk.count), position); values.set(chunk.values.subarray(0, chunk.count), position);
            data.set(chunk.data.subarray(0, chunk.pcmCount), pcmPosition); position += chunk.count; pcmPosition += chunk.pcmCount;
          }
          retainedBytes += active.count * 6 + active.pcmCount;
          Object.assign(previous, {times, registers:capturedRegisters, values, data, size:data.length, available:data.length, writeCount:times.length});
        }
        previous.boundary = reason; observation.endReason = reason;
      }
      active = null; stagingBytes = 0; return;
    }
    if (!active.pcmCount && !active.initial.pcmValueKnown) {active = null; stagingBytes = 0; return;}
    const finalBytes = active.count * 6 + active.pcmCount;
    reserve(finalBytes);
    const times = new Uint32Array(active.count), capturedRegisters = new Uint8Array(active.count), values = new Uint8Array(active.count), data = new Uint8Array(active.pcmCount);
    let position = 0, pcmPosition = 0;
    for (const chunk of active.chunks) {
      times.set(chunk.times.subarray(0, chunk.count), position);
      capturedRegisters.set(chunk.registers.subarray(0, chunk.count), position);
      values.set(chunk.values.subarray(0, chunk.count), position);
      data.set(chunk.data.subarray(0, chunk.pcmCount), pcmPosition);
      position += chunk.count; pcmPosition += chunk.pcmCount;
    }
    const id = samples.length + 1, sourceStartSample = active.startTime;
    const phase = {sourceStartSample, timebase:TIMEBASE, nativeTickRate:engineRate, periodSamples};
    samples.push({id, chip:'wonderswan', kind:'voice-pcm', representation:'timed-voice-pcm', data, times,
      registers:capturedRegisters, values, initial:active.initial, clock, sourceStartSample,
      duration:durationSamples, durationSamples, boundary:reason, startBoundary:active.startReason,
      phase, size:data.length, available:data.length, writeCount:active.count});
    events.push({sampleId:id, chip:'wonderswan', kind:'voice-pcm', channel:2, chipIndex:0, clock,
      startTime:sourceStartSample, endTime:time, startReason:active.startReason, endReason:reason,
      durationSamples, representation:'timed-voice-pcm'});
    retainedBytes += finalBytes + CAPTURE_WORK_BYTES; stagingBytes = 0; active = null;
    warnings.add('WonderSwan Voice PCM captures preserve timed CH2 writes and held output, split at Voice disable, CH2 key-off, end, or 10-second display windows. These are not detected original samples or instruments.');
  }
  function advance(time) {
    checkTime(time);
    while (active && active.startTime + WINDOW_SAMPLES <= time) {
      const boundary = active.startTime + WINDOW_SAMPLES;
      tickTo(boundary); complete(boundary, '10-second window'); begin(boundary, '10-second window');
    }
    tickTo(time);
  }
  function write(register, value, time) {
    integer(register, 0, 31, 'relative register'); integer(value, 0, 255, 'byte');
    advance(time);
    const wasEnabled = enabled(registers[16]);
    if (register === 16 && !wasEnabled && enabled(value)) begin(time, registers[16] & 32 ? 'CH2 key-on' : 'Voice PCM enable');
    if (active && CAPTURE_REGISTERS.has(register)) record(register, value, time);
    registers[register] = register === 14 ? value & ~8 : value;
    if (register === 9) pcmValueKnown = true;
    if (register === 16 && wasEnabled && !enabled(value)) complete(time, value & 32 ? 'CH2 key-off' : 'Voice PCM disable');
  }
  function finish(time, reason = 'end') {
    if (typeof reason !== 'string' || !reason) throw new TypeError('WonderSwan Voice PCM finish reason must be a nonempty string');
    advance(time); complete(time, reason); ended = true;
  }
  return {samples, events, warnings, write, advance, finish,
    stats:() => ({retainedBytes, stagingBytes, writeCount, pcmWriteCount, intervals:samples.length})};
}

/** Original register values are preserved; preview-only CH2 masking belongs to
 * the renderer. Arrays are exact timed writes, including repeated equal bytes.
 */
export function wonderswanVoiceSampleJson(sample, events = []) {
  const observations = Array.isArray(events) ? events.filter(event => event.sampleId === sample.id) : [events];
  return JSON.stringify({schemaVersion:1, format:'tetorica-wonderswan-voice-pcm', chip:'wonderswan', kind:'voice-pcm',
    representation:'timed-voice-pcm', timebase:TIMEBASE, clock:sample.clock, sourceStartSample:sample.sourceStartSample,
    durationSamples:sample.durationSamples, boundary:sample.boundary, startBoundary:sample.startBoundary,
    phase:sample.phase, initial:{...sample.initial, registers:[...sample.initial.registers], heldRegisters:[...sample.initial.heldRegisters]},
    pcmBytes:[...sample.data], times:[...sample.times], registers:[...sample.registers], values:[...sample.values], observations}, null, 2);
}
