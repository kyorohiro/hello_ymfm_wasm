// SPDX-License-Identifier: BSD-3-Clause
import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {copyScspSources} from './copy_scsp_sources.mjs';
import {SCSP_SSF_BUILD_INPUTS, checkScspSsfBuild} from './scsp_ssf_artifacts.mjs';

const root = fileURLToPath(new URL('../',import.meta.url)), stage = resolve(process.argv[2]);
await checkScspSsfBuild();
await copyScspSources(stage);
for (const [directory, files] of Object.entries({
  'synth-scsp':'song_player.js song_source.js ssf_source.js scsp_ssf_engine.js scsp_ssf_worker.js scsp_ssf_wasm.js',
  'synth-spu':'psf_song_preview.js psf_song_source.js psf_playback_core.js psf_live_snapshot.js psf_song_interaction.js spu_synth_levels.js',
  playground:'playground_ps1_psf.js playground_ps1_vab.js',
  synth:'synth_code_output.js',
  'synth-vsu':'audio.js vgm.js worklet.js vsu.js vsu.wasm ch5.js envelope.js timed-processor.js timed-operations.js vgm-transport.js vgm-seek.js vgm-seek-client.js vgm-seek-worker.js',
  js:'scsp.js soundchip_pitch.js register_timed_processor.js register_plan_validation.js playground_performance_queue.js',
  generated:'scsp_wasm.js scsp_wasm.wasm psf-player scsp-ssf',
})) {
  await mkdir(join(stage,directory),{recursive:true});
  for (const file of files.split(' ')) await cp(join(root,'docs',directory,file),join(stage,directory,file),{recursive:true});
}
const entry = join(stage,'console_songs.js');
await writeFile(entry,(await readFile(entry,'utf8')).replaceAll("from '../","from './"));
await mkdir(join(stage,'sources'),{recursive:true});
execFileSync('zip',['-q','-r',join(stage,'sources/console-song-engines.zip'),...SCSP_SSF_BUILD_INPUTS,
  'third_party/play-psf','tetorica_src/wasm/psf_player','scripts/build_psf_player.mjs',
  'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu'],{cwd:root});
