// Shared runtime payload for the flat runtime ZIP and the browser-example ZIP.
import {readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyOpnaRhythm} from './copy_opna_rhythm.mjs';
import {copySpcSources} from './copy_spc_sources.mjs';
import {copyNesSources} from './copy_nes_sources.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const stage = resolve(process.argv[2]);
const nested = process.argv[3] === 'js';
await copyOpnaRhythm(stage, nested ? 'js' : '.');
const jsDir = nested ? join(stage,'js') : stage;
mkdirSync(jsDir,{recursive:true});
mkdirSync(join(stage,'generated'),{recursive:true});
const chips = 'ay8910 gameboy_apu huc6280 k051649 nesapu nuked_opn2 okim6258 rf5c164 segapcm segapsg spc y8950 ym2151 ym2203 ym2413 ym2608 ym2610b ym2612 ym3438 ym3526 ym3812 ymf262 ymf276 ymf278b ymf288'.split(' ');
for (const chip of chips) for (const ext of ['js','wasm']) {
  const name = `${chip}_wasm.${ext}`;
  const source = join(root,'docs/generated',name);
  if (!existsSync(source)) throw new Error(`Missing ${name}; build this chip before packaging the full runtime`);
  copyFileSync(source,join(stage,'generated',name));
}
const modules = readdirSync(join(root,'web')).filter(n=>n.endsWith('.js') && !n.endsWith('.test.js')).sort();
for (const name of modules) {
  let source=readFileSync(join(root,'web',name),'utf8');
  // Match the established docs/js layout for module-relative generated assets.
  if (nested && (name.includes('worklet') || ['playground_nes_audio.js','vgm_runtime.js','spc_audio.js','playground_spc_audio.js','playground_snes_audio.js','playground_rf5c164_audio.js','playground_ym2608_audio.js','playground_gameboy_audio.js','playground_opl_audio.js','playground_ym2413_audio.js','playground_ay8910_audio.js'].includes(name)))
    source=source.replaceAll('./generated/', '../generated/');
  if (name === 'nesapu.js') source=source.replace('../docs/js/nesapuaudioengine.js', './nesapuaudioengine.js');
  if(name==='nesapu_wasm.js'){
    const expression="(import.meta.url.includes('/web/')?'../docs/generated/':'../generated/')";
    if(!source.includes(expression))throw new Error('Missing NES WASM default asset base');
    source=source.replace(expression,JSON.stringify(nested?'../generated/':'./generated/'));
  }
  if (name === 'soundchip.js') {
    source=source.replace("(import.meta.url.includes('/web/') ? '../docs/generated/' : '../generated/')", JSON.stringify(nested ? '../generated/' : './generated/'));
  }
  writeFileSync(join(jsDir,name),source);
}
// Retain the Analyzer's JavaScript compatibility/reference renderer. The
// asynchronous NES factory uses the generated shared-core WASM pair above.
for (const name of ['nesapuaudioengine.js','fds_audio.js']) copyFileSync(join(root,'docs/js',name),join(jsDir,name));
const {cpSync} = await import('node:fs');
cpSync(join(root,'docs/js/nes_apu_vendor'),join(jsDir,'nes_apu_vendor'),{recursive:true});
// Keep the DX7 package's module/WASM layout, local JS extensions and Apache notices.
cpSync(join(root,'web/msfa_dx7'),join(jsDir,'msfa_dx7'),{recursive:true});
await copySpcSources(stage);
await copyNesSources(stage);
const dx7Version = JSON.parse(readFileSync(join(root,'web/msfa_dx7/package.json'),'utf8')).version;
for (const name of ['jsnes','fixnes-fds']) cpSync(join(root,'third_party',name),join(stage,'licenses',name),{recursive:true});
copyFileSync(join(root,'web/native_audio_effect.wasm'),join(jsDir,'native_audio_effect.wasm'));
copyFileSync(join(root,'web/soundchip.md'),join(jsDir,'soundchip.md'));
const notices = ['nuked-opn2', 'mame-ay8910','mame-gameboy','mame-huc6280','mame-k051649','mame-okim6258','mame-okim6295','mame-rf5c164','mame-segapcm','mame-32x-pwm'];
for (const name of notices) {
  const dir=join(stage,'licenses',name); mkdirSync(dir,{recursive:true});
  for (const file of ['LICENSE','README.md']) copyFileSync(join(root,'third_party',name,file),join(dir,file));
}
writeFileSync(join(stage,'THIRD_PARTY_LICENSES.txt'), `ymfm: BSD-3-Clause; see LICENSE.\n${notices.map(n=>`${n}: see licenses/${n}/LICENSE and README.md.`).join('\n')}\nNuked-OPN2 is LGPL-2.1-or-later; the MAME adaptations listed above are BSD-3-Clause.\nNES APU: JSNES (Apache-2.0), FDS: fixNES (MIT); see licenses/jsnes, licenses/fixnes-fds and licenses/tetorica-nes. The default WASM port and reproducible source are described in sources/NES-FDS.md.\nDX7: tetorica-msfa-dx7-wasm ${dx7Version} / Google MSFA (Apache-2.0); see ${nested?'js/':''}msfa_dx7/LICENSE, THIRD_PARTY_NOTICES.md and README.vendor.md.\nSPC700 / S-DSP: snes_spc (LGPL-2.1-or-later); see licenses/snes-spc and sources/SNES-SPC.md for corresponding source and rebuilding.\nNo external instrument/sample ROMs are included.\n`);
writeFileSync(join(stage,'runtime-manifest.json'), JSON.stringify({modules:[...modules,'nesapuaudioengine.js','fds_audio.js',...readdirSync(join(root,'docs/js/nes_apu_vendor')).filter(n=>n.endsWith('.js')).map(n=>'nes_apu_vendor/'+n),'msfa_dx7/src/index.js','msfa_dx7/src/sysex.js','msfa_dx7/src/preset.js'],javascriptChips:[],additionalInstruments:['dx7','snes'],chips,layout:nested?'js':'flat'},null,2)+'\n');
writeFileSync(join(stage,'RUNTIME.md'), `# Full web runtime\n\nIncludes all ${modules.length} top-level web runtime modules and ${chips.length} generated chip/engine pairs.\n\n${chips.join(', ')}\n\nNES/FDS asynchronous creation uses the shared C++ core through nesapu_wasm. Its synchronous NesApu constructor retains the JavaScript compatibility/reference renderer. See sources/NES-FDS.md for rebuilding and licenses/tetorica-nes for provenance.\n\nYM2610 uses ym2610b with variant:false; YM2610B is the default.\nChip APIs and high-level Synth coverage differ; inclusion does not imply a common Synth API for every chip.\nNo external sample/instrument ROMs are bundled. In particular, ym2608_adpcm_rom.bin and yrw801.rom are excluded.\n\nImport only the chip you need. Files in the archive do not initialize engines automatically.\nFor a smaller application deployment, retain your entry point's dependencies, its WASM pair, and applicable licenses.\n\nYamaha convenience factory:\n\n\`\`\`javascript\nimport {createSoundChip} from './${nested?'js/':''}soundchip.js';\nconst chip = await createSoundChip('ym2610b');\ntry { const pcm = chip.generateStereo(128); } finally { chip.dispose(); }\n\`\`\`\n\nOther chips use their individual wrappers/audio engines. See runtime-manifest.json for the exact contents.\n`);
console.log(`Full runtime copied: ${modules.length} modules, ${chips.length} chip/engine pairs.`);
