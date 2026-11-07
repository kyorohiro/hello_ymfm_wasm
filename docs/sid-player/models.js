// SPDX-License-Identifier: BSD-3-Clause
import {validateBrowserPsid} from '../js/sid_psid.js';
import {validateBrowserRsid} from '../js/sid_rsid.js';
import {validateResearchSid} from '../sid8580-lab/parser.js';
import {SidPlayerCore} from './core.js';
import {RsidPlayerCore} from './rsid_core.js';
import {Sid8580PlayerCore} from './core8580.js';
import {resolvePlayerTarget,require8580Machine} from './model_policy.js';
export {resolveSidModel,SidPlayerTargetError} from './model_policy.js';

/** Player-level model selection. The original bytes and known declarations are
 * preserved. This does not relax the canonical 6581 validator or reference CLI.
 */
export function validatePlayerSid(input,options={}) {
  const target=resolvePlayerTarget(input,options),vbiBackend=options.vbiBackend===undefined?'c64':options.vbiBackend;
  const load={subtune:options.subtune,environment:options.environment===undefined?'minimal':options.environment,vbiBackend,...target.targetOptions};
  let parsed;
  if(target.selectedModel==='8580'){
    parsed=validateResearchSid(input,load);require8580Machine(parsed,vbiBackend);
  }else parsed=target.structure.format==='PSID'
    ?validateBrowserPsid(input,{...load,...(options.maxBytes===undefined?{}:{maxBytes:options.maxBytes})})
    :validateBrowserRsid(input,{...load,...(options.maxBytes===undefined?{}:{maxBytes:options.maxBytes})});
  return {...parsed,selectedModel:target.selectedModel,selectedClock:'pal',
    playbackBackend:target.selectedModel==='8580'||parsed.format==='RSID'?'c64':parsed.playbackBackend,
    playerOptions:{...target.targetOptions,modelSelection:target.modelSelection,assumeUnknown:target.assumeUnknown,vbiBackend}};
}

/** Match one model to its own engine. 6581 uses the original WASM unchanged. */
export async function createPlayerCore({model='6581',backend='psid',...options}={}) {
  if(!['6581','8580'].includes(model))throw new RangeError('SID player model must be 6581 or 8580');
  if(!['psid','rsid','psid-cia','psid-vbi','8580'].includes(backend))throw new RangeError('Unknown SID player backend');
  if(model==='8580')return Sid8580PlayerCore.create(options);
  if(backend==='8580')throw new RangeError('The 8580 backend requires model 8580');
  return (backend==='psid'?SidPlayerCore:RsidPlayerCore).create(options);
}
