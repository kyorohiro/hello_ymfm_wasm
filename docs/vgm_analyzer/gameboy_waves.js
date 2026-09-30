// Written wave RAM snapshots, not emulated playback: DMG active-channel RAM access
// and trigger corruption depend on chip timing and are deliberately not inferred.
export function createGameboyWaves() {
  const states = [0, 1].map(() => ({ram: new Uint8Array(16), known: new Uint8Array(16), dirty: false}));
  const samples = [], events = [], warnings = new Set(), definitions = new Map();
  function capture(chipIndex, time, reason, force = false) {
    const state = states[chipIndex];
    if (!state.dirty && !force) return;
    state.dirty = false;
    if (!state.known.every(Boolean)) {
      warnings.add('Game Boy: incomplete wave RAM snapshots are omitted; unwritten bytes are unknown.');
      return;
    }
    const key = [...state.ram].join(',');
    let sample = definitions.get(key);
    if (!sample) {
      if (samples.length >= 100000) throw new Error('Game Boy waveform analysis exceeds 100,000 definitions');
      sample = {id: samples.length + 1, chip: 'gameboy', kind: 'wave', size: 16, available: 16,
        data: state.ram.slice(), waveform: [...state.ram].flatMap(v => [v >> 4, v & 15])};
      samples.push(sample); definitions.set(key, sample);
    }
    if (events.length >= 100000) throw new Error('Game Boy waveform analysis exceeds 100,000 observations');
    events.push({sampleId: sample.id, chip: 'gameboy', kind: 'wave', chipIndex, channel: 3, startTime: time, reason});
  }
  return {samples, events, warnings,
    apply(event, time) {
      if (event.type !== 'gameboy-dmg-write') return;
      const {register: r, value: v, chipIndex = 0} = event;
      const state = states[chipIndex];
      if (!state) return;
      if (r >= 0x20 && r <= 0x2f) {
        const index = r - 0x20;
        state.dirty ||= !state.known[index] || state.ram[index] !== v;
        state.ram[index] = v; state.known[index] = 1;
      }
      if (r === 0x0e && (v & 0x80)) capture(chipIndex, time, 'CH3 trigger write', true);
    },
    flush(time) { states.forEach((_, i) => capture(i, time, 'wave RAM write batch')); },
  };
}

export function gameboyWaveCode(sample) {
  return `gb.wave.setWaveform([${sample.waveform.join(', ')}]);`;
}
export function gameboyWaveJson(sample, events) {
  return JSON.stringify({schemaVersion: 1, chip: 'gameboy', kind: 'wave', representation: 'written-wave-ram',
    waveform: sample.waveform, packedBytes: [...sample.data], timebase: 44100,
    observations: events.filter(e => e.sampleId === sample.id)}, null, 2);
}
