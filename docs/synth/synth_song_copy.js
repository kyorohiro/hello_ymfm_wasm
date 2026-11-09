import {describeSynthSongVoice} from './synth_song_voice.js?v=vgm-mix-copy-1';

/** Copy written settings, not a running envelope or a piece of song audio. */
export function createSynthSongCopyPreset(snapshot, channel) {
  const voice=describeSynthSongVoice(snapshot,channel);
  if(!voice.playable)throw new Error(voice.reason);
  const source=snapshot.channels[channel];
  return {...structuredClone(source.preset),capturedVoice:{keyMask:voice.keyMask,
    specialMode:source.specialMode,
    specialFrequencies:source.specialMode?source.specialFrequencies.map(({block,fnum})=>({block,fnum})):[]}};
}
