// Captured output intervals, not inferred instrument/sample boundaries.
export function createDacSamples() {
  const samples=[], events=[];
  let enabled=false, value=128, active=null, count=0;
  function finish(time,reason) {
    if(!active)return;
    if(time>active.startTime){
      const id=samples.length+1;
      samples.push({id,chip:'ym2612',kind:'dac',data:Uint8Array.from(active.values),
        times:Float64Array.from(active.times),size:active.values.length,available:active.values.length,
        duration:time-active.startTime,boundary:reason});
      events.push({sampleId:id,chip:'ym2612',kind:'dac',channel:6,startTime:active.startTime,
        endTime:time,endReason:reason,rate:44100,level:255,pan:'not tracked; preview centered'});
    }
    active=null;
  }
  function record(time) {
    if(++count>4000000)throw new Error('DAC capture exceeds four million writes.');
    if(!active)active={startTime:time,times:[],values:[]};
    active.times.push(time-active.startTime);active.values.push(value);
  }
  function advance(time) {
    while(active && time-active.startTime>=441000) {
      const end=active.startTime+441000;finish(end,'10-second display window');record(end);
    }
  }
  function write(register,data,port,time) {
    if(port!==0)return;
    advance(time);
    if(register===0x2b){
      const next=Boolean(data&128);
      if(enabled&&!next)finish(time,'DAC disabled');
      if(!enabled&&next)record(time);
      enabled=next;
    }else if(register===0x2a){value=data;if(enabled)record(time);}
  }
  return {samples,events,write,advance,finish};
}
export function renderDacPreview(sample) {
  const pcm=new Float32Array(Math.max(1,Math.ceil(sample.duration)));
  for(let i=0;i<sample.data.length;i++) {
    const from=Math.ceil(sample.times[i]),to=Math.ceil(sample.times[i+1]??sample.duration);
    pcm.fill((sample.data[i]-128)/128,from,Math.min(to,pcm.length));
  }
  return pcm;
}
