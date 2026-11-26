// Register ports follow ym2608/ym2610::write_data[_hi]; ADPCM-A reset values follow ymfm_adpcm.
export const rhythmNames = ['Bass drum','Snare','Cymbal','Hi-hat','Tom','Rim shot'];

export function opnaAddressUnit(control2) {
  return control2 & 3 ? 32 : 4;
}
export function createOpnAdpcmMonitor(chip = "ym2610") {
  const a = new Uint8Array(0x30);
  a.fill(0xdf, 8, 14);
  const b = new Uint8Array(14);
  b[12] = b[13] = 255;
  return {chip, a, b, lastTriggers:Array(7).fill(null), commands:Array(7).fill('—'), starts:Array(7).fill(0)};
}

export function writeOpnAdpcm(state, port, reg, value, now, commandEnd = null) {
  function control(channel, command) {
    state.commands[channel] = command;
    state.starts[channel] = command === 'Start' ? now : 0;
  }
  const opna = state.chip === 'ym2608';
  if (opna ? port === 0 && reg >= 0x10 && reg < 0x20 : port === 1 && reg < 0x30) {
    if (opna) reg -= 0x10;
    state.a[reg] = value;
    if (reg === 0) {
      for (let ch = 0; ch < 6; ch++) {
        if (!(value & (1 << ch))) continue;
        control(ch, value & 128 ? 'Stop' : 'Start');
        if (!opna && !(value & 128)) {
          // playStep has consumed this write before dispatch. Its end offset
          // identifies the same command in the live player and the offline scan.
          const a = state.a;
          state.lastTriggers[ch] = {channel:ch+1, commandEnd,
            rawStart:a[16+ch] | (a[24+ch]<<8), rawEnd:a[32+ch] | (a[40+ch]<<8)};
        }
      }
    }
    return true;
  }
  if (opna ? port === 1 && reg < 14 : port === 0 && reg >= 0x10 && reg <= 0x1b) {
    if (!opna) reg -= 0x10;
    state.b[reg] = value;
    if (reg === 0) {
      const start = opna && (value & 64) ? 'Record' : 'Start';
      control(6, value & 1 ? 'Reset' : value & 128 ? start : 'Stop');
      if ((value & 0x81) === 0x80) {
        const b = state.b;
        const rawStart = b[2] | (b[3] << 8), rawEnd = b[4] | (b[5] << 8);
        const limit = b[12] | (b[13] << 8);
        const external = !opna || ((value & 0x60) === 0x20 && !(rawStart <= limit && limit < rawEnd));
        state.lastTriggers[6] = external && rawStart <= rawEnd ? {channel:1, commandEnd, rawStart, rawEnd,
          deltaN:b[9] | (b[10] << 8), addressUnit:opna ? opnaAddressUnit(b[1]) : 256} : null;
      }
    }
    return true;
  }
  return false;
}

export function opnAdpcmRows(state, part) {
  const word = (lo, hi) => lo | (hi << 8);
  const unit = state.chip === "ym2608" ? opnaAddressUnit(state.b[1]) : 256;
  const address = (lo, hi, end = false) => '0x' + (word(lo, hi) * unit + (end ? unit - 1 : 0)).toString(16).toUpperCase().padStart(6, '0');
  const pan = reg => ['—','R','L','L+R'][reg >>> 6];
  const {a,b,commands} = state;
  if (part === 'B') return [{name:'Delta-T',values:[commands[6], address(b[2], b[3]), address(b[4], b[5], true),
    b[11], pan(b[1]), word(b[9], b[10]), b[0] & 16 ? 'On' : 'Off']}];
  if (state.chip === 'ym2608') return rhythmNames.map((name,ch) => ({
    name, values:[commands[ch], a[8+ch] & 31, pan(a[8+ch])],
  }));
  return Array.from({length:6}, (_, ch) => ({name:'CH' + (ch + 1), values:[commands[ch],
    address(a[16+ch], a[24+ch]), address(a[32+ch], a[40+ch], true), a[8+ch] & 31, pan(a[8+ch])]}));
}
