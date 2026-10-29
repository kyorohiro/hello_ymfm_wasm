// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
export const DEFAULT_PMON = Object.freeze({enabled:false, ratio:1, depth:.5, decayMs:500, waveform:'sine'});
export const PMON_WAVEFORMS = Object.freeze(['sine','triangle','saw','square']);
export function readPmon(value = DEFAULT_PMON) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(DEFAULT_PMON, key))) throw new TypeError('Invalid Pitch Modulation settings');
  const result = {...DEFAULT_PMON, ...value};
  if (!PMON_WAVEFORMS.includes(result.waveform)) throw new TypeError('Unknown PMON waveform');
  if (typeof result.enabled !== 'boolean') throw new TypeError('PMON enabled must be boolean');
  for (const [key,min,max] of [['ratio',.01,16],['depth',0,1],['decayMs',0,5000]]) {
    if (!Number.isFinite(result[key]) || result[key] < min || result[key] > max) throw new RangeError(`PMON ${key} must be from ${min} to ${max}`);
  }
  return result;
}
export function pmonPcm(depth, waveform = 'sine') {
  readPmon({depth,waveform});
  return Array.from({length:112}, (_,i) => {
    const phase=i/112;
    const value=waveform==='sine' ? Math.sin(2*Math.PI*phase) : waveform==='triangle' ? 2/Math.PI*Math.asin(Math.sin(2*Math.PI*phase)) : waveform==='saw' ? 2*phase-1 : phase<.5 ? 1 : -1;
    return .95*depth*value;
  });
}
// Nearest retained core linear-sustain duration, not an exact hardware timer.
// MAME pSXAuthor / R. Belmont table, BSD-3-Clause; numeric durations only.
// See sources/native/ps1/spu_tables.cpp generate_linear_rate_table().
const decayDurations = [13,15,19,23,27,31,37,46,53,62,74,93,110,120,150,190,210,250,300,370,420,500,590,740,850,990,1200,1500,1700,2000,2400,3000,3400,4000,4800];
export function pmonAdsr(decayMs, carrierAdsr2) {
  readPmon({decayMs});
  let rate = 127;
  if (decayMs > 0) rate = 32 + decayDurations.reduce((best,ms,i) => Math.abs(ms-decayMs) < Math.abs(decayDurations[best]-decayMs) ? i : best, 0);
  return {adsr1:15, adsr2:0x4000 | rate << 6 | carrierAdsr2 & 63};
}
