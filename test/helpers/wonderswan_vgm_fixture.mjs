/** Original synthetic VGM 1.71 fixtures; no game music or ROM data.
 * Format references: vgmrips/vgmplay-legacy VGMPlay/vgmspec171.txt and
 * ValleyBell/libvgm player/vgmplayer_cmdhandler.cpp, Cmd_WSwan_Reg.
 * BC uses register offset (hardware address minus 0x80), while C6 stores
 * the physical RAM address in big-endian order. A nonzero high RAM byte
 * deliberately makes an accidental little-endian implementation audible.
 */
export function createWonderSwanVgm({channel=0,mode='wave',clock=3072000,seconds=8,loop=true}={}) {
  if (!Number.isInteger(channel)||channel<0||channel>3) throw new RangeError('channel must be 0..3');
  if (!['wave','noise','sweep','voice'].includes(mode)) throw new RangeError('Unknown WonderSwan fixture mode');
  const samples=Math.round(seconds*44100);
  if (!Number.isSafeInteger(samples)||samples<441||samples>0xffffffff) throw new RangeError('Invalid fixture duration');
  if (mode==='voice') channel=1;
  if (mode==='sweep') channel=2;
  if (mode==='noise') channel=3;
  const data=[],write=(port,value)=>data.push(0xbc,port-0x80,value&255);
  const wait=count=>{while(count){const length=Math.min(count,65535);data.push(0x61,length&255,length>>>8);count-=length;}};
  const base=0x48,address=base<<6;
  for (let voice=0;voice<4;voice++) {
    for(let byte=0;byte<16;byte++) {
      const offset=address+voice*16+byte;
      data.push(0xc6,offset>>>8,offset&255,byte<8?0xff:0x00);
    }
    // Four different pitches make channel aliasing observable.
    const frequency=[220,330,440,550][voice],period=Math.max(0,2048-Math.round(clock/(32*frequency)));
    write(0x80+voice*2,period);write(0x81+voice*2,period>>>8);write(0x88+voice,0xff);
  }
  write(0x8f,base);write(0x91,8); // Headphone stereo output enabled.
  let gate=1<<channel;
  if(mode==='noise'){write(0x8e,0x18);gate|=0x80;}
  if(mode==='sweep'){write(0x8c,1);write(0x8d,4);gate|=0x40;}
  if(mode==='voice'){write(0x94,15);gate|=0x20;}
  write(0x90,gate);
  const loopOffset=0x100+data.length;
  if(mode==='voice') {
    // Direct unsigned 8-bit DAC writes need a changing stream, not one DC value.
    let remaining=samples,index=0;
    while(remaining){write(0x89,index++&1?0xe0:0x20);const count=Math.min(remaining,44);wait(count);remaining-=count;}
  } else wait(samples);
  data.push(0x66);
  const bytes=new Uint8Array(0x100+data.length),view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);
  view.setUint32(8,0x171,true);view.setUint32(0x18,samples,true);
  view.setUint32(0x34,0x100-0x34,true);view.setUint32(0xc0,clock,true);
  if(loop){view.setUint32(0x1c,loopOffset-0x1c,true);view.setUint32(0x20,samples,true);}
  bytes.set(data,0x100);return bytes;
}
