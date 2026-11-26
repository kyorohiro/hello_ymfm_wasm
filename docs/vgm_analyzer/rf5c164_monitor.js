// Configuration at the generated audio position, not measured output levels.
export function createRf5c164Monitor() {
  return { enabled: false, selectedChannel: 0, ramBank: 0, writes: 0,
    lastTriggers: Array(8).fill(null), memoryWrites: 0, transferredBytes: 0, changedAt: 0,
    channels: Array.from({ length: 8 }, () => ({ enabled: false, started: false, registers: Array(7).fill(0), changedAt: 0 })) };
}

export function applyRf5c164Write(state, register, value, now, commandEnd) {
  if (register < 0 || register > 8) return false;
  value &= 255;
  state.writes++;
  state.changedAt = now;
  if (register === 7) {
    const wasEnabled = state.enabled;
    state.enabled = Boolean(value & 128);
    if (!wasEnabled && state.enabled) state.channels.forEach((ch, i) => {
      if (ch.enabled && !ch.started) begin(i);
    });
    if (value & 64) state.selectedChannel = value & 7;
    else state.ramBank = value & 15;
  } else if (register === 8) {
    state.channels.forEach((channel, i) => {
      const enabled = !(value & (1 << i));
      if (enabled !== channel.enabled) channel.changedAt = now;
      if (enabled && !channel.enabled && state.enabled) begin(i);
      if (!enabled) channel.started = false;
      channel.enabled = enabled;
    });
  } else {
    const channel = state.channels[state.selectedChannel];
    channel.registers[register] = value;
    channel.changedAt = now;
  }
  return true;

  function begin(i) {
    const channel = state.channels[i];
    channel.started = true;
    const r = channel.registers;
    state.lastTriggers[i] = {commandEnd, channel:i+1, startAddress:r[6]<<8, loopAddress:r[4]|r[5]<<8};
  }
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
export function observeRf5c164Engine(engine, getState, onChange, now = () => performance.now(), getCommandEnd = () => undefined) {
  if (observed.has(engine)) return;
  observed.add(engine);
  let muteMask = 0;
  if (engine.writeRf5c164) {
    const write = engine.writeRf5c164.bind(engine);
    engine.setRf5c164ChannelMuted = (channel, muted) => {
      if (!Number.isInteger(channel) || channel < 0 || channel > 7) throw new RangeError('Invalid RF5C164 channel');
      const bit = 1 << channel;
      if (Boolean(muteMask & bit) === Boolean(muted)) return;
      const state = getState();
      // Register 8 would rewind disabled voices. Temporarily select the voice
      // and gate only its volume; register 7's RAM bank is independent.
      const select = 0x40 | (state.enabled ? 0x80 : 0);
      if (channel !== state.selectedChannel) write(7, select | channel);
      try {
        write(0, muted ? 0 : state.channels[channel].registers[0]);
      } finally {
        if (channel !== state.selectedChannel) write(7, select | state.selectedChannel);
      }
      muteMask = muted ? muteMask | bit : muteMask & ~bit;
    };
    if (engine.stateSettingsKey) {
      const key = engine.stateSettingsKey.bind(engine);
      engine.stateSettingsKey = () => JSON.stringify([key(), muteMask]);
    }
  }
  for (const name of ['writeRf5c164', 'writeRf5c164Memory', 'loadRf5c164Memory']) {
    if (typeof engine[name] !== 'function') continue;
    const original = engine[name].bind(engine);
    engine[name] = (...args) => {
      const state = getState();
      const suppress = name === 'writeRf5c164' && args[0] === 0 && (muteMask & (1 << state.selectedChannel));
      const result = suppress ? original(0, 0) : original(...args);
      if (name === 'writeRf5c164') {
        if (applyRf5c164Write(state, args[0], args[1], now(), getCommandEnd())) onChange();
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
