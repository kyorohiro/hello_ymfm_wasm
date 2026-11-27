// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {adpcmTriggerWrites,noteWrites} from './demo.js';

function integer(value,min,max,label) {
  if (!Number.isInteger(value) || value<min || value>max) throw RangeError(label+' must be '+min+'–'+max);
  return value;
}
const channel = n=>integer(n,1,16,'PCM channel')-1;
const qsound = {
  writeRegister(reg,value) {
    postMessage({writes:[[integer(reg,0,255,'Register'),integer(value,0,65535,'Value')]]});
  },
  noteOn(ch,midi,sample=0,pan=16,volume=8000) {
    const writes = noteWrites(channel(ch),integer(midi,0,127,'MIDI note'),integer(sample,0,1,'PCM sample'),
      integer(pan,0,32,'Pan'),integer(volume,0,32767,'Volume'));
    for (const [reg,value] of writes) if (value>65535) throw RangeError('Note exceeds the PCM rate register');
    postMessage({writes});
  },
  noteOff(ch) {this.writeRegister(channel(ch)*8+6,0);},
  trigger(voice,sample=0,pan=16,volume=32767) {
    postMessage({writes:adpcmTriggerWrites(integer(voice,1,3,'ADPCM voice')-1,integer(sample,0,2,'ADPCM sample'),
      integer(pan,0,32,'Pan'),integer(volume,0,32767,'Volume'))});
  },
};
const runtime = createPlaygroundCodeRuntime({
  ensureReady:()=>{}, now:()=>performance.now()/1000, supportedSoundChips:['qsound'],
  useSoundChip:()=>qsound,prepareSource:source=>'const qsound=await useSoundChip("qsound");\n'+source,
  guardExecution:false,onState:({status})=>{if(status.startsWith('Loop error'))postMessage({status});},
});
let revision = 0;
onmessage = async ({data})=>{
  const token = ++revision;
  try {
    const state = await runtime[data.apply?'apply':'run'](data.source,{path:data.path});
    if(token===revision)postMessage({status:state.status});
  } catch(error) {if(token===revision)postMessage({status:error.message});}
};
