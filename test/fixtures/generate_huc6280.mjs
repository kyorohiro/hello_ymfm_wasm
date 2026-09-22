// Original one-second square wave, no game data or external ROM.
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
const commands=[];
const write=(register,value)=>commands.push(0xb9,register,value);
write(1,255);write(0,0);write(4,64);write(4,0);
for(let i=0;i<32;i++)write(6,i<16?31:0);
write(2,254);write(3,0);write(5,255);write(4,159);
commands.push(0x61,0x44,0xac);write(4,0);commands.push(0x66);
const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
bytes.set([86,103,109,32]);bytes.set(commands,256);
for(const [offset,value] of [[4,bytes.length-4],[8,0x171],[0x18,44100],[0x34,204],[0xa4,3579545]])view.setUint32(offset,value,true);
writeFileSync(new URL('./huc6280-tone.vgm',import.meta.url),bytes);
writeFileSync(new URL('./huc6280-tone.vgz',import.meta.url),gzipSync(bytes));
