/** Original synthetic WonderSwan VGM for Wave Sample Explorer checks.
 * Physical wave RAM and register writes only; no game music or ROM data.
 * Packed bytes are low-nibble first. A and B deliberately differ under nibble
 * reversal and are shared across channels to exercise content deduplication.
 */
export const WONDER_SWAN_SAMPLE_WAVES = [
  [0x21,0x43,0x65,0x87,0xa9,0xcb,0xed,0x0f,0x10,0x32,0x54,0x76,0x98,0xba,0xdc,0xfe],
  [0xf0,0x0f,0xe1,0x1e,0xd2,0x2d,0xc3,0x3c,0xb4,0x4b,0xa5,0x5a,0x96,0x69,0x87,0x78],
].map(wave=>Object.freeze(wave));
export function createWonderSwanSampleVgm({clock=3072000}={}) {
  const commands=[],write=(port,value)=>commands.push(0xbc,port-0x80,value&255);
  const wait=()=>commands.push(0x61,0x44,0xac);
  const base=0x1200;
  for(let channel=0;channel<4;channel++){
    const wave=WONDER_SWAN_SAMPLE_WAVES[channel===2?1:0];
    for(let index=0;index<16;index++){
      const address=base+channel*16+index;
      commands.push(0xc6,address>>>8,address&255,wave[index]);
    }
    const frequency=[220,330,440,550][channel],period=2048-Math.round(clock/(32*frequency));
    write(0x80+channel*2,period);write(0x81+channel*2,period>>>8);
    write(0x88+channel,0x99);
  }
  write(0x8f,0x48);write(0x91,8);write(0x90,7);wait();
  write(0x90,0);wait();write(0x90,7);wait();write(0x90,0);
  commands.push(0x66);
  const bytes=new Uint8Array(0x100+commands.length),view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);
  view.setUint32(8,0x171,true);view.setUint32(0x18,3*44100,true);
  view.setUint32(0x34,0x100-0x34,true);view.setUint32(0xc0,clock,true);
  bytes.set(commands,0x100);return bytes;
}

