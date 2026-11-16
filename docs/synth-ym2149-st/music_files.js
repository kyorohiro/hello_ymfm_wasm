// SPDX-License-Identifier: BSD-3-Clause
export const MUSIC_FILE_LIMIT=16*1024*1024;
export const isYmMusicFilename=name=>typeof name==='string'&&/\.(?:vgm|vgz|ym|sndh)$/i.test(name);
export function ymMusicEntries(project,sources) {
  if(!Array.isArray(sources)||sources.length>128)throw new RangeError('Choose at most 128 music files at once');
  const fold=value=>value.normalize('NFC').toLowerCase();
  const occupied=new Set([...project.fs.list().map(file=>file.path),...project.fs.listDirectories()].map(fold));
  return sources.map(source=>{
    if(!source||typeof source.name!=='string'||!(source.bytes instanceof Uint8Array))throw new TypeError('Music needs a name and binary bytes');
    if(!source.bytes.length||source.bytes.length>MUSIC_FILE_LIMIT)throw new RangeError('Music files must contain 1 byte to 16 MiB');
    let name=source.name.split(/[\\/]/).at(-1).normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"|?*]/g,'_').replace(/[. ]+$/g,'');
    if(!isYmMusicFilename(name))throw new Error('Choose VGM, VGZ, SNDH or YM files');
    const ext=name.match(/\.[^.]+$/)[0];let stem=name.slice(0,-ext.length);
    stem=Array.from(stem).slice(0,96).join('').replace(/^\.+|[. ]+$/g,'')||'Untitled';
    if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem))stem='_'+stem;
    const folder=/\.vg[mz]$/i.test(name)?'/vgm':'/music';
    let path=`${folder}/${stem}${ext}`,count=1;
    while(occupied.has(fold(path)))path=`${folder}/${stem} (${++count})${ext}`;
    occupied.add(fold(path));return {path,type:'binary',data:source.bytes.slice()};
  });
}
export function listYmMusic(project) {
  return project.listEntries().filter(file=>file.fileType==='binary'&&isYmMusicFilename(file.path))
    .sort((a,b)=>a.path.localeCompare(b.path));
}
