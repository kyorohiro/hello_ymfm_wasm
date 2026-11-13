// SPDX-License-Identifier: BSD-3-Clause
// Temporary manual writes on the *same* reference APU as VGM. Install after
// song_state's timeline and before player.reset(), then dispose in reverse.
import {GameboySynth} from '../js/gameboysynth.js';
import {readPreset} from './preset.js';
import {readGameboyCodeEdit,applyGameboyCodeEdit} from './code_parameter_edit.js';
import {createGameboyCommonChannelEdits} from './channel_bank.js';
import {gameboyCodeLiveView} from './code_live.js?v=dmg-vgm-manual-1';

const triggers=new Map([[4,0],[9,1],[14,2],[19,3]]);
const fullChanges=(preset,channel)=>{
  const changes={'pan.left':preset.pan.left,'pan.right':preset.pan.right};
  const collect=(prefix,value)=>{for(const[key,item]of Object.entries(value)){
    if(item&&typeof item==='object'&&!Array.isArray(item))collect(prefix+key+'.',item);
    else changes[prefix+key]=item;
  }};
  if(channel<2){collect('pulse.',preset.pulse);if(channel===1)for(const key of Object.keys(changes))if(key.startsWith('pulse.sweep.'))delete changes[key];}
  else collect(channel===2?'wave.':'noise.',channel===2?preset.wave:preset.noise);
  return{channel,changes};
};

export function createGameboySongInteraction(engine){
  for(const method of ['writeGameboyApu','reset'])if(typeof engine?.[method]!=='function')throw new TypeError('Expected a Game Boy reference audio engine');
  const originalWrite=engine.writeGameboyApu,originalReset=engine.reset;
  let disposed=false,pitch=0,cursor=0,sequence=0;
  const voices=new Map(),slots=Array(4).fill(null);
  // Manual Synth writes go straight to the captured timeline wrapper. Only
  // external VGM writes pass through write() below, so a manual KON cannot
  // mistakenly retire the key that has just acquired that gate.
  const synth=new GameboySynth({transport:{
    writeRegister:(register,value)=>originalWrite.call(engine,register,value),
    reset:()=>{throw new Error('Manual VGM interaction cannot reset the APU');},
  }});
  const abort=()=>{const error=new Error('Game Boy song interaction is disposed');error.name='AbortError';return error;};
  const open=()=>{if(disposed)throw abort();};
  const ready=()=>{open();if(!synth._getState().initialized)throw new Error('The VGM must power on the APU before manual interaction');};
  const forget=channel=>{const voice=slots[channel];if(voice)voices.delete(voice.id);slots[channel]=null;};
  const clear=()=>{voices.clear();slots.fill(null);pitch=0;cursor=0;};
  function write(register,value){
    if(disposed)return originalWrite.call(engine,register,value);
    const previous=synth._getState();
    try{
      synth.writeRegister(register,value);
      if(register===22){const state=synth._getState();synth._adoptState({...state,initialized:Boolean(value&128)});}
    }catch(error){synth._adoptState(previous);throw error;}
    if(register===22&&!(value&128)){voices.clear();slots.fill(null);}
    else if(triggers.has(register)&&value&128)forget(triggers.get(register));
    else if([2,7,17].includes(register)&&!(value&0xf8))forget({2:0,7:1,17:3}[register]);
    else if(register===10&&!(value&128))forget(2);
  }
  function reset(...args){
    const result=originalReset.apply(engine,args);
    if(!disposed){synth._adoptState({initialized:false,registers:Array(48).fill(0),voice:Array(48).fill(0)});clear();}
    return result;
  }
  engine.writeGameboyApu=write;engine.reset=reset;
  const read=()=>({...synth._getState(),voices:[...voices.values()].map(({id,midi,channel})=>({id,midi,channel})),pitch,disposed});
  function prepareEdit(value){
    const edit=readGameboyCodeEdit(value),state=synth._getState();
    const preset=applyGameboyCodeEdit(gameboyCodeLiveView(state,edit.channel).preset,edit);
    return{edit,preset};
  }
  function applyPrepared({edit:{channel,changes},preset}){
    const own=key=>Object.hasOwn(changes,key),pulse={},noise={};
    for(const key of ['duty','volume'])if(own('pulse.'+key))pulse[key]=changes['pulse.'+key];
    for(const key of ['direction','period'])if(own('pulse.envelope.'+key))(pulse.envelope??={})[key]=changes['pulse.envelope.'+key];
    if(Object.keys(pulse).length)synth.pulse.setVoice(channel,pulse);
    if(Object.keys(changes).some(key=>key.startsWith('pulse.sweep.'))){
      const bits=synth._getState().voice[0],sweep={direction:bits&8?'down':'up',period:bits>>4&7,shift:bits&7};
      for(const key of ['direction','period','shift'])if(own('pulse.sweep.'+key))sweep[key]=changes['pulse.sweep.'+key];
      synth.pulse.setSweep(own('pulse.sweep.enabled')&&!changes['pulse.sweep.enabled']?{...sweep,period:0,shift:0}:sweep);
    }
    if(own('wave.samples')){synth.wave.stopAndSetWaveform(preset.wave.samples);forget(2);}
    if(own('wave.level'))synth.wave.setLevel(preset.wave.level);
    for(const key of ['volume','divisor','shift','width'])if(own('noise.'+key))noise[key]=changes['noise.'+key];
    for(const key of ['direction','period'])if(own('noise.envelope.'+key))(noise.envelope??={})[key]=changes['noise.envelope.'+key];
    if(Object.keys(noise).length)synth.noise.setVoice(noise);
    if(own('pan.left')||own('pan.right')){
      const bits=synth._getState().voice[21];
      synth.setPan(channel,own('pan.left')?changes['pan.left']:Boolean(bits&(16<<channel)),own('pan.right')?changes['pan.right']:Boolean(bits&(1<<channel)));
    }
  }
  function applyEdit(value){
    open();const prepared=prepareEdit(value);
    if(Object.keys(prepared.edit.changes).length){ready();applyPrepared(prepared);}
    return read();
  }
  function applyPreset(value,{previous,replace=true}={}){
    open();const preset=readPreset(value);
    if(typeof replace!=='boolean')throw new TypeError('Game Boy preset replacement must be boolean');
    const edits=replace?Array.from({length:4},(_,channel)=>fullChanges(preset,channel)):createGameboyCommonChannelEdits(previous,preset);
    // Validate every changed channel before a Wave DAC-off or any other write.
    const prepared=edits.map(prepareEdit);
    const changed=prepared.some(item=>Object.keys(item.edit.changes).length);
    if(changed)ready();
    if(replace||readPreset(previous).source!==preset.source)releaseKeyboard();
    if(changed)for(const item of prepared)applyPrepared(item);
    return{...read(),edits:prepared.map(item=>item.edit)};
  }
  function frequency(midi,semitones,channel){
    const hz=440*2**((midi-69+semitones)/12),divisor=channel===2?64:32;
    const period=Math.round(2048-synth.clock/(divisor*hz));
    if(!Number.isFinite(hz)||!Number.isInteger(period)||period<0||period>2047)throw new RangeError('Note is outside this Game Boy channel frequency range');
    return hz;
  }
  function noteOn(id,midi,{channel=null,source='pulse'}={}){
    open();
    if(typeof id!=='string'||!id.length||id.length>128)throw new TypeError('Expected a keyboard identity of 1–128 characters');
    if(voices.has(id))throw new Error('Keyboard identity is already active');
    if(!Number.isInteger(midi)||midi<0||midi>127)throw new RangeError('Expected a MIDI note 0–127');
    if(channel!==null&&(!Number.isInteger(channel)||channel<0||channel>3))throw new RangeError('Game Boy channel must be null or 0–3');
    if(!['pulse','wave','noise'].includes(source))throw new TypeError('Unknown Game Boy keyboard source');
    const pool=channel===null?source==='pulse'?(synth._getState().voice[0]&0x77?[0]:[0,1]):source==='wave'?[2]:[3]:[channel];
    let selected;
    for(let offset=0;offset<pool.length;offset++){const candidate=pool[(cursor+offset)%pool.length];if(!slots[candidate]){selected=candidate;break;}}
    if(selected===undefined)selected=pool.reduce((oldest,candidate)=>slots[candidate].order<slots[oldest].order?candidate:oldest,pool[0]);
    const hz=selected===3?null:frequency(midi,pitch,selected);ready();
    const previous=slots[selected];
    // The manual gate is a new trigger on an already sounding physical CH;
    // releasing an older key later must not release this new identity.
    if(previous){synth.keyOff(selected);forget(selected);}
    if(hz!==null)synth.setFrequency(selected,hz);
    synth.keyOn(selected);
    const voice={id,midi,channel:selected,order:++sequence};voices.set(id,voice);slots[selected]=voice;cursor=(pool.indexOf(selected)+1)%pool.length;
    return{id,midi,channel:selected,stolenId:previous?.id??null};
  }
  function noteOff(id){
    open();const voice=voices.get(id);
    if(!voice||slots[voice.channel]!==voice)return false;
    synth.keyOff(voice.channel);forget(voice.channel);return true;
  }
  function releaseKeyboard(){
    open();for(const voice of [...voices.values()])if(slots[voice.channel]===voice){synth.keyOff(voice.channel);forget(voice.channel);}
    pitch=0;cursor=0;return read();
  }
  function setPitch(value){
    open();if(!Number.isFinite(value)||value< -24||value>24)throw new RangeError('Keyboard Pitch must be between -24 and +24 semitones');
    const updates=[...voices.values()].filter(voice=>voice.channel!==3).map(voice=>[voice.channel,frequency(voice.midi,value,voice.channel)]);
    if(updates.length)ready();for(const[channel,hz]of updates)synth.setFrequency(channel,hz);pitch=value;return read();
  }
  function dispose(){
    if(disposed)return;disposed=true;clear();
    if(engine.writeGameboyApu===write)engine.writeGameboyApu=originalWrite;
    if(engine.reset===reset)engine.reset=originalReset;
    synth.dispose();
  }
  return{applyEdit,applyPreset,noteOn,noteOff,releaseKeyboard,setPitch,read,dispose};
}
