// RF5C164 register/RAM semantics follow third_party/mame-rf5c164/rf5c164.cpp.
export function createRf5c164Samples(clock) {
  const ram = new Uint8Array(65536), present = new Uint8Array(65536);
  const channels = Array.from({length:8}, () => ({r:new Uint8Array(7), enabled:false, event:null}));
  const samples=[], events=[], warnings=new Set(), definitions=new Map();
  let bank=0, selected=0, enabled=false, generation=0, retained=0;
  function begin(ch,index,time) {
    if(events.length>=100000) throw new Error('RF5C164 event limit exceeded.');
    const r=ch.r, start=r[6]*256, loopAddress=r[4]|r[5]<<8;
    // Include both initial and loop regions in a RAM snapshot. Save raw RAM
    // explicitly: an FF marker is a loop jump, not necessarily natural EOS.
    const key=`${generation}:${start}:${loopAddress}`;
    let sample=definitions.get(key);
    if(!sample) {
      if(retained+65536>64*1024*1024) throw new Error('RF5C164 snapshot limit (64 MiB) exceeded.');
      const visited=new Set(); let address=start, complete=true;
      while(!visited.has(address)) {
        visited.add(address);
        if(!present[address]) {complete=false;break;}
        if(ram[address]===255) {
          if(!present[loopAddress]) {complete=false;break;}
          if(ram[loopAddress]===255) break;
          address=loopAddress;
        } else address=(address+1)&65535;
      }
      sample={id:samples.length+1,chip:'rf5c164',kind:'pcm',generation,
        byteStart:0,byteEndExclusive:65536,size:65536,available:present.reduce((a,b)=>a+b,0),
        data:complete?ram.slice():null,startAddress:start,loopAddress};
      if(sample.data)retained+=65536;
      samples.push(sample);definitions.set(key,sample);
    }
    const step=r[2]|r[3]<<8;
    const event={sampleId:sample.id,chip:'rf5c164',kind:'pcm',channel:index+1,startTime:time,
      endTime:null,endReason:'unknown',clock,rate:clock/384*step/2048,step,
      level:r[0],pan:r[1],loop:true,startAddress:start,loopAddress,settings:[...r]};
    ch.event=event; events.push(event);
  }
  function apply(e,time) {
    if(!e.type.startsWith('rf5c164-'))return;
    if(e.chipIndex){warnings.add('Second RF5C164 chip is not analyzed.');return;}
    if(e.type==='rf5c164-data'||e.type==='rf5c164-memory-write') {
      const offset=e.offset|bank, bytes=e.data??Uint8Array.of(e.value);
      if(offset+bytes.length>65536)throw new Error('RF5C164 RAM transfer exceeds 64 KiB.');
      let changed=false;
      bytes.forEach((v,i)=>{changed ||= !present[offset+i]||ram[offset+i]!==v;ram[offset+i]=v;present[offset+i]=1;});
      if(changed){generation++;if(channels.some(ch=>ch.event))warnings.add('RAM changed during playback; previews retain the start-time snapshot.');}
      return;
    }
    const {register:r,value:v}=e;
    if(r===7) {
      const wasEnabled=enabled;enabled=Boolean(v&128);
      if(v&64)selected=v&7;else bank=(v&15)<<12;
      if(wasEnabled!==enabled) channels.forEach((ch,i)=>{
        if(!ch.enabled)return;
        if(enabled&&!ch.event)begin(ch,i,time);
        else if(ch.event) {ch.event.changes??=[];ch.event.changes.push({time,type:enabled?'resume':'pause'});}
      });
    } else if(r===8) {
      channels.forEach((ch,i)=>{
        const next=!(v&(1<<i));
        if(!next&&ch.event){ch.event.endTime=time;ch.event.endReason='keyOff';ch.event=null;}
        if(next&&!ch.enabled&&enabled)begin(ch,i,time);
        ch.enabled=next;
      });
    } else if(r>=0&&r<=6) {
      const ch=channels[selected];ch.r[r]=v;
      if(ch.event){ch.event.changes??=[];ch.event.changes.push({time,register:r,value:v});warnings.add('Live PCM settings are listed; preview uses start-time settings.');}
    }
  }
  return {apply,samples,events,warnings};
}
