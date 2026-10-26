// Explicit maintainer step: refresh the vendored JS, metadata and docs without rebuilding
// or changing the pinned WASM/MSFA engine unless --wasm is explicitly supplied.
// Normal builds use the checked-in copy.
import {cp,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const source=new URL('w/tetorica-msfa-dx7-wasm/',root);
for(const location of ['web/msfa_dx7/','docs/js/msfa_dx7/']){
  const target=new URL(location,root);
  await cp(new URL('src/',source),new URL('src/',target),{recursive:true});
  for (const name of ['package.json', 'README.md', 'README.ja.md', 'LICENSE',
    'THIRD_PARTY_NOTICES.md', 'docs/research.md', 'docs/verification.md',
    'vendor/msfa/COPYING', 'vendor/msfa/UPSTREAM.md']) {
    await cp(new URL(name,source),new URL(name,target));
  }
  await cp(new URL('docs/issues/msfa-live-parameters/',source),
    new URL('docs/issues/msfa-live-parameters/',target),{recursive:true});
}
// Monaco loads an ambient declaration file, so inline the canonical data types
// rather than introduce unresolved relative module imports into its virtual FS.
let types=await readFile(new URL('src/preset.d.ts',source),'utf8');
types=types.slice(types.indexOf('/** Public operator'),types.indexOf('/** Pure validation'))
  .replace(/^export /gm,'').trim();
const start='// BEGIN GENERATED DX7 PRESET TYPES';
const end='// END GENERATED DX7 PRESET TYPES';
const block=start+'\n'+types+'\n'+end;
const globals=new URL('docs/playground/tetorica-playground-globals.d.ts',root);
let declarations=await readFile(globals,'utf8');
if(declarations.includes(start)){
  const first=declarations.indexOf(start),last=declarations.indexOf(end,first);
  if(last<0)throw Error('Missing DX7 type block end');
  declarations=declarations.slice(0,first)+block+declarations.slice(last+end.length);
}else{
  declarations=declarations.replace('interface PlaygroundDx7VoiceInfo {',block+'\ninterface PlaygroundDx7VoiceInfo {');
}
await writeFile(globals,declarations);
await cp(new URL('web/msfa_dx7/README.vendor.md',root),new URL('docs/js/msfa_dx7/README.vendor.md',root));
if(process.argv.includes('--wasm')) {
  execFileSync('sh',[fileURLToPath(new URL('scripts/build_dx7_wasm.sh',root))],{stdio:'inherit'});
}
console.log('Synced DX7 JS, metadata and docs to web/docs, and declarations to Monaco; WASM '
  + (process.argv.includes('--wasm') ? 'rebuilt explicitly from the fixed SDK.' : 'unchanged.'));
