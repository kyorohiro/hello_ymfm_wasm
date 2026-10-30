import {Scsp} from './scsp.js';
import {ScspSynth,createScspInitSample,type ScspSample} from './scspsynth.js';
async function example() {
  const chip=await Scsp.create({moduleFactory:async()=>({})});
  const synth=new ScspSynth(chip),initial=createScspInitSample();
  const sample:ScspSample=synth.loadPCM(initial.pcm,initial.options);
  synth.setPreset(31,{sample,envelope:{attackRate:31,releaseRate:20}});
  synth.noteOn(31,'C4');synth.setFrequency(31,440);synth.setMix(31,{pan:15});
  const state=synth.getState();const rate:44100=state.sampleRate;
  const pcm=synth.generateStereo(rate);synth.renderInto(pcm.left,pcm.right,128);
  // @ts-expect-error Tuning is required.
  synth.loadPCM(new Int16Array(64),{});
  // @ts-expect-error Two tuning references are ambiguous.
  synth.loadPCM(new Int16Array(64),{rootNote:69,baseFrequencyHz:440});
  // @ts-expect-error Unsigned PCM is not accepted.
  synth.loadPCM(new Uint8Array(64),{rootNote:69});
  // @ts-expect-error Sample metadata cannot be edited.
  sample.address=0;
  // @ts-expect-error Raw envelopes have named fields.
  synth.setEnvelope(0,{attack:10});
  // @ts-expect-error Unsupported modulation controls must not appear supported.
  synth.setPreset(0,{fmDepth:1});
  synth.noteOff(31);synth.allNotesOff();synth.stopVoices();synth.reset({clearRam:true});synth.dispose();
}
void example;
