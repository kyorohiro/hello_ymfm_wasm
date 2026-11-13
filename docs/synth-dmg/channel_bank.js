// SPDX-License-Identifier: BSD-3-Clause
// Private editor state for the four physical DMG channels. Portable files are
// still one ordinary Game Boy preset, never this session-only bank.
import {readPreset} from './preset.js';
import {readGameboyCodeEdit,applyGameboyCodeEdit} from './code_parameter_edit.js?v=dmg-unified-channel-1';

const source=channel=>channel<2?'pulse':channel===2?'wave':'noise';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const at=(value,path)=>path.split('.').reduce((part,key)=>part[key],value);
const fields={
  'pulse.duty':[0,1],'pulse.volume':[0,1],'pulse.envelope.direction':[0,1],'pulse.envelope.period':[0,1],
  'pulse.sweep.enabled':[0],'pulse.sweep.direction':[0],'pulse.sweep.period':[0],'pulse.sweep.shift':[0],
  'wave.samples':[2],'wave.level':[2],
  'noise.volume':[3],'noise.envelope.direction':[3],'noise.envelope.period':[3],
  'noise.divisor':[3],'noise.shift':[3],'noise.width':[3],
  'pan.left':[0,1,2,3],'pan.right':[0,1,2,3],
};

export function readGameboyChannelBank(value){
  if(!Array.isArray(value)||value.length!==4||Reflect.ownKeys(value).length!==5)throw new TypeError('DMG channel bank needs four presets');
  return Array.from({length:4},(_,channel)=>{
    const preset=readPreset(value[channel]);
    if(preset.source!==source(channel)||channel===1&&preset.pulse.sweep.enabled)throw new TypeError('DMG bank preset must match its physical channel');
    return preset;
  });
}

export function createGameboyChannelBank(value){
  const preset=readPreset(value);
  return Array.from({length:4},(_,channel)=>{
    const next=readPreset(preset);next.source=source(channel);
    if(channel===1)next.pulse.sweep.enabled=false;
    return next;
  });
}

export function applyGameboyChannelEdit(value,edit){
  const bank=readGameboyChannelBank(value),validated=readGameboyCodeEdit(edit);
  bank[validated.channel]=applyGameboyCodeEdit(bank[validated.channel],validated);
  return bank;
}

export function createGameboyCommonChannelEdits(previousCommon,nextCommon){
  const previous=readPreset(previousCommon),next=readPreset(nextCommon);
  return Array.from({length:4},(_,channel)=>{
    const changes={};
    for(const[path,channels]of Object.entries(fields))if(channels.includes(channel)&&!equal(at(previous,path),at(next,path)))changes[path]=at(next,path);
    return readGameboyCodeEdit({channel,changes});
  });
}

/** Round-robin editing broadcasts changed fields only. Merely choosing a
 * source/view never copies one physical channel over another. */
export function updateGameboyChannelBank(value,previousCommon,nextCommon,{replace=false}={}){
  if(typeof replace!=='boolean')throw new TypeError('DMG bank replacement must be boolean');
  const bank=readGameboyChannelBank(value),previous=readPreset(previousCommon),next=readPreset(nextCommon);
  if(replace)return createGameboyChannelBank(next);
  for(const edit of createGameboyCommonChannelEdits(previous,next)){
    const channel=edit.channel;
    bank[channel]=applyGameboyCodeEdit(bank[channel],edit);
    if(previous.name!==next.name)bank[channel].name=next.name;
  }
  return readGameboyChannelBank(bank);
}
