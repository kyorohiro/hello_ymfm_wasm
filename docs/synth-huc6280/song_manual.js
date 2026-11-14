// SPDX-License-Identifier: BSD-3-Clause
// Deliberate hardware writes into the reference chip's next ungenerated frame.
// No PCM asset, envelope, oscillator phase or original VGM is reconstructed here.
import {readHuc6280CodeEdit} from './code_parameter_edit.js';

const byte=value=>Number.isInteger(value)&&value>=0&&value<=255;
const wave=values=>Array.isArray(values)&&values.length===32&&values.every(value=>Number.isInteger(value)&&value>=0&&value<=31);
const hardware=new Set(['source','volume','wave','pan.left','pan.right','noise.frequency',
  'lfo.enabled','lfo.wave','lfo.frequency','lfo.depth','lfo.reset','lfo.carrierPeriod','lfo.modulatorPeriod',
  'lfo.output.enabled','lfo.output.volume','lfo.output.pan.left','lfo.output.pan.right']);
const bool=(value,label)=>{if(typeof value!=='boolean')throw TypeError(`${label} must be boolean`);};
const integer=(value,min,max,label)=>{if(!Number.isInteger(value)||value<min||value>max)throw RangeError(`${label} must be ${min}..${max}`);};
const knownPeriod=registers=>byte(registers[2])&&byte(registers[3]);
const hz=midi=>440*2**((midi-69)/12);
const period=(midi,bend,clock)=>Math.max(1,Math.min(4096,Math.round(clock/(32*hz(midi+bend)))));

/** Synchronous companion of one timeline/native instance. The transport owns
 * its lifetime and decides when playing permits calls. All patch validation is
 * completed before the first native write. Existing PCM is left untouched. */
export function createHuc6280SongManual({engine,timeline,onMutation=()=>{}}={}) {
  if(!engine||timeline?.engine!==engine||typeof timeline.peek!=='function'||typeof timeline.onWrite!=='function'||typeof onMutation!=='function')throw TypeError('Expected a matching HuC6280 song engine and timeline');
  const owners=Array(6).fill(null);let disposed=false,depth=0,pitch=0,unsubscribe=null;
  const open=()=>{if(disposed)throw Error('HuC6280 song manual controls are disposed');};
  const snapshot=()=>{open();const state=timeline.peek();if(!state||timeline.error)throw Error('VGM channel observation is unavailable');return state;};
  function listen(){
    if(owners.some(Boolean)&&!unsubscribe)unsubscribe=timeline.onWrite(event=>{
      if(depth)return;
      if(event.reset){owners.fill(null);pitch=0;listen();return;}
      const {register,channel}=event;
      if(Number.isInteger(channel)&&channel<6&&channel>=0){
        if(register===4||register===6)owners[channel]=null;
        else if((register===2||register===3)&&owners[channel])owners[channel].pitchOwned=false;
      }
      listen();
    });
    else if(!owners.some(Boolean)&&unsubscribe){unsubscribe();unsubscribe=null;}
  }
  function availability(state,channel){
    const r=state.registers[channel],control=r[4],noise=r[7];
    const result={channel,playable:false,source:'unknown',reason:''};
    if(!byte(control))return{...result,reason:'The channel control was not recorded.'};
    if(channel>=4&&!byte(noise))return{...result,reason:'The channel Noise routing was not recorded.'};
    const source=channel>=4&&(noise&128)?'noise':control&64?'dda':'wave';result.source=source;
    if(source==='dda')return{...result,reason:'DDA is a changing DAC value, not a captured PCM sample. Its level and balance can be edited.'};
    if(source==='wave'&&!wave(state.waveforms[channel]))return{...result,reason:'All 32 Wave RAM values must be recorded before keyboard input.'};
    if(channel<2&&!byte(state.globals[9]))return{...result,reason:'The shared LFO routing was not recorded.'};
    if(channel<2&&(state.globals[9]&3)){
      if(channel===1)return{...result,reason:'CH2 is the active LFO modulator. Choose CH1 for the carrier keyboard.'};
      const mod=state.registers[1];
      if(source!=='wave'||!byte(mod[4])||(mod[4]&64)||!wave(state.waveforms[1])||!knownPeriod(mod)||!byte(state.globals[8]))return{...result,reason:'The active CH1/CH2 LFO pair needs recorded Wave RAM, control and modulator period.'};
    }
    return{...result,playable:true};
  }
  function read(){
    let state,reason='';
    try{state=snapshot();}catch(error){reason=error.message;}
    return{available:Boolean(state),reason,frame:state?.positionFrames??timeline.generatedFrames,pitch,
      channels:Array.from({length:6},(_,channel)=>state?availability(state,channel):{channel,source:'unknown',playable:false,reason}),
      voices:owners.filter(owner=>owner?.id).map(({id,channel,midi,pitchOwned})=>({id,channel,midi,pitchOwned}))};
  }
  function commit(operations,after=()=>{}){
    const frame=timeline.generatedFrames;if(!operations.length)return{applied:false,frame};
    const state=snapshot(),selected=Number.isInteger(engine.selectedChannel)?engine.selectedChannel:state.selectedChannel;
    integer(selected,0,7,'Current VGM channel selector');
    // The host only marks cache provenance here; notification occurs after the
    // full transaction, never from inside this callback.
    onMutation({frame});depth++;let current=selected;
    try{
      for(const[channel,register,value]of operations){
        if(channel!==null&&channel!==current){engine.writeHuc6280(0,channel);current=channel;}
        engine.writeHuc6280(register,value);
      }
    }finally{
      try{if(current!==selected)engine.writeHuc6280(0,selected);}finally{depth--;}
    }
    after();listen();return{applied:true,frame};
  }
  function applyEdit(value){
    const edit=readHuc6280CodeEdit(value),changes=edit.changes,own=path=>Object.hasOwn(changes,path);
    for(const[path,value]of Object.entries(changes)){
      if(!hardware.has(path))throw TypeError(`VGM manual editing supports hardware fields only: ${path}`);
      if(path==='source'){if(!['wave','noise'].includes(value))throw TypeError('Choose Synth to load a DDA PCM source.');}
      else if(path==='wave'||path==='lfo.wave'){if(!wave(value))throw TypeError('Wave RAM needs 32 integer values 0..31');}
      else if(['lfo.enabled','lfo.reset','lfo.output.enabled'].includes(path))bool(value,path);
      else integer(value,path.endsWith('Period')||path==='lfo.depth'?1:0,path.endsWith('Period')?4096:path==='lfo.depth'?3:path==='lfo.frequency'?255:path.startsWith('pan.')||path.includes('.pan.')?15:31,path);
    }
    const state=snapshot(),registers=state.registers.map(row=>[...row]),globals=[...state.globals],operations=[],retirePitch=new Set();
    const reg=(ch,index)=>{const value=registers[ch][index];if(!byte(value))throw Error(`CH${ch+1} register ${index} is not recorded; the untouched bits cannot be preserved.`);return value;};
    const global=index=>{if(!byte(globals[index]))throw Error(`Shared register ${index} is not recorded; the untouched bits cannot be preserved.`);return globals[index];};
    const write=(ch,index,value)=>{if(registers[ch][index]===value)return;registers[ch][index]=value;operations.push([ch,index,value]);};
    const shared=(index,value)=>{if(globals[index]===value)return;globals[index]=value;operations.push([null,index,value]);};
    const setPeriod=(ch,value)=>{const code=value&4095;write(ch,2,code&255);write(ch,3,code>>8);retirePitch.add(ch);};
    const upload=(ch,values)=>{
      if(wave(state.waveforms[ch])&&values.every((value,index)=>value===state.waveforms[ch][index]))return;
      const control=reg(ch,4);operations.push([ch,4,(control&31)|64],[ch,4,control&31]);
      for(const value of values)operations.push([ch,6,value]);operations.push([ch,4,control]);
    };
    const channel=edit.channel;
    if(own('source')){
      const control=reg(channel,4),source=changes.source;if(source==='noise'&&channel<4)throw Error('Hardware Noise is available only on CH5/CH6.');
      write(channel,4,control&~64);
      if(channel>=4){const noise=reg(channel,7);write(channel,7,source==='noise'?noise|128:noise&~128);}
      retirePitch.add(channel);
    }
    if(own('wave'))upload(channel,changes.wave);
    if(own('volume'))write(channel,4,(reg(channel,4)&0xe0)|changes.volume);
    if(own('pan.left')||own('pan.right')){
      const previous=own('pan.left')&&own('pan.right')?0:reg(channel,5);
      write(channel,5,(own('pan.left')?changes['pan.left']:previous>>4)<<4|(own('pan.right')?changes['pan.right']:previous&15));
    }
    if(own('noise.frequency')){if(channel<4)throw Error('Hardware Noise is available only on CH5/CH6.');write(channel,7,(reg(channel,7)&0xe0)|changes['noise.frequency']);}
    if(own('lfo.wave'))upload(1,changes['lfo.wave']);
    if(own('lfo.frequency'))shared(8,changes['lfo.frequency']);
    if(['lfo.enabled','lfo.depth','lfo.reset'].some(own)){
      const before=global(9),enabled=own('lfo.enabled')?changes['lfo.enabled']:Boolean(before&3);
      const depth=enabled?(own('lfo.depth')?changes['lfo.depth']:(before&3)||1):0;
      const reset=own('lfo.reset')?changes['lfo.reset']:Boolean(before&128);
      shared(9,depth|(reset?128:0));
    }
    if(own('lfo.carrierPeriod'))setPeriod(0,changes['lfo.carrierPeriod']);
    if(own('lfo.modulatorPeriod'))setPeriod(1,changes['lfo.modulatorPeriod']);
    if(own('lfo.output.volume'))write(1,4,(reg(1,4)&0xe0)|changes['lfo.output.volume']);
    if(own('lfo.output.pan.left')||own('lfo.output.pan.right')){
      const previous=own('lfo.output.pan.left')&&own('lfo.output.pan.right')?0:reg(1,5);
      write(1,5,(own('lfo.output.pan.left')?changes['lfo.output.pan.left']:previous>>4)<<4|(own('lfo.output.pan.right')?changes['lfo.output.pan.right']:previous&15));
    }
    const oldOutput=own('lfo.output.enabled')?Boolean(reg(1,4)&128):null;
    if(own('lfo.output.enabled'))write(1,4,changes['lfo.output.enabled']?reg(1,4)|128:reg(1,4)&~128);
    return commit(operations,()=>{
      for(const ch of retirePitch)if(owners[ch])owners[ch].pitchOwned=false;
      if(own('lfo.output.enabled')&&oldOutput!==changes['lfo.output.enabled'])owners[1]=changes['lfo.output.enabled']?{channel:1,manualEdit:true}:null;
    });
  }
  function noteOn(id,midi,channel){
    integer(channel,0,5,'VGM channel');integer(midi,0,127,'MIDI note');
    if(typeof id!=='string'||!id.length||id.length>128)throw TypeError('A hand note needs an identity of 1..128 characters');
    if(owners.some(owner=>owner?.id===id))throw Error('Hand note identity is already active');
    const state=snapshot(),availabilityState=availability(state,channel);if(!availabilityState.playable)throw Error(availabilityState.reason);
    if(availabilityState.source==='wave'&&hz(midi)<state.clock/(32*4096))throw RangeError('Raise the octave for the HuC6280 Wave pitch range.');
    const operations=[],before=owners[channel],voice={id,midi,channel,pitchOwned:availabilityState.source==='wave',source:availabilityState.source};
    if(voice.pitchOwned){const value=period(midi,pitch,state.clock)&4095;operations.push([channel,2,value&255],[channel,3,value>>8]);}
    operations.push([channel,4,state.registers[channel][4]|128]);
    return{...commit(operations,()=>{owners[channel]=voice;}),channel,stolenId:before?.id??null};
  }
  function noteOff(id){
    open();const channel=owners.findIndex(owner=>owner?.id===id);if(channel<0)return false;
    const state=snapshot(),control=state.registers[channel][4];if(!byte(control)){owners[channel]=null;listen();return false;}
    commit([[channel,4,control&~128]],()=>{owners[channel]=null;});return true;
  }
  function setPitch(value){
    if(!Number.isFinite(value)||value< -24||value>24)throw RangeError('Pitch must be -24..24 semitones');
    const state=snapshot(),operations=[];
    for(const voice of owners)if(voice?.id&&voice.pitchOwned){const code=period(voice.midi,value,state.clock)&4095;operations.push([voice.channel,2,code&255],[voice.channel,3,code>>8]);}
    const result=commit(operations);pitch=value;return result;
  }
  function releaseKeyboard(){
    const state=snapshot(),operations=[];
    for(let channel=0;channel<6;channel++)if(owners[channel]&&byte(state.registers[channel][4]))operations.push([channel,4,state.registers[channel][4]&~128]);
    const result=commit(operations,()=>owners.fill(null));owners.fill(null);pitch=0;listen();return result;
  }
  return{applyEdit,noteOn,noteOff,setPitch,releaseKeyboard,read,
    dispose(){if(disposed)return;disposed=true;unsubscribe?.();unsubscribe=null;owners.fill(null);pitch=0;}};
}
