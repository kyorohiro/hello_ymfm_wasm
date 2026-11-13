// SPDX-License-Identifier: BSD-3-Clause
// Convert deliberate UI changes to sparse physical-channel edits. Large DDA
// strings are compared by identity/value, never serialized on a polling tick.
import {readPreset} from './preset.js';
const paths=[
  'source','volume','wave','pan.left','pan.right','noise.frequency',
  'lfo.enabled','lfo.wave','lfo.frequency','lfo.depth','lfo.reset','lfo.mode','lfo.carrierPeriod','lfo.modulatorPeriod',
  'lfo.output.enabled','lfo.output.volume','lfo.output.pan.left','lfo.output.pan.right',
  'envelope.enabled','envelope.attack','envelope.decay','envelope.sustain','envelope.release',
  'dda.name','dda.data','dda.sampleRate','dda.rootNote','dda.loop','dda.speed',
];
const at=(value,path)=>path.split('.').reduce((item,key)=>item[key],value);
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)?a.length===b.length&&a.every((v,i)=>v===b[i]):a===b;
// AudioWorkletGlobalScope need not provide structuredClone. Preset fields are
// validated plain data; strings (including PCM) are immutable and need no copy.
export function copyHuc6280CodeValue(value){
  if(value===null||typeof value!=='object')return value;
  if(value instanceof Uint8Array)return value.slice();
  if(Array.isArray(value))return value.map(copyHuc6280CodeValue);
  return Object.fromEntries(Object.entries(value).map(([key,value])=>[key,copyHuc6280CodeValue(value)]));
}
export function createHuc6280CodeEdit(previous,next,channel) {
  if(!Number.isInteger(channel)||channel<0||channel>5)throw new RangeError('HuC6280 channel must be 0..5');
  const changes={};
  for(const path of paths)if(!same(at(previous,path),at(next,path)))changes[path]=copyHuc6280CodeValue(at(next,path));
  return Object.keys(changes).length?{channel,changes}:null;
}
export function readHuc6280CodeEdit(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Reflect.ownKeys(value).some(key=>!['channel','changes'].includes(key))||!Number.isInteger(value.channel)||value.channel<0||value.channel>5||!value.changes||typeof value.changes!=='object'||Array.isArray(value.changes))throw TypeError('Expected a HuC6280 channel and sparse changes');
  if(Reflect.ownKeys(value.changes).some(key=>!paths.includes(key)&&key!=='name'))throw TypeError('Unknown HuC6280 edit field');
  if(Object.hasOwn(value.changes,'dda.data')||Object.hasOwn(value.changes,'dda.name'))throw TypeError('Select Synth view to load the shared DDA sample. Physical CH edits keep its sample data.');
  return copyHuc6280CodeValue(value);
}
export function applyHuc6280CodeEdit(preset,value){
  const edit=readHuc6280CodeEdit(value),next=readPreset(preset);
  for(const [path,value]of Object.entries(edit.changes)){
    const keys=path.split('.');let target=next;for(const key of keys.slice(0,-1))target=target[key];target[keys.at(-1)]=copyHuc6280CodeValue(value);
  }
  return readPreset(next);
}
export function createHuc6280CodeChanges(previous,next){return createHuc6280CodeEdit(readPreset(previous),readPreset(next),0)?.changes??{};}
