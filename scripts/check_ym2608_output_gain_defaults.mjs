/** Reuse the full SDK differential checker for the one additive output-gain ABI.
 * Only the new export and two trailing unity-gain state floats are adapted.
 * Audio samples, register/status/IRQ observations and timers compare exactly.
 */
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

/** @param {string} source Existing SDK comparison checker. */
export function ym2608OutputGainDefaultChecker(source) {
  function replace(before,after) {
    const offset=source.indexOf(before);
    if(offset<0||source.indexOf(before,offset+1)>=0)throw Error('YM2608 SDK checker changed at a reviewed adaptation');
    source=source.slice(0,offset)+after+source.slice(offset+before.length);
  }
  replace('try{assert.equal(module._ym2608_save_state(chip.handle,ptr),size);return new Uint8Array(module.HEAPF32.buffer,ptr,size).slice();}',
    `try{assert.equal(module._ym2608_save_state(chip.handle,ptr),size);
    const bytes=new Uint8Array(module.HEAPF32.buffer,ptr,size).slice();
    if(!module._ym2608_set_output_gains)return bytes;
    const gains=new DataView(bytes.buffer,bytes.byteOffset+size-8,8);
    assert.equal(gains.getFloat32(0,true),1,'Default FM gain');
    assert.equal(gains.getFloat32(4,true),1,'Default SSG gain');
    return bytes.slice(0,-8);}`);
  replace(`const module=chip.module,ptr=module._malloc(Math.max(1,bytes.length));assert(ptr);
  try{new Uint8Array(module.HEAPF32.buffer,ptr,bytes.length).set(bytes);return module._ym2608_load_state(chip.handle,ptr,size);}`,
    `const module=chip.module,extra=module._ym2608_set_output_gains?8:0,payload=new Uint8Array(bytes.length+extra);
  payload.set(bytes);
  if(extra){const view=new DataView(payload.buffer);view.setFloat32(bytes.length,1,true);view.setFloat32(bytes.length+4,1,true);}
  const ptr=module._malloc(Math.max(1,payload.length));assert(ptr);
  try{new Uint8Array(module.HEAPF32.buffer,ptr,payload.length).set(payload);return module._ym2608_load_state(chip.handle,ptr,size+extra);}`);
  replace('assert.equal(opaque.byteLength,bytes.length+(actor===chip?0:64));',
    'assert.equal(opaque.byteLength,bytes.length+(actor===chip?0:64)+(chip.module._ym2608_set_output_gains?8:0));');
  replace("assert.deepEqual(sdk.metadata.exports,legacy.metadata.exports,'Export surface unchanged');",
    "assert.equal(sdk.metadata.exports.filter(entry=>entry.name==='ym2608_set_output_gains').length,1);assert.deepEqual(sdk.metadata.exports.filter(entry=>entry.name!=='ym2608_set_output_gains'),legacy.metadata.exports,'Only the output-gain setter is added');");
  return '// Reviewed default-gain differential checker. PCM is compared without normalization.\n'+source;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const output=resolve(root,'build/ym2608-output-gain-default-checker.mjs');
  await mkdir(dirname(output),{recursive:true});
  try {
    await writeFile(output,ym2608OutputGainDefaultChecker(await readFile(new URL('./check_ym2608_wasm_sdk.mjs',import.meta.url),'utf8')));
    execFileSync(process.execPath,[output,...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
  } finally {await rm(output,{force:true});}
}
