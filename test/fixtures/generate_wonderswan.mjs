// Original WonderSwan wavetable test note; no game, BIOS or external ROM data.
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
export function wonderSwanToneFixture() {
  const commands=[],write=(register,value)=>commands.push(0xbc,register,value);
  // VGM 0xc6 stores the wave-RAM address most significant byte first.
  for(let i=0;i<16;i++)commands.push(0xc6,0x12,i,i<8?0xff:0x00);
  write(0x0f,0x48); // 0x48 << 6 = 0x1200
  const frequency=2048-Math.round(3072000/(32*440));
  write(0,frequency&255);write(1,frequency>>8);write(8,0xf8);write(0x11,8);write(0x10,1);
  commands.push(0x61,0x22,0x56);write(0x10,0);commands.push(0x66);
  const bytes=new Uint8Array(256+commands.length),view=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);bytes.set(commands,256);
  for(const [offset,value]of [[4,bytes.length-4],[8,0x171],[0x18,22050],[0x34,204],[0xc0,3072000]])view.setUint32(offset,value,true);
  return bytes;
}
const bytes=wonderSwanToneFixture();
writeFileSync(new URL('./wonderswan-tone.vgm',import.meta.url),bytes);
writeFileSync(new URL('./wonderswan-tone.vgz',import.meta.url),gzipSync(bytes));
