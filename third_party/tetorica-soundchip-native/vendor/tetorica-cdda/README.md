# Tetorica CD-DA PCM device

An original BSD-3-Clause C11 stereo PCM player, shared without synthesis changes with `tetorica-fm2612`'s CD-DA module. It plays decoded audio data; it does not emulate a CD controller, SCSI commands, a disc drive, a CPU or a filesystem. See [NOTICE.md](NOTICE.md) for origin and [LICENSE](LICENSE) for terms.

## Native integration

Link `tetorica::cdda` and include `<tetorica/cdda.h>`. The public header forwards the original `cdda_pcm_*` functions and `cdda_pcm_state`. The core can also be compiled directly as C11 and called from C or C++14 without the rest of the SDK.

```c
#include <tetorica/cdda.h>

int render_track(const uint8_t *pcm, uint32_t bytes,
                 float *left, float *right, uint32_t frames) {
    cdda_pcm_state player;
    return cdda_pcm_init(&player, 48000) &&
           cdda_pcm_prepare(&player, pcm, bytes) &&
           cdda_pcm_play(&player) &&
           cdda_pcm_render(&player, left, right, frames);
}
```

Retain the state between callbacks in a streaming host. All functions return 1 on success and 0 for invalid input; failed operations preserve state. Serialize controls and rendering on the host's audio clock. The core allocates no memory, takes no locks and calls no host functions.

## Source and playback contract

- Input is **raw little-endian interleaved stereo PCM16 at 44,100 Hz**. A WAV/RIFF header is not audio data. The host parses files and supplies a nonempty, four-byte-aligned buffer, at most 256 MiB.
- `prepare()` borrows immutable bytes. Keep them alive until replacement or the end of the player's use; the core neither copies nor frees them. Gain, mute and the rendered-host-frame counter survive preparation.
- Output rates are integer 8,000–384,000 Hz. `render()` replaces two planar float buffers, resampling with an integer cursor/phase and linear interpolation. The final sample is held for its duration; EOF then produces exact silence, cursor `frames`, phase zero and state `CDDA_PCM_ENDED`.
- `play()` starts at frame zero. Pause freezes cursor and phase, resume continues, and Stop rewinds to Ready while retaining the source. `seek()` takes an integer **source frame**, including the EOF position. No automatic loop, fade or track transition is added.
- Gain is finite 0–16 and mute is 0 or 1. Muting an active player preserves its progression. `output_frames` counts every rendered host frame, including Ready, Paused and Ended silence. The state contains a borrowed pointer and is not a portable serialized save state.

`prepare_windowed()` and `set_window()` expose the same player through a host-supplied source window. A missing required window makes rendering fail before output is written. The host must supply the interpolation lookahead and retain the window during rendering.

## Standalone WebAssembly

From the SDK root:

```sh
sh scripts/build_cdda_wasm.sh build/application-audio
# Also available through: sh scripts/build-wasm.sh cdda build/application-audio
node tests/application_audio_wasm_smoke.mjs build/application-audio cdda
```

The `standalone-audio-wasm` result is `cdda_wasm.js` plus `cdda_wasm.wasm`. The ES module is a descriptor exporting `CDDA_PCM_ABI = 1` and `CDDA_WASM_URL`, resolved relative to that descriptor; it is not an Emscripten factory and provides no `cwrap()`. Instantiate the raw WASM with no host imports and call its original `cdda_wasm_*` exports. Linear memory is fixed at 128 KiB, with a 4 KiB source window and scratch outputs for at most 128 stereo frames per call. The host retains the complete source outside WASM and refreshes the required window.

These source recipes and local build checks do not imply that a new SDK release or prebuilt WASM archive has been published. CD-DA is cataloged under `applicationAudio`, separately from sound-chip IDs and chip factory APIs.

## What the application adds

`tetorica-fm2612` supplies JavaScript file decoding/track manifests and offline/AudioWorklet integration; Playground adds controls, Virtual Files, Mixer routing and Native transport/lifetime management. Those hosts are not bundled into this C core. The SDK's `tetorica_pcengine_cd_wav` example combines this device with HuC6280 and MSM5205 using original generated audio, explicit gains and one shared output clock.
