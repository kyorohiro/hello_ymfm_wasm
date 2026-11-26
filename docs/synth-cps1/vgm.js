// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM} from '../js/ym2612vgm.js';

export function inspectSong(bytes) {
  const parser = new Ym2612VGM(bytes);
  const {ym2151Clock,okim6295Clock} = parser.header;
  if (!(ym2151Clock || okim6295Clock) || (ym2151Clock & 0xc0000000) || (okim6295Clock & 0x40000000))
    throw Error('Choose a VGM for a single YM2151 and/or MSM6295.');
  let ticks = 0;
  while (!parser.ended) {
    const pos = parser.position, cmd = bytes[pos];
    if (!(cmd===0x54 && ym2151Clock || cmd===0xb8 && okim6295Clock ||
        cmd===0x67 && okim6295Clock && bytes[pos+2]===0x8b ||
        [0x61,0x62,0x63,0x66].includes(cmd) || cmd>=0x70 && cmd<=0x7f))
      throw Error('Unsupported CPS1 VGM command at '+pos+'.');
    const event = parser.step();
    if (parser.position>bytes.length || event.chipIndex) throw Error('Truncated or dual-chip CPS1 VGM.');
    if (event.type==='wait') ticks+=event.samples;
  }
  if (!ticks) throw Error('VGM contains no playback time.');
}
