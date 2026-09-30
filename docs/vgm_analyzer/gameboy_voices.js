// Trigger-time register settings, not an emulation of envelope/sweep/length counters.
const CHANNELS = [{channel:1,base:0,kind:'pulse'}, {channel:2,base:5,kind:'pulse'}, {channel:4,base:15,kind:'noise'}];
const DUTY = [0.125,0.25,0.5,0.75];
export function createGameboyVoices() {
  const regs = Array(23).fill(null), active = new Map(), definitions = new Map();
  const samples = [], events = [], warnings = new Set();
  let writes = 0;
  function close(channel,time,reason) {
    const e=active.get(channel);
    if(e){e.endTime=time;e.endReason=reason;active.delete(channel);}
  }
  function record(config,time) {
    const {base,channel,kind}=config;
    close(channel,time,'next trigger write');
    const env=regs[base+2], shape=regs[kind==='noise'?18:base+1];
    if(env===null || shape===null){warnings.add('Game Boy: triggers with unknown voice registers are omitted.');return;}
    const voice={volume:env>>4,envelope:{direction:env&8?'up':'down',period:env&7}};
    if(kind==='pulse')voice.duty=DUTY[shape>>6];
    else Object.assign(voice,{divisor:shape&7,shift:shape>>4,width:shape&8?7:15});
    const sweep=channel===1 && regs[0]!==null?{direction:regs[0]&8?'down':'up',period:(regs[0]>>4)&7,shift:regs[0]&7}:null;
    const key=JSON.stringify([channel,voice,sweep]);
    let sample=definitions.get(key);
    if(!sample){
      const data=Uint8Array.from([shape & (kind==='pulse'?0xc0:0xff),env,...(sweep?[regs[0]&0x7f]:[])]);
      sample={id:samples.length+1,chip:'gameboy',kind,channel,voice,sweep,data,size:data.length,available:data.length};
      samples.push(sample);definitions.set(key,sample);
    }
    if(events.length>=100000)throw new Error('Game Boy voice analysis exceeds 100,000 triggers');
    const initialRegisters=Object.fromEntries([...(channel===1?[0]:[]),base+1,base+2,base+3,base+4,20,21,22].map(r=>[r,regs[r]]));
    const lengthLoad=regs[base+1]===null?null:regs[base+1]&63;
    const e={sampleId:sample.id,chip:'gameboy',kind,channel,startTime:time,endTime:null,
      initialRegisters,length:{enabled:Boolean(regs[base+4]&64),lastWrittenLoad:lengthLoad},
      frequencyRegister:kind==='pulse'&&regs[base+3]!==null?regs[base+3]|((regs[base+4]&7)<<8):null,
      dacEnabled:Boolean(env&0xf8),powerEnabled:regs[22]===null?null:Boolean(regs[22]&128),changes:[]};
    events.push(e);
    if(e.dacEnabled && e.powerEnabled!==false)active.set(channel,e);
    else {e.endTime=time;e.endReason='trigger with DAC or APU disabled';}
  }
  return {samples,events,warnings,
    apply(e,time){
      if(e.type!=='gameboy-dmg-write'||e.chipIndex)return;
      const {register:r,value:v}=e;
      if(r>22)return;
      if(++writes>4000000)throw new Error('Game Boy voice analysis exceeds four million writes');
      const config=CHANNELS.find(c=>r>=c.base && r<=c.base+4);
      const trigger=config && r===config.base+4 && Boolean(v&128);
      for(const [ch,event] of active){
        if((config?.channel===ch && !trigger) || [20,21,22].includes(r)) {
          event.changes.push({offsetSamples:time-event.startTime,register:r,value:v});
        }
      }
      regs[r]=v;
      if(r===22 && !(v&128)){
        for(const {channel} of CHANNELS)close(channel,time,'APU power off write');
        // Later writes, rather than guessed reset values/counter state, establish the next snapshot.
        regs.fill(null,0,22);return;
      }
      if(trigger)record(config,time);
      else if(config && r===config.base+2 && !(v&0xf8))close(config.channel,time,'DAC disabled write');
    },
    finish(time){for(const {channel} of CHANNELS)close(channel,time,'VGM end');},
  };
}
export function gameboyVoiceCode(sample) {
  const {kind,channel,voice,sweep}=sample;
  const lines=['// Apply after gb.initialize(). Initial settings only; later writes are listed separately.'];
  lines.push(kind==='pulse'?`gb.pulse.setVoice(${channel-1}, ${JSON.stringify(voice,null,2)});`:`gb.noise.setVoice(${JSON.stringify(voice,null,2)});`);
  if(channel===1)lines.push(sweep?`gb.pulse.setSweep(${JSON.stringify(sweep)});`:'// CH1 sweep was not recorded; configure it separately.');
  lines.push('// Pitch, hardware length counter, routing and master volume are not applied here.');
  lines.push(kind==='pulse'?`// Set your pitch with gb.pulse.setNote(${channel-1}, "C4"), then gb.pulse.keyOn(${channel-1}).`:'// Call gb.noise.keyOn() to play.');
  return lines.join('\n');
}
export function gameboyVoiceJson(sample,events) {
  return JSON.stringify({schemaVersion:1,chip:'gameboy',kind:sample.kind,channel:sample.channel,
    representation:'trigger-register-settings',voice:sample.voice,sweep:sample.sweep,timebase:44100,
    occurrences:events.filter(e=>e.sampleId===sample.id)},null,2);
}
