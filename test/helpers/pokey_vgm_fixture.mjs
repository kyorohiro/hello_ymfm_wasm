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

/** Original one-pass import fixture with an authored silent onset. Its
 * nonperiodic 12 kHz volume-only streams expose dropped/reordered bytes,
 * fractional-rate timing and a one-quantum offset between two POKEYs. The
 * ordinary-register path deliberately changes shared/joined control and
 * repeats STIMER writes at the same sample boundary.
 */
export function createPokeyImportVgm({dual=false,clock=1789773,dense=false,seconds=.65}={}) {
  const initial=createPokeyVgm({dual,clock,seconds,loop:false,voices:[{volume:0}]});
  const data=[],write=(chip,register,value)=>data.push(0xbb,(chip<<7)|register,value);
  const wait=count=>{while(count){const n=Math.min(count,65535);data.push(0x61,n&255,n>>>8);count-=n;}};
  const chips=dual?2:1,samples=Math.round(seconds*44100),onset=2205;
  if(samples<22050)throw new RangeError('Import fixture duration must be at least half a second');
  for(let chip=0;chip<chips;chip++){
    for(let ch=0;ch<4;ch++)write(chip,ch*2+1,0xa0);
    write(chip,8,0);write(chip,15,3);write(chip,9,0);
  }
  if(dense){
    const count=Math.floor((samples-onset-2205)*12000/44100);
    for(let chip=0;chip<chips;chip++){
      const bytes=new Uint8Array(count);let state=(0x65a39d27^(chip*0x3db7a149))>>>0;
      for(let i=0;i<count;i++){state^=state<<13;state^=state>>>17;state^=state<<5;bytes[i]=0x10+(1+((state>>>0)%7));}
      data.push(0x67,0x66,0,count&255,(count>>>8)&255,(count>>>16)&255,count>>>24,...bytes);
    }
    for(let chip=0;chip<chips;chip++)data.push(0x90,chip,0x1e|(chip<<7),0,chip?7:3,
      0x91,chip,0,1,0,0x92,chip,0xe0,0x2e,0,0);
    wait(onset);
    for(let chip=0;chip<chips;chip++)data.push(0x95,chip,chip,0,0);
    wait(samples-onset-2205);
    for(let chip=0;chip<chips;chip++){data.push(0x94,chip);write(chip,chip?7:3,0x10);}
    wait(2205);
  }else{
    wait(onset);
    for(let chip=0;chip<chips;chip++){
      write(chip,0,chip?70:91);write(chip,1,0xa5);write(chip,9,0);write(chip,9,0);
    }
    wait(4410);
    for(let chip=0;chip<chips;chip++){
      write(chip,4,chip?61:45);write(chip,5,0xc2);write(chip,8,0x40);write(chip,0,chip?90:112);
    }
    wait(6615);
    for(let chip=0;chip<chips;chip++){
      write(chip,1,0xa0);write(chip,8,0x50);write(chip,0,chip?0x9b:0xd1);write(chip,2,3);
      write(chip,3,0xa4);write(chip,9,0);
    }
    wait(samples-onset-4410-6615-2205);
    for(let chip=0;chip<chips;chip++)for(let ch=0;ch<4;ch++)write(chip,ch*2+1,0xa0);
    wait(2205);
  }
  data.push(0x66);
  const bytes=new Uint8Array(0x100+data.length),view=new DataView(bytes.buffer);
  bytes.set(initial.subarray(0,0x100));view.setUint32(4,bytes.length-4,true);bytes.set(data,0x100);
  return bytes;
}
