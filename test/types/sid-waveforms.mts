import {SidSynth,SID_WAVEFORMS,sidWaveformBits,sidWaveformFromBits} from '../../tetorica_src/runtime/sidsynth.js';
import type {SidWaveform,SidWaveformName} from '../../tetorica_src/runtime/sidsynth.js';
import {createSidRegisterClient} from '../../tetorica_src/runtime/playground_sid.js';
import {sidWaveformBits as pureBits,sidWaveformFromBits as pureFromBits} from '../../tetorica_src/runtime/sid_waveforms.js';

const synth=new SidSynth({transport:{reset(){},writeRegister(){}}});
const names:readonly SidWaveformName[]=SID_WAVEFORMS;
const canonical:SidWaveform=sidWaveformFromBits(sidWaveformBits('pulse+triangle'));
const pureCanonical:SidWaveform=pureFromBits(pureBits('noise+triangle'));
synth.setVoice(0,{waveform:canonical});synth.setVoice(1,{waveform:'off'});
synth.setVoice(2,{waveform:'triangle+saw+pulse+noise'});
const observed:SidWaveformName|'off'|'combined'=synth._getState().channels[0].waveform;
const stateNames:SidWaveformName[]=synth._getState().channels[0].waveforms;
const client=createSidRegisterClient(()=>{});
client.setVoice(0,{waveform:'saw+pulse'});
client.setVoice(1,{waveform:'triangle+noise',sync:true,ring:true});
void [names,observed,stateNames,pureCanonical];

// @ts-expect-error The canonical flag names are readonly.
SID_WAVEFORMS.push('pulse');
// @ts-expect-error Duplicate waveform flags are invalid.
synth.setVoice(0,{waveform:'pulse+pulse'});
// @ts-expect-error Public types complete canonical flag order.
client.setVoice(0,{waveform:'saw+triangle'});
// @ts-expect-error A flag mask must be numeric.
sidWaveformFromBits('3');
// @ts-expect-error A waveform combination must be a string.
sidWaveformBits(['saw','pulse']);
