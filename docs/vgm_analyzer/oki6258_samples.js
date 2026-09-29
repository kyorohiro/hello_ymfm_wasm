// A play/stop capture of register writes, not inferred instrument boundaries.
// Recording, 3-bit ADPCM and a second chip are deliberately excluded.
export function createOki6258Samples(headerClock,flags) {
  const samples=[],events=[],warnings=new Set();
  const clock=headerClock&0x3fffffff,dividers=[1024,768,512,512];
  let committedClock=clock,clockBuffer=clock,divider=flags&3,pan=0,active=null,count=0;
  const supported=clock>0&&!(headerClock&0xc0000000)&&!!(flags&4);
  if(headerClock&&!supported)warnings.add('OKIM6258 sample capture requires single-chip 4-bit ADPCM; dual/variant and 3-bit data are omitted.');
  function record(r,v,time){
    if(++count>1000000)throw new Error('OKIM6258 capture exceeds one million register writes.');
    active.times.push(time-active.startTime);active.registers.push(r);active.values.push(v);
    if(r===1)active.data.push(v);
  }
  function finish(time,reason){
    if(!active)return;
    if(active.data.length && time>active.startTime){
      if(samples.length>=100000)throw new Error('OKIM6258 capture exceeds 100,000 intervals.');
      const id=samples.length+1,initial=active.initial;
      samples.push({id,chip:'okim6258',kind:'adpcm-stream',data:Uint8Array.from(active.data),
        times:Float64Array.from(active.times),registers:Uint8Array.from(active.registers),values:Uint8Array.from(active.values),
        initial,flags,clock,size:active.data.length,available:active.data.length,writeCount:active.values.length,
        duration:time-active.startTime,boundary:reason});
      events.push({sampleId:id,chip:'okim6258',kind:'adpcm-stream',channel:1,startTime:active.startTime,endTime:time,endReason:reason,
        clock:initial.clock,rate:initial.clock/dividers[initial.divider],level:1,pan:initial.pan,loop:false});
    }
    active=null;
  }
  function write(r,v,time){
    if(!supported)return;
    if(r===0){
      if(v&4){warnings.add('OKIM6258 recording commands are omitted.');finish(time,'recording command');return;}
      if((v&1)||!(v&2)){if(active)record(r,v,time);finish(time,'stop');return;}
      if(!active)active={startTime:time,times:[],registers:[],values:[],data:[],initial:{clock:committedClock,clockBuffer,divider,pan}};
    }
    if(active)record(r,v,time);
    if(r===2)pan=v&3;
    if(r>=8&&r<=11){const shift=(r-8)*8;clockBuffer=((clockBuffer&~(255<<shift))|(v<<shift))>>>0;if(r===11)committedClock=clockBuffer&0x3fffffff;}
    if(r===12)divider=v&3;
  }
  return {samples,events,warnings,write,finish};
}
export function oki6258CaptureJson(sample,event){
  return JSON.stringify({schemaVersion:1,format:'tetorica-okim6258-capture',timebase:44100,
    startTime:event.startTime,duration:sample.duration,boundary:sample.boundary,clock:sample.clock,flags:sample.flags,
    initial:sample.initial,times:[...sample.times],registers:[...sample.registers],values:[...sample.values]});
}
