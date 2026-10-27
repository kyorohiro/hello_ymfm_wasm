// Roll out parser, playback and UI changes together. Canonical web/ and npm
// modules keep their existing import paths; this only versions website URLs.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const directory=fileURLToPath(new URL('../docs/vgm_analyzer/',import.meta.url));
const version='pokey-vgm-1';
const affected=new Set(['ym2612vgm.js','vgmplayer.js','pokey_playback.js','pokey_notes.js','pokey_monitor.js',
  'playback_core.js','playback_mixer.js','mixer_ui.js','source_mutes.js','vgm_analyzer.js']);
const files=await Promise.all((await readdir(directory)).filter(name=>/\.(?:js|html)$/.test(name))
  .map(async name=>({name,source:await readFile(join(directory,name),'utf8')})));
let more;
do {more=false;for(const {name,source} of files){
  if(affected.has(name))continue;
  const imports=[...source.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/['"](?:\.\.?\/)+(?:js\/)?([\w.-]+\.js)(?:\?[^'"]*)?['"]/g)];
  if(imports.some(match=>affected.has(match[1]))){affected.add(name);more=true;}
}}while(more);
let changed=0;
for(const {name,source} of files){
  const next=source.replace(/(['"])((?:\.\.?\/)+(?:js\/)?([\w.-]+\.js))(?:\?[^'"\s]*)?\1/g,
    (original,quote,path,base)=>affected.has(base)?`${quote}${path}?v=${version}${quote}`:original);
  if(next!==source){await writeFile(join(directory,name),next);changed++;}
}
console.log(`Versioned ${changed} Analyzer modules for ${version}.`);
