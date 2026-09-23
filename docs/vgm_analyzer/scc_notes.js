// Register semantics follow third_party/mame-k051649/k051649.cpp.
// This is a base-period monitor, not waveform pitch detection.
export function createSccMonitor(plus = false) {
  return {plus, test:0, channels:Array.from({length:5}, () => ({period:0, volume:15, key:false, wave:new Uint8Array(32)}))};
}
export function applySccWrite(state, port, register, value) {
  port &= 7; value &= 255;
  if (port === 0 || port === 4) {
    if (port === 0 && (state.test & 0x40 || (state.test & 0x80 && register >= 0x60))) return;
    // Port 4 follows the independent waveform path in our playback core.
    const indices = port === 0 && register >= 0x60 ? [3,4] : [register >> 5];
    for (const i of indices) if (state.channels[i]) state.channels[i].wave[register & 31] = value;
  } else if (port === 1) {
    const ch = state.channels[(register >> 1) & 7];
    if (ch) ch.period = register & 1 ? (ch.period & 255) | (value & 15) << 8 : (ch.period & 0xf00) | value;
  } else if (port === 2) {
    const ch = state.channels[register & 7];
    if (ch) ch.volume = value & 15;
  } else if (port === 3) state.channels.forEach((ch,i) => { ch.key = !!(value & (1 << i)); });
  else if (port === 5) state.test = value;
}
export function describeSccNotes(state, clock) {
  return state.channels.map((ch,i) => {
    const freq = clock / (32 * (ch.period + 1));
    const midi = freq > 0 ? 69 + 12 * Math.log2(freq / 440) : null;
    // Low periods halt the oscillator. Constant waveforms have no pitched AC output.
    // Test-register frequency modes (bits 0–4) are not modeled by the playback core.
    const keyOn = ch.key && ch.volume > 0 && ch.period > 8 && !(state.test & 31)
      && ch.wave.some(value => value !== ch.wave[0]) && midi !== null;
    return {name:`${state.plus ? 'SCC+' : 'SCC'} CH${i+1}`, type:'Wavetable',
      freq, midi, keyOn, period:ch.period, volume:ch.volume,
      waveShared:!state.plus && i >= 3};
  });
}
