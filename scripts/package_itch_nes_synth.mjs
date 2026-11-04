// SPDX-License-Identifier: BSD-3-Clause
// Compatibility entry point; new packages use the 2A03 product name.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {package2a03Synth, validate2a03SynthVersion} from './package_itch_2a03_synth.mjs';
export {package2a03Synth as packageNesSynth, validate2a03SynthVersion as validateNesSynthVersion};
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length>3) throw new Error('Usage: node scripts/package_itch_nes_synth.mjs [VERSION]');
  console.log(JSON.stringify(await package2a03Synth({version:process.argv[2]??'dev'}),null,2));
}
