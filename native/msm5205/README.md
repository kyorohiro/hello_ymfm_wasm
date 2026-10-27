# MSM5205 PCM application module

This BSD-3-Clause C11 module provides a mono MSM5205 ADPCM renderer and a
small PC Engine CD-ROM² sample-RAM playback helper. Native and Browser WASM
use the same source. It is an application module; it is not a new published
`tetorica-soundchip-native` SDK release or a generic `createSoundChip()` entry.

The existing VGM Analyzer JavaScript decoder is unchanged. Raw register/FIFO
behavior is ported from that decoder, including its leaky predictor, seven
queued nibbles, 3/4-bit modes, prescalers, external VCLK and reset signal -2.
See `NOTICE.md` and `LICENSE` for the libvgm attribution and BSD terms.

## Native interface

Compile `msm5205_pcm.c` as C11 (or C++14) and include `msm5205_pcm.h`.
The caller owns `msm5205_pcm_state` and immutable packed source storage.
The module never allocates, locks, reads files, or calls the host. Keep
source storage alive until replacement or destruction. Run commands and
render on the same audio clock; do not mutate the state concurrently.

```c
msm5205_pcm_state player;
msm5205_pcm_init(&player, 48000, MSM5205_PCM_DEFAULT_CLOCK);
msm5205_pcm_prepare(&player, encoded, encoded_bytes);
msm5205_pcm_play(&player, 0, encoded_bytes * 2, 0, 12);
msm5205_pcm_render(&player, left, right, 128);
```

Source RAM holds 1..65,536 bytes. Samples use packed four-bit ADPCM, **high
nibble first**. `play` offset and length are **nibble counts**, so odd starts
and lengths do not silently decode an extra nibble. Rate 0..15 maps to
`clock / (48 * (16 - rate))`. The default 1,536,000 Hz clock gives 2,000 to
32,000 samples/second; rate 12 is 8,000 Hz. The clock is explicit and may be
set to 1,540,200 Hz when desired.

Each play resets predictor and step to zero, decodes its first nibble, and
holds that output through its first source sample duration. Looping wraps
RAM without resetting the predictor. Single-run EOF and Stop produce exact
silence. Gain and mute do not affect clock, FIFO or predictor progression.
Reset and source replacement retain gain, mute and the rendered-frame
counter. Reset retains RAM. Raw register writes switch to the separate raw
decoder; a later `play` explicitly returns to the RAM driver.

No CPU, SCSI, DMA, hardware address-latch, disc or BIOS emulation is included.
The host mixes the duplicated mono outputs and applies any speaker routing.

## Browser WASM

From the repository root, build with:

```sh
sh scripts/build_msm5205_wasm.sh
node scripts/check_msm5205_core.mjs
```

The standalone WASM has no host imports, no allocator, a fixed 128 KiB
memory, 64 KiB input RAM and 128-frame planar scratch. The loader uses
`import.meta.url` string operations rather than a `URL` constructor, so an
AudioWorklet can import it. `web/msm5205_pcm.js` exports
`createMSM5205PCM({sampleRate, clock, wasmBinary})`, with `prepare`, `play`,
`stop`, `reset`, `writeRegister`, `setGain`, `setMuted`, `readState`, `render`
and `dispose` methods. AudioWorklet hosts pass already fetched WASM bytes.

`check_msm5205_core.mjs` compares actual Native and WASM float output and
complete state against the unchanged JavaScript decoder at 44.1 and 48 kHz,
including all 16 PC Engine rates, odd nibble ranges, EOF, loops, mute,
reset, raw FIFO/3-bit/external VCLK, alternate clock and block partitioning.
