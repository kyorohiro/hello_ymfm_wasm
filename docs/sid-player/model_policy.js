// SPDX-License-Identifier: BSD-3-Clause
// Player-only target policy. The canonical validators and reference CLI stay strict.
import {parsePsidStructure} from '../sid8580-lab/psid_structure.js';
import {parseRsid} from '../js/sid_rsid.js';

export class SidPlayerTargetError extends Error {
  constructor(message, code) {super(`SID: ${message}`);this.name='SidPlayerTargetError';this.code=code;}
}

/** Read a bounded original layout, retaining declared hints and original bytes. */
export function parsePlayerStructure(input, {maxBytes} = {}) {
  const bytes=input instanceof ArrayBuffer?new Uint8Array(input)
    :ArrayBuffer.isView(input)?new Uint8Array(input.buffer,input.byteOffset,input.byteLength):null;
  if(!bytes)throw new TypeError('SID input must be an ArrayBuffer or byte view');
  const psid=bytes.length>=4&&bytes[0]===80&&bytes[1]===83&&bytes[2]===73&&bytes[3]===68;
  const limits=maxBytes===undefined?{}:{maxBytes};
  return psid?parsePsidStructure(bytes,limits):parseRsid(bytes,limits);
}

/** Select a model without changing known declarations. Manual choices resolve
 * unknown/either only. The checkbox supplies PAL/6581 for Auto's missing hints.
 * @param {ReturnType<typeof parsePlayerStructure>} parsed
 * @param {{modelSelection?:'auto'|'6581'|'8580',assumeUnknown?:boolean}} [options]
 */
export function modelForStructure(parsed,{modelSelection='auto',assumeUnknown=true}={}) {
  if(!['auto','6581','8580'].includes(modelSelection))throw new RangeError('SID model selection must be auto, 6581 or 8580');
  if(typeof assumeUnknown!=='boolean')throw new TypeError('SID assumeUnknown must be boolean');
  if(['6581','8580'].includes(parsed.model)){
    if(modelSelection!=='auto'&&modelSelection!==parsed.model)
      throw new SidPlayerTargetError(`file declares ${parsed.model}; choose Auto or ${parsed.model}. A known model declaration cannot be overridden by ${modelSelection}.`,'SID_MODEL_MISMATCH');
    return parsed.model;
  }
  if(modelSelection!=='auto')return modelSelection;
  if(assumeUnknown)return '6581';
  throw new SidPlayerTargetError('model is unspecified or supports either SID; choose 6581 or 8580, or enable the unknown/either default.','SID_MODEL_CHOICE_REQUIRED');
}

/** Resolve only the model. Clock acceptance is checked by resolvePlayerTarget. */
export function resolveSidModel(input,options={}) {
  return modelForStructure(parsePlayerStructure(input,options),options);
}

/** Resolve explicit options for the existing model-specific validators. */
export function resolvePlayerTarget(input,{modelSelection='auto',assumeUnknown=true,clock,model,maxBytes}={}) {
  if(clock!==undefined&&clock!=='pal')throw new RangeError('SID Player supports the PAL clock only');
  if(model!==undefined&&!['6581','8580'].includes(model))throw new RangeError('SID target model must be 6581 or 8580');
  const parsed=parsePlayerStructure(input,{maxBytes});
  const selectedModel=modelForStructure(parsed,{modelSelection,assumeUnknown});
  if(model!==undefined&&model!==selectedModel)
    throw new SidPlayerTargetError(`selected ${selectedModel} target conflicts with the supplied ${model} engine option.`,'SID_MODEL_MISMATCH');
  if(parsed.clock==='ntsc')throw new SidPlayerTargetError('a declared NTSC tune is unsupported by the PAL player.','SID_CLOCK_UNSUPPORTED');
  if(parsed.clock!=='pal'&&!assumeUnknown&&clock!=='pal')
    throw new SidPlayerTargetError('clock is unspecified or supports either standard; enable the PAL default to continue.','SID_CLOCK_CHOICE_REQUIRED');
  return {structure:parsed,selectedModel,modelSelection,assumeUnknown,
    // This target has passed the policy above. These are resolved load options,
    // not a request to rewrite the header or override a known declaration.
    targetOptions:{clock:'pal',model:selectedModel}};
}

export function require8580Machine(parsed,vbiBackend='c64') {
  if(!['c64','direct'].includes(vbiBackend))throw new RangeError('The PSID VBI backend must be direct or c64');
  if(parsed.format==='PSID'&&parsed.timing==='vbi'&&vbiBackend==='direct')
    throw new SidPlayerTargetError('8580 uses the C64 machine; Direct VBI is available for 6581 only. Choose C64 machine and retry.','SID_8580_DIRECT_UNSUPPORTED');
}
