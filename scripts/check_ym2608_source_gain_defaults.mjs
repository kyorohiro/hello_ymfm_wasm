/** Reuse the complete YM2608 differential suite for the additive source mixer.
 * Only host-state trailers and the new export are adapted. Every PCM sample,
 * core-state byte, timer, IRQ and resampler observation is compared exactly.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

export function ym2608SourceGainDefaultChecker(source) {
  function replace(before,after) {
    if(source.indexOf(before)<0||source.indexOf(before)!==source.lastIndexOf(before))
      throw Error('YM2608 differential suite changed at a reviewed source-gain adaptation');
    source=source.replace(before,after);
  }
  replace('function nativeSave(chip){',`function hostTrailerSize(module){
  return module._ym2608_set_source_gains?56:module._ym2608_set_output_gains?8:0;
}
function fullNativeSave(chip){`);
  replace('function nativeLoad(chip,bytes,size=bytes.length){',`function nativeSave(chip){
  const bytes=fullNativeSave(chip),extra=hostTrailerSize(chip.module);
  if(extra){
    const view=new DataView(bytes.buffer,bytes.byteOffset+bytes.length-extra,extra);
    for(let index=0;index<(extra===56?6:2);index++)assert.equal(view.getFloat32(index*4,true),1,'Default host gain remains unity');
  }
  return extra?bytes.slice(0,-extra):bytes;
}
function nativeLoad(chip,bytes,size=bytes.length){`);
  replace(`const module=chip.module,ptr=module._malloc(Math.max(1,bytes.length));assert(ptr);
  try{new Uint8Array(module.HEAPF32.buffer,ptr,bytes.length).set(bytes);return module._ym2608_load_state(chip.handle,ptr,size);}`,
    `const module=chip.module,extra=hostTrailerSize(module),payload=new Uint8Array(bytes.length+extra);
  payload.set(bytes);
  // Raw cross-build checks construct a recipient-layout state at unity. New
  // stem caches come from a valid recipient snapshot and are dormant at unity;
  // this adapter does not claim that old raw state files are a portable ABI.
  if(extra)payload.set(fullNativeSave(chip).subarray(-extra),bytes.length);
  const ptr=module._malloc(Math.max(1,payload.length,size+extra));assert(ptr);
  try{new Uint8Array(module.HEAPF32.buffer,ptr,payload.length).set(payload);return module._ym2608_load_state(chip.handle,ptr,size+extra);}`);
  replace('assert.equal(opaque.byteLength,bytes.length+(actor===chip?0:64));',
    'assert.equal(opaque.byteLength,bytes.length+(actor===chip?0:64)+hostTrailerSize(chip.module));');
  replace("assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Export surface unchanged');",
    `assert.equal(sdk.metadata.exports.filter(entry=>entry.name==='ym2608_set_source_gains').length,1,'New source-gain ABI');
  assert.deepEqual(sdk.metadata.exports.filter(entry=>entry.name!=='ym2608_set_source_gains'),legacy.metadata.exports,'Only one additive source-gain export');`);
  return '// Exact unity-source-gain differential suite; host trailers adapted only.\n'+source;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const output=resolve(root,'build/ym2608-source-gain-default-checker.mjs');
  await mkdir(resolve(root,'build/fm2608-source-mixer-20261119'),{recursive:true});
  await writeFile(output,ym2608SourceGainDefaultChecker(await readFile(new URL('./check_ym2608_wasm_sdk.mjs',import.meta.url),'utf8')));
  execFileSync(process.execPath,[output,...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
}
