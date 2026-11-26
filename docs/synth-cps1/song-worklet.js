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
    this.voiceState=new Ym2151VoiceInspector({clock:this.parser.header.ym2151Clock,sampleRate});
    this.lastMasks=Array(8).fill(15);
    this.mutes={fm:Array(8).fill(false),pcm:Array(4).fill(false)};
    this.sampleMemory=new SongSampleMemory();
    this.ticks=0; this.frame=0; this.until=0;
    this.port.onmessage=({data})=>{
      if (data.stop) this.finish();
      else if ('pause' in data) {
        this.paused=data.pause;
        const channels=this.paused && this.fm ? this.voiceState.read().channels : null;
        this.port.postMessage({paused:this.paused,seconds:this.frame/sampleRate,channels,oki:this.paused && this.pcm ? this.sampleMemory.snapshot(this.pcm) : null,masks:this.lastMasks});
      } else {this.mutes=data;this.applyMutes();}
    };
    this.init(wasmBinary).catch(error=>this.finish(error.message));
  }
  async init(wasmBinary) {
    const {ym2151Clock,okim6295Clock}=this.parser.header;
    if (okim6295Clock) this.pcm=new Oki6295AudioEngine({clock:okim6295Clock,outputSampleRate:sampleRate});
    if (ym2151Clock) {
      const fm=await Ym2151AudioEngine.create({ym2151ModuleFactory:factory,ym2151ModuleOptions:{wasmBinary},ym2151Clock,outputSampleRate:sampleRate});
      if (this.done) {fm.dispose();return;}
      this.fm=fm;
    }
    this.applyMutes();
    this.ready=true;this.port.postMessage({ready:true});
  }
  applyMutes() {
    this.mutes.fm.forEach((v,i)=>this.fm?.setChannelMuted(i,v));
    this.mutes.pcm.forEach((v,i)=>this.pcm?.setVoiceMuted(i,v));
  }
  finish(error) {
    if (this.done) return;
    this.done=true;this.fm?.dispose();this.pcm?.dispose();
    this.port.postMessage({done:true,error});
  }
  process(inputs,outputs) {
    if (!this.ready || this.done || this.paused) return !this.done;
    const size=outputs[0][0].length;
    try {
      for (let i=0;i<size;) {
        if (this.frame>=this.until) {
          const e=this.parser.step();
          if (e.type==='end') {this.finish();break;}
          if (e.type==='wait') {this.ticks+=e.samples;this.until=Math.round(this.ticks*sampleRate/44100);}
          if (e.type==='ym2151-write') {
            this.fm.writeYm2151(e.register,e.value);
            this.voiceState.observeWrite(e.register,e.value);
            if (e.register===8 && (e.value & 0x78)) this.lastMasks[e.value & 7]=(e.value>>3)&15;
          }
          if (e.type==='okim6295-write') this.pcm.writeOki6295(e.register,e.value);
          if (e.type==='okim6295-rom-data') {
            this.pcm.loadOki6295Rom(e.data,e.offset,e.memorySize);
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
    } catch(error) {this.finish(error.message);}
    return !this.done;
  }
}
registerProcessor('cps1-song',Song);
