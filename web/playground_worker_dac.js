/**
 * @file Worker / Node.js: DAC bank preparation and sample-relative commands.
 * AudioWorklet owns the audio-clock origin and performs timed register writes.
 */
export function createWorkerDac(send, {lookaheadSeconds = 0.25} = {}) {
  const banks = new Set();
  const bytesFrom = data => {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.byteLength % 5) throw new Error('Invalid DAC data length');
    return bytes;
  };
  const decode = encoded => bytesFrom(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
  const begin = () => send({type: 'begin-sample-schedule', lookaheadSeconds});
  function schedule(start, entries) {
    const base = Math.max(0, Number(start) || 0);
    const writes = entries.map(([offset, port, register, value]) => {
      const sample = base + Number(offset);
      if (!Number.isFinite(sample) || sample < 0) throw new Error('Invalid sample offset');
      return {sample, port: Number(port), register: Number(register), value: Number(value)};
    });
    begin();
    send({type: 'sample-writes', entries: writes});
  }
  const api = {
    async load(name, data) {
      const bytes = bytesFrom(data);
      // Copy the selected view, not unrelated bytes from its backing buffer.
      send({type: 'load-dac-bank', name, data: bytes.slice().buffer});
      banks.add(name);
    },
    async loadBase64(name, encoded) { return api.load(name, decode(encoded)); },
    playStream(name, {atSamples = 0} = {}) {
      if (!banks.has(name)) throw new Error(`Unknown DAC bank: ${name}`);
      begin();
      send({type: 'sample-dac-bank', name, sample: Math.max(0, Number(atSamples) || 0)});
    },
    schedule(start, entries) { schedule(start, entries.map(([offset, value]) => [offset, 0, 0x2a, value])); },
    scheduleBase64(start, encoded) {
      const bytes = decode(encoded), view = new DataView(bytes.buffer);
      const entries = [];
      for (let i = 0; i < bytes.length; i += 5) entries.push([view.getUint32(i, true), bytes[i + 4]]);
      api.schedule(start, entries);
    },
  };
  return {
    api, begin, schedule,
    setLookahead(value) { lookaheadSeconds = Math.max(0, Number(value) || 0); },
    reset() { send({type: 'reset-sample-schedule'}); },
  };
}
