// Run against the staged payload, so no imports can fall back to repository files.
import {readFileSync, readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(process.argv[2]);
// These caller-provided ROMs must never be distributed, even through samples/.
const excludedRoms = new Set(['ym2608_adpcm_rom.bin', 'yrw801.rom']);
function checkNoRoms(dir) {
  for (const entry of readdirSync(dir, {withFileTypes:true})) {
    const file = join(dir, entry.name);
    if (excludedRoms.has(entry.name.toLowerCase())) throw new Error(`Excluded ROM in runtime package: ${file}`);
    if (entry.isDirectory()) checkNoRoms(file);
  }
}
checkNoRoms(root);

const manifest=JSON.parse(readFileSync(join(root,'runtime-manifest.json'),'utf8'));
const dir=manifest.layout==='js' ? join(root,'js') : root;
const {createSoundChip}=await import(pathToFileURL(join(dir,'soundchip.js')));
const yamaha=manifest.chips.filter(n=>/^(ym|y8950$|ay8910$)/.test(n));
for (const name of yamaha) {
  // Exercises the default asset URLs, factory, native instantiation and PCM generation.
  const chip=await createSoundChip(name);
  try {
    const pcm=chip.generateStereo(128);
    assert.equal(pcm.left.length,128,name);
    assert.ok(pcm.left.every(Number.isFinite) && pcm.right.every(Number.isFinite),name);
  } finally {chip.dispose();}
}
for (const name of manifest.chips.filter(n=>!yamaha.includes(n))) {
  const {default:factory}=await import(pathToFileURL(join(root,'generated',`${name}_wasm.js`)));
  const module=await factory({wasmBinary:readFileSync(join(root,'generated',`${name}_wasm.wasm`))});
  assert.ok((module.HEAPU8 ?? module.HEAPF32)?.length, name);
}
console.log(`Staged runtime verified: ${yamaha.length} chip renderers; all ${manifest.chips.length} WASM engines loaded.`);
