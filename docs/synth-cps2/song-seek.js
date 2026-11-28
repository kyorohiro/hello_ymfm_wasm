// SPDX-License-Identifier: BSD-3-Clause
import {QSoundPcm} from '../js/qsoundpcm.js';
import {SongTransport} from './song.js';

// Reproduce the first pass off the audio thread, including PCM phase, ADPCM
// predictors and the echo line. Only validated QSound commands reach this path.
export function rebuildSongState(bytes,rate,targetTicks,mutes) {
  const chip=new QSoundPcm(new Uint8Array(),rate,{spatialPcm:true,trackRom:true});
  mutes.forEach((muted,i)=>chip.setChannelMuted(i,muted));
  const starts=new Uint16Array(16);
  const song=new SongTransport(bytes,chip,starts);
  const target=Math.round(targetTicks*rate/44100);
  const left=new Float32Array(8192),right=new Float32Array(8192);
  while(song.frames<target && !song.parser.ended) {
    const count=Math.min(target-song.frames,left.length);
    song.render(left.subarray(0,count),right.subarray(0,count));
  }
  song.applyDueEvents(true);
  const {position,ended}=song.parser;
  const {frames,ticks,nextFrame,loopStart}=song;
  return {ranges:[...song.ranges],chip,starts,position,ended,frames,ticks,nextFrame,loopStart};
}
