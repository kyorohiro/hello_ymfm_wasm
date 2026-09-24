// Original register sequences, not game music. Regenerate binary fixtures deterministically.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
function file(name,clockOffset,clock,commands,extraClocks=[],okiFlags=0) {
  const bytes=new Uint8Array(256+commands.length),v=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);
  v.setUint32(0x34,0xcc,true);v.setUint32(clockOffset,clock,true);v.setUint32(0x18,22050,true);
  for (const [offset,hz] of extraClocks) v.setUint32(offset,hz,true);
  bytes[0x94]=okiFlags;
  bytes.set(commands,256);writeFileSync(new URL(name+'.vgm',import.meta.url),bytes);
  writeFileSync(new URL(name+'.vgz',import.meta.url),gzipSync(bytes));
}
const wait=[0x61,0x22,0x56];
file('psg-tone',0x0c,3579545,[0x50,0x80,0x50,0x10,0x50,0x90,...wait,0x50,0x9f,0x66]);
file('ay-tone',0x74,1789773,[0xa0,0,100,0xa0,1,0,0xa0,7,0x3e,0xa0,8,15,...wait,0xa0,8,0,0x66]);
file('opn-tone',0x2c,7670454,[0x52,0xa4,0x22,0x52,0xa0,0x69,0x52,0x28,0xf0,...wait,0x52,0x28,0,0x66]);
file('opm-tone',0x30,3579545,[0x54,0x28,0x4a,0x54,8,0x78,...wait,0x54,8,0,0x66]);

// FM and PSG stay silent: any audible output must come from embedded RF5C164 PCM.
file('genesis-pcm',0x2c,7670453,[
  0x67,0x66,0xc1,7,0,0,0,0,0,0x40,0x40,0xc0,0xc0,0xff,
  0xb1,7,0xc0,0xb1,0,255,0xb1,1,255,
  0xb1,2,0,0xb1,3,8,0xb1,4,0,0xb1,5,0,0xb1,6,0,
  0xb1,8,0xfe,...wait,0xb1,8,255,0x66,
],[[0x6c,12500000],[0x0c,3579545]]);

// YM2203: independently audible FM and SSG voices, plus their combined mix.
const fm=[];
for(const slot of [0,4,8,12])for(const [reg,value] of [[0x30,1],[0x40,32],[0x50,31],[0x60,0],[0x70,0],[0x80,15]])fm.push(0x55,reg+slot,value);
fm.push(0x55,0xb0,7,0x55,0xa4,0x22,0x55,0xa0,0x69,0x55,0x28,0xf0);
const ssg=[0x55,0,100,0x55,1,0,0x55,7,0x3e,0x55,8,12];
for(const [name,commands] of [['fm',fm],['ssg',ssg],['mix',[...fm,...ssg]]])
  file('ym2203-'+name,0x44,4000000,[...commands,...wait,0x55,0x28,0,0x55,8,0,0x66]);

const opnaFm=fm.map((value,index)=>index%3===0?0x56:value);
opnaFm.push(0x56,0xb4,0xc0);
const opnaSsg=ssg.map((value,index)=>index%3===0?0x56:value);
for(const [name,commands] of [['fm',opnaFm],['ssg',opnaSsg],['rhythm',[0x56,0x11,0x3f,0x56,0x18,0xdf,0x56,0x10,1]]])
  file('ym2608-'+name,0x48,8000000,[...commands,...wait,0x66]);
// Original repeating nibble pattern in ADPCM-B RAM, no external ROM.
const adpcm=Array.from({length:256},(_,i)=>i%2?0x99:0x11);
file('ym2608-adpcm',0x48,8000000,[0x67,0x66,0x81,8,1,0,0,0,1,0,0,0,0,0,0,...adpcm,
  0x57,0,1,0x57,1,0xc0,0x57,2,0,0x57,3,0,0x57,4,7,0x57,5,0,
  0x57,9,0xff,0x57,10,0xff,0x57,11,0xff,0x57,0,0xa0,...wait,0x66]);

// Both YM2610 variants: original FM/SSG voices and embedded ADPCM patterns.
const romBlock=type=>[0x67,0x66,type,8,1,0,0,0,1,0,0,0,0,0,0,...adpcm];
const a=[...romBlock(0x82),0x59,1,0x3f,0x59,8,0xdf,0x59,0x10,0,0x59,0x18,0,0x59,0x20,0,0x59,0x28,0,0x59,0,1];
const b=[...romBlock(0x83),0x58,0x11,0xc0,0x58,0x12,0,0x58,0x13,0,0x58,0x14,0,0x58,0x15,0,0x58,0x19,0xff,0x58,0x1a,0xff,0x58,0x1b,0xff,0x58,0x10,0x80];
const ssg2610=ssg.map((v,i)=>i%3===0?0x58:v);
const fm2610=[];
// CH2 exists in both variants; CH1 is only available on YM2610B.
for(let i=0;i<fm.length;i+=3)fm2610.push(0x58,fm[i+1]===0x28?0x28:fm[i+1]+1,fm[i+1]===0x28?0xf1:fm[i+2]);
fm2610.push(0x58,0xb5,0xc0);
const fmExtra4=[];
for(let i=0;i<fm.length;i+=3)fmExtra4.push(fm[i+1]===0x28?0x58:0x59,fm[i+1],fm[i+1]===0x28?0xf4:fm[i+2]);
fmExtra4.push(0x59,0xb4,0xc0);
const fmExtra=[...fm.map((v,i)=>i%3===0?0x58:v),0x58,0xb4,0xc0];
for(const [chip,clock] of [['ym2610',8000000],['ym2610b',0x80000000+8000000]])
  for(const [name,commands] of [['fm',fm2610],['extra-fm',fmExtra],['extra-fm4',fmExtra4],['ssg',ssg2610],['adpcm-a',a],['adpcm-b',b],['mix',[...fm2610,...ssg2610,...a,...b]]])
    file(chip+'-'+name,0x4c,clock,[...commands,...wait,0x66]);

// Authored OPM voice plus scheduled 4-bit OKI bytes, no external samples.
const opmVoice=[0x54,0x20,0xc7,0x54,0x28,0x4a];
for(let i=0;i<4;i++)opmVoice.push(0x54,0x40+8*i,1,0x54,0x60+8*i,32,0x54,0x80+8*i,31);
opmVoice.push(0x54,8,0x78);
const okiCommands=[0xb7,0,2];
for(let i=0;i<100;i++)okiCommands.push(0xb7,1,i%2?0x99:0x11,0x61,12,0);
okiCommands.push(0xb7,0,1,0x61,0x72,0x51,0x66); // total 22050 samples
file('okim6258-tone',0x90,8192000,okiCommands,[],12);
file('opm-oki-mix',0x30,3579545,[...opmVoice,...okiCommands],[[0x90,8192000]],12);
file('opm-audible',0x30,3579545,[...opmVoice,...wait,0x66]);

const yFm=[];
for(const slot of [0,3])for(const [r,v] of [[0x20,0x21],[0x40,16],[0x60,0xf0],[0x80,0x0f]])yFm.push(0x5c,r+slot,v);
yFm.push(0x5c,0xc0,0x0e,0x5c,0xa0,0x98,0x5c,0xb0,0x31);
const yAdpcm=[0x67,0x66,0x88,8,1,0,0,0,1,0,0,0,0,0,0,...new Array(256).fill(0x17)];
for(const [r,v] of [[8,1],[9,0],[10,0],[11,7],[12,0],[16,255],[17,255],[18,255],[7,0xb0]])yAdpcm.push(0x5c,r,v);
const yPsg=[0x50,0x80,0x50,0x10,0x50,0x90];
for(const [name,commands,clocks] of [['fm',yFm,[]],['adpcm',yAdpcm,[]],['mix',[...yFm,...yAdpcm],[]],['psg',[...yFm,...yAdpcm,...yPsg],[[0x0c,3579545]]]])
  file('y8950-'+name,0x58,3579545,[...commands,...wait,0x66],clocks);

const wave=new Uint8Array(512);wave.set([0,1,0,0,0,255,0,0,0xf0,0,0x0f,0]);
for(let i=256;i<512;i++)wave[i]=Math.round(Math.sin(i*Math.PI/16)*100)&255;
const opl4Pcm=[[1,5,3],[2,8,0],[2,0x20,0],[2,0x38,0],[2,0x50,1],[2,0x68,0x80]].flatMap(r=>[0xd0,...r]);
const opl4Fm=[0xd0,1,5,3];
for(let i=0;i<yFm.length;i+=3)opl4Fm.push(0xd0,0,yFm[i+1],yFm[i+1]===0xc0?0x31:yFm[i+2]);
const waveBlock=[0x67,0x66,0x84,8,2,0,0,0,2,0,0,0,0,0,0,...wave];
for(const [name,cmds] of [['fm',opl4Fm],['external',opl4Pcm],['embedded',[...waveBlock,...opl4Pcm]],['mix',[...waveBlock,...opl4Fm,...opl4Pcm]],['psg',[...waveBlock,...opl4Fm,...opl4Pcm,...yPsg]]])
  file('ymf278b-'+name,0x60,33868800,[...cmds,...wait,0x66],name==='psg'?[[0x0c,3579545]]:[]);

// Authored unsigned PCM banks: distinct negative/positive ramps, no game ROM.
const segaWave=Uint8Array.from({length:2048},(_,i)=>i<1024?32+(i%64):160+(i%64));
const segaBlock=[0x67,0x66,0x80,8,8,0,0,0,8,0,0,0,0,0,0,...segaWave];
const segaVoice=bank=>[[2,64],[3,32],[4,0],[5,0],[6,0],[7,8],[0x84,0],[0x85,0],[0x86,bank]].flatMap(([r,v])=>[0xc0,r,0,v]);
for(const [name,bank,extra,clocks] of [
  ['bank0',0,[],[]],['bank1',4,[],[]],['psg',4,yPsg,[[0x0c,3579545]]],
  ['opm',4,opmVoice,[[0x30,3579545]]],['opm-psg',4,[...opmVoice,...yPsg],[[0x30,3579545],[0x0c,3579545]]],
])file('segapcm-'+name,0x38,4000000,[...segaBlock,...segaVoice(bank),...extra,...wait,0x66],[[0x3c,0x00040008],...clocks]);

// All nonempty subsets of the four Browser MSX chip types (single instances).
const sccVoice=Array.from({length:32},(_,i)=>[0xd2,0,i,((i-16)*4)&255]).flat();
sccVoice.push(0xd2,1,0,0x50,0xd2,1,1,0,0xd2,2,0,8,0xd2,3,0,1);
const msxVoices=[
  ['ay',0x74,1789773,[0xa0,0,100,0xa0,1,0,0xa0,7,0x3e,0xa0,8,10]],
  ['opll',0x10,3579545,[0x51,0x30,0x13,0x51,0x10,0x98,0x51,0x20,0x15]],
  ['audio',0x58,3579545,[...yFm,...yAdpcm]],
  ['scc',0x9c,1789773,sccVoice],
];
for(let mask=1;mask<16;mask++){
  const selected=msxVoices.filter((_,i)=>mask&(1<<i));
  file('msx-'+selected.map(v=>v[0]).join('-'),selected[0][1],selected[0][2],
    [...selected.flatMap(v=>v[3]),...wait,0x66],selected.slice(1).map(v=>[v[1],v[2]]));
}

// 32X PWM: authored pulses, equivalent direct writes and 16-bit stream units.
const pwmWrite=(r,v)=>[0xb2,(r<<4)|(v>>8),v&255];
const pwmSetup=[...pwmWrite(0,5),...pwmWrite(1,100)];
const pulses=Array.from({length:220},(_,i)=>i%2?40:60);
const pwmDirect=[...pwmSetup,...pulses.flatMap(v=>[...pwmWrite(4,v),0x61,100,0]),0x61,50,0,0x66];
const pwmStream=[...pwmSetup,0x67,0x66,3,0xb8,1,0,0,...pulses.flatMap(v=>[v,0]),
  0x90,0,0x11,0,4,0x91,0,3,1,0,0x92,0,0xb9,1,0,0,
  0x93,0,0,0,0,0,1,220,0,0,0,...wait,0x66];
file('pwm-direct',0x70,23011361,pwmDirect);
file('pwm-stream',0x70,23011361,pwmStream);
file('pwm-stereo',0x70,23011361,[...pwmSetup,...pwmWrite(2,75),...pwmWrite(3,25),...wait,0x66]);
const genesisFm=[...fm.map((v,i)=>i%3===0?0x52:v),0x52,0xb4,0xc0];
const rfVoice=[...readFileSync(new URL('genesis-pcm.vgm',import.meta.url)).subarray(256,-7)];
for(const [name,commands,clocks] of [
  ['fm',genesisFm,[[0x2c,7670454]]],['psg',yPsg,[[0x0c,3579545]]],
  ['pcm',rfVoice,[[0x6c,12500000]]],
  ['all',[...genesisFm,...yPsg,...rfVoice],[[0x2c,7670454],[0x0c,3579545],[0x6c,12500000]]],
])file('pwm-'+name,0x70,23011361,[...commands,...pwmDirect],clocks);

// S98 v3, authored FM voice, fractional timer, loop boundary and UTF-8 tag.
for(const [name,type,clock,voice] of [['ym2203',2,4000000,fm],['ym2608',4,8000000,opnaFm],['ym2612',3,7670454,genesisFm]]){
  const writes=voice.map((v,i)=>i%3===0?0:v);
  const commands=[...writes,0xff,0xfe,48,0xfd];
  const tag=new TextEncoder().encode('[S98]\ntitle=自作 tone\nartist=Tetorica\n\0');
  const bytes=new Uint8Array(48+commands.length+tag.length),v=new DataView(bytes.buffer);
  bytes.set([83,57,56,51]);v.setUint32(4,1,true);v.setUint32(8,1000,true);
  v.setUint32(0x10,48+commands.length,true);v.setUint32(0x14,48,true);v.setUint32(0x18,48+writes.length,true);
  v.setUint32(0x1c,1,true);v.setUint32(0x20,type,true);v.setUint32(0x24,clock,true);
  bytes.set(commands,48);bytes.set(tag,48+commands.length);
  writeFileSync(new URL('s98-'+name+'.s98',import.meta.url),bytes);
}

import './generate_huc6280.mjs';

// FDS standalone sine A4: VGM's 20-2A controls map to CPU 4080-408A.
const fdsWrite=(r,v)=>[0xb4,r,v];
file('fds-tone',0x84,(1789773|0x80000000)>>>0,[
 ...fdsWrite(0x3f,2),...fdsWrite(0x23,0x80),...fdsWrite(0x29,0x80),
 ...Array.from({length:64},(_,i)=>fdsWrite(0x40+i,Math.round(31.5+31.5*Math.sin(i*Math.PI/32)))).flat(),
 ...fdsWrite(0x29,0),...fdsWrite(0x24,0x80),...fdsWrite(0x20,0xa0),
 ...fdsWrite(0x22,0x07),...fdsWrite(0x23,0x04),...wait,...fdsWrite(0x20,0x80),0x66,
]);

// Standalone audible OPL family fixtures. OPL3 exercises the second bank (CH10).
for(const [chip,offset,clock,op] of [['ym3526',0x54,3579545,0x5b],['ym3812',0x50,3579545,0x5a],['ymf262',0x5c,14318180,0x5f]]) {
  const commands=chip==='ymf262'?[0x5f,5,1]:[];
  for(const slot of [0,3])for(const [reg,value] of [[0x20,1],[0x40,16],[0x60,0xf0],[0x80,0x0f],[0xe0,0]])commands.push(op,reg+slot,value);
  commands.push(op,0xc0,0x31,op,0xa0,0x98,op,0xb0,0x31);
  file(chip+'-tone',offset,clock,[...commands,...wait,op,0xb0,0x11,0x66]);
}
file('ym2413-tone',0x10,3579545,[0x51,0x30,0x13,0x51,0x10,0x98,0x51,0x20,0x15,...wait,0x51,0x20,5,0x66]);
const dmg=[[0x16,0x80],[0x14,0x77],[0x15,0x11],[0,0],[1,0x80],[2,0xf0],[3,0xd6],[4,0x86]].flatMap(([r,v])=>[0xb3,r,v]);
file('gameboy-tone',0x80,4194304,[...dmg,...wait,0xb3,2,0,0x66]);
