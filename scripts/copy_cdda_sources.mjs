// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026, kyorohiro.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyApplicationAudioSources} from './copy_application_audio_sources.mjs';
export const copyCddaSources=stage=>copyApplicationAudioSources(stage,'cdda');
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error('Usage: node scripts/copy_cdda_sources.mjs <stage>');
  await copyCddaSources(resolve(process.argv[2]));
}
