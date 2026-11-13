// SPDX-License-Identifier: BSD-3-Clause
// App-only authoring edits for one observed physical DMG channel. No APU/RPC.
import {readPreset} from './preset.js';

const fields={
  'pulse.duty':[0,1],'pulse.volume':[0,1],'pulse.envelope.direction':[0,1],'pulse.envelope.period':[0,1],
  'pulse.sweep.enabled':[0],'pulse.sweep.direction':[0],'pulse.sweep.period':[0],'pulse.sweep.shift':[0],
  'wave.samples':[2],'wave.level':[2],
  'noise.volume':[3],'noise.envelope.direction':[3],'noise.envelope.period':[3],
  'noise.divisor':[3],'noise.shift':[3],'noise.width':[3],'pan.left':[0,1,2,3],'pan.right':[0,1,2,3],
};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const channel=value=>{if(!Number.isInteger(value)||value<0||value>3)throw new RangeError('DMG Code edit channel must be 0..3');return value;};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[null,Object.prototype].includes(Object.getPrototypeOf(value));
const read=(value,path)=>path.split('.').reduce((part,key)=>part[key],value);
function write(value,path,next){const keys=path.split('.'),last=keys.pop();keys.reduce((part,key)=>part[key],value)[last]=Array.isArray(next)?next.slice():next;}
export function readGameboyCodeEdit(value){
  if(!plain(value)||Reflect.ownKeys(value).length!==2||!Object.hasOwn(value,'channel')||!Object.hasOwn(value,'changes'))throw new TypeError('Expected a DMG channel parameter edit');
  if(Object.values(Object.getOwnPropertyDescriptors(value)).some(item=>!Object.hasOwn(item,'value')))throw new TypeError('DMG edits cannot contain accessors');
  const ch=channel(value.channel),changes=value.changes;
  if(!plain(changes))throw new TypeError('Expected changed DMG fields');
  const copy={};for(const path of Reflect.ownKeys(changes)){
    const descriptor=Object.getOwnPropertyDescriptor(changes,path);
    if(typeof path!=='string'||!fields[path]?.includes(ch)||!Object.hasOwn(descriptor,'value'))throw new TypeError('DMG field does not belong to the selected physical channel');
    copy[path]=Array.isArray(descriptor.value)?descriptor.value.slice():descriptor.value;
  }
  return {channel:ch,changes:copy};
}
export function applyGameboyCodeEdit(authorPreset,edit){
  const next=readPreset(authorPreset),validated=readGameboyCodeEdit(edit);
  for(const [path,value]of Object.entries(validated.changes))write(next,path,value);
  return readPreset(next);
}
export function createGameboyCodeEdit(beforeDisplay,afterDisplay,selectedChannel){
  const before=readPreset(beforeDisplay),after=readPreset(afterDisplay),ch=channel(selectedChannel),changes={};
  if(before.source!==after.source||before.name!==after.name)throw new TypeError('A Code channel edit cannot change instrument source or name');
  for(const path of Object.keys(fields))if(!equal(read(before,path),read(after,path))){
    if(!fields[path].includes(ch))throw new TypeError('DMG field does not belong to the selected physical channel');
    changes[path]=Array.isArray(read(after,path))?read(after,path).slice():read(after,path);
  }
  return {channel:ch,changes};
}
