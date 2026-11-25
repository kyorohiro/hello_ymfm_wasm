// SPDX-License-Identifier: BSD-3-Clause
import {createPlaygroundCassetteZip,loadPlaygroundCassette} from '../playground/playground_cassette.js';
import {parseSysex} from '../js/msfa_dx7/src/sysex.js';
import {parseMidiFile} from '../js/midi_file.js';

export function exportSession({bank, selected, code, song}) {
  const files=[
    {path:'/bank.syx',type:'binary',data:bank},
    {path:'/index.js',type:'text',data:code},
    {path:'/fm21290.json',type:'text',data:JSON.stringify({version:1,selected})}
  ];
  if(song) files.push({path:'/song.mid',type:'binary',data:song});
  return createPlaygroundCassetteZip(files);
}
export async function importSession(bytes) {
  const {files}=await loadPlaygroundCassette(bytes);
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const meta=JSON.parse(decoder.decode(files.get('fm21290.json')));
  if(meta?.version!==1 || !Number.isInteger(meta.selected) || meta.selected<0 || meta.selected>31)
    throw Error('Invalid FM21290 Cassette');
  const dump=parseSysex(files.get('bank.syx'));
  if(dump.format!=='bank'||!files.has('index.js'))throw Error('Cassette needs bank.syx and index.js');
  const song=files.get('song.mid');
  return {dump,selected:meta.selected,code:decoder.decode(files.get('index.js')),song,midi:song?parseMidiFile(song):null};
}
