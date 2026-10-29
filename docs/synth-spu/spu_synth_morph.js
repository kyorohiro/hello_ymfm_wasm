// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
export const MORPH_SHAPES = Object.freeze(['sine','triangle','saw','square']);
export function morphShape(shape) {
  if (!MORPH_SHAPES.includes(shape)) throw new TypeError('Unknown Morph waveform');
  return Array.from({length:112},(_,i)=>{
    const phase=i/112;
    return Math.fround(.65*(shape==='sine'?Math.sin(2*Math.PI*phase):shape==='triangle'?2/Math.PI*Math.asin(Math.sin(2*Math.PI*phase)):shape==='saw'?2*phase-1:phase<.5?1:-1));
  });
}
const defaults=Object.freeze({enabled:false,amount:0,a:Object.freeze(morphShape('sine')),b:Object.freeze(morphShape('saw'))});
export function readMorph(value=defaults) {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!Object.hasOwn(defaults,key))) throw new TypeError('Invalid Software morph settings');
  const result={...defaults,...value};
  if(typeof result.enabled!=='boolean')throw new TypeError('Morph enabled must be boolean');
  if(!Number.isFinite(result.amount)||result.amount<0||result.amount>1)throw new RangeError('Morph amount must be from 0 to 1');
  for(const key of ['a','b']) {
    const pcm=result[key];
    if(!Array.isArray(pcm)||pcm.length!==112||pcm.some(x=>!Number.isFinite(x)||x< -1||x>1))throw new TypeError('Morph endpoints require 112 PCM samples in [-1, 1]');
    result[key]=pcm.map(Math.fround);
  }
  return result;
}
export function morphPcm(value) {
  const {a,b,amount}=readMorph(value);
  if(amount===0)return a;
  if(amount===1)return b;
  return a.map((sample,i)=>Math.fround(sample+(b[i]-sample)*amount));
}
export function morphShapeName(pcm) {
  return MORPH_SHAPES.find(shape=>morphShape(shape).every((x,i)=>x===pcm[i]))??'custom';
}
