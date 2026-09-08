// Configuration at the generated audio position, not measured output levels.
export function createRf5c164Monitor() {
  return { enabled: false, selectedChannel: 0, ramBank: 0, writes: 0,
    memoryWrites: 0, transferredBytes: 0, changedAt: 0,
    channels: Array.from({ length: 8 }, () => ({ enabled: false, registers: Array(7).fill(0), changedAt: 0 })) };
}

export function applyRf5c164Write(state, register, value, now) {
  if (register < 0 || register > 8) return false;
  value &= 255;
  state.writes++;
  state.changedAt = now;
  if (register === 7) {
    state.enabled = Boolean(value & 128);
    if (value & 64) state.selectedChannel = value & 7;
    else state.ramBank = value & 15;
  } else if (register === 8) {
    state.channels.forEach((channel, i) => {
      const enabled = !(value & (1 << i));
      if (enabled !== channel.enabled) channel.changedAt = now;
      channel.enabled = enabled;
    });
  } else {
    const channel = state.channels[state.selectedChannel];
    channel.registers[register] = value;
    channel.changedAt = now;
  }
  return true;
}

export function describeRf5c164Monitor(state, used, clock, muted) {
  return { used, clock, muted, enabled: state.enabled, selectedChannel: state.selectedChannel + 1,
    ramBank: state.ramBank, writes: state.writes, memoryWrites: state.memoryWrites,
    transferredBytes: state.transferredBytes,
    channels: state.channels.map((channel, i) => {
      const r = channel.registers;
      return { name: `PCM ${i + 1}`, enabled: channel.enabled,
        volume: r[0], panLeft: r[1] & 15, panRight: r[1] >> 4,
        step: r[2] | (r[3] << 8), loopAddress: r[4] | (r[5] << 8),
        startAddress: r[6] << 8, registers: [...r] };
    }) };
}

const observed = new WeakSet();
export function observeRf5c164Engine(engine, getState, onChange, now = () => performance.now()) {
  if (observed.has(engine)) return;
  observed.add(engine);
  for (const name of ['writeRf5c164', 'writeRf5c164Memory', 'loadRf5c164Memory']) {
    if (typeof engine[name] !== 'function') continue;
    const original = engine[name].bind(engine);
    engine[name] = (...args) => {
      const result = original(...args);
      const state = getState();
      if (name === 'writeRf5c164') {
        if (applyRf5c164Write(state, args[0], args[1], now())) onChange();
      } else {
        state.memoryWrites++;
        state.transferredBytes += name === 'loadRf5c164Memory' ? args[0].length : 1;
        state.changedAt = now();
        onChange();
      }
      return result;
    };
  }
}
