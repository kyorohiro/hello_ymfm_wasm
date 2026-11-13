// SPDX-License-Identifier: BSD-3-Clause
import {noteToHz} from '../js/soundchip_pitch.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';

export const HUC6280_CODE_METHODS=Object.freeze(['initialize','reset','writeRegister','getState','setWaveform','setVolume','setPan','setMasterVolume','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','allNotesOff','setNoise','setDda','writeDda','setLfo','dispose']);
export const huc6280CodeCancelled=()=>{const error=new Error('HuC6280 Code session was stopped');error.name='AbortError';return error;};
const integer=(v,min,max)=>{if(!Number.isInteger(v)||v<min||v>max)throw new RangeError(`Expected integer ${min}..${max}`);};
export function validateHuc6280CodeCall(method,args){
  if(!HUC6280_CODE_METHODS.includes(method))throw new Error('Unknown HuC6280 Code method');
  if(!Array.isArray(args))throw new TypeError('HuC6280 Code arguments must be an array');
  if(['initialize','reset','getState','allNotesOff','dispose'].includes(method)&&args.length)throw new TypeError(`${method} takes no arguments`);
  if(['setWaveform','setVolume','setPan','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','setDda','writeDda'].includes(method))integer(args[0],0,5);
  if(method==='setNoise')integer(args[0],4,5);
  if(method==='writeRegister'){integer(args[0],0,9);integer(args[1],0,255);}
  if(method==='setWaveform'){
    if(!(Array.isArray(args[1])||args[1] instanceof Uint8Array)||args[1].length!==32)throw new RangeError('Expected 32 five-bit samples');
    for(const value of args[1])integer(value,0,31);
  }
  if(method==='setVolume')integer(args[1],0,31);
  if(method==='writeDda')integer(args[1],0,31);
  if(method==='setDda'&&typeof args[1]!=='boolean')throw TypeError('Expected boolean DDA enabled');
  if(method==='setPan'){integer(args[1],0,15);if(args[2]!==undefined)integer(args[2],0,15);}
  if(method==='setMasterVolume'){integer(args[0],0,15);if(args[1]!==undefined)integer(args[1],0,15);}
  if(['setFrequency','setNote','noteOn'].includes(method)){
    const hz=method==='setFrequency'?args[1]:noteToHz(args[1]),period=Math.round(HUC6280_CLOCK/(32*hz));
    if(!Number.isFinite(hz)||hz<=0||period<1||period>4096)throw new RangeError('Note is outside HuC6280 frequency range');
  }
}

/** Awaitable Playground-shaped interface over the existing Synth PSG. noteOn /
 * noteOff also use this host's labelled software envelope and loaded DDA feed;
 * keyOn / keyOff are explicit raw gates. This object owns no audio device. */
export function createHuc6280CodeClient({metadata,invoke,isCurrent,ownsOutput,dispose}={}){
  if(!Number.isSafeInteger(metadata?.session)||metadata.session<1||metadata.clock!==HUC6280_CLOCK||metadata.channels!==6)throw Error('Invalid HuC6280 Code session');
  for(const fn of [invoke,isCurrent,dispose])if(typeof fn!=='function')throw TypeError('HuC6280 Code requires ownership callbacks');
  let closed=false,closing=null;
  const current=()=>!closed&&isCurrent(),check=()=>{if(!current())throw huc6280CodeCancelled();};
  const client={id:'huc6280:synth',chip:'huc6280',channels:6,clock:HUC6280_CLOCK};
  for(const method of HUC6280_CODE_METHODS){
    if(method==='dispose')continue;
    client[method]=(...args)=>{check();validateHuc6280CodeCall(method,args);return Promise.resolve().then(()=>{check();return invoke(method,args);}).then(value=>{check();return value;});};
  }
  client.isCurrent=current;client.ownsOutput=()=>Boolean(ownsOutput?ownsOutput():current());
  client.dispose=(...args)=>{if(closing)return closing;check();validateHuc6280CodeCall('dispose',args);closed=true;return closing=Promise.resolve().then(dispose);};
  return client;
}
