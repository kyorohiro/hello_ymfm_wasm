// Standard VAB -> one prepared Tone -> actual SPU -> stereo WAV, no audio device.
// Usage: node tetorica_examples/nodejs/main_ps1_vab.js bank.vab /tmp/tone.wav --program 3 --tone 0
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readVab,prepareVabTone} from '../../tetorica_src/runtime/ps1_vab.js';
import {Ps1Spu} from '../../tetorica_src/runtime/ps1_spu.js';
import {Ps1Synth} from '../../tetorica_src/runtime/ps1synth.js';
import {encodeWav} from '../../tetorica_src/runtime/wav.js';
import moduleFactory from '../../docs/generated/ps1_spu_wasm.js';

const args=process.argv.slice(2), input=args.shift(),output=args.shift();
if(!input||!output||input.startsWith('--')||output.startsWith('--')) {
  throw new Error('Usage: node tetorica_examples/nodejs/main_ps1_vab.js bank.vab output.wav [--program 0..127] [--tone 0..15]');
}
if(resolve(input)===resolve(output))throw new Error('Choose a WAV output path different from the source bank.');
let programNumber=null,toneIndex=0;
while(args.length) {
  const flag=args.shift(),text=args.shift(),value=Number(text);
  if(!['--program','--tone'].includes(flag)||text===undefined||!/^\d+$/.test(text)||!Number.isInteger(value)||value>(flag==='--program'?127:15)) {
    throw new Error('Expected --program 0..127 or --tone 0..15.');
  }
  if(flag==='--program')programNumber=value;else toneIndex=value;
}
// readVab also accepts a VH DataView/Uint8Array plus its matching VB body.
const bank=readVab(await readFile(input));
programNumber??=bank.programs[0].index;
const toneNumber=bank.tones.findIndex(tone=>tone.program===programNumber&&tone.index===toneIndex);
if(toneNumber<0)throw new Error(`Program ${programNumber}, Tone ${toneIndex} is absent. Available: ${bank.tones.map(t=>`${t.program}:${t.index}`).join(', ')}`);
const prepared=prepareVabTone(bank,toneNumber);
const core=await Ps1Spu.create({moduleFactory,moduleOptions:{
  wasmBinary:await readFile(new URL('../../docs/generated/ps1_spu_wasm.wasm',import.meta.url)),
}});
const synth=new Ps1Synth({core}),sampleRate=44100;
try {
  const sample=synth.loadADPCM(prepared.adpcm,prepared.options);
  synth.setPreset(0,{...prepared.preset,sample});
  // VAB keeps each voice's reverb send; shared reverb remains the host's choice.
  // This example renders dry. No song sequencer, key-zone layering or driver FX.
  const notes=['C4','E4','G4','C5'],noteFrames=22050,gapFrames=4410;
  const frames=notes.length*(noteFrames+gapFrames);
  const left=new Float32Array(frames),right=new Float32Array(frames);
  let offset=0;
  for(const note of notes) {
    synth.noteOn(0,note);
    synth.renderInto(left,right,noteFrames,offset);offset+=noteFrames;
    synth.keyOff(0);
    synth.renderInto(left,right,gapFrames,offset);offset+=gapFrames;
  }
  if(!left.every(Number.isFinite)||!right.every(Number.isFinite))throw new Error('SPU produced non-finite PCM.');
  let peak=0;for(const channel of [left,right])for(const value of channel)peak=Math.max(peak,Math.abs(value));
  await writeFile(output,encodeWav({sampleRate,left,right}));
  console.log(JSON.stringify({output,program:programNumber,tone:toneIndex,sample:prepared.tone.sample,
    frames,sampleRate,baseFrequencyHz:prepared.options.baseFrequencyHz,
    loopStartSamples:prepared.options.loopStartSamples??null,trimmedBytes:prepared.trimmedBytes,
    peak,
  },null,2));
}finally{synth.dispose();}
