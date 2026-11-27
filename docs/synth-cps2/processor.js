// SPDX-License-Identifier: BSD-3-Clause
import {chipRomMap} from './rom-map.js';
import {pcmRegisterAddresses} from './registers.js';
import {SongTransport} from './song.js';
import {QSoundPcm,QSOUND_PCM_RATE} from '../js/qsoundpcm.js';
import {demoRom} from './demo.js';

class Cps2Preview extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chip = new QSoundPcm(demoRom(), sampleRate,{spatialPcm:true});
    this.previewVersion=0;
    this.mutes=Array(19).fill(false);
    this.starts = new Uint16Array(16);
    this.port.onmessage = ({data}) => {
      if(data?.type==='project-rom'){
        this.projectRom=data.rom;
        if(!this.song && !this.captured)this.chip.rom=data.rom;
        return;
      }
      if (data?.type === 'mute-voices') {this.mutes=data.mask;this.applyMutes();return;}
      if (data?.type === 'song') {
        this.chip=new QSoundPcm(new Uint8Array(),sampleRate,{spatialPcm:true});
        this.applyMutes();
        this.starts.fill(0);
        this.song=new SongTransport(data.bytes,this.chip,this.starts);
        if(data.state) {
          this.song.restore(data.state);
          this.applyMutes();
        }
        this.song.loop=data.loop;
        this.sourcePath=data.path;this.source=null;this.captured=false;
        this.setPaused(Boolean(data.paused));
        return;
      }
      if (data?.type === 'loop-song') {if(this.song)this.song.loop=data.enabled;return;}
      if (data?.type === 'pause-song') {this.setPaused(data.paused);return;}
      if (data?.type === 'echo-delay') {
        this.chip.writeRegister(0xd9,this.chip.echoBase + data.ticks);
        return;
      }
      if(data?.type==='prepare-audition'){
        this.apply(data.writes);this.capture();return;
      }
      if(data?.type==='silence-audition'){
        this.capture();
        return;
      }
      if (data === 'stop-audition') {
        this.capture();
        this.song=null;
        return;
      }
      if(data?.type==='rename-song'){
        if(this.sourcePath===data.from)this.sourcePath=data.to;
        if(this.source?.path===data.from)this.source={...this.source,path:data.to};
        return;
      }
      if(data?.type==='read-preset'){
        const ch=data.channel,adpcm=data.kind==='adpcm';
        const v=adpcm?this.chip.adpcm[ch]:this.chip.voices[ch],begin=v.bank*65536;
        const fields=adpcm?{start:v.start,volume:v.volume}:{
          start:this.starts[ch],loop:v.loop&65535,volume:this.captured?this.levels[ch]:(v.volume||v.lastLevel||0),
          rate:this.captured?this.rates[ch]:v.rate,send:v.echoSend};
        data.reply.postMessage({source:this.romSource(),clock:Math.round(this.chip.tickRate*4000000/QSOUND_PCM_RATE),
          bank:v.bank,end:v.end&65535,pan:v.pan,...fields,bytes:this.chip.rom.slice(begin,begin+65536)});
        data.reply.close();return;
      }
      if(data?.type==='load-preset'){
        const p=data.preset,ch=data.channel,base=8*ch;
        this.capture();this.song=null;
        this.chip.rom=data.rom;this.source=p.source;
        this.chip.tickRate=QSOUND_PCM_RATE*p.clock/4000000;
        if(p.format==='qsound-adpcm-1'){
          const reg=0xca+4*ch;
          this.apply([[reg,p.start],[reg+1,p.end],[reg+2,p.bank],[reg+3,p.volume&65535],[0x90+ch,p.pan]]);
          return;
        }
        this.apply([[((ch+15)&15)*8,p.bank|0x8000],[base+1,p.start],[base+2,p.rate],
          [base+3,0],[base+4,p.loop],[base+5,p.end],[0x80+ch,p.pan],[0xba+ch,p.send&65535]]);
        this.levels[ch]=p.volume;
        return;
      }
      if(data?.type==='captured-note'){
        this.playCaptured(data.channel,data.midi);
        return;
      }
      if(data?.type==='captured-off'){
        this.chip.writeRegister(data.channel*8+6,0);
        return;
      }
      if(data?.type==='voice-setting'){
        if(!this.captured)return;
        const {channel,field,value}=data, v=this.chip.voices[channel];
        if(field==='volume'){
          this.levels[channel]=value;
          if(v.volume)this.chip.writeRegister(channel*8+6,value&65535);
        }else{
          this.rates[channel]=value;
          this.chip.writeRegister(channel*8+2,value);
        }
        return;
      }
      if (data?.type === 'inspect') {
        const v = this.chip.voices[data.channel];
        let view;
        if (this.song || this.captured) {
          const start=this.starts[data.channel], end=v.end & 65535;
          const span=((end-start)&65535)||256;
          const wave=data.registers || data.skipWave ? null : new Uint8Array(256);
          if(wave)for(let i=0;i<wave.length;i++) wave[i]=this.chip.rom[v.bank*65536+((start+Math.floor(i*span/256))&65535)]??0;
          view={wave,start,span,seconds:(this.song?.frames??0)/sampleRate,bank:v.bank,ended:this.song?.parser.ended??false,pan:v.pan,volume:this.captured?this.levels[data.channel]:v.volume};
        }
        const words=data.registers ? pcmRegisterAddresses(data.channel).map(r=>this.chip.lastWrites[r]) : undefined;
        const pad=data.padVoice==null ? null : this.chip.adpcm[data.padVoice];
        const padState=pad && {start:pad.start,end:pad.end,bank:pad.bank,volume:pad.volume,panWord:pad.pan,
          address:pad.address,active:pad.gain!==0,configured:this.chip.lastWrites[0xcb+4*data.padVoice]>=0};
        if(pad && data.livePad){
          const revision=this.song?.romRevision;
          if(this.previewRom!==this.chip.rom || this.previewRevision!==revision){
            this.previewRom=this.chip.rom;this.previewRevision=revision;this.previewVersion++;
          }
          padState.key=this.previewVersion+'-'+pad.bank;
          padState.tickRate=this.chip.tickRate;
          if(padState.key!==data.padBankKey){
            const offset=pad.bank*65536;
            padState.bytes=this.chip.rom.subarray(offset,offset+65536);
          }
        }
        this.port.postMessage({...data,romMap:data.romMap?chipRomMap(this.chip,this.starts):null,view,words,padState,pan:v.pan,address:v.address & 65535,rate:v.rate,end:v.end,loop:v.loop,
          send:v.echoSend,feedback:this.chip.echoFeedback,delay:this.chip.echoEnd-this.chip.echoBase,
          active:v.volume !== 0,start:this.starts[data.channel]});
        return;
      }
      if (data === 'stop') {
        this.song=null;this.captured=false;this.source=null;
        this.chip = new QSoundPcm(this.projectRom??demoRom(), sampleRate,{spatialPcm:true});
        this.applyMutes();
        this.starts.fill(0);
      } else this.apply(data);
    };
  }
  romSource(){
    if(this.song && !this.captured)return {path:this.sourcePath,position:this.song.parser.position,looped:this.song.looped};
    return this.source??null;
  }
  capture(){
    this.source=this.romSource();
    const source=this.chip;
    const chip=new QSoundPcm(source.rom,sampleRate,{spatialPcm:true});
    chip.tickRate=source.tickRate;
    chip.lastWrites.set(source.lastWrites);
    chip.echoBase=source.echoBase;chip.echoEnd=source.echoEnd;chip.echoFeedback=source.echoFeedback;
    if(!this.captured){
      this.rates=source.voices.map(v=>v.rate);
      this.levels=source.voices.map(v=>v.volume || v.lastLevel || 0);
    }
    chip.voices.forEach((v,i)=>Object.assign(v,source.voices[i],{volume:0,freezeWhileSilent:true}));
    chip.adpcm.forEach((v,i)=>{
      const {bank,start,end,pan,volume}=source.adpcm[i];
      Object.assign(v,{bank,start,end,pan,volume});
    });
    this.starts=this.starts.slice();
    this.chip=chip;this.captured=true;this.applyMutes();
  }
  setPaused(paused){
    if(!this.song || paused===this.song.paused)return;
    if(paused)this.capture();
    else{
      this.chip=this.song.chip;this.starts=this.song.starts;
      this.captured=false;this.applyMutes();
    }
    this.song.paused=paused;
  }
  playCaptured(ch,midi){
    const v=this.chip.voices[ch], base=ch*8;
    const rate=this.captured?this.rates[ch]:v.rate;
    const level=this.captured?this.levels[ch]:(v.volume || v.lastLevel || 0);
    this.apply([[base+1,this.starts[ch]],[base+3,0],
      [base+2,Math.min(65535,Math.round(rate*2**((midi-60)/12)))],[base+6,level&65535]],false);
  }
  applyMutes() {
    this.mutes.forEach((muted,i)=>this.chip.setChannelMuted(i,muted));
  }
  apply(writes,remember=true) {
    for (const [reg,value] of writes) {
      if (reg < 0x80 && (reg & 7) === 1) this.starts[reg >> 3] = value;
      if(this.captured && remember && reg<128){
        if((reg&7)===2)this.rates[reg>>3]=value;
        if((reg&7)===6)this.levels[reg>>3]=(value<<16)>>16;
      }
      this.chip.writeRegister(reg,value);
    }
  }
  process(_, outputs) {
    const [left,right] = outputs[0];
    if(this.song && !this.song.paused){this.song.render(left,right);return true;}
    this.chip.render(left,right);
    return true;
  }
}
registerProcessor('tetorica-cps2-preview',Cps2Preview);
