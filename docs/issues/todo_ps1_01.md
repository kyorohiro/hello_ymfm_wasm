# PlayStation SPU: staged instrument support

The first milestone is a CPU-free, experimental SPU instrument core shared by
Native and WASM. It uses the individually BSD-3-Clause-licensed MAME SPU files,
with their attribution and pristine pinned sources retained in `native/ps1/`.
No BIOS, game audio, console CPU or MAME framework is required.

## Completed foundation

- [x] Port the real 24-voice SPU decoder, 512 KiB RAM and fixed 44,100 Hz output.
- [x] Provide a C register/RAM/stereo-PCM interface and an injected-WASM JS wrapper.
- [x] Validate voices, pitch, looping, ADSR, stereo, RAM updates and instance isolation.
- [x] Preserve licenses, source provenance and reproducible build inputs.
- [x] Rebuild final WASM and compare its output with the actual native core.
- [x] Provide an original audible sample example and document the raw API.
- [x] Verify browser/worker loading and standalone source rebuilding.
- [x] Finish isolated npm payload verification and record results.

Results: [ps1_spu_01.md](ps1_spu_01.md) / [JSON](ps1_spu_01.json). No publication has been performed.

## Browser mode milestone

- [x] Add a Synth API for samples, tuning, fixed stereo gain, ADSR and key-on/off.
- [x] Add a Web Audio adapter, phase-preserving host-rate conversion and lifecycle handling.
- [x] Add experimental PS1 mode, starter, 24 Keyboard targets and an SPU voice tab.
- [x] Include two original editable examples; keep Mixer settings in the Mixer.
- [x] Verify sample ownership, scheduled voice ownership, immediate Stop and retained banks.
- [x] Finish source / actual Run ZIP browser verification and record results.

Results: [ps1_mode_01.md](ps1_mode_01.md) / [JSON](ps1_mode_01.json).
Source and the actual Run ZIP pass Chromium / WebKit × Main / Worker (8 routes).

## Following milestones

- [ ] Add PCM → SPU ADPCM conversion with explicit loop and tuning metadata.
- [ ] Add Sample Editor conversion and instrument saving.
- [ ] Integrate the source and build recipe into a new soundchip SDK version.
- [ ] Add a Tauri Native audio adapter. PS1 currently selects Web Audio only.

The Browser adapter renders through AudioWorklet and batches only the native
frames needed for the current scheduled segment. Buffers are reused and the
SPU tab adds no periodic reads. Decoded sample caches can still allocate in the
core; there is no real-time allocation guarantee. General format conversion
is a separate milestone.

## Accuracy and supported subset

The pinned MAME implementation uses linear interpolation, floating envelope-rate
approximations and preset-based approximate reverb. This is not a claim of
hardware-exact sound or game soundtrack compatibility. ADSR changes apply on the
next key-on. Initial use is self-authored ADPCM instruments with reverb disabled.

The public adapter supports standard 512 KiB RAM mapping, 16-byte-aligned ADPCM
packet addresses and fixed volumes. Unsupported RAM mappings and volume sweeps
are rejected. CPU/DMA/IRQ timing, PSF playback, CD-XA and external CD audio are
outside this milestone. BRR, ADPCM-A and SPU ADPCM are different formats.

The fixed SDK and Tauri Native backend are unchanged. PS1 has an explicitly
unmeasured unity Mixer profile; existing gains are unchanged. The C++ core and
its WASM binary are unchanged from the completed foundation. The build recipe
and generated JS loader now support injected WASM bytes in AudioWorklet.
Publication is a separate task.
