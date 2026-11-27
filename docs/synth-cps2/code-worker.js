// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCodeRuntime} from '../js/playground_code_runtime.js';
import {adpcmTriggerWrites,noteWrites} from './demo.js';

function integer(value,min,max,label) {
  if (!Number.isInteger(value) || value<min || value>max) throw RangeError(label+' must be '+min+'–'+max);
  return value;
}
const channel = n=>integer(n,1,16,'PCM channel')-1;
let captured=false;
let samples=new Map();
const qsound = {
  assignSample(ch,path,options={}) {
    const index=channel(ch),base=index*8;
    if(!samples)throw Error('Choose Use synth instruments to play WAVs from the project ROM.');
    const item=samples.get(path);
    if(!item)throw Error('Missing PCM sample: '+path);
    const offset=integer(options.offset??0,0,item.length-1,'Sample offset');
    const length=integer(options.length??item.length-offset,1,item.length-offset,'Sample length');
    const loop=integer(options.loop??length,0,length,'Loop length');
    const start=item.start+offset;
    postMessage({writes:[[((index+15)%16)*8,0x8000|item.bank],[base+1,start],[base+3,0],
      [base+4,loop],[base+5,start+length],[base+2,item.rate]]});
  },
  async assignPad(voice,path){
    integer(voice,1,3,'ADPCM voice');
    if(!samples)throw Error('Choose Use synth instruments to play WAVs from the project ROM.');
    if(!samples.has(path))throw Error('Missing WAV sample: '+path);
    const {port1,port2}=new MessageChannel();
    try{
      await new Promise((resolve,reject)=>{
        port1.onmessage=({data})=>data.error?reject(Error(data.error)):resolve();
        postMessage({assignPad:{voice,path,reply:port2}},[port2]);
      });
    }finally{port1.close();}
  },
  writeRegister(reg,value) {
    postMessage({writes:[[integer(reg,0,255,'Register'),integer(value,0,65535,'Value')]]});
  },
  noteOn(ch,midi,sample=0,pan=16,volume=8000) {
    if(captured && arguments.length===2){
      postMessage({audition:{type:'captured-note',channel:channel(ch),midi:integer(midi,0,127,'MIDI note')}});return;
    }
    const writes = noteWrites(channel(ch),integer(midi,0,127,'MIDI note'),integer(sample,0,1,'PCM sample'),
      integer(pan,0,32,'Pan'),integer(volume,0,32767,'Volume'));
    for (const [reg,value] of writes) if (value>65535) throw RangeError('Note exceeds the PCM rate register');
    postMessage({writes});
  },
  noteOff(ch) {if(captured){postMessage({audition:{type:'captured-off',channel:channel(ch)}});return;}this.writeRegister(channel(ch)*8+6,0);},
  trigger(voice,sample=0,pan=16,volume=32767) {
    if(captured && arguments.length===1){this.writeRegister(0xd6+integer(voice,1,3,'ADPCM voice')-1,1);return;}
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
  if('samples' in data)samples=data.samples===null?null:new Map(data.samples);
  if(data.source===undefined)return;
  if(!data.apply)captured=Boolean(data.captured);
  const token = ++revision;
  try {
    const state = await runtime[data.apply?'apply':'run'](data.source,{path:data.path});
    if(token===revision)postMessage({status:state.status});
  } catch(error) {if(token===revision)postMessage({status:error.message});}
};
