# CD-DA playback

CD-DA is an independent stereo PCM source. It can play alongside the selected
sound chips in Playground, including PC Engine's HuC6280. It is available with
Web Audio and the experimental Native backend; it does not open a second audio
device or use a JavaScript timer to advance playback.

Current CD-DA input supports **44,100 Hz, stereo, uncompressed PCM16 RIFF WAV**.
It does not load a game disc, BIOS, CUE/BIN image or compressed audio. PC Engine
CD-ROM² mode combines HuC6280 PSG, MSM5205 ADPCM and CD-DA. See
[PC Engine CD ADPCM](msm5205.md) for sample preparation and playback.

## Playground

Import a WAV into Virtual Files, then run:

```js
await cdda.load('/audio/track02.wav');
await cdda.play();
```

The `pce-cdda.js` example in PC Engine mode creates its own original stereo WAV
and mixes it with PSG. PC Engine CD-ROM² mode adds
`pce-cd-three-sources.js`, which also encodes an original ADPCM sample. Both
examples require no external audio file.

The transport API is asynchronous:

```js
await cdda.pause();
await cdda.seek(12.5);    // seconds from the start of the selected track
await cdda.resume();
log(await cdda.getState());
await cdda.stop();       // stop, rewind and cancel queued future CD-DA controls
await cdda.play();       // replay the selected track from its beginning
```

`play(trackNumber, {offset, at})` accepts a source offset in seconds and an
optional absolute audio-clock start time. `pause`, `resume`, `stop` and `seek`
also accept `{at}`. Future commands acknowledge admission; their returned
`scheduledFrame` is the output-frame deadline, not a claim that playback has
already reached it. Prepare the track before relying on a start deadline.

`getState()` reads the audio-side state: `ready`, `playing`, `paused` or `ended`,
the selected track, `positionFrames`, `positionSeconds`, `durationFrames`,
`durationSeconds` and `outputFrame`. Source frames are always 44,100 Hz; output
frames use the actual device sample rate. Pause preserves fractional resampling
phase. Seeking to the duration ends playback; replay starts at frame zero.

Mixer has a separate `cdda` input for volume, stereo balance, Mute and Solo.
Muting advances playback silently. No additional normalization is applied.
Playground Stop, a retired Run or session shutdown cancels pending preparations
and releases this source. The device can also be used from Worker execution.

## Track manifests

Use an object or a JSON file stored in Virtual Files:

```js
await cdda.load({
  tracks: [
    {number: 2, file: '/disc/audio.wav', title: 'First song', startFrame: 0, endFrame: 441000},
    {number: 3, file: '/disc/audio.wav', title: 'Second song', startFrame: 441000, endFrame: 882000},
  ],
});
await cdda.play(3);
```

Track numbers are unique integers from 1 to 99. Ranges are half-open source
frame intervals `[startFrame, endFrame)`. Omitted start/end use the beginning/end
of that WAV. File paths above are absolute Virtual Files paths. No pregap or
data track is inferred. Only the selected WAV is read, and the selected range
is passed as PCM16 without expanding the entire file into Float32 channels.

The selected track is limited to 256 MiB of PCM16. Native counts the playing
track, pending upload and retained sources together within that budget. If a
large replacement would exceed it, stop the Playground Run and start a fresh
Run; replacing a track never silently deletes the previous source on failure.
Browser preparation copies the selected PCM16 bytes before transferring them,
so it does not detach the Virtual Files buffer. This is bounded in-memory
playback, not streaming from a physical disc or a compressed-file decoder.

## Offline output

The same renderer works without an AudioContext:

```js
import {readFile, writeFile} from 'node:fs/promises';
import {createCddaOffline} from './web/cdda_offline.js';
import {encodeWav} from './web/wav.js';

const offline = await createCddaOffline({sampleRate: 48000});
try {
  await offline.cdda.load(await readFile('track02.wav'));
  await offline.cdda.play();
  await writeFile('output.wav', new Uint8Array(encodeWav(offline.render(48000 * 10))));
} finally {
  offline.dispose();
}
```

Place this Node script at the repository root, beside `web/`.
For the npm package, import `tetorica-fm2612/cdda_offline.js` and
`tetorica-fm2612/wav.js` instead.

Pass existing synchronous engines in `sources: [engine]` to mix them on the
same frame clock. They must expose `processFrames(frames)` at the selected
output sample rate and remain owned by the caller. Their internal gain is
applied once. External source controls can be specified as
`{engine, volume, mute, pan}`; CD-DA itself uses `offline.mix(...)`.
`offline.schedule(outputFrame, actionOrCallback)` schedules CD-DA controls or
synchronous chip register writes at an exact output-frame boundary.

## Implementation and scope

The BSD-3-Clause C11 core is pinned under
`third_party/tetorica-soundchip-native/vendor/tetorica-cdda/`. Browser and offline playback use
the same core through a 2,257-byte WASM module, fixed 128 KiB memory and a 4 KiB
PCM input window. Audio rendering does not allocate, grow WASM memory, decode
whole tracks, read files or ask the UI to supply each block. Native reads its
immutable PCM16 source within the existing audio callback. It never frees the
last PCM owner on that callback.

Rebuild with `sh scripts/build_cdda_wasm.sh`; this checks the fixed SDK pin and
builds its original core and bridge. Runtime packages include the generated
WASM and self-contained sources under `sources/native/cdda/`. Their
`sources/CDDA.md` guide and `sources/CDDA.json` receipt record the fixed SDK and
standalone recipe; rebuilding a package needs Emscripten and no SDK checkout.
Existing VGM
commands and chip APIs are unchanged. A VGM without external CD-DA audio and
its timeline cannot reconstruct those tracks.

MSM5205 Native/WASM, Playground integration and the PSG + ADPCM + CD-DA example
are available; see [MSM5205](msm5205.md). Physical CD-ROM² controller emulation
and additional disc/compressed-audio import formats remain outside this module.
