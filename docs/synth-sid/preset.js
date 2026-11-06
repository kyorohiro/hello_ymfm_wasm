// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

/** @typedef {{format:'tetorica-sid-voice',version:1,name:string,
 * voice:{waveform:'triangle'|'saw'|'pulse'|'noise',pulseWidth:number,attack:number,decay:number,sustain:number,release:number,test:boolean},
 * modulation:{sync:boolean,ring:boolean,ratio:number},
 * filter:{enabled:boolean,mode:'lowpass'|'bandpass'|'highpass'|'notch',cutoff:number,resonance:number,volume:number}}} SidPreset */

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

/** Portable authoring data only. Allocation and the modulator ratio are software
 * features; waveforms, ADSR, Sync/Ring, TEST and the shared filter are hardware.
 * @returns {SidPreset} */
export function createDefaultPreset(){
  return {format:'tetorica-sid-voice',version:1,name:'Saw',
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
  own(value,['format','version','name','voice','modulation','filter'],'SID preset');
  if(value.format!=='tetorica-sid-voice'||value.version!==1)throw new TypeError('Unsupported SID preset format/version');
  if(typeof value.name!=='string'||value.name.length>80||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value.name))throw new TypeError('SID name must be at most 80 characters without control characters');
  own(value.voice,['waveform','pulseWidth','attack','decay','sustain','release','test'],'SID voice');
  own(value.modulation,['sync','ring','ratio'],'SID modulation');
  own(value.filter,['enabled','mode','cutoff','resonance','volume'],'SID filter');
  const ratio=value.modulation.ratio;
  if(!Number.isFinite(ratio)||ratio<.125||ratio>8)throw new RangeError('Software modulator ratio must be .125–8');
  return {format:'tetorica-sid-voice',version:1,name:value.name.trim(),
    voice:{waveform:choice(value.voice.waveform,['triangle','saw','pulse','noise'],'SID waveform'),
      pulseWidth:integer(value.voice.pulseWidth,4095,'SID pulse width'),attack:integer(value.voice.attack,15,'SID attack'),
      decay:integer(value.voice.decay,15,'SID decay'),sustain:integer(value.voice.sustain,15,'SID sustain'),release:integer(value.voice.release,15,'SID release'),test:boolean(value.voice.test,'SID TEST')},
    modulation:{sync:boolean(value.modulation.sync,'SID Sync'),ring:boolean(value.modulation.ring,'SID Ring'),ratio},
    filter:{enabled:boolean(value.filter.enabled,'SID filter enabled'),mode:choice(value.filter.mode,['lowpass','bandpass','highpass','notch'],'SID filter mode'),
      cutoff:integer(value.filter.cutoff,2047,'SID cutoff'),resonance:integer(value.filter.resonance,15,'SID resonance'),volume:integer(value.filter.volume,15,'SID chip volume')}};
}

/** Self-contained setup for the existing C64 Playground's initialized `sid` API.
 * This auditions C4; it does not install the Synth's software keyboard allocator.
 * @param {unknown} value @returns {string} */
export function presetToCode(value){
  const preset=readPreset(value),pair=preset.modulation.sync||preset.modulation.ring;
  const lines=['// Select Mode: C64 (SID 6581) in Playground, then Run.',`// ${preset.name||'Untitled SID voice'}`,
    '// Hardware: three oscillators, ADSR and one shared filter; PAL 985248 Hz.',
    '// Software: Synth keyboard round robin and pitch-wheel allocation are not installed by this snippet.',
    '// The core also has its documented 12 Hz software output DC blocker.',
    'sid.initialize();'];
  for(let channel=0;channel<3;channel++){
    const source=pair&&channel===2,voice=source
      ?{waveform:'triangle',pulseWidth:2048,attack:0,decay:0,sustain:0,release:0,test:false,sync:false,ring:false}
      :{...preset.voice,sync:pair&&channel===0&&preset.modulation.sync,ring:pair&&channel===0&&preset.modulation.ring};
    lines.push(`sid.setVoice(${channel}, ${JSON.stringify(voice)});`);
  }
  lines.push(`sid.setFilter(${JSON.stringify({mode:preset.filter.enabled?preset.filter.mode:'off',cutoff:preset.filter.cutoff,
    resonance:preset.filter.resonance,routing:preset.filter.enabled?(pair?1:7):0,volume:preset.filter.volume,voice3off:pair})});`);
  if(pair){
    lines.push('// Hardware connection: oscillator 3 -> carrier 1. Ring affects Triangle only.',
      '// Software tuning ratio; the fixed Triangle modulator has Gate OFF and is not routed to the filter.',
      'const carrierHz = 440 * 2 ** ((60 - 69) / 12);',
      'sid.setFrequency(0, carrierHz);',`sid.setFrequency(2, carrierHz * ${preset.modulation.ratio});`,
      'sid.keyOn(0);');
  }else lines.push("sid.noteOn(0, 'C4');");
  lines.push('// Release with sid.keyOff(0); hardware release continues. Playground Stop clears tails.');
  return lines.join('\n');
}
