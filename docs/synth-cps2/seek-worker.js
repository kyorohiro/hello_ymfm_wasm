// SPDX-License-Identifier: BSD-3-Clause
import {rebuildSongState} from './song-seek.js';
onmessage=({data})=>{
  const state=rebuildSongState(data.bytes,data.rate,data.tick,data.mutes);
  postMessage(state,[state.chip.rom.buffer,state.chip.echoLine.buffer,state.starts.buffer]);
};
