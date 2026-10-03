// SPDX-License-Identifier: BSD-3-Clause
// ADPCM and command behavior adapted from MAME / libvgm.
// Copyright (c) Mirko Buffoni, Aaron Giles, Andrew Gardner.
// See third_party/mame-okim6295/LICENSE and README.md.
const VOLUME = [32,22,16,11,8,6,4,3,2,0,0,0,0,0,0,0];
const INDEX = [-1,-1,-1,-1,2,4,6,8];
const STEPS = Array.from({length:49},(_,i)=>Math.floor(16*Math.pow(1.1,i)));

/** Four mono ADPCM voices. Synchronous rendering for VGM, no audio device. */
export class Oki6295AudioEngine {
  constructor({clock,outputSampleRate=44100,masterVolume=1}) {
    if (!Number.isInteger(clock) || clock<0 || clock>0xffffffff || !(clock & 0x3fffffff) || (clock & 0x40000000)) throw new RangeError('Invalid or dual OKIM6295 clock');
    if (!Number.isFinite(outputSampleRate) || outputSampleRate < 8000 || outputSampleRate > 384000) throw new RangeError('Invalid output sample rate');
    this.initialClock=clock>>>0;
    this.rate=outputSampleRate;
    this.rom=new Uint8Array();
    this.muted=false;
    this.setMasterVolume(masterVolume);
    this.reset();
  }
  sampleRate(){return this.rate;}
  setMasterVolume(v){if(!Number.isFinite(v))throw new RangeError('Invalid volume');this.volume=Math.max(0,Math.min(3.8,v));}
  getMasterVolume(){return this.volume;}
  setOki6295Muted(v){this.muted=Boolean(v);}
  supportsState(){return false;}
  reset(){
    this.clock=this.initialClock & 0x3fffffff;
    this.clockBuffer=this.clock;
    this.pin7=Boolean(this.initialClock & 0x80000000);
    this.bank=0; this.nmkMode=0; this.nmkBanks=new Uint8Array(4);
    this.pending=-1; this.phase=0;
    this.voices=Array.from({length:4},()=>({playing:false,signal:0,step:0,output:0}));
  }
  dispose(){this.reset();this.rom=new Uint8Array();}
  loadOki6295Rom(data,offset=0,size=offset+data.length){
    if (!(data instanceof Uint8Array) || !Number.isInteger(size) || size<0 || size>0x4000000 || !Number.isInteger(offset) || offset<0 || offset+data.length>size) throw new RangeError('Invalid OKIM6295 ROM range');
    if(this.rom.length!==size)this.rom=new Uint8Array(size).fill(255);
    this.rom.set(data,offset);
  }
  clearOki6295Rom(){this.rom=new Uint8Array();}
  readRom(address){
    address &= 0x3ffff;
    let offset;
    if(!this.nmkMode)offset=this.bank|address;
    else {
      const table=address<0x400 && (this.nmkMode&0x80);
      const bankId=table ? address>>>8 : address>>>16;
      offset=(this.nmkBanks[bankId&3]<<16)|(address&(table?0x3ff:0xffff));
    }
    return this.rom[offset] ?? 0;
  }
  readStatus(){return this.voices.reduce((n,v,i)=>n|(v.playing?1<<i:0),0xf0);}
  writeOki6295(register,value){
    if(!Number.isInteger(register)||!Number.isInteger(value)||value<0||value>255)throw new RangeError('Invalid OKIM6295 write');
    if(register===0){this.command(value);return;}
    if(register>=8 && register<=11){
      const shift=(register-8)*8;
      this.clockBuffer=((this.clockBuffer & ~(255<<shift)) | (value<<shift))>>>0;
      if(register===11){
        if(!this.clockBuffer || this.clockBuffer>0x3fffffff)throw new RangeError('Invalid OKIM6295 clock change');
        this.clock=this.clockBuffer;
      }
    } else if(register===12)this.pin7=Boolean(value);
    else if(register===14)this.nmkMode=value;
    else if(register===15)this.bank=value<<18;
    else if(register>=16 && register<=19)this.nmkBanks[register-16]=value;
    else throw new Error(`Unsupported OKIM6295 register: ${register}`);
  }
  command(value){
    if(this.pending>=0){
      const base=this.pending*8;
      const start=((this.readRom(base)<<16)|(this.readRom(base+1)<<8)|this.readRom(base+2))&0x3ffff;
      const stop=((this.readRom(base+3)<<16)|(this.readRom(base+4)<<8)|this.readRom(base+5))&0x3ffff;
      this.voices.forEach((v,i)=>{
        if((value&(0x10<<i)) && !v.playing && start<stop){
          Object.assign(v,{playing:true,start,count:2*(stop-start+1),cursor:0,signal:0,step:0,output:0,volume:VOLUME[value&15]});
        }
      });
      this.pending=-1;
    } else if(value&0x80)this.pending=value&127;
    else this.voices.forEach((v,i)=>{if(value&(8<<i)){v.playing=false;v.output=0;}});
  }
  tick(){
    for(const v of this.voices){
      if(!v.playing){v.output=0;continue;}
      const byte=this.readRom(v.start+(v.cursor>>>1));
      const nibble=(v.cursor&1)?byte&15:byte>>>4;
      const step=STEPS[v.step];
      const diff=(step>>3)+((nibble&1)?step>>2:0)+((nibble&2)?step>>1:0)+((nibble&4)?step:0);
      v.signal=Math.max(-2048,Math.min(2047,v.signal+((nibble&8)?-diff:diff)));
      v.step=Math.max(0,Math.min(48,v.step+INDEX[nibble&7]));
      v.output=v.signal*v.volume/65536;
      if(++v.cursor>=v.count)v.playing=false;
    }
  }
  processFrames(frames){
    if(!Number.isInteger(frames)||frames<0||frames>0x1000000)throw new RangeError('Invalid frame count');
    const left=new Float32Array(frames),right=new Float32Array(frames);
    const increment=this.clock/(this.pin7?132:165)/this.rate;
    for(let i=0;i<frames;i++){
      this.phase+=increment;
      while(this.phase>=1){this.tick();this.phase-=1;}
      const value=this.muted?0:this.voices.reduce((n,v)=>n+v.output,0)*this.volume;
      left[i]=right[i]=value;
    }
    return {left,right};
  }
}

export function attachOki6295(engine,oki){
  const render=engine.processFrames.bind(engine),reset=engine.reset.bind(engine),dispose=engine.dispose.bind(engine);
  engine.writeOki6295=(r,v)=>oki.writeOki6295(r,v);
  engine.loadOki6295Rom=(data,offset,size)=>oki.loadOki6295Rom(data,offset,size);
  engine.clearOki6295Rom=()=>oki.clearOki6295Rom();
  engine.setOki6295Muted=v=>oki.setOki6295Muted(v);
  // An OPM-only snapshot would lose ADPCM voices, bank and divider phase.
  engine.supportsState=()=>false;
  engine.processFrames=frames=>{
    const pcm=render(frames),extra=oki.processFrames(frames),volume=engine.getMasterVolume();
    for(let i=0;i<frames;i++){pcm.left[i]+=extra.left[i]*volume;pcm.right[i]+=extra.right[i]*volume;}
    return pcm;
  };
  engine.reset=()=>{reset();oki.reset();};
  engine.dispose=()=>{dispose();oki.dispose();};
  return engine;
}
