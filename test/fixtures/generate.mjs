// Original register sequences, not game music. Regenerate binary fixtures deterministically.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
function file(name,clockOffset,clock,commands) {
  const bytes=new Uint8Array(256+commands.length),v=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);
  v.setUint32(0x34,0xcc,true);v.setUint32(clockOffset,clock,true);v.setUint32(0x18,22050,true);
  bytes.set(commands,256);writeFileSync(new URL(name+'.vgm',import.meta.url),bytes);
  writeFileSync(new URL(name+'.vgz',import.meta.url),gzipSync(bytes));
}
const wait=[0x61,0x22,0x56];
file('psg-tone',0x0c,3579545,[0x50,0x80,0x50,0x10,0x50,0x90,...wait,0x50,0x9f,0x66]);
file('ay-tone',0x74,1789773,[0xa0,0,100,0xa0,1,0,0xa0,7,0x3e,0xa0,8,15,...wait,0xa0,8,0,0x66]);
file('opn-tone',0x2c,7670454,[0x52,0xa4,0x22,0x52,0xa0,0x69,0x52,0x28,0xf0,...wait,0x52,0x28,0,0x66]);
file('opm-tone',0x30,3579545,[0x54,0x28,0x4a,0x54,8,0x78,...wait,0x54,8,0,0x66]);
