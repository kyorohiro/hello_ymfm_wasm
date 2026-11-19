// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

export const FM2608_OUTPUT_MIX_DEFAULTS = Object.freeze({fm:1,ssg:1,rhythm:1,adpcm:1,ym2203Mode:false});

/** Software output controls. Voice registers and envelope levels stay intact. */
export function readFm2608OutputMix(input = {},previous = FM2608_OUTPUT_MIX_DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Output mix must be an object');
  const result = {...FM2608_OUTPUT_MIX_DEFAULTS,...previous};
  // A restored two-bus record used fm for the whole FM/Rhythm/ADPCM bus.
  // New partial edits only change their named source; they do not share gain.
  if (!Object.hasOwn(previous,'rhythm')) result.rhythm = result.fm;
  if (!Object.hasOwn(previous,'adpcm')) result.adpcm = result.fm;
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(FM2608_OUTPUT_MIX_DEFAULTS,key)) throw new TypeError('Unknown output mix control ' + key);
    const value = input[key];
    if (key === 'ym2203Mode') {
      if (typeof value !== 'boolean') throw new TypeError('YM2203 mode must be boolean');
    } else if (!Number.isFinite(value) || value < 0 || value > 3.8) {
      throw new RangeError('Output mix faders must be 0–3.8');
    }
    result[key] = value;
  }
  return result;
}

/** Normalize first-chip VGM volume entries to the source's default levels.
 * VGMPlay GetChipVolume uses YM2203 FM 0x100 and paired SSG 0x80, then
 * accepts the first matching entry. Relative values multiply that level.
 * https://github.com/vgmrips/vgmplay-legacy/blob/master/VGMPlay/VGMPlay.c
 */
export function resolveFm2608OutputMix(input = {},source = null) {
  const controls = readFm2608OutputMix(input);
  const correction = {fm:1,ssg:controls.ym2203Mode ? .75 : 1};
  const file = {fm:1,ssg:1};
  const entries = source?.sourceChip === 'ym2203' ? source.compatibility?.extraVolumeEntries ?? [] : [];
  const appliedSections = new Set();
  const fileVolumeEntries = [];
  for (const entry of entries) {
    const section = entry.section;
    const applied = controls.ym2203Mode && !appliedSections.has(section);
    fileVolumeEntries.push({...entry,applied});
    if (!applied) continue;
    if (!['fm','ssg'].includes(section) || entry.chipIndex !== 0) throw new Error('Invalid first-YM2203 volume metadata');
    file[section] = entry.relative ? entry.multiplier : entry.absolute / (section === 'fm' ? 256 : 128);
    if (!Number.isFinite(file[section]) || file[section] < 0 || file[section] >= 256) throw new RangeError('Invalid VGM output volume multiplier');
    appliedSections.add(section);
  }
  return {...controls,correction,file,effective:{fm:controls.fm * correction.fm * file.fm,ssg:controls.ssg * correction.ssg * file.ssg,
    rhythm:controls.rhythm,adpcm:controls.adpcm},
    fileVolumeEntries,volumeAdjustmentsApplied:controls.ym2203Mode && entries.length > 0};
}
