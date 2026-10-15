import {createInitVoice,packVoice} from './sysex.js';

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const OP_RANGES={rateScaling:7,ampModSensitivity:3,velocitySensitivity:7,outputLevel:99,coarse:31,fine:99,detune:14};
const OP_OFFSETS={rateScaling:13,ampModSensitivity:14,velocitySensitivity:15,outputLevel:16,coarse:18,fine:19,detune:20};
const SCALE_RANGES={breakpoint:99,leftDepth:99,rightDepth:99,leftCurve:3,rightCurve:3};
const SCALE_OFFSETS={breakpoint:8,leftDepth:9,rightDepth:10,leftCurve:11,rightCurve:12};
const LFO_RANGES={speed:99,delay:99,pitchModDepth:99,ampModDepth:99,waveform:5,pitchModSensitivity:7};
const LFO_OFFSETS={speed:137,delay:138,pitchModDepth:139,ampModDepth:140,waveform:142,pitchModSensitivity:143};

function integer(value,minimum,maximum,name) {
  if(!Number.isInteger(value)||value<minimum||value>maximum)throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}.`);
}
function boolean(value,name) {
  if(typeof value!=='boolean')throw new TypeError(`${name} must be a boolean.`);
}
function object(value,keys,name) {
  if(!value||typeof value!=='object'||Array.isArray(value)||ArrayBuffer.isView(value)||value instanceof ArrayBuffer||Object.prototype.toString.call(value)!=='[object Object]')throw new TypeError(`${name} must be an object.`);
  for(const key of Reflect.ownKeys(value)){
    if(typeof key!=='string'||!keys.includes(key))throw new TypeError(`Unknown ${name} field: ${String(key)}.`);
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(descriptor.get||descriptor.set)throw new TypeError(`${name}.${key} must be a data property.`);
  }
}
function envelope(value,name) {
  object(value,['rates','levels'],name);
  for(const key of ['rates','levels'])if(own(value,key)){
    const tuple=value[key];
    if(!Array.isArray(tuple)||tuple.length!==4)throw new TypeError(`${name}.${key} must contain exactly four values.`);
    for(let index=0;index<4;index++)integer(tuple[index],0,99,`${name}.${key}[${index}]`);
  }
}
function operatorPatch(patch) {
  object(patch,['envelope','keyboardScaling','mode',...Object.keys(OP_RANGES)],'operator');
  if(own(patch,'envelope'))envelope(patch.envelope,'operator.envelope');
  if(own(patch,'keyboardScaling')){
    object(patch.keyboardScaling,Object.keys(SCALE_RANGES),'keyboardScaling');
    for(const [key,max] of Object.entries(SCALE_RANGES))if(own(patch.keyboardScaling,key))integer(patch.keyboardScaling[key],0,max,`keyboardScaling.${key}`);
  }
  if(own(patch,'mode')&&patch.mode!=='ratio'&&patch.mode!=='fixed')throw new TypeError('operator.mode must be ratio or fixed.');
  for(const [key,max] of Object.entries(OP_RANGES))if(own(patch,key))integer(patch[key],0,max,`operator.${key}`);
}

/** Pure validation for partial preset input. Unknown/accessor fields are rejected.
 * @param {import('./preset.js').DX7Preset} preset */
export function validatePreset(preset) {
  object(preset,['name','algorithm','feedback','oscillatorSync','pitchEnvelope','lfo','transpose','operators'],'preset');
  if(own(preset,'name')&&(typeof preset.name!=='string'||preset.name.length>10||/[^\x20-\x7e]/.test(preset.name)))throw new TypeError('Preset name must contain at most ten printable ASCII characters.');
  for(const [key,max] of [['algorithm',31],['feedback',7],['transpose',48]])if(own(preset,key))integer(preset[key],0,max,`preset.${key}`);
  if(own(preset,'oscillatorSync'))boolean(preset.oscillatorSync,'preset.oscillatorSync');
  if(own(preset,'pitchEnvelope'))envelope(preset.pitchEnvelope,'pitchEnvelope');
  if(own(preset,'lfo')){
    object(preset.lfo,[...Object.keys(LFO_RANGES),'sync'],'lfo');
    for(const [key,max] of Object.entries(LFO_RANGES))if(own(preset.lfo,key))integer(preset.lfo[key],0,max,`lfo.${key}`);
    if(own(preset.lfo,'sync'))boolean(preset.lfo.sync,'lfo.sync');
  }
  if(own(preset,'operators')){
    object(preset.operators,['1','2','3','4','5','6'],'preset.operators');
    for(const key of Object.getOwnPropertyNames(preset.operators))validateOperator(Number(key),preset.operators[key]);
  }
}

/** Validate a public OP1..OP6 partial edit without changing its input.
 * @param {import('./preset.js').DX7Operator} operator
 * @param {import('./preset.js').DX7OperatorParams} patch */
export function validateOperator(operator,patch) {
  integer(operator,1,6,'Operator');operatorPatch(patch);
}

/** Validate the complete tuple batch before any operator is changed.
 * @param {import('./preset.js').DX7OperatorEntries} entries */
export function validateOperators(entries) {
  if(!Array.isArray(entries))throw new TypeError('Operator entries must be an array of [operator, patch] tuples.');
  const seen=new Set();
  for(const entry of entries){
    if(!Array.isArray(entry)||entry.length!==2)throw new TypeError('Each operator entry must be an [operator, patch] tuple.');
    validateOperator(entry[0],entry[1]);
    if(seen.has(entry[0]))throw new TypeError(`Duplicate operator entry: ${entry[0]}.`);
    seen.add(entry[0]);
  }
}

function voiceCopy(input) {
  let bytes;
  if(input instanceof ArrayBuffer)bytes=new Uint8Array(input.slice(0));
  else if(ArrayBuffer.isView(input))bytes=new Uint8Array(new Uint8Array(input.buffer,input.byteOffset,input.byteLength));
  else throw new TypeError('DX7 voice must be an ArrayBuffer or an ArrayBuffer view.');
  packVoice(bytes); // Validate the exact 155-byte layout and every raw range.
  return bytes;
}
function writeEnvelope(bytes,offset,patch) {
  if(own(patch,'rates'))bytes.set(patch.rates,offset);
  if(own(patch,'levels'))bytes.set(patch.levels,offset+4);
}
function writeOperator(bytes,operator,patch) {
  const offset=(6-operator)*21;
  if(own(patch,'envelope'))writeEnvelope(bytes,offset,patch.envelope);
  if(own(patch,'keyboardScaling'))for(const [key,index] of Object.entries(SCALE_OFFSETS))if(own(patch.keyboardScaling,key))bytes[offset+index]=patch.keyboardScaling[key];
  if(own(patch,'mode'))bytes[offset+17]=patch.mode==='fixed'?1:0;
  for(const [key,index] of Object.entries(OP_OFFSETS))if(own(patch,key))bytes[offset+index]=patch[key];
}

/** Apply a validated partial preset to a copied base, defaulting to INIT SINE.
 * No working bank or caller-owned bytes are modified.
 * @param {import('./preset.js').DX7Preset} preset
 * @param {import('./sysex.js').SysexBytes} [baseBytes]
 * @returns {Uint8Array} */
export function presetToVoice(preset,baseBytes=createInitVoice()) {
  validatePreset(preset);
  const bytes=voiceCopy(baseBytes);
  for(const [key,index] of [['algorithm',134],['feedback',135],['transpose',144]])if(own(preset,key))bytes[index]=preset[key];
  if(own(preset,'oscillatorSync'))bytes[136]=preset.oscillatorSync?1:0;
  if(own(preset,'pitchEnvelope'))writeEnvelope(bytes,126,preset.pitchEnvelope);
  if(own(preset,'lfo')){
    for(const [key,index] of Object.entries(LFO_OFFSETS))if(own(preset.lfo,key))bytes[index]=preset.lfo[key];
    if(own(preset.lfo,'sync'))bytes[141]=preset.lfo.sync?1:0;
  }
  if(own(preset,'operators'))for(const key of Object.getOwnPropertyNames(preset.operators))writeOperator(bytes,Number(key),preset.operators[key]);
  if(own(preset,'name')){
    bytes.fill(32,145);
    for(let index=0;index<preset.name.length;index++)bytes[145+index]=preset.name.charCodeAt(index);
  }
  return bytes;
}

/** Decode a voice into an independent, complete object in OP1..OP6 order.
 * Control characters in imported names are displayed as spaces.
 * @param {import('./sysex.js').SysexBytes} data
 * @returns {import('./preset.js').DX7PresetState} */
export function voiceToPreset(data) {
  const bytes=voiceCopy(data),operators={};
  for(let operator=1;operator<=6;operator++){
    const offset=(6-operator)*21;
    operators[operator]={
      envelope:{rates:Array.from(bytes.slice(offset,offset+4)),levels:Array.from(bytes.slice(offset+4,offset+8))},
      keyboardScaling:Object.fromEntries(Object.entries(SCALE_OFFSETS).map(([key,index])=>[key,bytes[offset+index]])),
      ...Object.fromEntries(Object.entries(OP_OFFSETS).map(([key,index])=>[key,bytes[offset+index]])),
      mode:bytes[offset+17]===0?'ratio':'fixed',
    };
  }
  let name='';
  for(let index=145;index<155;index++)name+=bytes[index]<32||bytes[index]===127?' ':String.fromCharCode(bytes[index]);
  return {
    name:name.trimEnd(),algorithm:bytes[134],feedback:bytes[135],oscillatorSync:bytes[136]===1,
    pitchEnvelope:{rates:Array.from(bytes.slice(126,130)),levels:Array.from(bytes.slice(130,134))},
    lfo:{...Object.fromEntries(Object.entries(LFO_OFFSETS).map(([key,index])=>[key,bytes[index]])),sync:bytes[141]===1},
    transpose:bytes[144],operators,
  };
}
