# PlayStation SPU: staged instrument support

The first milestone is a CPU-free, experimental SPU instrument core shared by
Native and WASM. It uses the individually BSD-3-Clause-licensed MAME SPU files,
with their attribution and pristine pinned sources retained in the fixed SDK at
`third_party/tetorica-soundchip-native/vendor/mame-ps1-spu/`. The independently
distributed source bundle retains its public `sources/native/ps1/` layout.
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

- [x] Add PCM → SPU ADPCM conversion with explicit loop and tuning metadata.
- [x] Add Sample Editor conversion, before/after comparison, actual SPU preview and saved Keyboard instruments.
- [x] Add live SPU-tab sound design: named ADSR, owned-note retrigger, sustained audition and shared reverb with per-voice sends.
- [x] Add direct per-voice PCM-cycle drawing with bounded reusable ADPCM slots and portable voice code.
- [x] Integrate the source and build recipe into SDK 0.1.6 (unpublished, hash-pinned local candidate).
- [x] Implement the Tauri Native audio adapter for primary and additional PS1 instruments. Rust, package and offline parity verification passed. Browser core and WebKit source/Run ZIP checks passed; Chromium Worker clock continuity remains a separate unresolved follow-up. GUI listening and remote OS CI remain pending.

The Browser adapter renders through AudioWorklet and batches only the native
frames needed for the current scheduled segment. Buffers are reused and the
SPU tab adds no periodic reads. Decoded sample caches can allocate on the first KON/render and other cache
paths; allocations are not restricted to preparation work. There is no
unconditional zero-allocation or real-time guarantee. Sample Editor conversion runs
in its preparation Worker; its preview uses a private SPU instance. It adds no
periodic live-chip reads. The SDK and Native adapter implementation is recorded in
[ps1_sdk_native_01.md](ps1_sdk_native_01.md) / [JSON](ps1_sdk_native_01.json).
That record lists completed implementation checks and the unresolved Chromium
clock-continuity follow-up. Do not treat the complete Browser UI matrix as passed. Browser
audio remains the default; Native output is explicitly selected in Tauri.

PCM conversion results: [ps1_adpcm_encoder_01.md](ps1_adpcm_encoder_01.md) /
[JSON](ps1_adpcm_encoder_01.json).

Sample Editor results: [ps1_sample_editor_01.md](ps1_sample_editor_01.md) /
[JSON](ps1_sample_editor_01.json). Public workflow:
[PS1 Sample Editor](../ps1_sample_editor.md). The PS1 mode now lists four
examples, including the PCM encoder and saved-sample Keyboard instrument.

Voice/effect editor results: [ps1_voice_editor_01.md](ps1_voice_editor_01.md) /
[JSON](ps1_voice_editor_01.json). Rate controls represent the retained core's
table indexes; envelope timing and reverb remain approximate.

Direct PCM drawing results: [ps1_pcm_waveform_01.md](ps1_pcm_waveform_01.md) /
[JSON](ps1_pcm_waveform_01.json). Each voice has a lazy reusable 64-byte slot
for its 112-frame cycle; copied code recreates the instrument in a fresh bank.

## Accuracy and supported subset

The pinned MAME implementation uses linear interpolation, floating envelope-rate
approximations and preset-based approximate reverb. This is not a claim of
hardware-exact sound or game soundtrack compatibility. ADSR changes apply on the
next key-on. The supported use is self-authored ADPCM instruments; the live editor also exposes the retained preset-based reverb.

The public adapter supports standard 512 KiB RAM mapping, 16-byte-aligned ADPCM
packet addresses and fixed volumes. Unsupported RAM mappings and volume sweeps
are rejected. CPU/DMA/IRQ timing, PSF playback, CD-XA and external CD audio are
outside this milestone. BRR, ADPCM-A and SPU ADPCM are different formats.

The fixed SDK now includes the unchanged PS1 core through an explicit 0.1.6
local-candidate pin, and the Tauri Native adapter implementation/offline tests
are complete. Chromium clock continuity, GUI/human listening and remote OS CI
are tracked separately. PS1 still has an
explicitly unmeasured unity Mixer profile; existing gains and Browser binary
outputs are unchanged. The WASM loader supports injected bytes in AudioWorklet.
No SDK tag or package publication was performed; publication is a separate task.
