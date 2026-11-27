import {writePerformanceCommand} from './pcm-performance.js';
import {noteToHz,opmPitchFromHz} from '../js/soundchip_pitch.js';
import {SongSampleMemory} from './song-samples.js';
// SPDX-License-Identifier: BSD-3-Clause
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {Ym2151AudioEngine} from '../js/ym2151audioengine.js';
import {Oki6295AudioEngine} from '../js/okim6295audioengine.js';
import {Ym2151VoiceInspector} from '../js/playground_ym2151_inspector.js';
import factory from '../generated/ym2151_wasm.js';

class Song extends AudioWorkletProcessor {
  constructor({processorOptions:{bytes,wasmBinary}}) {
    super();
    this.parser=new Ym2612VGM(bytes);
    this.voiceState=new Ym2151VoiceInspector({clock:this.parser.header.ym2151Clock,sampleRate,
      dispatch:({args})=>this.writeFm(...args)});
    this.keyOverrides=[];this.keyboardOwners=[];
    this.nextReport=0; this.fmDirty=true;
    this.lastMasks=Array(8).fill(15);
    this.mutes={fm:Array(8).fill(false),pcm:Array(4).fill(false)};
    this.sampleMemory=new SongSampleMemory();
    this.ticks=0; this.frame=0; this.until=0;
    this.port.onmessage=({data})=>{
      if (data.stop) this.finish();
      else if(data.keyboardFm && this.keyboardFm)this.playKeyboardFm(data.keyboardFm);
      else if(data.keyboardPcm && this.keyboardPcm){
        const {voice,sample,level}=data.keyboardPcm;
        this.keyboardPcm.command(8<<voice);
        this.keyboardPcm.command(128|sample);
        this.keyboardPcm.command((16<<voice)|level);
      }else if(data.fmEdit && this.fm){
        this.voiceState.invoke(data.fmEdit.method,data.fmEdit.args);
        if(this.paused)this.port.postMessage({editedFm:this.fmSnapshot()});
      }else if(data.keyMask){
        const [ch,mask]=data.keyMask;
        this.keyOverrides[ch]=this.lastMasks[ch]=mask;
      }else if ('samples' in data) this.sampleOverrides=data.samples;
      else if ('attenuation' in data) this.attenuationOverride=data.attenuation;
      else if ('pause' in data) {
        this.paused=data.pause;
        this.report({paused:this.paused,seconds:this.frame/sampleRate},true);
      } else {this.mutes=data;this.applyMutes();}
    };
    this.init(wasmBinary).catch(error=>this.finish(error.message));
  }
  async init(wasmBinary) {
    const {ym2151Clock,okim6295Clock}=this.parser.header;
    if(okim6295Clock){
      const options={clock:okim6295Clock,outputSampleRate:sampleRate};
      this.pcm=new Oki6295AudioEngine(options);
      this.keyboardPcm=new Oki6295AudioEngine(options);
    }
    if (ym2151Clock) {
      // Independent chip handles can share one compiled WASM module and heap.
      const module=await factory({wasmBinary});
      if(this.done)return;
      const options={ym2151ModuleFactory:async()=>module,ym2151Clock,outputSampleRate:sampleRate};
      const fm=await Ym2151AudioEngine.create(options);
      if (this.done) {fm.dispose();return;}
      this.fm=fm;
      const keyboardFm=await Ym2151AudioEngine.create(options);
      if(this.done){keyboardFm.dispose();return;}
      this.keyboardFm=keyboardFm;
    }
    this.applyMutes();
    this.ready=true;this.report({ready:true,clock:this.parser.header.ym2151Clock});
  }
  playKeyboardFm({channel,midi,id}){
    const chip=this.keyboardFm;
    if(midi===undefined){
      if(this.keyboardOwners[channel]===id){
        chip.writeYm2151(8,channel);this.keyboardOwners[channel]=null;
      }
      return;
    }
    this.keyboardOwners[channel]=id;this.keyboardFmStarted=true;
    const {registers,amDepth,pmDepth}=this.voiceState;
    chip.writeYm2151(8,channel);
    for(const r of [0x0f,0x18,0x1b])chip.writeYm2151(r,registers[r]);
    chip.writeYm2151(0x19,amDepth);chip.writeYm2151(0x19,128|pmDepth);
    for(let r=0x20+channel;r<256;r+=8)chip.writeYm2151(r,registers[r]);
    const pitch=opmPitchFromHz(noteToHz(midi),this.parser.header.ym2151Clock);
    chip.writeYm2151(0x28+channel,pitch.keyCode);
    chip.writeYm2151(0x30+channel,pitch.keyFraction<<2);
    chip.writeYm2151(8,channel|(this.lastMasks[channel]<<3));
  }
  mixKeyboard(outputs,size){
    const mix=(chip,bus)=>{
      const {left,right}=chip.processFrames(size);
      for(let i=0;i<size;i++){outputs[bus][0][i]+=left[i];outputs[bus][1][i]+=right[i];}
    };
    if(this.keyboardFmStarted)mix(this.keyboardFm,0);
    if(this.keyboardPcm?.voices.some(v=>v.playing))mix(this.keyboardPcm,1);
  }
  writeFm(register,value){
    if(register===8 && (value&0x78)){
      const ch=value&7;
      this.lastMasks[ch]=this.keyOverrides[ch]??((value>>3)&15);
      value=ch|(this.lastMasks[ch]<<3);
    }
    this.fm.writeYm2151(register,value);
    this.voiceState.observeWrite(register,value);
    this.fmDirty=true;
  }
  fmSnapshot(){
    const state=this.voiceState;
    return {registers:state.registers,keyMasks:state.keyMasks,amDepth:state.amDepth,pmDepth:state.pmDepth};
  }
  report(message,force=false) {
    if (this.fm && (this.fmDirty || force)) {
      message.fm=this.fmSnapshot();
      message.masks=this.lastMasks;
      this.fmDirty=false;
    }
    message.oki=this.pcm ? this.sampleMemory.snapshot(this.pcm,!!message.paused) : null;
    if(message.oki){
      message.oki.bank=this.pcm.bank>>>18;
      message.oki.nmk=this.pcm.nmkMode;
      message.oki.command=this.lastCommand;
      message.oki.sourceAttenuation=this.sourceAttenuation;
    }
    if (message.paused) message.masks=this.lastMasks;
    this.port.postMessage(message);
  }
  applyMutes() {
    this.mutes.fm.forEach((v,i)=>{this.fm?.setChannelMuted(i,v);this.keyboardFm?.setChannelMuted(i,v);});
    this.mutes.pcm.forEach((v,i)=>{this.pcm?.setVoiceMuted(i,v);this.keyboardPcm?.setVoiceMuted(i,v);});
  }
  finish(error) {
    if (this.done) return;
    this.done=true;this.fm?.dispose();this.pcm?.dispose();this.keyboardFm?.dispose();this.keyboardPcm?.dispose();
    this.port.postMessage({done:true,error});
  }
  process(inputs,outputs) {
    if (!this.ready || this.done) return !this.done;
    const size=outputs[0][0].length;
    try {
      for (let i=0;!this.paused && i<size;) {
        if (this.frame>=this.until) {
          const e=this.parser.step();
          if (e.type==='end') {this.report({playing:true},true);this.finish();break;}
          if (e.type==='wait') {this.ticks+=e.samples;this.until=Math.round(this.ticks*sampleRate/44100);}
          if (e.type==='ym2151-write') this.writeFm(e.register,e.value);
          if (e.type==='okim6295-write') {
            if(e.register){
              this.pcm.writeOki6295(e.register,e.value);
              this.keyboardPcm.writeOki6295(e.register,e.value);
            }
            else {
              if(this.pcm.pending>=0)this.sourceAttenuation=e.value&15;
              this.lastCommand=writePerformanceCommand(this.pcm,e.value,this.sampleOverrides,this.attenuationOverride);
            }
          }
          if (e.type==='okim6295-rom-data') {
            this.pcm.loadOki6295Rom(e.data,e.offset,e.memorySize);
            this.keyboardPcm.rom=this.pcm.rom;
            this.sampleMemory.observe(e.offset,e.data.length,e.memorySize);
          }
          continue;
        }
        const count=Math.min(size-i,this.until-this.frame);
        for (const [bus,chip] of [[0,this.fm],[1,this.pcm]]) {
          if (!chip) continue;
          const {left,right}=chip.processFrames(count);
          outputs[bus][0].set(left,i);outputs[bus][1].set(right,i);
        }
        this.frame+=count;i+=count;
      }
      if(!this.done)this.mixKeyboard(outputs,size);
      if (!this.done && !this.paused && this.frame>=this.nextReport) {
        this.nextReport=this.frame+Math.ceil(sampleRate/8);
        if (this.fmDirty || this.pcm) this.report({playing:true});
      }
    } catch(error) {this.finish(error.message);}
    return !this.done;
  }
}
registerProcessor('cps1-song',Song);
