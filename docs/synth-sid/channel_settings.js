// SPDX-License-Identifier: BSD-3-Clause
// Three preserved voice patches, one hardware model/filter and one keyboard target.
import {createDefaultPreset,readPreset,presetToCode,waveformBits,waveformFromBits} from './preset.js?sid-waves=1';

/** @typedef {'round-robin'|0|1|2} SidChannelTarget */
/** @typedef {'retrigger'|'legato'} SidKeyboardMode */
/** @typedef {{format:'tetorica-sid-channels',version:2,target:SidChannelTarget,keyboardMode:SidKeyboardMode,
 * channels:[import('./preset.js').SidPreset,import('./preset.js').SidPreset,import('./preset.js').SidPreset]}} SidChannelSettings */

export const CHANNEL_SETTINGS_MAX_BYTES=64*1024;
const targets=['round-robin',0,1,2];
const target=value=>{
  if(!targets.includes(value))throw new RangeError('SID channel target must be round-robin, 0, 1 or 2');
  return value;
};
const keyboardMode=value=>{
  if(!['retrigger','legato'].includes(value))throw new RangeError('SID keyboard mode must be retrigger or legato');
  return value;
};
const own=(value,keys,label)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![null,Object.prototype].includes(Object.getPrototypeOf(value)))throw new TypeError(`${label}: expected a plain object`);
  const actual=Reflect.ownKeys(value);
  if(actual.length!==keys.length||actual.some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(value,key)))throw new TypeError(`${label}: unexpected or missing property`);
  if(Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor=>!Object.hasOwn(descriptor,'value')))throw new TypeError(`${label}: accessors are not channel data`);
};
const copies=preset=>[readPreset(preset),readPreset(preset),readPreset(preset)];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const selected=settings=>settings.channels[settings.target==='round-robin'?0:settings.target];
const bank=(choice,channels,mode='retrigger')=>({format:'tetorica-sid-channels',version:2,target:choice,keyboardMode:mode,channels});

// AudioWorklet does not need TextEncoder to validate an imported JSON string.
function boundedJson(value){
  if(value.length>CHANNEL_SETTINGS_MAX_BYTES)throw new RangeError('SID channel settings exceed 64 KiB');
  let bytes=0;
  for(const character of value){
    const point=character.codePointAt(0);bytes+=point<=0x7f?1:point<=0x7ff?2:point<=0xffff?3:4;
    if(bytes>CHANNEL_SETTINGS_MAX_BYTES)throw new RangeError('SID channel settings exceed 64 KiB');
  }
  try{return JSON.parse(value);}catch{throw new TypeError('Invalid SID channel settings JSON');}
}

/** Start with the existing portable voice on all three physical channels.
 * @param {unknown} [preset] @returns {SidChannelSettings} */
export function createChannelSettings(preset=createDefaultPreset()){
  return bank('round-robin',copies(readPreset(preset)));
}

/** Validate before touching audio and return detached, canonical channel data.
 * Model and filter are shared hardware controls, including dormant filter values.
 * Selecting round robin preserves all three patches. Parameter edits may be
 * broadcast separately from an explicit complete voice replacement.
 * @param {unknown} value @returns {SidChannelSettings} */
export function readChannelSettings(value){
  if(typeof value==='string')value=boundedJson(value);
  // Inspect the schema version without invoking an untrusted accessor.
  const legacy=value&&typeof value==='object'&&Object.getOwnPropertyDescriptor(value,'version')?.value===1;
  own(value,legacy?['format','version','target','channels']:['format','version','target','keyboardMode','channels'],'SID channel settings');
  if(value.format!=='tetorica-sid-channels'||![1,2].includes(value.version))throw new TypeError('Unsupported SID channel settings format/version');
  const choice=target(value.target),mode=legacy?'retrigger':keyboardMode(value.keyboardMode),input=value.channels;
  if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype||input.length!==3)throw new TypeError('SID channel settings require exactly three voice presets in a plain array');
  const keys=Reflect.ownKeys(input);
  if(keys.length!==4||keys.some(key=>!['0','1','2','length'].includes(key))||[0,1,2].some(index=>!Object.hasOwn(input,index)))throw new TypeError('SID channel presets must be a dense array without extra properties');
  if(Object.values(Object.getOwnPropertyDescriptors(input)).some(descriptor=>!Object.hasOwn(descriptor,'value')))throw new TypeError('SID channel presets: accessors are not channel data');
  const channels=input.map(item=>{
    const preset=readPreset(item);
    if(item.version!==2)throw new TypeError('SID channel settings require portable voice preset version 2');
    return preset;
  });
  if(channels.some(preset=>preset.model!==channels[0].model||!equal(preset.filter,channels[0].filter)))throw new RangeError('SID channels share one model and one filter');
  return bank(choice,channels,mode);
}

/** @param {unknown} settings @returns {import('./preset.js').SidPreset} */
export function selectedChannelPreset(settings){return readPreset(selected(readChannelSettings(settings)));}

/** Selecting an edit/play target never overwrites any saved channel patch.
 * @param {unknown} settings @param {SidChannelTarget} choice @returns {SidChannelSettings} */
export function selectChannelTarget(settings,choice){
  const current=readChannelSettings(settings);target(choice);
  return bank(choice,current.channels,current.keyboardMode);
}

/** Choose a software keyboard policy without replacing any sound settings.
 * The choice is retained in round robin, where it is inactive.
 * @param {unknown} settings @param {SidKeyboardMode} mode @returns {SidChannelSettings} */
export function selectKeyboardMode(settings,mode){
  const current=readChannelSettings(settings);
  return bank(current.target,current.channels,keyboardMode(mode));
}

/** Replace the selected voice, sharing model/filter with the other channels.
 * A complete voice load/import in round robin replaces all three patches.
 * @param {unknown} settings @param {unknown} value @returns {SidChannelSettings} */
export function applyChannelPreset(settings,value){
  const current=readChannelSettings(settings),preset=readPreset(value);
  if(current.target==='round-robin')return bank(current.target,copies(preset),current.keyboardMode);
  return bank(current.target,current.channels.map((previous,index)=>readPreset(index===current.target?preset:{...previous,model:preset.model,filter:preset.filter})),current.keyboardMode);
}

/** Apply an editor's full value while broadcasting only fields that changed.
 * Round robin displays CH 1 as its editing baseline; changing its Attack, for
 * example, leaves the other channels' waveforms and remaining ADSR untouched.
 * Explicit file loads/imports use applyChannelPreset instead.
 * @param {unknown} settings @param {unknown} value @returns {SidChannelSettings} */
export function editChannelPreset(settings,value){
  const current=readChannelSettings(settings),next=readPreset(value);
  if(current.target!=='round-robin')return applyChannelPreset(current,next);
  const baseline=selected(current),changed=(before,after)=>Object.fromEntries(Object.entries(after).filter(([key,value])=>before[key]!==value));
  const voice=changed(baseline.voice,next.voice),modulation=changed(baseline.modulation,next.modulation);
  const nextWaves=waveformBits(next.voice.waveform),changedWaves=waveformBits(baseline.voice.waveform)^nextWaves;
  delete voice.waveform;
  return bank(current.target,current.channels.map(previous=>readPreset({
    ...previous,model:next.model,filter:next.filter,name:baseline.name!==next.name?next.name:previous.name,
    voice:{...previous.voice,...voice,waveform:waveformFromBits((waveformBits(previous.voice.waveform)&~changedWaves)|(nextWaves&changedWaves))},modulation:{...previous.modulation,...modulation},
  })),current.keyboardMode);
}

/** Resolve the software allocator without rewriting channel authoring data.
 * Independent round-robin voices use all three channels. Sync/Ring retains
 * the Synth's one-pair limit and uses the first configured pair as carrier.
 * Other saved pairs remain available when their fixed channel is selected.
 * @param {unknown} settings @returns {{channels:number[],carrier:number,source:number|null}} */
export function channelPlaybackPlan(settings){
  const current=readChannelSettings(settings),paired=preset=>preset.modulation.sync||preset.modulation.ring;
  const pairChannel=current.channels.findIndex(paired);
  const carrier=current.target==='round-robin'?Math.max(0,pairChannel):current.target;
  const source=paired(current.channels[carrier])?(carrier+2)%3:null;
  return {channels:current.target==='round-robin'&&source===null?[0,1,2]:[carrier],carrier,source};
}

/** Readable low-level Playground setup. It auditions C4 on the selected physical
 * channel, with the physical preceding source for Sync/Ring. Uniform round-
 * robin code retains the existing single-voice export byte for byte.
 * @param {unknown} settings @returns {string} */
export function channelSettingsToCode(settings){
  const current=readChannelSettings(settings);
  if(current.target==='round-robin'&&current.channels.every(preset=>equal(preset,current.channels[0])))return presetToCode(current.channels[0]);
  const {channels,carrier,source}=channelPlaybackPlan(current),preset=current.channels[carrier],paired=source!==null;
  const chip=preset.model==='8580'?'sid8580':'sid';
  const lines=[preset.model==='8580'?'// Select Mode: C64 in Playground; this creates a separate 8580 Preview instance.':'// Select Mode: C64 (SID 6581) in Playground, then Run.',
    `// ${preset.name||'Untitled SID voice'} · CH ${carrier+1}`,
    '// Hardware: three oscillators, ADSR and one shared filter; PAL 985248 Hz.',
    current.target==='round-robin'?'// Software: round robin retains each stored channel sound; this snippet auditions C4 once.':'// Software: fixed keyboard channel selection; this snippet auditions C4 once.',
    '// The core also has its documented 12 Hz software output DC blocker.'];
  if(preset.model==='8580')lines.push("const sid8580 = await createSoundChip('sid', {id:'sid:8580-voice', model:'8580'});");
  if(current.target!=='round-robin'&&current.keyboardMode==='legato')lines.push('// Software keyboard mode: Legato keeps Gate on while keys overlap. This one-note snippet starts a new Gate.');
  if(current.target==='round-robin'&&paired)lines.push(`// Sync/Ring keeps the one-pair limit: CH ${carrier+1} is the first configured carrier. Other saved pairs are inactive.`);
  lines.push(`${chip}.initialize();`);
  for(let channel=0;channel<3;channel++){
    const voice=paired&&channel===source
      ?{waveform:'triangle',pulseWidth:2048,attack:0,decay:0,sustain:0,release:0,test:false,sync:false,ring:false}
      :{...current.channels[channel].voice,sync:channel===carrier&&preset.modulation.sync,ring:channel===carrier&&preset.modulation.ring};
    lines.push(`// Stored CH ${channel+1}: ${current.channels[channel].name||'Untitled SID voice'}`,
      `${chip}.setVoice(${channel}, ${JSON.stringify(voice)});`);
  }
  lines.push(`${chip}.setFilter(${JSON.stringify({mode:preset.filter.enabled?preset.filter.mode:'off',cutoff:preset.filter.cutoff,
    resonance:preset.filter.resonance,routing:preset.filter.enabled?channels.reduce((mask,channel)=>mask|1<<channel,0):0,volume:preset.filter.volume,voice3off:paired&&source===2})});`);
  if(paired){
    lines.push(`// Hardware connection: oscillator ${source+1} -> carrier ${carrier+1}. Ring affects Triangle only.`,
      '// Software tuning ratio; the Triangle source has Gate OFF, zero ADSR and no filter route.',
      'const carrierHz = 440 * 2 ** ((60 - 69) / 12);',
      `${chip}.setFrequency(${carrier}, carrierHz);`,`${chip}.setFrequency(${source}, carrierHz * ${preset.modulation.ratio});`,
      `${chip}.keyOn(${carrier});`);
  }else lines.push(`${chip}.noteOn(${carrier}, 'C4');`);
  lines.push(`// Release with ${chip}.keyOff(${carrier}); hardware release continues. Playground Stop clears tails.`);
  return lines.join('\n');
}
