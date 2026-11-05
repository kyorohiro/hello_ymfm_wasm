// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

/** A reversible library view over canonical extracted voices, not an edit to
 * their presets. Only channel volume and the two descriptive names are ignored
 * when comparing settings; Wave RAM and stored DAC bytes are never decoded or scaled.
 * Groups retain their first input position. The loudest member supplies its own
 * id, channel, timestamp and preset; equal volumes retain the first member.
 * Singletons and voices outside the selected kinds retain their object identity.
 */
function mergeVolumeVariants(voices, kinds) {
  const result=[], groups=new Map();
  const origins=voice=>voice.origins??(voice.origin?[voice.origin]:[]);
  for(const voice of voices) {
    if(!kinds.has(voice.kind)){result.push(voice);continue;}
    const {name:_name,volume:_volume,dda,...settings}=voice.preset;
    const {name:_ddaName,...pcm}=dda;
    const key=JSON.stringify([voice.kind,{...settings,dda:pcm}]);
    const previous=groups.get(key);
    if(!previous) {
      groups.set(key,{index:result.length,winner:voice,occurrences:voice.occurrences,
        variants:voice.volumeVariants??1,origins:[...origins(voice)],warnings:[...(voice.warnings??[])]});
      result.push(voice);continue;
    }
    if(voice.preset.volume>previous.winner.preset.volume)previous.winner=voice;
    previous.occurrences+=voice.occurrences;
    previous.variants+=voice.volumeVariants??1;
    previous.origins=[...new Set([...previous.origins,...origins(voice)])];
    previous.warnings=[...new Set([...previous.warnings,...(voice.warnings??[])])];
    result[previous.index]={...previous.winner,occurrences:previous.occurrences,
      origins:previous.origins,warnings:previous.warnings,volumeVariants:previous.variants};
  }
  return result;
}

const PCM_KINDS=new Set(['pcm']), VGM_KINDS=new Set(['wave','pcm']);

/** Compatibility view: keep the original PCM-only grouping behavior. */
export function mergePcmVolumeVariants(voices) {
  return mergeVolumeVariants(voices,PCM_KINDS);
}

/** Group volume-only variants of Wave and PCM; Noise and LFO remain separate. */
export function mergeVgmVolumeVariants(voices) {
  return mergeVolumeVariants(voices,VGM_KINDS);
}
