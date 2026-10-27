/** Original synthetic VGM 1.71 POKEY tones; no game music or ROM data.
 * Header 0xb0 stores the clock and bit 30 selects two chips. BB writes use
 * bit 7 of the register byte as the chip index, and physical registers 0..15.
 * Normal 28-cycle clock / pure-tone distortion keeps pitch and routing
 * observable without joined channels or analog-board assumptions.
 */
export function createPokeyVgm({dual=false,chip=0,channel=0,clock=1789790,seconds=8,loop=true,voices}={}) {
  if(typeof dual!=='boolean')throw new TypeError('dual must be boolean');
  const validChip=value=>Number.isInteger(value)&&value>=0&&value<(dual?2:1);
  if(!validChip(chip))throw new RangeError('chip is outside the configured POKEY count');
  if(!Number.isInteger(channel)||channel<0||channel>3)throw new RangeError('channel must be 0..3');
  if(!Number.isInteger(clock)||clock<100000||clock>100000000)throw new RangeError('Invalid POKEY clock');
  const samples=Math.round(seconds*44100);
  if(!Number.isSafeInteger(samples)||samples<441||samples>0xffffffff)throw new RangeError('Invalid fixture duration');
  const selected=voices??[{chip,channel,frequency:[220,330,440,550][channel]+chip*110,volume:12}];
  if(!Array.isArray(selected)||!selected.length)throw new TypeError('voices must be a nonempty array');
  const data=[],write=(index,register,value)=>data.push(0xbb,(index<<7)|register,value&255);
  const wait=count=>{while(count){const length=Math.min(count,65535);data.push(0x61,length&255,length>>>8);count-=length;}};
  for(let index=0;index<(dual?2:1);index++) {
    for(let voice=0;voice<4;voice++)write(index,voice*2+1,0xa0);
    write(index,8,0);write(index,15,3);
  }
  for(const voice of selected) {
    const {chip:index=0,channel:physical=0,frequency=440,volume=12,distortion=5}=voice;
    if(!validChip(index))throw new RangeError('voice chip is outside the configured POKEY count');
    if(!Number.isInteger(physical)||physical<0||physical>3)throw new RangeError('voice channel must be 0..3');
    if(!Number.isFinite(frequency)||frequency<=0)throw new RangeError('Invalid voice frequency');
    if(!Number.isInteger(volume)||volume<0||volume>15)throw new RangeError('voice volume must be 0..15');
    if(!Number.isInteger(distortion)||distortion<0||distortion>7)throw new RangeError('voice distortion must be 0..7');
    const divisor=Math.max(1,Math.min(256,Math.round(clock/(2*28*frequency))));
    write(index,physical*2,divisor-1);write(index,physical*2+1,(distortion<<5)|volume);
  }
  for(let index=0;index<(dual?2:1);index++)write(index,9,0);
  const loopOffset=0x100+data.length;
  wait(samples);data.push(0x66);
  const bytes=new Uint8Array(0x100+data.length),view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);
  view.setUint32(8,0x171,true);view.setUint32(0x18,samples,true);
  view.setUint32(0x34,0x100-0x34,true);view.setUint32(0xb0,(clock|(dual?0x40000000:0))>>>0,true);
  if(loop){view.setUint32(0x1c,loopOffset-0x1c,true);view.setUint32(0x20,samples,true);}
  bytes.set(data,0x100);return bytes;
}

/** Original 32-step square PCM written through VGM's generic DAC stream.
 * The stream's target type 0x1e / 0x9e selects POKEY 1 / 2; each byte sets a
 * volume-only AUDC value. Timed writes must keep their 44100 Hz VGM phase.
 */
export function createPokeyStreamVgm({dual=false,chip=0,channel=0,clock=1789790,seconds=8,loop=true}={}) {
  const initial=createPokeyVgm({dual,chip,channel,clock,seconds,loop:false,
    voices:[{chip,channel,volume:0}]});
  let end=0x100;while(initial[end]===0xbb)end+=3;
  const data=Array.from(initial.subarray(0x100,end)),wave=Array.from({length:32},(_,i)=>i<16?0x1c:0x10);
  // One standard bank 0 block, one 11025 Hz looping data stream.
  data.push(0x67,0x66,0,wave.length,0,0,0,...wave,
    0x90,0,0x1e|(chip<<7),0,channel*2+1,
    0x91,0,0,1,0,
    0x92,0,0x11,0x2b,0,0,
    0x95,0,0,0,1);
  const loopOffset=0x100+data.length,samples=Math.round(seconds*44100);
  let remaining=samples;
  while(remaining){const count=Math.min(remaining,65535);data.push(0x61,count&255,count>>>8);remaining-=count;}
  data.push(0x66);
  const bytes=new Uint8Array(0x100+data.length),view=new DataView(bytes.buffer);
  bytes.set(initial.subarray(0,0x100));view.setUint32(4,bytes.length-4,true);
  if(loop){view.setUint32(0x1c,loopOffset-0x1c,true);view.setUint32(0x20,samples,true);}
  bytes.set(data,0x100);return bytes;
}
