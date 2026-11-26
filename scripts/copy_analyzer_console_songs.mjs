// SPDX-License-Identifier: BSD-3-Clause
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {copySid8580MachineSources} from './copy_sid8580_machine_sources.mjs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {copyScspSources} from './copy_scsp_sources.mjs';
import {SCSP_SSF_BUILD_INPUTS, checkScspSsfBuild} from './scsp_ssf_artifacts.mjs';

const root = fileURLToPath(new URL('../',import.meta.url)), stage = resolve(process.argv[2]);
await checkScspSsfBuild();
await copyScspSources(stage);
for (const [directory, files] of Object.entries({
  'sid-player':'audio.js models.js model_policy.js processor.js manual.js core.js core8580.js rsid_core.js roms.js',
  'sid8580-lab':'core.js parser.js psid_structure.js',
  'synth-scsp':'song_player.js song_source.js ssf_source.js scsp_ssf_engine.js scsp_ssf_worker.js scsp_ssf_wasm.js',
  'synth-spu':'psf_song_preview.js psf_song_source.js psf_playback_core.js psf_live_snapshot.js psf_song_interaction.js spu_synth_levels.js',
  playground:'playground_ps1_psf.js playground_ps1_vab.js',
  synth:'synth_code_output.js',
  'synth-vsu':'audio.js vgm.js worklet.js vsu.js vsu.wasm ch5.js envelope.js timed-processor.js timed-operations.js vgm-transport.js vgm-seek.js vgm-seek-client.js vgm-seek-worker.js',
  js:'sid_rsid.js sid_psid.js sid_waveforms.js scsp.js soundchip_pitch.js register_timed_processor.js register_plan_validation.js playground_performance_queue.js',
  generated:'sid-rsid sid-player sid8580-machine scsp_wasm.js scsp_wasm.wasm psf-player scsp-ssf',
})) {
  await mkdir(join(stage,directory),{recursive:true});
  for (const file of files.split(' ')) await cp(join(root,'docs',directory,file),join(stage,directory,file),{recursive:true});
}
for (const name of ['console_songs.js','sid_song.js']) {
  const entry = join(stage,name);
  await writeFile(entry,(await readFile(entry,'utf8')).replaceAll("from '../","from './"));
}
await mkdir(join(stage,'sources'),{recursive:true});
execFileSync('zip',['-q','-r',join(stage,'sources/console-song-engines.zip'),...SCSP_SSF_BUILD_INPUTS,
  'third_party/play-psf','tetorica_src/wasm/psf_player','scripts/build_psf_player.mjs',
  'third_party/tetorica-soundchip-native/vendor/mame-ps1-spu'],{cwd:root});

const sidKit = await mkdtemp(join(tmpdir(),'analyzer-sid-'));
try {
  await copySid8580MachineSources(sidKit);
  for (const name of ['sid-player','sid-rsid']) {
    await cp(join(root,'docs/sources',name),join(sidKit,'sources',name),{recursive:true});
  }
  execFileSync('zip',['-q','-r',join(stage,'sources/sid-song-engines.zip'),'sources'],{cwd:sidKit});
} finally {
  await rm(sidKit,{recursive:true,force:true});
}
