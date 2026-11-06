// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {prepareSnesBRR} from '../js/snessynth.js';
import {decodeBase64} from './sample.js';

const FORMAT='tetorica-sdsp-voice';
export const ECHO_BRR_MAX_BYTES=33786;
const GAIN_MODES=['direct','linear-decrease','exponential-decrease','linear-increase','bent-increase'];
const checkedBrr=new Map();
function object(value,keys,label) {
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new TypeError(`${label}: expected an object`);
  const actual=Reflect.ownKeys(value);
  if(actual.length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||actual.some(key=>!keys.includes(key))) throw new TypeError(`${label}: unexpected or missing property`);
}
function number(value,min,max,label,integer=true) {
  if(!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value)) throw new RangeError(`${label}: expected ${integer?'an integer':'a number'} ${min}–${max}`);
  return value;
}
function name(value,max,label) {
  if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) throw new TypeError(`${label}: expected at most ${max} characters without control characters`);
  return value.trim();
}
function boolean(value,label) {
  if(typeof value!=='boolean') throw new TypeError(`${label}: expected a boolean`);
  return value;
}

export function createDefaultEcho() {
  return {enabled:false,delay:4,feedback:32,volumeLeft:32,volumeRight:32,send:true,fir:[127,0,0,0,0,0,0,0]};
}
export function createDefaultNoise() {return {clock:31};}
/** A valid silent DSP fetch loop; the hardware NON route supplies the sound. */
export function createNoiseCarrier() {return Uint8Array.of(3,0,0,0,0,0,0,0,0);}
function readNoise(value) {
  object(value,['clock'],'S-DSP Noise');
  return {clock:number(value.clock,0,31,'Noise clock')};
}
function readEcho(value) {
  object(value,['enabled','delay','feedback','volumeLeft','volumeRight','send','fir'],'S-DSP Echo');
  if(!Array.isArray(value.fir)||value.fir.length!==8||Reflect.ownKeys(value.fir).length!==9) throw new RangeError('Echo FIR requires exactly eight signed coefficients');
  return {enabled:boolean(value.enabled,'Enable Echo'),delay:number(value.delay,0,15,'Echo delay'),
    feedback:number(value.feedback,-128,127,'Echo feedback'),volumeLeft:number(value.volumeLeft,-128,127,'Echo return left'),
    volumeRight:number(value.volumeRight,-128,127,'Echo return right'),send:boolean(value.send,'Echo send'),
    fir:Array.from(value.fir,value=>number(value,-128,127,'Echo FIR coefficient'))};
}

/** Map the standalone instrument's shared send switch to physical voice bits. */
export function echoOptions(value) {
  const {send,...echo}=readEcho(value);
  return {...echo,sendMask:send?255:0};
}

/** One normalized 128-frame cycle. Drawing and BRR encoding are authoring tools. */
export function waveShape(shape) {
  if(!['sine','triangle','saw','square'].includes(shape)) throw new RangeError('Expected Sine, Triangle, Saw or Square');
  return Array.from({length:128},(_,index)=>{
    const phase=index/128;
    return .75*(shape==='sine'?Math.sin(phase*Math.PI*2):shape==='triangle'?1-4*Math.abs(phase-.5):shape==='saw'?2*phase-1:index<64?1:-1);
  });
}

export function createDefaultPreset() {
  return {format:FORMAT,version:3,name:'Sine',source:'wave',wave:waveShape('sine'),
    brr:{name:'',data:'',rootNote:60,basePitch:4096,loopStartSamples:null},
    volume:{left:16,right:16},
    envelope:{mode:'adsr',attack:15,decay:2,sustainLevel:7,sustainRate:0,
      gainMode:'direct',gainLevel:96,gainRate:16},echo:createDefaultEcho(),noise:createDefaultNoise()};
}

/** Validate and detach the portable instrument before touching RAM or voices. */
export function readPreset(value) {
  object(value,['format','version','name','source','wave','brr','volume','envelope',...([2,3].includes(value?.version)?['echo']:[]),...(value?.version===3?['noise']:[])],'S-DSP preset');
  if(value.format!==FORMAT||![1,2,3].includes(value.version)) throw new TypeError('Unsupported S-DSP preset format/version');
  const echo=value.version===1?createDefaultEcho():readEcho(value.echo);
  const noise=value.version===3?readNoise(value.noise):createDefaultNoise();
  if(!['wave','brr','noise'].includes(value.source)||value.source==='noise'&&value.version!==3) throw new RangeError('Expected Wave, BRR or v3 Noise source');
  if(!Array.isArray(value.wave)||value.wave.length!==128||Reflect.ownKeys(value.wave).length!==129) throw new RangeError('Wave requires exactly 128 normalized samples');
  const wave=Array.from(value.wave,sample=>number(sample,-1,1,'Wave sample',false));
  object(value.brr,['name','data','rootNote','basePitch','loopStartSamples'],'BRR sample');
  const brr={name:name(value.brr.name,120,'Sample name'),data:value.brr.data,
    rootNote:number(value.brr.rootNote,0,127,'Root note'),basePitch:number(value.brr.basePitch,1,16383,'Base PITCH'),
    loopStartSamples:value.brr.loopStartSamples===null?null:number(value.brr.loopStartSamples,0,114672,'Loop sample')};
  if(brr.loopStartSamples!==null&&brr.loopStartSamples%16) throw new RangeError('BRR loop must begin at a 16-sample boundary');
  const bytes=decodeBase64(brr.data);
  if(value.source==='brr'&&echo.enabled&&bytes.length>ECHO_BRR_MAX_BYTES) throw new RangeError('Echo reserves 30 KiB of RAM: this instrument allows at most 33,786 BRR bytes with Echo enabled. Use a shorter sample or keep Echo off.');
  if(!bytes.length) {
    if(brr.loopStartSamples!==null) throw new RangeError('An unloaded BRR sample has no loop position');
  } else {
    let cached=checkedBrr.get(brr.data);
    if(!cached||cached.loop!==brr.loopStartSamples) {
      prepareSnesBRR(bytes,{rootNote:60,basePitch:4096,...(brr.loopStartSamples===null?{}:{loopStartSamples:brr.loopStartSamples})});
      checkedBrr.delete(brr.data);checkedBrr.set(brr.data,{loop:brr.loopStartSamples});
      if(checkedBrr.size>2) checkedBrr.delete(checkedBrr.keys().next().value);
    }
  }
  object(value.volume,['left','right'],'Voice volume');
  object(value.envelope,['mode','attack','decay','sustainLevel','sustainRate','gainMode','gainLevel','gainRate'],'Hardware envelope');
  const envelope=value.envelope;
  if(!['adsr','gain'].includes(envelope.mode)) throw new RangeError('Envelope mode: expected ADSR or GAIN');
  if(!GAIN_MODES.includes(envelope.gainMode)) throw new RangeError('Unknown GAIN mode');
  return {format:FORMAT,version:3,name:name(value.name,80,'Instrument name'),source:value.source,wave,brr,
    volume:{left:number(value.volume.left,-128,127,'Left voice volume'),right:number(value.volume.right,-128,127,'Right voice volume')},
    envelope:{mode:envelope.mode,attack:number(envelope.attack,0,15,'Attack'),decay:number(envelope.decay,0,7,'Decay'),
      sustainLevel:number(envelope.sustainLevel,0,7,'Sustain level'),sustainRate:number(envelope.sustainRate,0,31,'Sustain rate'),
      gainMode:envelope.gainMode,gainLevel:number(envelope.gainLevel,0,127,'Direct GAIN level'),gainRate:number(envelope.gainRate,0,31,'GAIN rate')},echo,noise};
}

/** Hardware register codes. KOFF uses the chip's fixed release in every mode. */
export function envelopeRegisters(value) {
  const e=readPreset(value).envelope;
  return {adsr1:(e.mode==='adsr'?128:0)|(e.decay<<4)|e.attack,adsr2:(e.sustainLevel<<5)|e.sustainRate,
    gain:e.gainMode==='direct'?e.gainLevel:([0x80,0xa0,0xc0,0xe0][GAIN_MODES.indexOf(e.gainMode)-1]|e.gainRate)};
}

/** Editable Playground setup. BRR tuning is declared; no original note is guessed. */
export function presetToCode(value) {
  const p=readPreset(value),env=envelopeRegisters(p);
  if(p.source==='brr'&&!p.brr.data)throw new Error('Load a BRR or audio sample before copying a BRR audition');
  const lines=['// Select SNES in Playground. Run in a fresh context for a fresh BRR bank.',
    `// ${p.name||'Untitled S-DSP voice'}`,"const snes = await useSoundChip('snes');",'snes.allNotesOff();',
    `await snes.setEcho(${JSON.stringify(echoOptions(p.echo))}); // Reserve Echo RAM before loading BRR.`];
  if(p.source==='wave') lines.push(`const pcm = Float32Array.from(${JSON.stringify(p.wave)});`,
    'const encoded = pg.encodeBrr(pcm, {loopStartSamples:0});',
    'const sample = await snes.loadBRR(encoded.brr, {baseFrequencyHz:32000 / 128, loopStartSamples:0});');
  else if(p.source==='noise') lines.push('// Noise uses one shared hardware generator; note names only trigger its envelope.',
    `const brr = Uint8Array.from(${JSON.stringify(Array.from(createNoiseCarrier()))});`,
    'const sample = await snes.loadBRR(brr, {rootNote:60, basePitch:4096, loopStartSamples:0});');
  else lines.push(`const brr = Uint8Array.from(${JSON.stringify(Array.from(decodeBase64(p.brr.data)))});`,
    `const sample = await snes.loadBRR(brr, ${JSON.stringify({rootNote:p.brr.rootNote,basePitch:p.brr.basePitch,...(p.brr.loopStartSamples===null?{}:{loopStartSamples:p.brr.loopStartSamples})})});`);
  lines.push(`snes.writeDsp(0x3d, ${p.source==='noise'?1:0}); // NON: only the audition voice uses Noise.`);
  if(p.source==='noise') lines.push('const noiseFlags = await snes.readDsp(0x6c);',
    `snes.writeDsp(0x6c, (noiseFlags & 0xe0) | ${p.noise.clock}); // Preserve Echo, mute and reset flags.`);
  lines.push(`snes.setPreset(0, {sample, adsr1:${env.adsr1}, adsr2:${env.adsr2}, gain:${env.gain}, volumeLeft:${p.volume.left}, volumeRight:${p.volume.right}});`,
    "snes.noteOn(0, 'C4');",'// snes.noteOff(0); // Fixed hardware KOFF release; no authored release-time knob.');
  return lines.join('\n');
}
