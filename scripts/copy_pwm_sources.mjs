// Shared PWM source and provenance for runtime distributions.
import {cp,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function copyPwmSources(stage){
  for(const name of ['wasm/pwm32x_core.h','wasm/pwm32x_wasm.cpp','scripts/build_pwm32x_wasm.sh','third_party/mame-32x-pwm']){
    const target=join(stage,'sources',name);
    await mkdir(join(target,'..'),{recursive:true});
    await cp(join(root,name),target,{recursive:true});
  }
  await writeFile(join(stage,'sources/PWM32X.md'),`# 32X PWM shared source

The asynchronous PWM factory uses this C++ core through WASM. Tauri Native builds the same core directly. The synchronous JavaScript constructor remains available for compatibility/reference.

From this sources directory, run \`sh scripts/build_pwm32x_wasm.sh\` with Emscripten installed. The generated loader/binary are written to \`docs/generated/\`. Source files retain their original relative paths.

MAME-derived FIFO/routing/timer code uses BSD-3-Clause, copyright David Haywood. See \`third_party/mame-32x-pwm/LICENSE\` and its README for the pinned upstream revision and host PCM differences. The original upstream source is included. No CPU, DMA or analog PWM filtering is emulated.
`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_pwm_sources.mjs <stage>');
  await copyPwmSources(resolve(process.argv[2]));
}
