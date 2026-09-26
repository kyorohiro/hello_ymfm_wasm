// Shared runtime payload for the flat runtime ZIP and the browser-example ZIP.
import {readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const stage = resolve(process.argv[2]);
const nested = process.argv[3] === 'js';
const jsDir = nested ? join(stage,'js') : stage;
mkdirSync(jsDir,{recursive:true});
mkdirSync(join(stage,'generated'),{recursive:true});
const chips = 'ay8910 gameboy_apu huc6280 k051649 nuked_opn2 okim6258 rf5c164 segapcm segapsg y8950 ym2151 ym2203 ym2413 ym2608 ym2610b ym2612 ym3438 ym3526 ym3812 ymf262 ymf276 ymf278b ymf288'.split(' ');
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
  if (nested && (name.includes('worklet') || name === 'vgm_runtime.js' || name === 'playground_rf5c164_audio.js'))
    source=source.replaceAll('./generated/', '../generated/');
  if (name === 'soundchip.js') {
    source=source.replace("(import.meta.url.includes('/web/') ? '../docs/generated/' : '../generated/')", JSON.stringify(nested ? '../generated/' : './generated/'));
  }
  writeFileSync(join(jsDir,name),source);
}
copyFileSync(join(root,'web/native_audio_effect.wasm'),join(jsDir,'native_audio_effect.wasm'));
copyFileSync(join(root,'web/soundchip.md'),join(jsDir,'soundchip.md'));
const notices = ['nuked-opn2', 'mame-ay8910','mame-gameboy','mame-huc6280','mame-k051649','mame-okim6258','mame-rf5c164','mame-segapcm'];
for (const name of notices) {
  const dir=join(stage,'licenses',name); mkdirSync(dir,{recursive:true});
  for (const file of ['LICENSE','README.md']) copyFileSync(join(root,'third_party',name,file),join(dir,file));
}
writeFileSync(join(stage,'THIRD_PARTY_LICENSES.txt'), `ymfm: BSD-3-Clause; see LICENSE.\n${notices.map(n=>`${n}: see licenses/${n}/LICENSE and README.md.`).join('\n')}\nNuked-OPN2 is LGPL-2.1-or-later; the MAME adaptations listed above are BSD-3-Clause.\nNo external instrument/sample ROMs are included.\n`);
writeFileSync(join(stage,'runtime-manifest.json'), JSON.stringify({modules,chips,layout:nested?'js':'flat'},null,2)+'\n');
writeFileSync(join(stage,'RUNTIME.md'), `# Full web runtime\n\nIncludes all ${modules.length} top-level web runtime modules and ${chips.length} generated chip/engine pairs.\n\n${chips.join(', ')}\n\nYM2610 uses ym2610b with variant:false; YM2610B is the default.\nChip APIs and high-level Synth coverage differ; inclusion does not imply a common Synth API for every chip.\nNo external sample/instrument ROMs are bundled. In particular, ym2608_adpcm_rom.bin and yrw801.rom are excluded.\n\nImport only the chip you need. Files in the archive do not initialize engines automatically.\nFor a smaller application deployment, retain your entry point's dependencies, its WASM pair, and applicable licenses.\n\nYamaha convenience factory:\n\n\`\`\`javascript\nimport {createSoundChip} from './${nested?'js/':''}soundchip.js';\nconst chip = await createSoundChip('ym2610b');\ntry { const pcm = chip.generateStereo(128); } finally { chip.dispose(); }\n\`\`\`\n\nOther chips use their individual wrappers/audio engines. See runtime-manifest.json for the exact contents.\n`);
console.log(`Full runtime copied: ${modules.length} modules, ${chips.length} chip/engine pairs.`);
