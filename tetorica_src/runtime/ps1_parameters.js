// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
// Reverb register tables: copyright pSXAuthor and R. Belmont, BSD-3-Clause.
// Adapted from MAME src/devices/sound/spu_tables.cpp at
// a64a5d6602b19f67e091a4491f0c851a9dacf79d. See third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/LICENSE.
/** Named controls for the retained experimental PS1 envelope and reverb core.
 * Rates are raw table indexes: zero is fastest; high indexes can stop a stage.
 * These are not durations in milliseconds or a hardware timing model.
 */
/** @typedef {{attackRate:number,attackExponential:boolean,decayRate:number,
 * sustainLevel:number,sustainRate:number,sustainDecrease:boolean,
 * sustainExponential:boolean,releaseRate:number,releaseExponential:boolean}} Ps1Envelope */
/** @typedef {'off'|'room'|'studio-small'|'studio-medium'|'studio-large'|'hall'|'space-echo'|'half-echo'} Ps1ReverbPreset */
/** @typedef {{preset:Ps1ReverbPreset,volumeLeft:number,volumeRight:number}} Ps1Reverb */
const integer=(value,min,max,name)=>{if(!Number.isSafeInteger(value)||value<min||value>max)throw new RangeError(`${name} must be an integer from ${min} to ${max}`);return value;};
const fields=Object.freeze({
  attackRate:{word:'adsr1',shift:8,mask:0x7f},attackExponential:{word:'adsr1',shift:15,boolean:true},
  decayRate:{word:'adsr1',shift:4,mask:0xf},sustainLevel:{word:'adsr1',shift:0,mask:0xf},
  sustainRate:{word:'adsr2',shift:6,mask:0x7f},sustainDecrease:{word:'adsr2',shift:14,boolean:true},
  sustainExponential:{word:'adsr2',shift:15,boolean:true},releaseRate:{word:'adsr2',shift:0,mask:0x1f},
  releaseExponential:{word:'adsr2',shift:5,boolean:true},
});
/** Decode named ADSR fields without interpreting them as exact durations.
 * @param {number} adsr1 @param {number} adsr2 @returns {Ps1Envelope} */
export function decodePs1Envelope(adsr1,adsr2){
  integer(adsr1,0,0xffff,'adsr1');integer(adsr2,0,0xffff,'adsr2');
  return {attackRate:(adsr1>>8)&127,attackExponential:!!(adsr1&0x8000),decayRate:(adsr1>>4)&15,sustainLevel:adsr1&15,
    sustainRate:(adsr2>>6)&127,sustainDecrease:!!(adsr2&0x4000),sustainExponential:!!(adsr2&0x8000),
    releaseRate:adsr2&31,releaseExponential:!!(adsr2&0x20)};
}
/** Merge a partial named envelope while retaining unedited raw bits, including
 * ADSR2 bit 13, which the experimental core does not interpret.
 * @param {number} adsr1 @param {number} adsr2 @param {Partial<Ps1Envelope>} values
 * @returns {{adsr1:number,adsr2:number}} */
export function patchPs1Envelope(adsr1,adsr2,values){
  decodePs1Envelope(adsr1,adsr2);
  if(!values||typeof values!=='object'||Array.isArray(values))throw new TypeError('PS1 envelope must be an object');
  const result={adsr1,adsr2};
  for(const key of Reflect.ownKeys(values)){
    if(typeof key!=='string'||!Object.hasOwn(fields,key))throw new TypeError('Unknown PS1 envelope parameter');
    const definition=fields[key],value=values[key];if(value===undefined)continue;
    if(definition.boolean){if(typeof value!=='boolean')throw new TypeError(`${key} must be boolean`);}
    else integer(value,0,definition.mask,key);
    const mask=(definition.boolean?1:definition.mask)<<definition.shift;
    result[definition.word]=(result[definition.word]&~mask)|((definition.boolean?Number(value):value)<<definition.shift);
  }
  return result;
}
/** Encode a named envelope, using fast attack/full sustain/fast release for
 * omitted fields. Use patchPs1Envelope() to preserve existing raw register bits.
 * @param {Partial<Ps1Envelope>} values @returns {{adsr1:number,adsr2:number}} */
export function encodePs1Envelope(values){return patchPs1Envelope(0x000f,0,values);}

const preset=(id,name,registers)=>Object.freeze({id,name,registers:Object.freeze(registers)});
/** The seven nonzero reverb approximations implemented by the pinned core,
 * plus Off. Arbitrary register patterns do not create new effects; upstream
 * Echo and Delay entries have no processing configuration and are omitted.
 * Reverb uses private delay buffers in this core, not the sample RAM allocator.
 * @type {ReadonlyArray<Readonly<{id:Ps1ReverbPreset,name:string,registers:ReadonlyArray<number>}>>} */
export const PS1_REVERB_PRESETS=Object.freeze([
  preset('off','Off',Array(32).fill(0)),
  preset('room','Room',[
    0x007D,0x005B,0x6D80,0x54B8,0xBED0,0x0000,0x0000,0xBA80,
    0x5800,0x5300,0x04D6,0x0333,0x03F0,0x0227,0x0374,0x01EF,
    0x0334,0x01B5,0x0000,0x0000,0x0000,0x0000,0x0000,0x0000,
    0x0000,0x0000,0x01B4,0x0136,0x00B8,0x005C,0x8000,0x8000]),
  preset('studio-small','Studio Small',[
    0x0033,0x0025,0x70F0,0x4FA8,0xBCE0,0x4410,0xC0F0,0x9C00,
    0x5280,0x4EC0,0x03E4,0x031B,0x03A4,0x02AF,0x0372,0x0266,
    0x031C,0x025D,0x025C,0x018E,0x022F,0x0135,0x01D2,0x00B7,
    0x018F,0x00B5,0x00B4,0x0080,0x004C,0x0026,0x8000,0x8000]),
  preset('studio-medium','Studio Medium',[
    0x00B1,0x007F,0x70F0,0x4FA8,0xBCE0,0x4510,0xBEF0,0xB4C0,
    0x5280,0x4EC0,0x0904,0x076B,0x0824,0x065F,0x07A2,0x0616,
    0x076C,0x05ED,0x05EC,0x042E,0x050F,0x0305,0x0462,0x02B7,
    0x042F,0x0265,0x0264,0x01B2,0x0100,0x0080,0x8000,0x8000]),
  preset('studio-large','Studio Large',[
    0x00E3,0x00A9,0x6F60,0x4FA8,0xBCE0,0x4510,0xBEF0,0xA680,
    0x5680,0x52C0,0x0DFB,0x0B58,0x0D09,0x0A3C,0x0BD9,0x0973,
    0x0B59,0x08DA,0x08D9,0x05E9,0x07EC,0x04B0,0x06EF,0x03D2,
    0x05EA,0x031D,0x031C,0x0238,0x0154,0x00AA,0x8000,0x8000]),
  preset('hall','Hall',[
    0x01A5,0x0139,0x6000,0x5000,0x4C00,0xB800,0xBC00,0xC000,
    0x6000,0x5C00,0x15BA,0x11BB,0x14C2,0x10BD,0x11BC,0x0DC1,
    0x11C0,0x0DC3,0x0DC0,0x09C1,0x0BC4,0x07C1,0x0A00,0x06CD,
    0x09C2,0x05C1,0x05C0,0x041A,0x0274,0x013A,0x8000,0x8000]),
  preset('space-echo','Space Echo',[
    0x033D,0x0231,0x7E00,0x5000,0xB400,0xB000,0x4C00,0xB000,
    0x6000,0x5400,0x1ED6,0x1A31,0x1D14,0x183B,0x1BC2,0x16B2,
    0x1A32,0x15EF,0x15EE,0x1055,0x1334,0x0F2D,0x11F6,0x0C5D,
    0x1056,0x0AE1,0x0AE0,0x07A2,0x0464,0x0232,0x8000,0x8000]),
  preset('half-echo','Half Echo',[
    0x0017,0x0013,0x70F0,0x4FA8,0xBCE0,0x4510,0xBEF0,0x8500,
    0x5F80,0x54C0,0x0371,0x02AF,0x02E5,0x01DF,0x02B0,0x01D7,
    0x0358,0x026A,0x01D6,0x011E,0x012D,0x00B1,0x011F,0x0059,
    0x01A0,0x00E3,0x0058,0x0040,0x0028,0x0014,0x8000,0x8000]),
]);
