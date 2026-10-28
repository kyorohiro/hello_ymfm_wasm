# PlayStation SPU: staged instrument support

The first milestone is a CPU-free, experimental SPU instrument core shared by
Native and WASM. It uses the individually BSD-3-Clause-licensed MAME SPU files,
with their attribution and pristine pinned sources retained in `native/ps1/`.
No BIOS, game audio, console CPU or MAME framework is required.

## Current milestone

- [x] Port the real 24-voice SPU decoder, 512 KiB RAM and fixed 44,100 Hz output.
- [x] Provide a C register/RAM/stereo-PCM interface and an injected-WASM JS wrapper.
- [x] Validate voices, pitch, looping, ADSR, stereo, RAM updates and instance isolation.
- [x] Preserve licenses, source provenance and reproducible build inputs.
- [x] Rebuild final WASM and compare its output with the actual native core.
- [x] Provide an original audible sample example and document the raw API.
- [x] Verify browser/worker loading and standalone source rebuilding.
- [x] Finish isolated npm payload verification and record results.

Results: [ps1_spu_01.md](ps1_spu_01.md) / [JSON](ps1_spu_01.json). No publication has been performed.

## Following milestones

- [ ] Add PCM → SPU ADPCM conversion with explicit loop and tuning metadata.
- [ ] Add a Synth/transport API for samples, pitch, fixed gain, ADSR and key-on/off.
- [ ] Integrate the source and build recipe into a new soundchip SDK version.
- [ ] Add Web Audio and Tauri adapters, resampling and lifecycle handling.
- [ ] Add a real PS1 Playground mode, starter, Keyboard target and SPU inspection tab.
- [ ] Add Sample Editor conversion and authored examples.

The current port is an offline-first foundation. It may allocate decoded sample
caches while rendering and is not yet connected to an audio callback. Scheduling,
bounded real-time work and format conversion belong to the later adapters.

## Accuracy and supported subset

The pinned MAME implementation uses linear interpolation, floating envelope-rate
approximations and preset-based approximate reverb. This is not a claim of
hardware-exact sound or game soundtrack compatibility. ADSR changes apply on the
next key-on. Initial use is self-authored ADPCM instruments with reverb disabled.

The public adapter supports standard 512 KiB RAM mapping, 16-byte-aligned ADPCM
packet addresses and fixed volumes. Unsupported RAM mappings and volume sweeps
are rejected. CPU/DMA/IRQ timing, PSF playback, CD-XA and external CD audio are
outside this milestone. BRR, ADPCM-A and SPU ADPCM are different formats.

The existing fixed SDK, Tauri backend, Playground modes and Mixer defaults remain
outside this first milestone. Publication is a separate task.
