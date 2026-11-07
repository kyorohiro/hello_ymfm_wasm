// SPDX-License-Identifier: BSD-3-Clause
// Original controlled chip experiments; no music or measured waveform tables.
export const QUALITY_CLOCK=985248;
export const QUALITY_CAPTURE=QUALITY_CLOCK/4;
export function qualityTone({name,model=8580,rate=48000,hz=800,harmonic=1,sustain=4,wave=0x20,mode=0,fc=0,res=0,voice3off=false,kind='transfer'}){
  const reg=Math.round(hz/harmonic*2**24/QUALITY_CLOCK);
  if(reg<1||reg>65535)throw Error('SID frequency register out of range');
  const actualHz=reg*QUALITY_CLOCK/2**24,commands=[['w',24,0]];
  for(let voice=0;voice<3;voice++){
    const b=voice*7;commands.push(['w',b,0],['w',b+1,0],['w',b+2,0],['w',b+3,8],['w',b+5,0],['w',b+6,0],['w',b+4,0x18]);
  }
  commands.push(['skip',100000],['r',28],['r',27],
    ['w',14,reg&255],['w',15,reg>>8],['w',20,sustain<<4],['w',18,0x19],
    ['skip',100000],['r',28],['r',27],
    ['w',21,fc&7],['w',22,fc>>3],['w',23,(res<<4)|(mode?4:0)],['w',24,mode|3|(voice3off?128:0)],
    ['w',18,wave|1],['skip',300000],['c',QUALITY_CAPTURE],['r',28],['r',27]);
  return {name,model,rate,kind,reg,actualHz,analysisHz:actualHz*harmonic,harmonic,sustain,wave,mode,fc,res,voice3off,
    setupReads:[0,0,sustain*17,0],commands,
    dryKey:`${model}:${rate}:${reg}:${sustain}:${wave}`};
}
export function sid8580QualityFixtures(){
  const scenes=[],dry=new Map(),frequencies=[200,300,400,500,600,700,800,900,1000,1200,1400,1600,1800,2000,2400,3000,3600];
  function addTone(config){
    const f=qualityTone(config);scenes.push(f);
    if(f.kind==='transfer'){
      const key=`${f.dryKey}:${f.harmonic}`;
      if(!dry.has(key))dry.set(key,qualityTone({...config,name:`dry-${f.reg}-h${f.harmonic}-s${f.sustain}`,mode:0,fc:0,res:0,kind:'dry'}));
    }
  }
  for(const rate of [44100,48000,96000])for(const model of [6581,8580])
    for(const [name,wave] of [['triangle',0x10],['saw',0x20],['pulse',0x40],['noise',0x80],['combined',0x70]])
      addTone({name:`wave-${name}`,model,rate,hz:440,sustain:15,wave,kind:'wave'});
  for(const fc of [128,256])for(const res of (fc===128?[0,4,8,12,15]:[0,15]))for(const hz of frequencies)
    addTone({name:`bp-fc${fc}-r${res}-f${hz}`,hz,harmonic:1,mode:0x20,fc,res});
  for(const fc of [512,1536])for(const mode of [0x10,0x40])for(const res of [0,15])for(const hz of [600,2400,6000,10000,14000])
    addTone({name:`mode${mode}-fc${fc}-r${res}-f${hz}`,hz,harmonic:Math.ceil(hz/3000),mode,fc,res});
  for(const res of [0,15])for(const hz of [400,800,1600])
    addTone({name:`level15-bp-r${res}-f${hz}`,hz,mode:0x20,fc:128,res,sustain:15});
  for(const model of [6581,8580])for(const mode of [0,0x10])
    addTone({name:`voice3off-${mode}`,model,hz:440,sustain:15,wave:0x10,mode,fc:512,res:0,voice3off:true,kind:'routing'});
  // Digital envelope comparisons use observed values at explicit cycle points.
  // Initial onset phase is reported separately from the subsequent step rate.
  for(const model of [6581,8580])for(const attack of [0,4,8]){
    const f=qualityTone({name:`attack-${attack}`,model,rate:48000,hz:440,sustain:15,wave:0x10,kind:'envelope'});
    const firstSkip=f.commands.findIndex(c=>c[0]==='skip');
    f.commands=f.commands.slice(0,firstSkip+3);
    f.commands.push(['w',14,f.reg&255],['w',15,f.reg>>8],['w',19,attack<<4],['w',20,0xf0],['w',24,3],['w',18,0x11]);
    for(let i=0;i<60;i++)f.commands.push(['c',2000],['r',28]);
    f.setupReads=[0,0];f.attack=attack;scenes.push(f);
  }
  return [...dry.values(),...scenes];
}
export function qualityProtocol(scene){return `SID8QUALITY 1 ${scene.rate} ${scene.model}\n${scene.commands.map(c=>c.join(' ')).join('\n')}\n`;}
export function sid8580QualityValidationFixtures(){
  const scenes=[],dry=new Map();
  function add(config){
    const f=qualityTone(config);scenes.push(f);const key=`${f.dryKey}:${f.harmonic}`;
    if(!dry.has(key))dry.set(key,qualityTone({...config,name:`dry-${f.reg}-s${f.sustain}`,mode:0,fc:0,res:0,kind:'dry'}));
  }
  const frequencies=[600,900,1100,1300,1400,1500,1600,1700,1750,1800,1850,1900,1950,2000,2100,2200,2400,2600,2800,3000,3300,3600];
  for(const sustain of [4,15])for(const res of [2,6,10,14])for(const hz of frequencies)
    add({name:`heldout-s${sustain}-fc256-r${res}-f${hz}`,sustain,res,hz,fc:256,mode:0x20});
  for(let hz=400;hz<=1500;hz+=50)add({name:`dense-fc128-r15-f${hz}`,hz,fc:128,res:15,mode:0x20});
  return [...dry.values(),...scenes];
}
