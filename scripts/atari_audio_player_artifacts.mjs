#!/usr/bin/env node
// SPDX-License-Identifier: BSD-3-Clause
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const vendorPath = 'third_party/atari-audio';
const manifest = JSON.parse(await readFile(join(repositoryRoot, vendorPath, 'upstream.json'), 'utf8'));
const revision = '1dd9fca810a4f00b4b5e6a5348872ac0a21d88fb';
const defaultDirectory = join(repositoryRoot, 'docs/generated/atari-audio-player');
const digest = bytes => ({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });

export const ATARI_AUDIO_PLAYER_BUILD_INPUTS = Object.freeze([
  'LICENSE',
  ...manifest.files.map(file => `${vendorPath}/${file.path}`),
  `${vendorPath}/upstream.json`, `${vendorPath}/PATCHES.md`, `${vendorPath}/local.patch`,
  'tetorica_src/wasm/atari_audio_player_wasm.cpp',
  'scripts/build_atari_audio_player_wasm.sh', 'scripts/atari_audio_player_artifacts.mjs',
]);

export async function checkAtariAudioPlayerSource(root = repositoryRoot) {
  const recorded = JSON.parse(await readFile(join(root, vendorPath, 'upstream.json'), 'utf8'));
  if (recorded.revision !== revision || recorded.repository !== 'https://github.com/arnaud-carre/AtariAudio') throw new Error('AtariAudio upstream pin differs');
  for (const file of recorded.files) {
    const actual = digest(await readFile(join(root, vendorPath, file.path)));
    if (actual.sha256 !== file.sha256) throw new Error(`AtariAudio vendored source differs: ${file.path}`);
  }
  return recorded;
}

async function inputDigests(root) {
  await checkAtariAudioPlayerSource(root);
  return Object.fromEntries(await Promise.all(ATARI_AUDIO_PLAYER_BUILD_INPUTS.map(async path => [path, digest(await readFile(join(root, path)))])));
}

function receipt(inputs, wasm) {
  return {
    schemaVersion: 1,
    component: 'ym2149-atari-audio-reference-player',
    upstream: { repository: 'https://github.com/arnaud-carre/AtariAudio', revision, version: '1.31' },
    sampleRate: 44100,
    channels: 1,
    maximumFileBytes: 8 * 1024 * 1024,
    maximumMemoryBytes: 64 * 1024 * 1024,
    maximumRenderFrames: 4096,
    inputs,
    output: digest(wasm),
  };
}

export async function recordAtariAudioPlayerBuild(directory = defaultDirectory) {
  const wasm = await readFile(join(directory, 'atari-audio-player.wasm'));
  await WebAssembly.compile(wasm);
  const record = receipt(await inputDigests(repositoryRoot), wasm);
  await writeFile(join(directory, 'atari-audio-player-build.json'), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

export async function checkAtariAudioPlayerBuild({ root = repositoryRoot, directory = join(root, 'docs/generated/atari-audio-player') } = {}) {
  const record = JSON.parse(await readFile(join(directory, 'atari-audio-player-build.json'), 'utf8'));
  const expected = receipt(await inputDigests(root), await readFile(join(directory, 'atari-audio-player.wasm')));
  if (!isDeepStrictEqual(record, expected)) throw new Error('AtariAudio source/WASM receipt differs. Run sh scripts/build_atari_audio_player_wasm.sh');
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, directory] = process.argv.slice(2);
  if (action === '--record' && directory) await recordAtariAudioPlayerBuild(resolve(directory));
  else if (action === '--check-source' && !directory) await checkAtariAudioPlayerSource();
  else if (action === '--check' && !directory) await checkAtariAudioPlayerBuild();
  else throw new Error('Usage: atari_audio_player_artifacts.mjs --record DIRECTORY | --check-source | --check');
  process.stdout.write('AtariAudio source and artifact verification passed.\n');
}
