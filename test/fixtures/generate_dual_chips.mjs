// SPDX-License-Identifier: BSD-3-Clause
// Three one-second phrases: chip 1, chip 2, then both.
import {writeFile} from 'node:fs/promises';

for (const [name, clockField, clock, opcode] of [
  ['ym2612',0x2c,7670454,0x52], ['ym2608',0x48,7987200,0x56],
  ['ym2610',0x4c,8000000,0x58], ['dmg',0x80,4194304,0xb3],
]) {
  const data = [];
  function write(chip, register, value) {
    if (name === 'dmg') data.push(opcode, register | chip << 7, value);
    else data.push(opcode + chip * 0x50, register, value);
  }
  // Physical FM channel at register offset 1 exists on the original YM2610.
  function key(chip, on) {
    if (name === 'dmg') {
      write(chip,2,on ? 0x90 : 0);
      if (on) write(chip,4,0x80 | (chip ? 7 : 6));
    } else write(chip,0x28,on ? 0xf1 : 1);
  }
  for (const chip of [0,1]) {
    if (name === 'dmg') {
      for (const [reg,val] of [[22,128],[20,0x77],[21,0x11],[0,0],[1,chip?0x40:0x80],[3,chip?0x06:0x0c]]) write(chip,reg,val);
    } else {
      if (name === 'ym2608') write(chip,0x29,0x80);
      for (const slot of [1,5,9,13]) {
        for (const [reg,val] of [[0x30,chip && slot===13?2:1],[0x40,0x20],[0x50,31],
          [0x60,0],[0x70,0],[0x80,0x0f]]) write(chip,reg+slot,val);
      }
      for (const [reg,val] of [[0xb1,7],[0xb5,0xc0],[0xa5,chip?0x2a:0x22],[0xa1,0x69]]) write(chip,reg,val);
    }
  }
  for (const phrase of [[0],[1],[0,1]]) {
    for (const chip of phrase) key(chip,true);
    data.push(0x61,0x44,0xac); // 44100 samples
    for (const chip of phrase) key(chip,false);
  }
  data.push(0x66);
  const header = Buffer.alloc(0x100);
  header.write('Vgm ');
  for (const [offset,value] of [[4,header.length+data.length-4],[8,0x171],[0x18,3*44100],
    [0x34,header.length-0x34],[clockField,clock+0x40000000]]) header.writeUInt32LE(value,offset);
  await writeFile(new URL('dual-'+name+'.vgm',import.meta.url),Buffer.concat([header,Buffer.from(data)]));
}
