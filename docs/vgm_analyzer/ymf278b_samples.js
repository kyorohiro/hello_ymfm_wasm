// Header layout and signed PCM packing follow src/ymfm_pcm.cpp.
export function createYmf278bSamples(clock, waveRom) {
  const samples=[],events=[],warnings=new Set(),regs=new Uint8Array(256);
  if(!clock)return {samples,events,warnings,apply(){},finish(){}};
  const memory=new Uint8Array(0x400000),present=new Uint8Array(memory.length);
  const headers=Array(24).fill(null),active=Array(24).fill(null),definitions=new Map();
  let generation=0,retained=0,address=0;
  function load(data,offset=0){
    if(offset<0||offset+data.length>memory.length)throw new Error('OPL4 memory exceeds 4 MiB');
    memory.set(data,offset);present.fill(1,offset,offset+data.length);generation++;
  }
  if(waveRom){if(!(waveRom instanceof Uint8Array)||waveRom.length!==0x200000)throw new Error('YMF278B wave ROM must be 2097152 bytes');load(waveRom);}
  function close(ch,time,reason){if(active[ch]){active[ch].endTime=time;active[ch].endReason=reason;active[ch]=null;}}
  function begin(ch,time){
    close(ch,time,'retrigger');
    const h=headers[ch];
    if(!h){warnings.add('OPL4 sample header missing at wave-number write; load the external Wave ROM and analyze again.');return;}
    if(h.format===3||!h.length){warnings.add('OPL4 reserved format or zero-length sample omitted.');return;}
    const size=Math.ceil(h.length*[1,1.5,2][h.format]),key=JSON.stringify([generation,h]);
    let sample=definitions.get(key);
    if(!sample){
      if(retained+size>64*1024*1024)throw new Error('OPL4 sample analysis exceeds 64 MiB');
      if(h.start+size>memory.length){warnings.add('OPL4 wrapped sample address omitted.');return;}
      const available=present.subarray(h.start,h.start+size).reduce((a,b)=>a+b,0);
      sample={id:samples.length+1,chip:'ymf278b',kind:'pcm',generation,byteStart:h.start,byteEndExclusive:h.start+size,size,available,
        data:available===size?memory.slice(h.start,h.start+size):null,format:[8,12,16][h.format],frameCount:h.length,loopStart:h.loop,waveNumber:h.wave};
      if(sample.data)retained+=size;
      samples.push(sample);definitions.set(key,sample);
    }
    if(events.length>=100000)throw new Error('OPL4 sample analysis exceeds 100,000 events');
    const octave=(regs[0x38+ch]>>4)^8,oct=octave-8;
    const fnum=(regs[0x20+ch]>>1)|((regs[0x38+ch]&7)<<7);
    const rate=clock/768*(1024+fnum)/2048*2**oct;
    const event={sampleId:sample.id,chip:'ymf278b',kind:'pcm',channel:ch+1,startTime:time,endTime:null,endReason:'unknown',clock,rate,octave:oct,fnum,level:regs[0x50+ch]>>1,pan:regs[0x68+ch]&15};
    events.push(event);active[ch]=event;
  }
  function apply(e,time){
    if(e.type==='opl-sample-data'&&e.chip==='ymf278b'){
      if(e.chipIndex){warnings.add('Second OPL4 chip is not analyzed.');return;}
      load(e.data,e.offset);return;
    }
    if(e.type!=='ymf278b-write'||e.port!==2)return;
    if(e.chipIndex){warnings.add('Second OPL4 chip is not analyzed.');return;}
    const r=e.register,v=e.value,old=regs[r];regs[r]=v;
    if(r>=3&&r<=5)address=((regs[3]&63)<<16)|(regs[4]<<8)|regs[5];
    if(r===6&&(regs[2]&1)){load(Uint8Array.of(v),address);address=(address+1)&0x3fffff;}
    if(r>=8&&r<32){
      const ch=r-8,wave=v|((regs[ch+0x20]&1)<<8),bank=(regs[2]>>2)&7;
      const a=wave>=384&&bank?bank*0x80000+(wave-384)*12:wave*12;
      headers[ch]=present.subarray(a,a+12).every(Boolean)?{wave,format:memory[a]>>6,start:((memory[a]&63)<<16)|(memory[a+1]<<8)|memory[a+2],loop:(memory[a+3]<<8)|memory[a+4],length:(0x10000-((memory[a+5]<<8)|memory[a+6]))&0xffff}:null;
    }
    if(r>=0x68&&r<=0x7f){const ch=r-0x68;if(!(v&128))close(ch,time,'key off');else if(!(old&128))begin(ch,time);}
  }
  return {samples,events,warnings,apply,finish(time){for(let ch=0;ch<24;ch++)close(ch,time,'VGM end');if(events.length)warnings.add('OPL4 PCM is a key-on memory snapshot. Preview plays one raw sample pass at the initial pitch; loops, envelope, LFO and later pitch/memory changes are not reproduced. Sample pitch is a playback rate, not an absolute musical note.');}};
}
export function decodeYmf278bSample(sample){
  if(!sample.data)throw new Error('Sample has missing/partial data');
  const d=sample.data,out=new Float32Array(sample.frameCount);
  for(let i=0;i<out.length;i++){
    let v;
    if(sample.format===8)v=d[i]<<8;
    else if(sample.format===16)v=(d[i*2]<<8)|d[i*2+1];
    else {const a=Math.floor(i/2)*3;v=i%2?(d[a+2]<<8)|(d[a+1]&240):(d[a]<<8)|((d[a+1]<<4)&240);}
    out[i]=(v>=32768?v-65536:v)/32768;
  }
  return out;
}
