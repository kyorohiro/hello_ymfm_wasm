// SPDX-License-Identifier: BSD-3-Clause
import {readPreset} from './preset.js';
import {prepareHuc6280SongVoice} from './song_voice.js';

/** A portable configured sound, without applying it or borrowing an unrelated
 * authored PCM asset. A physical DDA observation alone is not a sample. */
export function prepareHuc6280SelectedPreset({target='synth',origin='synth',author,snapshot}={}) {
  if(target==='synth')return{sound:readPreset(author),reason:''};
  if(!Number.isInteger(target)||target<0||target>5)throw RangeError('Choose Auto or CH1–CH6.');
  if(!snapshot)return{sound:null,reason:'Enable audio or play a song to observe this channel first.'};
  const label=origin==='vgm'?'VGM':origin==='code'?'Code':'CH';
  const prepared=prepareHuc6280SongVoice(snapshot,target,{name:`${label==='CH'?'':label+' '}CH ${target+1}`});
  if(!prepared.capturable)return{sound:null,reason:prepared.reason};
  const sound=readPreset(prepared.preset);
  if(origin!=='vgm'&&snapshot.envelopes?.[target])sound.envelope={...snapshot.envelopes[target]};
  return{sound:readPreset(sound),reason:'',warnings:[...prepared.warnings]};
}
