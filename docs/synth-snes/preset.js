// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {prepareSnesBRR} from '../js/snessynth.js';
import {decodeBase64} from './sample.js';

const FORMAT='tetorica-sdsp-voice';
export const ECHO_BRR_MAX_BYTES=33786;
export const PMON_MODULATOR_BYTES=72;
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
const defaultEnvelope=()=>({mode:'adsr',attack:15,decay:2,sustainLevel:7,sustainRate:0,
  gainMode:'direct',gainLevel:96,gainRate:16});
const defaultBrr=()=>({name:'',data:'',rootNote:60,basePitch:4096,loopStartSamples:null});
export function createDefaultPmon() {
  return {enabled:false,source:'wave',ratio:1,wave:waveShape('sine'),brr:defaultBrr(),envelope:{...defaultEnvelope(),mode:'gain',gainLevel:64}};
}
export const pmonActive=p=>p.source!=='noise'&&p.pmon.enabled;
export const pmonSampleBytes=p=>!pmonActive(p)?0:p.pmon.source==='brr'?decodeBase64(p.pmon.brr.data).length:PMON_MODULATOR_BYTES;
export const sampleBudget=p=>(p.echo.enabled?ECHO_BRR_MAX_BYTES:64512)-pmonSampleBytes(p);
/** Only changes that replace the physical RAM bank or voice allocation. */
export function presetBankKey(p) {
  const active=pmonActive(p);
  return JSON.stringify([p.source,p.echo.enabled,active,
    p.source==='wave'?p.wave:p.source==='brr'?[p.brr.data,p.brr.loopStartSamples]:null,
    active?[p.pmon.source,p.pmon.source==='brr'?[p.pmon.brr.data,p.pmon.brr.loopStartSamples]:p.pmon.wave]:null]);
}
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
  return {format:FORMAT,version:5,name:'Sine',source:'wave',wave:waveShape('sine'),
    brr:defaultBrr(),
    volume:{left:16,right:16},
    envelope:defaultEnvelope(),echo:createDefaultEcho(),noise:createDefaultNoise(),pmon:createDefaultPmon()};
}

function readWave(value,label='Wave') {
  if(!Array.isArray(value)||value.length!==128||Reflect.ownKeys(value).length!==129) throw new RangeError(`${label} requires exactly 128 normalized samples`);
  return Array.from(value,sample=>number(sample,-1,1,`${label} sample`,false));
}
function readEnvelope(value,label='Hardware envelope') {
  object(value,['mode','attack','decay','sustainLevel','sustainRate','gainMode','gainLevel','gainRate'],label);
  if(!['adsr','gain'].includes(value.mode)) throw new RangeError(`${label}: expected ADSR or GAIN`);
  if(!GAIN_MODES.includes(value.gainMode)) throw new RangeError('Unknown GAIN mode');
  return {mode:value.mode,attack:number(value.attack,0,15,'Attack'),decay:number(value.decay,0,7,'Decay'),
    sustainLevel:number(value.sustainLevel,0,7,'Sustain level'),sustainRate:number(value.sustainRate,0,31,'Sustain rate'),
    gainMode:value.gainMode,gainLevel:number(value.gainLevel,0,127,'Direct GAIN level'),gainRate:number(value.gainRate,0,31,'GAIN rate')};
}
function readBrr(value,label='BRR sample') {
  object(value,['name','data','rootNote','basePitch','loopStartSamples'],label);
  const brr={name:name(value.name,120,`${label} name`),data:value.data,
    rootNote:number(value.rootNote,0,127,`${label} root note`),basePitch:number(value.basePitch,1,16383,`${label} base PITCH`),
    loopStartSamples:value.loopStartSamples===null?null:number(value.loopStartSamples,0,114672,`${label} loop sample`)};
  if(brr.loopStartSamples!==null&&brr.loopStartSamples%16) throw new RangeError('BRR loop must begin at a 16-sample boundary');
  const bytes=decodeBase64(brr.data);
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
  return brr;
}
function readPmon(value,version) {
  object(value,['enabled','ratio','wave','envelope',...(version===5?['source','brr']:[])],'S-DSP PMON');
  const source=version===5?value.source:'wave';
  if(!['wave','brr'].includes(source))throw new RangeError('PMON source: expected Wave or BRR');
  return {enabled:boolean(value.enabled,'Enable PMON'),source,ratio:number(value.ratio,.125,8,'PMON ratio',false),
    wave:readWave(value.wave,'PMON wave'),brr:version===5?readBrr(value.brr,'PMON BRR sample'):defaultBrr(),envelope:readEnvelope(value.envelope,'PMON envelope')};
}

/** Validate and detach the portable instrument before touching RAM or voices. */
export function readPreset(value) {
  object(value,['format','version','name','source','wave','brr','volume','envelope',...([2,3,4,5].includes(value?.version)?['echo']:[]),...([3,4,5].includes(value?.version)?['noise']:[]),...([4,5].includes(value?.version)?['pmon']:[])],'S-DSP preset');
  if(value.format!==FORMAT||![1,2,3,4,5].includes(value.version)) throw new TypeError('Unsupported S-DSP preset format/version');
  const echo=value.version===1?createDefaultEcho():readEcho(value.echo);
  const noise=value.version>=3?readNoise(value.noise):createDefaultNoise();
  const pmon=value.version>=4?readPmon(value.pmon,value.version):createDefaultPmon();
  if(!['wave','brr','noise'].includes(value.source)||value.source==='noise'&&value.version<3) throw new RangeError('Expected Wave, BRR or v3 Noise source');
  const wave=readWave(value.wave),brr=readBrr(value.brr);
  const layout={source:value.source,pmon,echo},budget=sampleBudget(layout);
  const carrierBytes=value.source==='brr'?decodeBase64(brr.data).length:value.source==='wave'?72:9;
  if(carrierBytes>budget) {
    if(!pmonActive(layout)&&echo.enabled)throw new RangeError('Echo reserves 30 KiB of RAM: this instrument allows at most 33,786 BRR bytes with Echo enabled. Use a shorter sample or keep Echo off.');
    throw new RangeError(`PMON reserves ${pmonSampleBytes(layout).toLocaleString('en-US')} BRR bytes for its modulator${echo.enabled?' and Echo reserves 30 KiB':''}: the carrier sample allows at most ${Math.max(0,budget).toLocaleString('en-US')} BRR bytes. Use a shorter sample or disable PMON.`);
  }
  object(value.volume,['left','right'],'Voice volume');
  const envelope=readEnvelope(value.envelope);
  return {format:FORMAT,version:5,name:name(value.name,80,'Instrument name'),source:value.source,wave,brr,
    volume:{left:number(value.volume.left,-128,127,'Left voice volume'),right:number(value.volume.right,-128,127,'Right voice volume')},
    envelope,echo,noise,pmon};
}

/** Hardware register codes. KOFF uses the chip's fixed release in every mode. */
export function envelopeRegisters(value) {
  return registers(readPreset(value).envelope);
}
export function modulatorEnvelopeRegisters(value) {
  return registers(readPreset(value).pmon.envelope);
}
function registers(e) {
  return {adsr1:(e.mode==='adsr'?128:0)|(e.decay<<4)|e.attack,adsr2:(e.sustainLevel<<5)|e.sustainRate,
    gain:e.gainMode==='direct'?e.gainLevel:([0x80,0xa0,0xc0,0xe0][GAIN_MODES.indexOf(e.gainMode)-1]|e.gainRate)};
}

/** Editable Playground setup. BRR tuning is declared; no original note is guessed. */
export function presetToCode(value) {
  const p=readPreset(value),env=envelopeRegisters(p),active=pmonActive(p);
  if(p.source==='brr'&&!p.brr.data)throw new Error('Load a BRR or audio sample before copying a BRR audition');
  if(active&&p.pmon.source==='brr'&&!p.pmon.brr.data)throw new Error('Load a PMON modulator BRR sample before copying a PMON audition');
  const lines=['// Select SNES in Playground. Run in a fresh context for a fresh BRR bank.',
    `// ${p.name||'Untitled S-DSP voice'}`,"const snes = await useSoundChip('snes');",'snes.allNotesOff();',
    `await snes.setEcho(${JSON.stringify({...echoOptions(p.echo),...(active?{sendMask:p.echo.send?2:0}:{})})}); // Reserve Echo RAM before loading BRR.`];
  if(p.source==='wave') lines.push(`const pcm = Float32Array.from(${JSON.stringify(p.wave)});`,
    'const encoded = pg.encodeBrr(pcm, {loopStartSamples:0});',
    'const sample = await snes.loadBRR(encoded.brr, {baseFrequencyHz:32000 / 128, loopStartSamples:0});');
  else if(p.source==='noise') lines.push('// Noise uses one shared hardware generator; note names only trigger its envelope.',
    `const brr = Uint8Array.from(${JSON.stringify(Array.from(createNoiseCarrier()))});`,
    'const sample = await snes.loadBRR(brr, {rootNote:60, basePitch:4096, loopStartSamples:0});');
  else lines.push(`const brr = Uint8Array.from(${JSON.stringify(Array.from(decodeBase64(p.brr.data)))});`,
    `const sample = await snes.loadBRR(brr, ${JSON.stringify({rootNote:p.brr.rootNote,basePitch:p.brr.basePitch,...(p.brr.loopStartSamples===null?{}:{loopStartSamples:p.brr.loopStartSamples})})});`);
  lines.push(`snes.writeDsp(0x3d, ${p.source==='noise'?1:0}); // NON: only the audition voice uses Noise.`);
  lines.push(`snes.writeDsp(0x2d, ${active?2:0}); // PMON: adjacent voice 0 modulates voice 1.`);
  if(p.source==='noise') lines.push('const noiseFlags = await snes.readDsp(0x6c);',
    `snes.writeDsp(0x6c, (noiseFlags & 0xe0) | ${p.noise.clock}); // Preserve Echo, mute and reset flags.`);
  if(active) {
    const mod=modulatorEnvelopeRegisters(p),base=p.pmon.source==='brr'?p.pmon.brr.basePitch*2**((60-p.pmon.brr.rootNote)/12):4096*(440*2**((60-69)/12))/250;
    const pitch=Math.max(1,Math.min(16383,Math.round(base*p.pmon.ratio)));
    lines.push('// PMON is hardware adjacent-voice modulation. Wave encoding, ratio and pair allocation are software authoring.');
    if(p.pmon.source==='wave')lines.push(`const modPcm = Float32Array.from(${JSON.stringify(p.pmon.wave)});`,
      'const modBrr = pg.encodeBrr(modPcm, {loopStartSamples:0});',
      'const modSample = await snes.loadBRR(modBrr.brr, {baseFrequencyHz:250, loopStartSamples:0});');
    else lines.push(`const modBrr = Uint8Array.from(${JSON.stringify(Array.from(decodeBase64(p.pmon.brr.data)))});`,
      `const modSample = await snes.loadBRR(modBrr, ${JSON.stringify({rootNote:p.pmon.brr.rootNote,basePitch:p.pmon.brr.basePitch,...(p.pmon.brr.loopStartSamples===null?{}:{loopStartSamples:p.pmon.brr.loopStartSamples})})});`);
    lines.push(
      `snes.setPreset(0, {sample:modSample, adsr1:${mod.adsr1}, adsr2:${mod.adsr2}, gain:${mod.gain}, volumeLeft:0, volumeRight:0, pitch:${pitch}});`,
      `snes.setPreset(1, {sample, adsr1:${env.adsr1}, adsr2:${env.adsr2}, gain:${env.gain}, volumeLeft:${p.volume.left}, volumeRight:${p.volume.right}});`,
      'snes.keyOn(0);',"snes.noteOn(1, 'C4');",
      '// snes.noteOff(0); snes.noteOff(1); // Release both voices together.');
  }else lines.push(`snes.setPreset(0, {sample, adsr1:${env.adsr1}, adsr2:${env.adsr2}, gain:${env.gain}, volumeLeft:${p.volume.left}, volumeRight:${p.volume.right}});`,
    "snes.noteOn(0, 'C4');",'// snes.noteOff(0); // Fixed hardware KOFF release; no authored release-time knob.');
  return lines.join('\n');
}
