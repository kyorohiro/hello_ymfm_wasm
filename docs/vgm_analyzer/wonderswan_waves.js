// Written RAM snapshots, not recovered instruments or emulated voice recordings.
// Only bytes present in the VGM are known. Noise and Voice PCM do not use the
// selected wavetable; sweep snapshots retain the written base frequency only.
const DEFAULT_CLOCK = 3072000;
const RAM_SIZE = 0x4000;
const DEFAULT_LIMITS = {maxDefinitions: 100000, maxEvents: 100000, maxPayloadBytes: 64 * 1024 * 1024};

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid WonderSwan ${label}`);
  return value;
}

/** Single-chip, one-pass wave RAM analysis. Times are original 44,100 Hz units.
 * Optional limits are internal analysis budgets, useful for bounded consumers.
 */
export function createWonderSwanWaves(clock = DEFAULT_CLOCK, limits = {}) {
  integer(clock, 1, 0x3fffffff, 'clock');
  const budget = {...DEFAULT_LIMITS, ...limits};
  for (const name of Object.keys(DEFAULT_LIMITS)) integer(budget[name], 0, Number.MAX_SAFE_INTEGER, `${name} budget`);
  const ram = new Uint8Array(RAM_SIZE), known = new Uint8Array(RAM_SIZE), dirty = new Uint8Array(RAM_SIZE / 16);
  const registers = new Uint8Array(32), registerKnown = new Uint8Array(32);
  const samples = [], events = [], warnings = new Set(), definitions = new Map();
  let retainedBytes = 0, observationTime = -1;
  const observationsAtTime = new Map();

  function waveMode(channel) {
    if (channel === 1 && (registers[16] & 0x20)) return null;
    if (channel === 3 && (registers[16] & 0x80)) return null;
    return channel === 2 && (registers[16] & 0x40) ? 'sweep' : 'wave';
  }
  function capture(channel, time, reason, force = false) {
    const address = ((registers[15] << 6) + channel * 16) & 0x3fff;
    const index = address >> 4;
    if ((!dirty[index] && !force) || !waveMode(channel)) return;
    // A later bank/mode/key-on observation can retry an incomplete snapshot.
    dirty[index] = 0;
    for (let offset = 0; offset < 16; offset++) if (!known[address + offset]) {
      warnings.add('WonderSwan: incomplete wave RAM snapshots are omitted; unwritten bytes are unknown.');
      return;
    }
    const packed = ram.subarray(address, address + 16), key = [...packed].join(',');
    let sample = definitions.get(key);
    if (!sample) {
      if (samples.length >= budget.maxDefinitions) throw new Error(`WonderSwan waveform analysis exceeds ${budget.maxDefinitions} definitions`);
      if (retainedBytes + 16 > budget.maxPayloadBytes) throw new Error(`WonderSwan waveform analysis exceeds the ${budget.maxPayloadBytes}-byte payload limit`);
      sample = {id: samples.length + 1, chip: 'wonderswan', kind: 'wave', representation: 'written-wave-ram',
        size: 16, available: 16, data: packed.slice(), waveform: [...packed].flatMap(value => [value & 15, value >> 4])};
      samples.push(sample); definitions.set(key, sample); retainedBytes += 16;
    }
    const frequency = registers[channel * 2] | (registers[channel * 2 + 1] & 7) << 8;
    const output = registers[17], pan = registers[8 + channel];
    const observation = {sampleId: sample.id, chip: 'wonderswan', kind: 'wave', chipIndex: 0,
      channel: channel + 1, startTime: time, reason, bank: registers[15], address, clock, frequency,
      frequencyKnown: Boolean(registerKnown[channel * 2] && registerKnown[channel * 2 + 1]),
      frequencyHz: Math.floor(clock / 128) * 128 / (32 * (2048 - frequency)),
      pan: {left: pan >> 4, right: pan & 15}, mode: waveMode(channel), enabled: Boolean(registers[16] & (1 << channel)),
      output: {register: output, headphones: Boolean(output & 8), speaker: Boolean(output & 1), speakerVolume: output >> 1 & 3}};
    if (time !== observationTime) { observationsAtTime.clear(); observationTime = time; }
    const observationKey = `${sample.id}:${channel}:${address}`;
    const previous = observationsAtTime.get(observationKey);
    if (previous) {
      // A key-on inside a RAM batch must not duplicate the same physical wave
      // at this instant. Different selected banks retain their own provenance.
      const reasons = new Set([...previous.reason.split('; '), reason]);
      Object.assign(previous, observation, {reason: [...reasons].join('; ')});
      return;
    }
    if (events.length >= budget.maxEvents) throw new Error(`WonderSwan waveform analysis exceeds ${budget.maxEvents} observations`);
    events.push(observation); observationsAtTime.set(observationKey, observation);
  }
  function captureSelected(time, reason, force = false) {
    for (let channel = 0; channel < 4; channel++) capture(channel, time, reason, force);
  }
  return {samples, events, warnings,
    apply(event, time) {
      if (event.type !== 'wonderswan-write' && event.type !== 'wonderswan-memory-write') return;
      integer(time, 0, Number.MAX_SAFE_INTEGER, 'observation time');
      if (event.chipIndex) throw new Error('Second WonderSwan wave RAM is not analyzed.');
      const value = integer(event.value, 0, 255, 'byte');
      if (event.type === 'wonderswan-memory-write') {
        const address = integer(event.offset, 0, RAM_SIZE - 1, 'RAM address');
        dirty[address >> 4] ||= !known[address] || ram[address] !== value;
        ram[address] = value; known[address] = 1;
        return;
      }
      const register = integer(event.register, 0, 31, 'relative register');
      const previous = registers[register];
      // Flush the old physical bank before selecting another, including writes
      // made immediately before this register in the same zero-wait batch.
      if (register === 15 && previous !== value) captureSelected(time, 'wave bank change (previous bank)');
      const oldModes = [0, 1, 2, 3].map(waveMode);
      registers[register] = value; registerKnown[register] = 1;
      if (register === 15 && previous !== value) captureSelected(time, 'wave bank change', true);
      if (register === 16) {
        if (value & 0x20) warnings.add('WonderSwan: Voice PCM is not extracted as a wavetable; timed PCM capture is not included.');
        for (let channel = 0; channel < 4; channel++) {
          const keyOn = (value & (1 << channel)) && !(previous & (1 << channel));
          const becameWave = !oldModes[channel] && waveMode(channel);
          const changedWaveMode = oldModes[channel] && waveMode(channel) && oldModes[channel] !== waveMode(channel);
          if (keyOn || becameWave || changedWaveMode) capture(channel, time,
            keyOn ? `CH${channel + 1} key-on` : `CH${channel + 1} wave mode change`, true);
        }
      }
    },
    flush(time) {
      integer(time, 0, Number.MAX_SAFE_INTEGER, 'observation time');
      captureSelected(time, 'wave RAM write batch');
    },
  };
}

/** Playground API uses physical zero-based channels 0..3. */
export function wonderswanWaveCode(sample, channel = 0) {
  integer(channel, 0, 3, 'waveform channel');
  return `ws.setWaveform(${channel}, [${sample.waveform.join(', ')}]);`;
}
export function wonderswanWaveJson(sample, events) {
  return JSON.stringify({schemaVersion: 1, chip: 'wonderswan', kind: 'wave', representation: 'written-wave-ram',
    waveform: sample.waveform, packedBytes: [...sample.data], timebase: 44100,
    observations: events.filter(event => event.sampleId === sample.id)}, null, 2);
}
