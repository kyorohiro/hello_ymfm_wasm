// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {sidWaveformBits as waveformBits,sidWaveformFromBits as waveformFromBits} from '../js/sid_waveforms.js?sid-waves=1';

export {waveformBits,waveformFromBits};

/** @typedef {'off'|'lowpass'|'bandpass'|'lowpass+bandpass'|'highpass'|'notch'|'bandpass+highpass'|'lowpass+bandpass+highpass'} SidPresetFilterMode */
/** @typedef {'off'|'triangle'|'saw'|'triangle+saw'|'pulse'|'triangle+pulse'|'saw+pulse'|'triangle+saw+pulse'|'noise'|'triangle+noise'|'saw+noise'|'triangle+saw+noise'|'pulse+noise'|'triangle+pulse+noise'|'saw+pulse+noise'|'triangle+saw+pulse+noise'} SidPresetWaveform */
/** @typedef {{format:'tetorica-sid-voice',version:2,model:'6581'|'8580',name:string,
 * voice:{waveform:SidPresetWaveform,pulseWidth:number,attack:number,decay:number,sustain:number,release:number,test:boolean},
 * modulation:{sync:boolean,ring:boolean,ratio:number},
 * filter:{enabled:boolean,mode:SidPresetFilterMode,cutoff:number,resonance:number,volume:number}}} SidPreset */

// Index equals the SID's LP/BP/HP output mask. Keep the original "notch"
// spelling for LP + HP so existing v1 presets round-trip unchanged.
const filterModes=Object.freeze(['off','lowpass','bandpass','lowpass+bandpass','highpass','notch','bandpass+highpass','lowpass+bandpass+highpass']);

const own=(value,keys,label)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![null,Object.prototype].includes(Object.getPrototypeOf(value)))throw new TypeError(`${label}: expected a plain object`);
  const actual=Reflect.ownKeys(value);
  if(actual.length!==keys.length||actual.some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))throw new TypeError(`${label}: unexpected or missing property`);
  if(Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor=>!Object.hasOwn(descriptor,'value')))throw new TypeError(`${label}: accessors are not preset data`);
};
const integer=(value,max,label)=>{
  if(!Number.isInteger(value)||value<0||value>max)throw new RangeError(`${label}: expected an integer 0–${max}`);return value;
};
const boolean=(value,label)=>{if(typeof value!=='boolean')throw new TypeError(`${label}: expected a boolean`);return value;};
const choice=(value,choices,label)=>{if(!choices.includes(value))throw new RangeError(`${label}: expected ${choices.join(' / ')}`);return value;};

/** @param {unknown} mode @returns {number} Hardware LP/BP/HP mask, 0..7. */
export function filterModeBits(mode){return filterModes.indexOf(choice(mode,filterModes,'SID filter mode'));}
/** @param {number} bits @returns {SidPresetFilterMode} */
export function filterModeFromBits(bits){return /** @type {SidPresetFilterMode} */ (filterModes[integer(bits,7,'SID filter output mask')]);}

/** Portable authoring data only. Allocation and the modulator ratio are software
 * features; waveforms, ADSR, Sync/Ring, TEST and the shared filter are hardware.
 * @returns {SidPreset} */
export function createDefaultPreset({model='6581'}={}){
  choice(model,['6581','8580'],'SID model');
  return {format:'tetorica-sid-voice',version:2,model,name:'Saw',
    voice:{waveform:'saw',pulseWidth:2048,attack:2,decay:6,sustain:12,release:5,test:false},
    modulation:{sync:false,ring:false,ratio:1},
    filter:{enabled:false,mode:'lowpass',cutoff:600,resonance:4,volume:8}};
}

/** Validate everything before touching an instrument and return a detached copy.
 * @param {unknown} value @returns {SidPreset} */
export function readPreset(value){
  if(typeof value==='string'){
    try{value=JSON.parse(value);}catch{throw new TypeError('Invalid SID preset JSON');}
  }
  // Read descriptors before branching so a version getter cannot execute.
  if(!value||typeof value!=='object'||!Object.hasOwn(value,'version'))throw new TypeError('Unsupported SID preset format/version');
  const version=Object.getOwnPropertyDescriptor(value,'version');
  if(!Object.hasOwn(version,'value'))throw new TypeError('SID preset: accessors are not preset data');
  own(value,version.value===1?['format','version','name','voice','modulation','filter']:['format','version','model','name','voice','modulation','filter'],'SID preset');
  if(value.format!=='tetorica-sid-voice'||![1,2].includes(value.version))throw new TypeError('Unsupported SID preset format/version');
  const model=value.version===1?'6581':choice(value.model,['6581','8580'],'SID model');
  if(typeof value.name!=='string'||value.name.length>80||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value.name))throw new TypeError('SID name must be at most 80 characters without control characters');
  own(value.voice,['waveform','pulseWidth','attack','decay','sustain','release','test'],'SID voice');
  own(value.modulation,['sync','ring','ratio'],'SID modulation');
  own(value.filter,['enabled','mode','cutoff','resonance','volume'],'SID filter');
  const ratio=value.modulation.ratio;
  if(!Number.isFinite(ratio)||ratio<.125||ratio>8)throw new RangeError('Software modulator ratio must be .125–8');
  const filterMode=filterModeFromBits(filterModeBits(value.filter.mode));
  const filterEnabled=boolean(value.filter.enabled,'SID filter enabled');
  return {format:'tetorica-sid-voice',version:2,model,name:value.name.trim(),
    voice:{waveform:waveformFromBits(waveformBits(value.voice.waveform)),
      pulseWidth:integer(value.voice.pulseWidth,4095,'SID pulse width'),attack:integer(value.voice.attack,15,'SID attack'),
      decay:integer(value.voice.decay,15,'SID decay'),sustain:integer(value.voice.sustain,15,'SID sustain'),release:integer(value.voice.release,15,'SID release'),test:boolean(value.voice.test,'SID TEST')},
    modulation:{sync:boolean(value.modulation.sync,'SID Sync'),ring:boolean(value.modulation.ring,'SID Ring'),ratio},
    // The keyboard Synth bypasses when all outputs are off. Raw SidSynth
    // register routing remains available for the hardware's silent case.
    filter:{enabled:filterEnabled&&filterMode!=='off',mode:filterMode,
      cutoff:integer(value.filter.cutoff,2047,'SID cutoff'),resonance:integer(value.filter.resonance,15,'SID resonance'),volume:integer(value.filter.volume,15,'SID chip volume')}};
}

/** C64 Playground setup: 6581 uses its primary `sid`; 8580 creates a separate
 * instance. This auditions C4 without installing the Synth's keyboard allocator.
 * @param {unknown} value @returns {string} */
export function presetToCode(value){
  const preset=readPreset(value),pair=preset.modulation.sync||preset.modulation.ring,target=preset.model==='8580'?'sid8580':'sid';
  const lines=[preset.model==='8580'?'// Select Mode: C64 in Playground; this creates a separate 8580 Preview instance.':'// Select Mode: C64 (SID 6581) in Playground, then Run.',`// ${preset.name||'Untitled SID voice'}`,
    '// Hardware: three oscillators, ADSR and one shared filter; PAL 985248 Hz.',
    '// Software: Synth keyboard round robin and pitch-wheel allocation are not installed by this snippet.',
    '// The core also has its documented 12 Hz software output DC blocker.'];
  if(preset.model==='8580')lines.push("const sid8580 = await createSoundChip('sid', {id:'sid:8580-voice', model:'8580'});");
  lines.push(`${target}.initialize();`);
  for(let channel=0;channel<3;channel++){
    const source=pair&&channel===2,voice=source
      ?{waveform:'triangle',pulseWidth:2048,attack:0,decay:0,sustain:0,release:0,test:false,sync:false,ring:false}
      :{...preset.voice,sync:pair&&channel===0&&preset.modulation.sync,ring:pair&&channel===0&&preset.modulation.ring};
    lines.push(`${target}.setVoice(${channel}, ${JSON.stringify(voice)});`);
  }
  lines.push(`${target}.setFilter(${JSON.stringify({mode:preset.filter.enabled?preset.filter.mode:'off',cutoff:preset.filter.cutoff,
    resonance:preset.filter.resonance,routing:preset.filter.enabled?(pair?1:7):0,volume:preset.filter.volume,voice3off:pair})});`);
  if(pair){
    lines.push('// Hardware connection: oscillator 3 -> carrier 1. Ring affects Triangle only.',
      '// Software tuning ratio; the fixed Triangle modulator has Gate OFF and is not routed to the filter.',
      'const carrierHz = 440 * 2 ** ((60 - 69) / 12);',
      `${target}.setFrequency(0, carrierHz);`,`${target}.setFrequency(2, carrierHz * ${preset.modulation.ratio});`,
      `${target}.keyOn(0);`);
  }else lines.push(`${target}.noteOn(0, 'C4');`);
  lines.push(`// Release with ${target}.keyOff(0); hardware release continues. Playground Stop clears tails.`);
  return lines.join('\n');
}
