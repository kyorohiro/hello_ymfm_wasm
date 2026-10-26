// Shared PWM source and provenance for runtime distributions.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function copyPwmSources(stage){
  // Runtime distributions need a standalone recipe, not the checkout's SDK
  // dispatcher shim. Copy its exact inputs from the pinned source release.
  const sdk=join(root,'third_party/tetorica-soundchip-native');
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const pin=JSON.parse(await readFile(join(root,'third_party/soundchip-sdk.json'),'utf8'));
  const manifestBytes=await readFile(join(sdk,'RELEASE-MANIFEST.json'));
  if(sha(manifestBytes)!==pin.manifestSha256)throw new Error('PWM SDK manifest hash mismatch');
  const manifest=JSON.parse(manifestBytes),required=['wasm/pwm32x_core.h','wasm/pwm32x_wasm.cpp','scripts/build_pwm32x_wasm.sh'];
  const inputs=[...required,...Object.keys(manifest.files).filter(name=>name.startsWith('vendor/mame-32x-pwm/'))];
  const files=await Promise.all(inputs.map(async name=>{
    const expected=manifest.files[name],bytes=await readFile(join(sdk,name));
    if(!expected||sha(bytes)!==expected.sha256||bytes.length!==expected.size)throw new Error(`PWM SDK source hash mismatch: ${name}`);
    return {name,bytes};
  }));
  for(const {name,bytes} of files){
    const relative=name.replace(/^vendor\/mame-32x-pwm\//,'third_party/mame-32x-pwm/');
    const target=join(stage,'sources',relative);
    await mkdir(join(target,'..'),{recursive:true});
    await writeFile(target,bytes);
  }
  await writeFile(join(stage,'sources/PWM32X.md'),`# 32X PWM shared source

The asynchronous PWM factory uses this C++ core through WASM. Tauri Native builds the same core directly. The synchronous JavaScript constructor remains available for compatibility/reference.

From this sources directory, run \`sh scripts/build_pwm32x_wasm.sh docs/generated\` with Emscripten installed. The explicit output argument writes the loader/binary to \`docs/generated/\`; the recipe default is \`dist/wasm/\`. The standalone recipe, core, wrapper and provenance come from the pinned SDK source release; no SDK checkout, Python importer or network access is needed to build this bundle. MAME provenance files are retained under \`third_party/mame-32x-pwm/\`.

MAME-derived FIFO/routing/timer code uses BSD-3-Clause, copyright David Haywood. See \`third_party/mame-32x-pwm/LICENSE\` and its README for the pinned upstream revision and host PCM differences. The original upstream source is included. No CPU, DMA or analog PWM filtering is emulated.
`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_pwm_sources.mjs <stage>');
  await copyPwmSources(resolve(process.argv[2]));
}
