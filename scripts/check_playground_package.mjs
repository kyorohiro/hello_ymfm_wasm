import {SourceTextModule} from 'node:vm';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
const root=resolve(process.argv[2]);let count=0;const errors=[];
function check(file,spec){if(!spec.startsWith('.'))return;const target=resolve(dirname(file),spec.split(/[?#]/)[0]);count++;if(!existsSync(target)||relative(root,target).startsWith('..'))errors.push(`${relative(root,file)}: ${spec}`);}
function walk(dir){for(const ent of readdirSync(dir,{withFileTypes:true})){if(['vendor','examples','defaults','samples'].includes(ent.name))continue;const f=resolve(dir,ent.name);if(ent.isDirectory()){walk(f);continue;}if(!f.endsWith('.js'))continue;const src=readFileSync(f,'utf8');const mod=new SourceTextModule(src);for(const spec of mod.dependencySpecifiers)check(f,spec);for(const m of src.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import.meta.url/g))check(f,m[1]);}}
walk(root);
for(const file of ['playground_mode_starters.js','playground_mode_examples.js','defaults/index.js',...['genesis','genesis-nuked','genesis-full','genesis-full-nuked','pc98-26','pc98','neogeo','neogeo-b','gameboy','nes','snes','x68000','pc-engine','game-gear','master-system'].map(mode=>`defaults/${mode}/index.js`)])if(!existsSync(resolve(root,file)))errors.push(file);
for(const mode of ['game-gear','master-system'])if(!existsSync(resolve(root,`tetorica-playground-${mode}.d.ts`)))errors.push(`tetorica-playground-${mode}.d.ts`);
for(const file of ['playground_audio_input.js','playground_sample_assets.js','playground_sample_editor.css','playground_sample_editor_worker.js',
  'js/playground_sample_edit.js','js/playground_sample_instrument.js','js/playground_keyboard.js','tetorica-playground-mega-cd.d.ts','defaults/mega-cd/index.js',
  'examples/mega-cd/megacd-pcm-loop.js','examples/mega-cd/megacd-fm-pcm.js','examples/mega-cd/megacd-sampler.js',
  'examples/gameboy/gameboy-sampler.js','examples/pc98/pc98-sampler.js','examples/neogeo/neogeo-sampler.js'])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['js/native_runtime_synth.js','js/playground_native_primary.js',
  ...['nes','snes','x68000','huc6280'].map(chip=>`tetorica-playground-${chip}.d.ts`),
  ...['huc6280','okim6258'].flatMap(chip=>[`js/${chip}audioengine.js`,`js/${chip}synth.js`,`js/playground_${chip}.js`,`js/playground_${chip}_audio.js`,`js/playground_${chip}_worklet.js`,`generated/${chip}_wasm.js`,`generated/${chip}_wasm.wasm`,`licenses/mame-${chip}/LICENSE`,`licenses/mame-${chip}/README.md`]),
  'examples/nes/nes-mode-pulse.js','examples/nes/nes-mode-fds.js','examples/nes/nes-mode-rhythm.js',
  'examples/snes/snes-mode-brr.js','examples/snes/snes-mode-stereo.js',
  'examples/x68000/x68000-mode-opm.js','examples/x68000/x68000-mode-adpcm.js',
  'examples/pc-engine/pce-mode-wave.js','examples/pc-engine/pce-mode-stereo.js','examples/pc-engine/pce-mode-noise.js',
])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['tetorica-playground-gameboy.d.ts','js/gameboy_runtime_synth.js','js/playground_gameboy_worklet.js','generated/gameboy_apu_wasm.js','generated/gameboy_apu_wasm.wasm','examples/gameboy/gameboy-mode-pulse.js','licenses/mame-gameboy/LICENSE'])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['js/rf5c164.js','js/playground_rf5c164.js','js/playground_rf5c164_audio.js','js/rf5c164-worklet.js','generated/rf5c164_wasm.js','generated/rf5c164_wasm.wasm','licenses/mame-rf5c164/LICENSE','licenses/mame-rf5c164/README.md','examples/genesis/rf5c164-sine.js','llms.txt','js/playground_nes.js','js/playground_nes_audio.js','js/playground_nes_worklet.js','js/nesapu.js','js/nesapusynth.js','js/nesapuaudioengine.js','js/fds_audio.js','licenses/jsnes/LICENSE','licenses/jsnes/AUTHORS.md','licenses/fixnes-fds/LICENSE','examples/nes/nes-apu-tones.js','examples/nes/nes-fds-wave.js','examples/nes/nes-dmc-sample.js'])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['js/playground_dx7.js','js/playground_dx7_audio.js','js/playground_dx7_worklet.js','js/msfa_dx7/src/index.js','js/msfa_dx7/src/sysex.js','js/msfa_dx7/wasm/msfa.wasm','js/msfa_dx7/LICENSE','js/msfa_dx7/THIRD_PARTY_NOTICES.md','js/msfa_dx7/README.vendor.md','js/msfa_dx7/vendor/msfa/COPYING','js/msfa_dx7/vendor/msfa/UPSTREAM.md','examples/dx7/dx7-init-sine.js'])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['js/msfa_dx7/src/preset.js','js/msfa_dx7/src/preset.d.ts','examples/dx7/dx7-object-preset.js'])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['js/spc.js','js/snessynth.js','js/spc_resampler.js','js/playground_snes.js','js/playground_snes_audio.js','js/playground_snes_worklet.js','generated/spc_wasm.js','generated/spc_wasm.wasm','licenses/snes-spc/LICENSE','sources/third_party/snes-spc/snes_spc/SPC_DSP.cpp','sources/wasm/spc_wasm.cpp','sources/scripts/build_spc_wasm.sh','examples/snes/snes-brr-melody.js'])if(!existsSync(resolve(root,file)))errors.push(file);
if(errors.length){console.error('ERROR: missing or out-of-package dependencies:\n'+errors.join('\n'));process.exit(1);}console.log(`PASS: ${count} local module/asset references plus all mode starters, native APIs, WASM and release licenses`);
