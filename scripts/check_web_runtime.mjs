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
if (manifest.additionalInstruments?.includes('dx7')) {
  const dx7Dir = join(dir, 'msfa_dx7');
  const {createDX7, createInitVoice, createVoiceSysex} = await import(pathToFileURL(join(dx7Dir, 'src/index.js')));
  const wasmBytes = readFileSync(join(dx7Dir, 'wasm/msfa.wasm'));
  assert.match(readFileSync(join(dx7Dir, 'LICENSE'), 'utf8'), /Apache License/);
  assert.match(readFileSync(join(dx7Dir, 'THIRD_PARTY_NOTICES.md'), 'utf8'), /msfa/i);
  assert.match(readFileSync(join(dx7Dir, 'vendor/msfa/COPYING'), 'utf8'), /Apache License/);
  const synths = await Promise.all([44100, 48000].map(sampleRate => createDX7({sampleRate, wasmBytes})));
  try {
    for (const synth of synths) {
      await synth.loadSysex(createVoiceSysex(createInitVoice()));
      synth.noteOn(60, 100);
      const pcm = synth.render(4096);
      assert.equal(pcm.length, 4096);
      assert.ok(pcm.every(Number.isFinite) && pcm.some(value => Math.abs(value) > .001), 'Packaged DX7 must produce audible PCM');
      synth.noteOff(60);
      synth.panic();
      synth.setPreset({name:'OBJECT',algorithm:31,operators:{1:{coarse:2,outputLevel:90}}});
      synth.setOperators([[1,{fine:25}],[6,{outputLevel:0}]]);
      synth.setOperator(1,{coarse:1});
      assert.equal(synth.getPreset().operators[1].fine,25);
      synth.noteOn(64,100);
      assert.ok(synth.render(4096).some(value=>Math.abs(value)>.001),'Packaged DX7 object preset must be audible');
    }
  } finally { for (const synth of synths) synth.dispose(); }
  console.log('Staged DX7 verified: vendored modules, Apache notices and audible PCM at 44100/48000 Hz.');
}
if (manifest.additionalInstruments?.includes('snes')) {
  const {SnesDspCore} = await import(pathToFileURL(join(dir,'spc.js')));
  const {SnesSynth} = await import(pathToFileURL(join(dir,'snessynth.js')));
  const {default:moduleFactory} = await import(pathToFileURL(join(root,'generated/spc_wasm.js')));
  const core = await SnesDspCore.create({moduleFactory, moduleOptions:{wasmBinary:readFileSync(join(root,'generated/spc_wasm.wasm'))}});
  assert.match(readFileSync(join(root,'licenses/snes-spc/LICENSE'),'utf8'), /LESSER GENERAL PUBLIC LICENSE/);
  assert.match(readFileSync(join(root,'sources/wasm/spc_wasm.cpp'),'utf8'), /SPC_DSP/);
  assert.match(readFileSync(join(root,'sources/scripts/build_spc_wasm.sh'),'utf8'), /em\+\+/);
  assert.match(readFileSync(join(root,'sources/third_party/snes-spc/README.md'),'utf8'), /ec8ee2bbe30451614c1d02a83f7af1c97d497d45/);
  const synth = new SnesSynth({core});
  try {
    const sample=synth.loadBRR(new Uint8Array([0xc3,0x13,0x57,0x75,0x31,0xfd,0xb9,0x9b,0xdf]),{baseFrequencyHz:2000,loopStartSamples:0});
    synth.setPreset(0,{sample,gain:127}); synth.noteOn(0,'C4');
    const left=new Float32Array(4096),right=new Float32Array(4096);
    synth.renderInto(left,right);
    assert.ok(left.every(Number.isFinite)&&right.every(Number.isFinite));
    assert.ok(left.some(value=>Math.abs(value)>.001),'Packaged SNES DSP must produce audible PCM');
    assert.equal(synth.snapshot().ram.length,65536);
    assert.equal(core.sampleRate,32000);
  } finally {synth.dispose();}
  console.log('Staged SNES verified: original BRR produces 32kHz stereo PCM; LGPL notices and corresponding source included.');
}
console.log(`Staged runtime verified: ${yamaha.length} chip renderers; all ${manifest.chips.length} WASM engines loaded.`);
