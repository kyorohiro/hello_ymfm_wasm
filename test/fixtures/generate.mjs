// Original register sequences, not game music. Regenerate binary fixtures deterministically.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
function file(name,clockOffset,clock,commands,extraClocks=[]) {
  const bytes=new Uint8Array(256+commands.length),v=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);
  v.setUint32(0x34,0xcc,true);v.setUint32(clockOffset,clock,true);v.setUint32(0x18,22050,true);
  for (const [offset,hz] of extraClocks) v.setUint32(offset,hz,true);
  bytes.set(commands,256);writeFileSync(new URL(name+'.vgm',import.meta.url),bytes);
  writeFileSync(new URL(name+'.vgz',import.meta.url),gzipSync(bytes));
}
const wait=[0x61,0x22,0x56];
file('psg-tone',0x0c,3579545,[0x50,0x80,0x50,0x10,0x50,0x90,...wait,0x50,0x9f,0x66]);
file('ay-tone',0x74,1789773,[0xa0,0,100,0xa0,1,0,0xa0,7,0x3e,0xa0,8,15,...wait,0xa0,8,0,0x66]);
file('opn-tone',0x2c,7670454,[0x52,0xa4,0x22,0x52,0xa0,0x69,0x52,0x28,0xf0,...wait,0x52,0x28,0,0x66]);
file('opm-tone',0x30,3579545,[0x54,0x28,0x4a,0x54,8,0x78,...wait,0x54,8,0,0x66]);

// FM and PSG stay silent: any audible output must come from embedded RF5C164 PCM.
file('genesis-pcm',0x2c,7670453,[
  0x67,0x66,0xc1,7,0,0,0,0,0,0x40,0x40,0xc0,0xc0,0xff,
  0xb1,7,0xc0,0xb1,0,255,0xb1,1,255,
  0xb1,2,0,0xb1,3,8,0xb1,4,0,0xb1,5,0,0xb1,6,0,
  0xb1,8,0xfe,...wait,0xb1,8,255,0x66,
],[[0x6c,12500000],[0x0c,3579545]]);
