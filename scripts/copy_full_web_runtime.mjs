// Shared runtime payload for the flat runtime ZIP and the browser-example ZIP.
import {readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyOpnaRhythm} from './copy_opna_rhythm.mjs';
import {copySpcSources} from './copy_spc_sources.mjs';
import {copyNesSources} from './copy_nes_sources.mjs';
import {copyPwmSources} from './copy_pwm_sources.mjs';
import {copyNukedSources} from './copy_nuked_sources.mjs';
import {copySegaPsgSources} from './copy_segapsg_sources.mjs';
import {copyPokeySources} from './copy_pokey_sources.mjs';
import {copyCddaSources} from './copy_cdda_sources.mjs';
import {copyMsm5205Sources} from './copy_msm5205_sources.mjs';
import {copyScspSources} from './copy_scsp_sources.mjs';
import {copyPs1Sources} from './copy_ps1_sources.mjs';
import {copySidSources} from './copy_sid_sources.mjs';
import {copySidModelSources} from './sid_model_artifacts.mjs';
import {copyRuntimeArtifactProfile, runtimeArtifactProfiles} from './runtime_artifact_profiles.mjs';
import {packagedRuntimeModule} from './runtime_module_layout.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const stage = resolve(process.argv[2]);
const nested = process.argv[3] === 'js';
await copyRuntimeArtifactProfile('full', stage, {root, layout: nested ? 'js' : 'flat'});
await copyOpnaRhythm(stage, nested ? 'js' : '.');
const jsDir = nested ? join(stage,'js') : stage;
mkdirSync(jsDir,{recursive:true});
mkdirSync(join(stage,'generated'),{recursive:true});
const additionalArtifacts = new Set(['sid','cdda','msm5205','ps1_spu','scsp','dx7','native_audio_effect']);
const chips = runtimeArtifactProfiles.full.filter(id => !additionalArtifacts.has(id));
const modules = readdirSync(join(root,'tetorica_src/runtime')).filter(n=>n.endsWith('.js') && !n.endsWith('.test.js')).sort();
for (const name of modules) {
  let source=readFileSync(join(root,'tetorica_src/runtime',name),'utf8');
  // Match the established docs/js layout for module-relative generated assets.
  if (nested && (name.includes('worklet') || ['msm5205_audio.js','msm5205_pcm.js','cdda_audio.js','cdda_pcm.js','cdda_offline.js','playground_nes_audio.js','playground_pwm_audio.js','vgm_runtime.js','spc_audio.js','playground_spc_audio.js','playground_snes_audio.js','playground_rf5c164_audio.js','playground_ym2608_audio.js','playground_gameboy_audio.js','playground_opl_audio.js','playground_ym2413_audio.js','playground_ay8910_audio.js','playground_wonderswan_audio.js','playground_pokey_audio.js','playground_scsp_audio.js'].includes(name)))
    source=source.replaceAll('./generated/', '../generated/');
  source = packagedRuntimeModule(source, name, {nested});
  writeFileSync(join(jsDir,name),source);
}
// Retain the Analyzer's JavaScript compatibility/reference renderer. The
// asynchronous NES factory uses the generated shared-core WASM pair above.
for (const name of ['nesapuaudioengine.js','fds_audio.js']) copyFileSync(join(root,'docs/js',name),join(jsDir,name));
const {cpSync} = await import('node:fs');
cpSync(join(root,'docs/js/nes_apu_vendor'),join(jsDir,'nes_apu_vendor'),{recursive:true});
// The shared artifact profile retains the complete DX7 vendor package and
// copies its WASM from the canonical generated directory.
await copySpcSources(stage);
await copyNesSources(stage);
await copyPwmSources(stage);
await copyNukedSources(stage);
await copySegaPsgSources(stage);
await copyPokeySources(stage);
await copyCddaSources(stage);
await copyMsm5205Sources(stage);
await copyPs1Sources(stage);
await copyScspSources(stage);
await copySidSources(stage);
await copySidModelSources(stage, {layout: nested ? 'js' : 'flat'});
// Type declarations are readable authoring sources, not compiled SID inputs.
copyFileSync(join(root,'tetorica_src/runtime/sid.d.ts'),join(stage,'sources/sid/tetorica_src/runtime/sid.d.ts'));
// The historical 6581 source copier also serves nested application archives.
// Keep this distribution's guide accurate for both runtime module layouts.
writeFileSync(join(stage,'sources/SID.md'),
  `# C64 SID / MOS 6581\n\nSee [the matching SID source kit](sid/README.md) for original source, marked patches, licenses, Native host and standalone WASM rebuild recipe. The core is a 6581 approximation under zlib; the Tetorica wrapper is BSD-3-Clause. It is separate from this package's fixed SDK snapshot. Browser modules remain readable ${nested?'under js/':'at the package root'}: [SidCore](../${nested?'js/':''}sid.js) and [SidSynth](../${nested?'js/':''}sidsynth.js).\n\nThe additional CPU-free 8580 Preview and its matching source kit are described in [SID8580.md](SID8580.md). Neither instrument requires a C64 CPU, ROM or song.\n`);
const dx7Version = JSON.parse(readFileSync(join(root,'tetorica_src/runtime/msfa_dx7/package.json'),'utf8')).version;
for (const name of ['jsnes','fixnes-fds']) cpSync(join(root,'third_party',name),join(stage,'licenses',name),{recursive:true});
copyFileSync(join(root,'tetorica_src/runtime/soundchip.md'),join(jsDir,'soundchip.md'));
const notices = ['nuked-opn2', 'mame-ay8910','mame-gameboy','mame-huc6280','mame-wonderswan','mame-k051649','mame-okim6258','mame-okim6295','libvgm-msm5205','mame-rf5c164','mame-segapcm','mame-32x-pwm'];
for (const name of notices.filter(name=>name!=='nuked-opn2')) {
  const dir=join(stage,'licenses',name); mkdirSync(dir,{recursive:true});
  for (const file of ['LICENSE','README.md']) copyFileSync(join(root,'third_party',name,file),join(dir,file));
}
writeFileSync(join(stage,'THIRD_PARTY_LICENSES.txt'), `ymfm: BSD-3-Clause; see LICENSE.\nSaturn SCSP: experimental standalone BSD-3-Clause MAME port by ElSemi and R. Belmont; see licenses/mame-scsp/LICENSE and sources/SCSP.md.\nPlayStation SPU: experimental standalone BSD-3-Clause MAME port by pSXAuthor and R. Belmont; see licenses/mame-ps1-spu/LICENSE and sources/PS1-SPU.md for complete source and rebuilding. The source and build recipe come from the fixed SDK, where PS1 SPU is cataloged as a separate instrument.\nC64 SID: chips/m6581 6581 approximation (zlib) and optional MIT sidera 8580 Preview with BSD-3-Clause Tetorica hosts. See licenses/chips-m6581/, sources/SID.md and sources/SID8580.md for matching source kits and rebuild recipes. The 8580 kit retains Rust/MIT, C64/zlib and Tetorica/BSD notices, including third_party/sidera/toolchain-notices/ and third_party/sid8580-machine-toolchain-notices/ inside sources/sid8580-machine/.\nPOKEY: BSD-3-Clause; see licenses/libvgm-pokey/ and sources/POKEY.md for the standalone adaptation, exact licensed upstream source, pinned provenance and rebuild recipe.\nCD-DA PCM: BSD-3-Clause; see licenses/tetorica-cdda/ and sources/CDDA.md for fixed SDK sources, provenance and standalone rebuilding.\nMSM5205 PCM and PC Engine ADPCM RAM helper: BSD-3-Clause; see licenses/tetorica-msm5205/ and sources/MSM5205.md for complete fixed SDK application-audio sources, attribution and standalone rebuilding.\nSega PSG: original Tetorica implementation, BSD-3-Clause; see licenses/tetorica_sega_psg/ and sources/SegaPSG.md. Hardware reference: SMS Power! SN76489 documentation by Maxim and contributors.\n${notices.map(n=>`${n}: see licenses/${n}/LICENSE and README.md.`).join('\n')}\nNuked-OPN2 is LGPL-2.1-or-later; corresponding source and standalone recipe: sources/Nuked-OPN2.md. The MAME adaptations listed above are BSD-3-Clause.\nNES APU: JSNES (Apache-2.0), FDS: fixNES (MIT); see licenses/jsnes, licenses/fixnes-fds and licenses/tetorica-nes. The default WASM port and reproducible source are described in sources/NES-FDS.md.\nDX7: tetorica-msfa-dx7-wasm ${dx7Version} / Google MSFA (Apache-2.0); see ${nested?'js/':''}msfa_dx7/LICENSE, THIRD_PARTY_NOTICES.md and README.vendor.md.\nSPC700 / S-DSP: snes_spc (LGPL-2.1-or-later); see licenses/snes-spc and sources/SNES-SPC.md for corresponding source and rebuilding.\nNo external instrument/sample ROMs are included.\n`);
writeFileSync(join(stage,'runtime-manifest.json'), JSON.stringify({modules:[...modules,'nesapuaudioengine.js','fds_audio.js',...readdirSync(join(root,'docs/js/nes_apu_vendor')).filter(n=>n.endsWith('.js')).map(n=>'nes_apu_vendor/'+n),'msfa_dx7/src/index.js','msfa_dx7/src/sysex.js','msfa_dx7/src/preset.js'],javascriptChips:[],additionalInstruments:['dx7','snes'],applicationAudio:['cdda','msm5205'],experimentalStandalone:['ps1-spu','scsp','sid'],sidModels:['6581','8580-preview'],chips,layout:nested?'js':'flat'},null,2)+'\n');
writeFileSync(join(stage,'RUNTIME.md'), `# Full web runtime\n\nIncludes all ${modules.length} top-level web runtime modules and ${chips.length} generated chip/engine pairs.\n\n${chips.join(', ')}\n\nC64 SID provides the CPU-free SidCore (6581 approximation), Sid8580Core (PAL 8580 Preview), SidSynth high-level voice/filter API and Web Audio Playground helpers. Import SidCore from sid.js or Sid8580Core from sid8580.js, then pass the core to new SidSynth({core}) from sidsynth.js. The browser Playground exposes C64 mode and its sid API; the package-root raw chip factory does not expose SID. The model adapters use generated/sid/sid.wasm and generated/sid8580-machine/sid8580-endpoint.wasm respectively, without a C64 CPU, ROM or per-cycle JavaScript loop. Research calibration profiles default Off. The matching machine WASM and receipt are retained with the 8580 source kit for independent rebuilding; the CPU-free adapter loads only the endpoint. These application-local artifacts remain separate from this package's fixed SDK snapshot. See sources/SID.md and sources/SID8580.md for complete readable sources, marked patches, licenses, toolchain notices and rebuilding. No .sid song-playback application or Native audio-device host is included.\n\nSaturn SCSP is another experimental standalone pair, with Scsp / ScspSynth and the Web Audio Playground API. Sources and the original rebuild recipe are under sources/scsp-sdk; see sources/SCSP.md. The package-root direct chip factory does not expose SCSP.\n\nPlayStation SPU is an additional experimental standalone pair from the fixed SDK, cataloged as a separate instrument. Import Ps1Spu from ps1_spu.js and inject generated/ps1_spu_wasm.js explicitly; Ps1Synth adds sample instruments and Ps1Resampler converts native PCM to a host rate. The Browser Playground provides experimental PS1 mode with the spu API; compatible Tauri hosts also support primary and independent SPUs through the same SDK C++ core, including Main/Worker control. The package-root createSoundChip() factory does not expose PS1. Complete BSD source, pristine upstream snapshots and the unchanged build recipe are included; see sources/PS1-SPU.md.\n\nCD-DA and MSM5205 are two additional application-audio WASM pairs, separate from the chip list. Their original C cores, bridges, BSD notices and SDK provenance are bundled. See sources/CDDA.md and sources/MSM5205.md for standalone recipes; no SDK checkout or importer is required.\n\nNES/FDS asynchronous creation uses the shared C++ core through nesapu_wasm. Its synchronous NesApu constructor retains the JavaScript compatibility/reference renderer. See sources/NES-FDS.md for rebuilding and licenses/tetorica-nes for provenance.\n\n32X PWM asynchronous creation uses the shared C++ core through pwm32x_wasm. The synchronous PWM32X constructor retains the JavaScript compatibility/reference renderer. Rebuild sources are in sources/wasm and sources/scripts; provenance is in licenses/mame-32x-pwm.\n\nYM2610 uses ym2610b with variant:false; YM2610B is the default.\nChip APIs and high-level Synth coverage differ; inclusion does not imply a common Synth API for every chip.\nNo external sample/instrument ROMs are bundled. In particular, ym2608_adpcm_rom.bin and yrw801.rom are excluded.\n\nImport only the chip you need. Files in the archive do not initialize engines automatically.\nFor a smaller application deployment, retain your entry point's dependencies, its WASM pair, and applicable licenses.\n\nName-based direct chip factory:\n\n\`\`\`javascript\nimport {createSoundChip} from './${nested?'js/':''}soundchip.js';\nconst chip = await createSoundChip('ym2610b');\ntry { const pcm = chip.generateStereo(128); } finally { chip.dispose(); }\n\`\`\`\n\nThe name-based factory also supports WonderSwan and POKEY direct PCM generation. Chip-specific wrappers and audio engines provide additional entry points. See runtime-manifest.json for the exact contents.\n`);
console.log(`Full runtime copied: ${modules.length} modules, ${chips.length} chip/engine pairs.`);
