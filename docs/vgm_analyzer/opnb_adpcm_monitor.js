// YM2610/B register layout and reset values follow ymfm_adpcm and ym2610::write_data[_hi].
export function createOpnbAdpcmMonitor() {
  const a = new Uint8Array(0x30);
  a.fill(0xdf, 8, 14);
  return {a, b:new Uint8Array(12), commands:Array(7).fill('—'), starts:Array(7).fill(0)};
}

export function writeOpnbAdpcm(state, port, reg, value, now) {
  function control(channel, command) {
    state.commands[channel] = command;
    state.starts[channel] = command === 'Start' ? now : 0;
  }
  if (port === 1 && reg < 0x30) {
    state.a[reg] = value;
    if (reg === 0) {
      for (let ch = 0; ch < 6; ch++) {
        if (value & (1 << ch)) control(ch, value & 128 ? 'Stop' : 'Start');
      }
    }
    return true;
  }
  if (port === 0 && reg >= 0x10 && reg <= 0x1b) {
    state.b[reg - 0x10] = value;
    if (reg === 0x10) control(6, value & 1 ? 'Reset' : value & 128 ? 'Start' : 'Stop');
    return true;
  }
  return false;
}

export function opnbAdpcmRows(state, part) {
  const word = (lo, hi) => lo | (hi << 8);
  const address = (lo, hi, end = false) => '0x' + (word(lo, hi) * 256 + (end ? 255 : 0)).toString(16).toUpperCase().padStart(6, '0');
  const pan = reg => ['—','R','L','L+R'][reg >>> 6];
  const {a,b,commands} = state;
  if (part === 'B') return [{name:'Delta-T',values:[commands[6], address(b[2], b[3]), address(b[4], b[5], true),
    b[11], pan(b[1]), word(b[9], b[10]), b[0] & 16 ? 'On' : 'Off']}];
  return Array.from({length:6}, (_, ch) => ({name:'CH' + (ch + 1), values:[commands[ch],
    address(a[16+ch], a[24+ch]), address(a[32+ch], a[40+ch], true), a[8+ch] & 31, pan(a[8+ch])]}));
}
