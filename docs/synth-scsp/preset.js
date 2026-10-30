// SPDX-License-Identifier: BSD-3-Clause
import {createScspValidation} from '../js/playground_scsp.js';
export function readPreset(value) {
  if(value?.format!=='tetorica-scsp-voice'||value.version!==1)throw new TypeError('Unsupported SCSP preset format/version');
  if(![8,16].includes(value.bits)||!Array.isArray(value.pcm)||value.pcm.length<2||value.pcm.length>65535)throw new RangeError('Preset requires 2–65,535 PCM8/16 samples');
  const limit=2**(value.bits-1);
  if(value.pcm.some(v=>!Number.isInteger(v)||v< -limit||v>=limit))throw new RangeError('Invalid signed PCM value');
  const pcm=value.bits===8?Int8Array.from(value.pcm):Int16Array.from(value.pcm);
  const options=value.options,voice=value.voice;
  if(voice?.modulation&&(voice.modulation.depth||voice.modulation.writeInhibit))throw new TypeError('Linked SCSP modulation requires a multi-slot preset; this Synth reads single-slot PCM voices');
  if(!voice||!voice.envelope)throw new TypeError('Missing voice settings');
  const check=createScspValidation();
  try {
    const sample=check.loadPCM(pcm,options);
    const patch={sample,frequencyHz:voice.frequencyHz,totalLevel:voice.totalLevel,directLevel:voice.directLevel,pan:voice.pan,envelope:voice.envelope,lfo:voice.lfo??{}};
    check.setPreset(0,patch);check.keyOn(0);
    const {sample:_,...validated}=check.getState().slots[0];delete validated.gate;
    return {pcm,options:structuredClone(options),voice:validated};
  }finally{check.dispose();}
}
export function writePreset({pcm,sample,voice}) {
  const value={format:'tetorica-scsp-voice',version:1,bits:sample.bits,pcm:Array.from(pcm),options:{baseFrequencyHz:sample.rootFrequencyHz,sourceSampleRate:sample.sourceSampleRate,...(sample.loopStartSamples===null?{}:{loopStartSamples:sample.loopStartSamples})},voice:{frequencyHz:voice.frequencyHz,totalLevel:voice.totalLevel,directLevel:voice.directLevel,pan:voice.pan,envelope:voice.envelope,lfo:voice.lfo??{}}};
  readPreset(value);return value;
}
