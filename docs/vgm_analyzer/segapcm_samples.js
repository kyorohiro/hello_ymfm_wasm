// Mirrors the register window and bank rules in third_party/mame-segapcm/segapcm.cpp.
// Snapshots describe the programmed range at enable time, not recovered instruments.
export function createSegaPcmSamples(clock, bankShift=0, bankMask=0) {
  bankMask=(bankMask||0x70)&(bankShift>=32?0:0x1fffff>>>bankShift);
  const voices=Array.from({length:16},()=>({addr:0xffff00,loop:65535,end:255,freq:255,left:255,right:255,ctrl:255,event:null}));
  const samples=[],events=[],warnings=new Set(),definitions=new Map();
  let rom=new Uint8Array(),present=new Uint8Array(),generation=0,retained=0,ticks=0,changes=0;
  const finish=(v,time,reason)=>{if(v.event){v.event.endTime=time;v.event.endReason=reason;v.event=null;}};
  function advance(time) {
    if(!(clock>0))return;
    const next=Math.ceil(time*clock/(44100*128)),count=next-ticks;
    if(count<=0)return;
    for(const v of voices){
      if(v.ctrl&1){v.addr&=0xffff00;continue;}
      let remaining=count,elapsed=0;
      const boundary=((v.end+1)&255)*65536;
      // At most initial run + one loop traversal; subsequent loops use modulo.
      while(remaining>0){
        if((v.addr>>>16)===((v.end+1)&255)){
          if(v.ctrl&2){v.ctrl|=1;finish(v,Math.ceil((ticks+elapsed)*128*44100/clock),'sampleEnd');break;}
          v.addr=v.loop*256;
          if((v.addr>>>16)===((v.end+1)&255)){
            // Core reads from loop even when loop and end pages coincide.
            warnings.add('Sega PCM loop starts on the end page; preview uses the start-time range only.');
            v.addr=(v.addr+v.freq)&0xffffff;remaining--;elapsed++;if(!remaining)break;
          }
        }
        if(!v.freq)break;
        const distance=(boundary-v.addr+0x1000000)%0x1000000;
        const until=Math.ceil(distance/v.freq)||1,n=Math.min(remaining,until);
        v.addr=(v.addr+n*v.freq)&0xffffff;remaining-=n;elapsed+=n;
        if(remaining && !(v.ctrl&2)){
          const loopDistance=(boundary-v.loop*256+0x1000000)%0x1000000;
          const period=Math.ceil(loopDistance/v.freq);
          if(period>0){const skip=Math.floor((remaining-1)/period)*period;remaining-=skip;elapsed+=skip;}
        }
      }
    }
    ticks=next;
  }
  function begin(v,index,time){
    if(events.length>=100000)throw new Error('Sega PCM event limit exceeded.');
    const start=v.addr>>>8,end=(v.end+1)*256,loop=!(v.ctrl&2);
    const bank=bankShift>=32?0:(v.ctrl&bankMask)*2**bankShift;
    const low=loop?Math.min(start,v.loop):start;
    const endPage=(v.end+1)&255;
    const valid=start<end&&(start>>>8)!==endPage&&(!loop||(v.loop<end&&(v.loop>>>8)!==endPage));
    const byteStart=bank+low,byteEndExclusive=bank+end,size=valid?end-low:0;
    const key=`${generation}:${bank}:${low}:${end}:${valid}`;
    let sample=definitions.get(key);
    if(!sample){
      if(samples.length>=100000||retained+size>64*1024*1024)throw new Error('Sega PCM snapshot limit exceeded (64 MiB / 100,000 definitions).');
      let available=0;for(let a=byteStart;a<byteStart+size;a++)available+=present[a]||0;
      const data=valid&&available===size?rom.slice(byteStart,byteEndExclusive):null;
      sample={id:samples.length+1,chip:'segapcm',kind:'pcm',generation,bank,byteStart,byteEndExclusive,size,available,data,format:'unsigned-8',rangeStart:low};
      if(data)retained+=size;samples.push(sample);definitions.set(key,sample);
    }
    if(!valid)warnings.add('Sega PCM wrapped or end-page start/loop ranges are not extracted.');
    if(!sample.data)warnings.add('Sega PCM sample data is missing, partial or has an unsupported range.');
    const event={sampleId:sample.id,chip:'segapcm',kind:'pcm',channel:index+1,startTime:time,endTime:null,endReason:'unknown',
      clock,rate:clock/128*v.freq/256,step:v.freq,level:Math.max(v.left&127,v.right&127),pan:`L${v.left&127}/R${v.right&127}`,
      leftLevel:v.left&127,rightLevel:v.right&127,bank,bankShift,bankMask,startAddress:start,loopAddress:v.loop,endAddress:end,loop};
    events.push(event);v.event=event;
  }
  function apply(e,time){
    if(!e.type.startsWith('segapcm-'))return;
    advance(time);
    if(e.chipIndex){warnings.add('Second Sega PCM chip is not analyzed.');return;}
    if(e.type==='segapcm-rom-data'){
      if(e.memorySize>0x200000||e.offset<0||e.offset+e.data.length>e.memorySize)throw new Error('Invalid Sega PCM ROM range');
      const next=new Uint8Array(e.memorySize),coverage=new Uint8Array(e.memorySize);
      next.set(rom.subarray(0,e.memorySize));coverage.set(present.subarray(0,e.memorySize));
      let changed=rom.length!==next.length;
      e.data.forEach((v,i)=>{const a=e.offset+i;changed ||= !coverage[a]||next[a]!==v;next[a]=v;coverage[a]=1;});
      rom=next;present=coverage;
      if(changed){generation++;if(voices.some(v=>v.event))warnings.add('Sega PCM ROM changed during playback; previews retain the enable-time snapshot.');}
      return;
    }
    if(e.type!=='segapcm-write'||e.offset>=256)return;
    const index=(e.offset>>>3)&15,v=voices[index],r=e.offset&7,high=!!(e.offset&128),value=e.value;
    if(r<2||r===7&&high)return;
    if(v.event && !(r===6&&high)){
      if(++changes>100000)throw new Error('Sega PCM live-change limit exceeded.');
      (v.event.changes??=[]).push({time,offset:e.offset,value});
      warnings.add('Sega PCM live parameter changes are listed; previews use enable-time settings.');
    }
    if(r===2)v.left=value;
    else if(r===3)v.right=value;
    else if(r===4){if(high)v.addr=(v.addr&0xff00ff)|(value<<8);else v.loop=(v.loop&0xff00)|value;}
    else if(r===5){if(high)v.addr=(v.addr&0x00ffff)|(value<<16);else v.loop=(v.loop&255)|(value<<8);}
    else if(r===7)v.freq=value;
    else if(!high)v.end=value;
    else{
      const wasDisabled=!!(v.ctrl&1),old=v.ctrl;v.ctrl=value;
      if(value&1)finish(v,time,'keyOff');
      else if(wasDisabled)begin(v,index,time);
      else if(old!==value){
        if(++changes>100000)throw new Error('Sega PCM live-change limit exceeded.');
        if(v.event)(v.event.changes??=[]).push({time,offset:e.offset,value});
        warnings.add('Sega PCM live bank/loop changes are not applied to previews.');
      }
    }
  }
  return {samples,events,warnings,apply,advance,finish(time){advance(time);for(const v of voices)finish(v,time,'vgmEnd');}};
}
