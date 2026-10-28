import {SourceTextModule} from 'node:vm';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
const root=resolve(process.argv[2]);let count=0;const errors=[];
function check(file,spec){if(!spec.startsWith('.'))return;const target=resolve(dirname(file),spec.split(/[?#]/)[0]);count++;if(!existsSync(target)||relative(root,target).startsWith('..'))errors.push(`${relative(root,file)}: ${spec}`);}
function walk(dir){for(const ent of readdirSync(dir,{withFileTypes:true})){if(['vendor','examples','defaults','samples'].includes(ent.name))continue;const f=resolve(dir,ent.name);if(ent.isDirectory()){walk(f);continue;}if(!f.endsWith('.js'))continue;const src=readFileSync(f,'utf8');const mod=new SourceTextModule(src);for(const spec of mod.dependencySpecifiers)check(f,spec);for(const m of src.matchAll(/new URL\(\s*["']([^"']+)["']\s*,\s*import.meta.url/g))check(f,m[1]);}}
walk(root);
for(const file of [
  ...['pokey','pokey-dual'].flatMap(mode=>[`tetorica-playground-${mode}.d.ts`,`defaults/${mode}/index.js`]),
  'js/pokey.js','js/pokeysynth.js','js/pokeyaudioengine.js','js/playground_pokey.js',
  'pokey_vgm_import.js','playground_pokey_voice_panel.js','js/pokey_timeline.js','js/pokey_timeline_upload.js','js/pokey_timeline_builder.js',
  'js/playground_pokey_audio.js','js/playground_pokey_worklet.js','js/playground_pokey_inspector.js',
  'js/native_genesis_pokey.js','js/native_genesis_extra_pokey.js',
  'generated/pokey_wasm.js','generated/pokey_wasm.wasm',
  'licenses/libvgm-pokey/LICENSE','licenses/libvgm-pokey/README.md',
  'sources/POKEY.md','sources/POKEY-SDK.json','sources/scripts/build_pokey_wasm.sh',
  'sources/third_party/libvgm-pokey/pokey.cpp','sources/third_party/libvgm-pokey/pokey.h',
  'sources/third_party/libvgm-pokey/upstream/pokey.c','sources/wasm/pokey_wasm.cpp',
])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['js/adpcm_a_sample.js','examples/neogeo/neogeo-adpcm-a-drums.js','examples/genesis/chip-level-comparison.js'])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['tetorica-playground-msx.d.ts','tetorica-playground-msx-audio.d.ts','defaults/msx/index.js','defaults/msx-audio/index.js','playground_ay8910_voice_panel.js',
  'js/ay8910.js','js/ay8910synth.js','js/playground_ay8910.js','js/playground_ay8910_audio.js',
  'js/playground_ay8910_worklet.js','js/playground_ay8910_inspector.js','generated/ay8910_wasm.js','generated/ay8910_wasm.wasm',
  'licenses/mame-ay8910/LICENSE','licenses/mame-ay8910/README.md',
])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['playground_ym2413_voice_panel.js','js/ym2413synth.js','js/ym2413.js',
  'js/playground_ym2413.js','js/playground_ym2413_audio.js','js/playground_ym2413_worklet.js','js/playground_ym2413_inspector.js',
  'generated/ym2413_wasm.js','generated/ym2413_wasm.wasm',
])if(!existsSync(resolve(root,file)))errors.push(file);
for(const chip of ['ym3526','ym3812','y8950','ymf262'])for(const file of [
  `defaults/${chip}/index.js`,`tetorica-playground-${chip}.d.ts`,`js/${chip}synth.js`,
  `js/${chip}.js`,`js/${chip}audioengine.js`,`generated/${chip}_wasm.js`,`generated/${chip}_wasm.wasm`,
])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['playground_opl_voice_panel.js','js/opl_synth.js','js/playground_opl.js',
  'js/playground_opl_audio.js','js/playground_opl_worklet.js','js/playground_opl_inspector.js',
])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['playground_mode_starters.js','playground_mode_examples.js','defaults/index.js',...['genesis','genesis-nuked','genesis-full','genesis-full-nuked','pc98-26','pc98','neogeo','neogeo-b','gameboy','nes','snes','x68000','pc-engine','game-gear','master-system','dx7'].map(mode=>`defaults/${mode}/index.js`)])if(!existsSync(resolve(root,file)))errors.push(file);
for(const mode of ['game-gear','master-system','dx7'])if(!existsSync(resolve(root,`tetorica-playground-${mode}.d.ts`)))errors.push(`tetorica-playground-${mode}.d.ts`);
for(const file of ['playground_audio_input.js','playground_sample_assets.js','playground_sample_editor.css','playground_sample_editor_worker.js',
  'playground_mode_keyboard.js','playground_dx7_voice_panel.js','playground_gameboy_voice_panel.js','playground_nes_voice_panel.js','playground_snes_voice_panel.js','playground_ym2151_voice_panel.js','playground_okim6258_voice_panel.js','playground_huc6280_voice_panel.js','playground_cdrom2_audio_panels.js',
  'js/playground_keyboard_channels.js','js/playground_opn_inspector.js','js/playground_dx7_inspector.js','js/playground_snes_inspector.js','js/playground_native_voice_inspector.js','js/playground_ym2151_inspector.js','js/playground_okim6258_inspector.js','js/playground_huc6280_inspector.js',
  'js/playground_sample_edit.js','js/playground_sample_gameboy_preview.js','js/playground_sample_instrument.js','js/playground_keyboard.js','tetorica-playground-mega-cd.d.ts','defaults/mega-cd/index.js',
  'examples/mega-cd/megacd-pcm-loop.js','examples/mega-cd/megacd-fm-pcm.js','examples/mega-cd/megacd-sampler.js',
  'examples/gameboy/gameboy-sampler.js','examples/pc98/pc98-sampler.js','examples/neogeo/neogeo-sampler.js'])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['playground_extra_fm_editor.js','playground_opn_ssg_editor.js','playground_opna_sample_editor.js','playground_opnb_sample_editor.js','js/native_runtime_synth.js','js/playground_native_primary.js','js/native_genesis_wonderswan.js','js/native_genesis_extra_wonderswan.js','js/native_genesis_extra_segapsg.js','js/native_genesis_extra_ym2612.js','js/native_genesis_extra_ym2203.js','js/native_genesis_extra_ym2608.js','js/native_genesis_extra_ym2610.js','js/native_genesis_extra_ym2151.js','js/native_genesis_extra_ym2413.js','js/native_genesis_extra_ay8910.js','js/native_genesis_extra_register_voice.js','js/native_genesis_extra_opl.js','js/native_genesis_extra_rf5c164.js','js/native_genesis_extra_okim6258.js','js/native_genesis_extra_gameboy.js','js/native_genesis_extra_nes.js','js/native_genesis_extra_huc6280.js','js/native_genesis_extra_dx7.js','js/native_genesis_extra_pwm.js','js/native_genesis_extra_snes.js','js/native_genesis_extra_spc.js','js/opn_ssg_retained.js','js/native_genesis_extra_chip.js',
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
for(const file of ['js/nesapu_wasm.js','generated/nesapu_wasm.js','generated/nesapu_wasm.wasm',
  'licenses/tetorica-nes/LICENSE-JSNES','licenses/tetorica-nes/LICENSE-FDS','licenses/tetorica-nes/AUTHORS-JSNES.md','licenses/tetorica-nes/UPSTREAM-JSNES.md','licenses/tetorica-nes/UPSTREAM-FDS.md','licenses/tetorica-nes/README.md','licenses/jsnes/AUTHORS.md',
  'sources/third_party/tetorica-nes/nes_core.cpp','sources/third_party/tetorica-nes/nes_core.h','sources/wasm/nesapu_wasm.cpp','sources/scripts/build_nesapu_wasm.sh','sources/NES-FDS.md',
])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['js/msfa_dx7/src/preset.js','js/msfa_dx7/src/preset.d.ts','examples/dx7/dx7-object-preset.js','examples/dx7/dx7-live-parameters.js','examples/dx7/dx7-keyboard.js'])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['tetorica-playground-ps1.d.ts','playground_ps1_voice_panel.js','defaults/ps1/index.js','examples/ps1/ps1-stereo-voices.js','examples/ps1/ps1-adpcm-wave.js','js/ps1_spu.js','js/ps1_adpcm_encoder.js','examples/ps1/ps1-pcm-adpcm.js','js/ps1synth.js','js/ps1_resampler.js','js/playground_ps1.js','js/playground_ps1_audio.js','js/playground_ps1_worklet.js','js/playground_ps1_inspector.js','generated/ps1_spu_wasm.js','generated/ps1_spu_wasm.wasm','sources/PS1-SPU.json','sources/native/ps1/ps1_spu.cpp','licenses/mame-ps1-spu/LICENSE'])if(!existsSync(resolve(root,file)))errors.push(file);
for(const file of ['js/spc.js','js/snessynth.js','js/snes_brr_encoder.js','js/spc_resampler.js','js/playground_snes.js','js/playground_snes_audio.js','js/playground_snes_worklet.js','generated/spc_wasm.js','generated/spc_wasm.wasm','licenses/snes-spc/LICENSE','sources/third_party/snes-spc/snes_spc/SPC_DSP.cpp','sources/wasm/spc_wasm.cpp','sources/scripts/build_spc_wasm.sh','examples/snes/snes-brr-melody.js','examples/snes/snes-pcm-brr.js'])if(!existsSync(resolve(root,file)))errors.push(file);
if(errors.length){console.error('ERROR: missing or out-of-package dependencies:\n'+errors.join('\n'));process.exit(1);}console.log(`PASS: ${count} local module/asset references plus all mode starters, native APIs, WASM and release licenses`);
