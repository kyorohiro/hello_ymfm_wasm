// Register state only: envelope phase, LFSR state and PCM levels are not inferred.
export function createPsgMonitor(chip) {
  return { chip, kind: chip === 'ym2203' || chip === 'ym2608' ? 'ssg' : 'psg',
    registers: chip === 'ym2203' || chip === 'ym2608' ? Array(14).fill(0) : [0, 15, 0, 15, 0, 15, 0, 15],
    changedAt: Array(14).fill(0), latchedRegister: 0 };
}

export function applySsgWrite(state, port, register, value, now) {
  if (state.kind !== 'ssg' || port !== 0) return false;
  if (register >= 0x2d && register <= 0x2f) {
    const old = state.prescale ?? 6;
    state.prescale = register === 0x2d ? 6 : register === 0x2f ? 2 : old === 6 ? 3 : old;
    return true;
  }
  if (register < 0 || register > 13) return false;
  const masks = [255, 15, 255, 15, 255, 15, 31, 255, 31, 31, 31, 255, 255, 15];
  const next = value & masks[register];
  if (state.registers[register] !== next || register === 13) state.changedAt[register] = now;
  state.registers[register] = next;
  return true;
}

export function applyPsgWrite(state, value, now) {
  if (state.kind !== 'psg') return false;
  const latch = (value & 128) !== 0;
  if (latch) state.latchedRegister = (value >> 4) & 7;
  const r = state.latchedRegister;
  const previous = state.registers[r];
  const next = (r & 1) ? value & 15 : r === 6 ? value & 7 :
    latch ? (previous & 0x3f0) | (value & 15) : (previous & 15) | ((value & 63) << 4);
  if (previous !== next || r === 6) state.changedAt[r] = now;
  state.registers[r] = next;
  return true;
}

export function describePsgMonitor(state, muted = false) {
  const r = state.registers;
  if (state.kind === 'ssg') {
    return { chip: state.chip, kind: state.kind, muted, channels: [0, 1, 2].map((ch) => ({
      name: `CH ${'ABC'[ch]}`, period: r[ch * 2] | (r[ch * 2 + 1] << 8),
      toneEnabled: !(r[7] & (1 << ch)), noiseEnabled: !(r[7] & (8 << ch)),
      volume: r[8 + ch] & 15, envelope: !!(r[8 + ch] & 16),
    })), noisePeriod: r[6], envelope: { period: r[11] | (r[12] << 8), shape: r[13],
      continue: !!(r[13] & 8), attack: !!(r[13] & 4), alternate: !!(r[13] & 2), hold: !!(r[13] & 1) },
      registers: [...r] };
  }
  return { chip: state.chip, kind: state.kind, muted,
    channels: [0, 1, 2].map((ch) => ({ name: `Tone ${ch + 1}`, period: r[ch * 2], attenuation: r[ch * 2 + 1] })),
    noise: { mode: r[6] & 4 ? 'White' : 'Periodic', rate: r[6] & 3,
      tone3Linked: (r[6] & 3) === 3, attenuation: r[7] },
    latchedRegister: state.latchedRegister, registers: [...r] };
}

const observed = new WeakSet();
export function observePsgEngine(engine, getState, onChange, onReset, now = () => performance.now()) {
  if (observed.has(engine)) return;
  observed.add(engine);
  for (const [method, decode] of [
    ['writeYm2203', (s, a) => applySsgWrite(s, 0, a[0], a[1], now())],
    ['writeYm2608', (s, a) => applySsgWrite(s, a[0], a[1], a[2], now())],
    ['writePsg', (s, a) => applyPsgWrite(s, a[0], now())],
  ]) {
    if (typeof engine[method] !== 'function') continue;
    const original = engine[method].bind(engine);
    engine[method] = (...args) => {
      if (decode(getState(), args)) onChange();
      return original(...args);
    };
  }
  const reset = engine.reset.bind(engine);
  engine.reset = (...args) => { const result = reset(...args); onReset(); return result; };
}
