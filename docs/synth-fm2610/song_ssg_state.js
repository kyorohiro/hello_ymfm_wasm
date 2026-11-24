// SPDX-License-Identifier: BSD-3-Clause

export function isFm2610SongSsgRegister(port, register) {
  return port === 0 && Number.isInteger(register) && register >= 0 && register <= 0x0d;
}

export function createFm2610SongSsgState() {
  const registers = new Uint8Array(14);
  let observed = false;
  let cached = null;

  return {
    reset() {
      registers.fill(0);
      observed = false;
      cached = null;
    },
    write(register, value) {
      if (!observed || registers[register] !== value) cached = null;
      observed = true;
      registers[register] = value;
    },
    saveState() { return {registers: registers.slice(), observed}; },
    loadState(state) {
      registers.set(state.registers);
      observed = state.observed;
      cached = null;
    },
    snapshot() {
      if (!observed) return null;
      if (cached) return cached;
      const mixer = registers[7];
      const channels = Array.from({length: 3}, (_, channel) => {
        const level = registers[8 + channel];
        return Object.freeze({
          period: registers[channel * 2] | (registers[channel * 2 + 1] & 15) << 8,
          tone: !(mixer & (1 << channel)), noise: !(mixer & (8 << channel)),
          level: level & 15, envelope: Boolean(level & 16),
        });
      });
      cached = Object.freeze({channels: Object.freeze(channels), noisePeriod: registers[6] & 31,
        envelopePeriod: registers[11] | registers[12] << 8, envelopeShape: registers[13] & 15});
      return cached;
    },
  };
}
