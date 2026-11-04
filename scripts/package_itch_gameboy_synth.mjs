// SPDX-License-Identifier: BSD-3-Clause
// Compatibility entry point. New integrations use package_itch_dmg_synth.mjs.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packageDmgSynth} from './package_itch_dmg_synth.mjs';
export {packageDmgSynth as packageGameboySynth, validateDmgSynthVersion as validateGameboySynthVersion} from './package_itch_dmg_synth.mjs';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/package_itch_gameboy_synth.mjs [VERSION]');
  console.log(JSON.stringify(await packageDmgSynth({version:process.argv[2] ?? 'dev'}),null,2));
}
