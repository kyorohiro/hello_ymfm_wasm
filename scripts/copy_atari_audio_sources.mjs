// SPDX-License-Identifier: BSD-3-Clause
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ATARI_AUDIO_PLAYER_BUILD_INPUTS, checkAtariAudioPlayerBuild} from './atari_audio_player_artifacts.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const record = bytes => ({bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
export const ATARI_AUDIO_PLAYER_OUTPUTS = Object.freeze(['atari-audio-player.wasm', 'atari-audio-player-build.json']);

/** Ship the independent reference player and a complete offline rebuild tree.
 * The existing instrument SDK and its provenance remain separate.
 */
export async function copyAtariAudioSources(stage, {root = repositoryRoot} = {}) {
  const build = await checkAtariAudioPlayerBuild({root});
  const inputs = [], generated = [], inputPaths = [], payload = new Map();
  for (const sourcePath of ATARI_AUDIO_PLAYER_BUILD_INPUTS) {
    const bytes = await readFile(join(root, sourcePath)), actual = record(bytes), expected = build.inputs[sourcePath];
    if (!expected || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
      throw new Error(`AtariAudio build input mismatch: ${sourcePath}`);
    const path = `sources/atari-audio-player/${sourcePath}`;
    payload.set(path, bytes); inputs.push({path, sourcePath, ...actual}); inputPaths.push(sourcePath);
  }
  for (const name of ATARI_AUDIO_PLAYER_OUTPUTS) {
    const sourcePath = `docs/generated/atari-audio-player/${name}`, bytes = await readFile(join(root, sourcePath));
    const path = `generated/atari-audio-player/${name}`, actual = record(bytes);
    if (name.endsWith('.wasm') && (actual.bytes !== build.output.bytes || actual.sha256 !== build.output.sha256))
      throw new Error('AtariAudio WASM output mismatch');
    payload.set(path, bytes); generated.push({path, ...actual}); inputPaths.push(sourcePath);
  }
  // Keep separate top-level notices discoverable in addition to the unchanged
  // source headers and upstream README within the complete source kit.
  for (const [sourcePath, path] of [
    ['third_party/atari-audio/LICENSE', 'licenses/atari-audio/LICENSE'],
    ['third_party/atari-audio/UPSTREAM_README.md', 'licenses/atari-audio/UPSTREAM_README.md'],
    ['third_party/atari-audio/src/external/Musashi/readme.txt', 'licenses/musashi/readme.txt'],
    ['third_party/atari-audio/src/external/Musashi/m68k.h', 'licenses/musashi/m68k.h'],
    ['third_party/atari-audio/src/external/ice_24.cpp', 'licenses/ice/ice_24.cpp'],
    ['third_party/atari-audio/src/external/lzh.cpp', 'licenses/lzh/lzh.cpp'],
  ]) payload.set(path, await readFile(join(root, sourcePath)));
  payload.set('sources/ATARI-AUDIO.json', Buffer.from(JSON.stringify({
    schemaVersion: 1, component: 'ym2149-atari-audio-reference-player',
    upstream: build.upstream, build, inputs, generated,
  }, null, 2) + '\n'));
  payload.set('sources/ATARI-AUDIO.md', Buffer.from(`# AtariAudio reference playback sources and rebuilding

SNDH and YM reference playback uses AtariAudio ${build.upstream.version}, pinned to
commit \`${build.upstream.revision}\` of
https://github.com/arnaud-carre/AtariAudio. Its MIT license, Karl Stenerud's
Musashi license, Hans Wessels' public-domain ICE notice and the LZH source
credits are retained in the source tree and in ../licenses/.

[ATARI-AUDIO.json](ATARI-AUDIO.json) records every native build input and both
shipped outputs with SHA-256 hashes. The browser transport and module Worker
remain readable in ../synth-ym2149-st/atari_engine.js and atari_worker.js.
The standalone WASM lives in ../generated/atari-audio-player/; it uses no
generated JavaScript factory. No music files from upstream are included.

The complete rebuild tree is [atari-audio-player/](atari-audio-player/). It keeps
the repository paths expected by the original build and verification scripts.
With Node.js and Emscripten installed, run from that directory:

\`\`\`sh
sh scripts/build_atari_audio_player_wasm.sh /tmp/tetorica-atari-audio-player
cp /tmp/tetorica-atari-audio-player/atari-audio-player.wasm ../../generated/atari-audio-player/
cp /tmp/tetorica-atari-audio-player/atari-audio-player-build.json ../../generated/atari-audio-player/
\`\`\`

The reference player is separate from the MAME-derived AY / YM instrument core.
SNDH replays its Atari 68000 program and can include STE DAC audio; the Live
view observes the three YM voices. Consult third_party/atari-audio/PATCHES.md
for local changes, limits, formats and retained upstream attributions.
`));
  for (const [path, bytes] of payload) {
    await mkdir(dirname(join(stage, path)), {recursive: true});
    await writeFile(join(stage, path), bytes);
  }
  return {inputs: inputs.length, files: payload.size, revision: build.upstream.revision, inputPaths, generated};
}
