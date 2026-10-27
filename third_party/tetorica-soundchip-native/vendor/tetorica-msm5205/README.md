# Tetorica MSM5205 and PC Engine ADPCM

A self-contained BSD-3-Clause C11 decoder with two explicit modes: the Analyzer's existing MSM5205 raw register/FIFO behavior, and an independent PC Engine packed-ADPCM RAM playback helper. The C core and WASM bridge retain the bytes used by `tetorica-fm2612`; SDK build glue and public forwarders do not alter decoding. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE) for origin, retained credits and terms.

The unchanged [Analyzer JavaScript engine](../../reference/javascript/msm5205audioengine.js) remains a behavioral reference. The separately pinned [libvgm source reference](../libvgm-msm5205/README.md) is not this target's build dependency. This module does not supply a CPU, DMA engine, CD controller, SCSI interface, OKIM6295 implementation or universal `createSoundChip()` factory.

## Native integration

Link `tetorica::msm5205` and include `<tetorica/msm5205.h>`. The original `msm5205_pcm_*` functions and `msm5205_pcm_state` are also usable by compiling `msm5205_pcm.c` directly as C11, with C or C++14 callers.

```c
#include <tetorica/msm5205.h>

int render_sample(const uint8_t *adpcm, uint32_t bytes,
                  float *left, float *right, uint32_t frames) {
    msm5205_pcm_state player;
    return msm5205_pcm_init(&player, 48000, MSM5205_PCM_DEFAULT_CLOCK) &&
           msm5205_pcm_prepare(&player, adpcm, bytes) &&
           msm5205_pcm_play(&player, 0, bytes * 2, 0, 12) &&
           msm5205_pcm_render(&player, left, right, frames);
}
```

Retain state between callbacks. Functions return 1 on success and 0 for invalid input; rejected inputs preserve state and render outputs. Every operation is allocation-free and makes no host calls. Serialize controls and rendering, and keep the borrowed source immutable and alive until replacement or the player's last use.

## PC Engine RAM playback

`prepare()` borrows 1–65,536 bytes of packed ADPCM and selects Ready RAM mode with a zero predictor. Bytes decode **high nibble first**. `play(offset, length, loop, rate)` addresses **nibbles**, allowing odd starts and lengths within the loaded bytes. It resets predictor/step, decodes the first nibble immediately and holds its output until the first source-clock tick.

The PCE rate register is 0–15:

```text
source sample rate = clock / (48 * (16 - rate))
```

The compatibility default clock is 1,536,000 Hz, giving 2,000–32,000 Hz; register 12 gives 8,000 Hz. Hosts may explicitly select another clock, including 1,540,200 Hz. Output rates are 8,000–384,000 Hz and clock values are 1–`0x3fffffff`; this is clocked ADPCM playback rather than pitch-aware sample conversion.

A single run reaches Ended exactly at `offset + length`, with zero phase and exact silent output. A loop wraps its source **without resetting the predictor**. Arbitrary encoded ranges can click, grow louder or decay at a loop boundary; prepare suitable faded/continuous encoded data in the host. Stop selects silent Ready RAM mode and retains the bytes. Reset retains source, gain, mute and host-frame count, restores the full range/rate 15 and raw control defaults, and is Ready if source bytes are present.

## Raw compatibility mode

Initialization without a prepared sample starts the original raw decoder: signal −2, 4-bit input, divide-by-96 prescaler and a seven-nibble FIFO. That reset value produces a small DC output; use Stop to select an explicitly silent inactive RAM driver when needed by a mixed host. No hidden DC filter or normalization is added.

`write_register(reg, value)` accepts register 0–7 and value 0–15. Register 0 controls reset, 1 pushes FIFO data, 2 clocks external VCLK on a rising edge, 4 selects divide-by-96/64/48 or external VCLK and 5 selects 3/4-bit decoding; 3, 6 and 7 retain the reference's ignored behavior. The first raw write after RAM mode cancels RAM playback and starts a fresh raw decoder, retaining the source for a later explicit `play()`.

The port preserves the reference step table and leaky predictor, including floor division for negative values, saturation and fractional timing. It does not substitute the separately collected upstream C source or MAME implementation. Mono output is `signal / 2048`, multiplied by explicit gain and copied to both planar outputs. Gain 0–16 and mute affect output only: timing, predictor and FIFO continue. `output_frames` includes silent frames. The public state contains a borrowed pointer and is not a portable serialized checkpoint.

## Standalone WebAssembly

From the SDK root:

```sh
sh scripts/build_msm5205_wasm.sh build/application-audio
# Also available through: sh scripts/build-wasm.sh msm5205 build/application-audio
node tests/application_audio_wasm_smoke.mjs build/application-audio msm5205
```

The `standalone-audio-wasm` result is `msm5205_wasm.js` plus `msm5205_wasm.wasm`. The descriptor ES module exports `MSM5205_PCM_ABI = 1` and `MSM5205_WASM_URL`, relative to the descriptor. It is not an Emscripten factory and has no `cwrap()`. Instantiate the raw WASM with no host imports and use the original `msm5205_wasm_*` exports. Fixed 128 KiB linear memory contains a 64 KiB source area and scratch outputs for at most 128 stereo frames per render; no allocator or memory growth is used.

The new module is listed under `applicationAudio`, separate from the SDK's 24 generic chip IDs and 29 sound-chip WASM artifacts. Recipes and local verification are not a new published SDK release and do not update any consumer pin. JavaScript sample encoding, WAV decoding, scheduling, Mixer/pan, ownership queues and device output belong to the host. `tetorica_pcengine_cd_wav` demonstrates an offline HuC6280 + MSM5205 + CD-DA host using generated data.
