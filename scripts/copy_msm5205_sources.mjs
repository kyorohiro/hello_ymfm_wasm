// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyApplicationAudioSources} from './copy_application_audio_sources.mjs';
export const copyMsm5205Sources=stage=>copyApplicationAudioSources(stage,'msm5205');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_msm5205_sources.mjs <stage>');
  await copyMsm5205Sources(resolve(process.argv[2]));
}
