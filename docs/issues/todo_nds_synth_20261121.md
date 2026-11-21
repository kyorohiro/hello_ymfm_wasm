# Nintendo DS Synth and 2SF reference playback

Recorded 2026-11-21 after the user selected DS as a new Tetorica Synth target.
Goal: use familiar game music as an entry into sound-chip exploration, then let
users edit the sound and control it from readable JavaScript. Audience reach is
a product hypothesis, not a measured demographic claim.

## License decision and 2SF feasibility

- [x] Keep GPL code out of the Nintendo DS source and distribution. The former
      vio2sf prototype, its browser build and its test fixtures are archived
      locally under the Git-ignored `build/nds-vio2sf-local/` directory.
      The icon and the permissive SkyEmu feasibility work remain in the source tree.
- [x] Use MIT SkyEmu for an isolated native 2SF experiment. Resolve ROM overlays
      and folder libraries in memory and measure PCM without an audio device.
- [x] Verify two self-authored mini2SF tracks sharing one library. SkyEmu
      rendered 440.035 Hz left and 659.511 Hz right at 48 kHz. Five loader tests
      cover order, CRC, bounds, library paths and unsupported state or timing
      options. See [the local experiment](../../scripts/nds-2sf/README.md).
- [x] Verify startup and PCM output with the supplied Chrono Trigger set.
      Presentiment, Chrono Trigger, Wind Scene and Corridors of Time each
      resolved the shared library and yielded distinct non-silent 48 kHz
      stereo PCM for the first eight seconds on arm64 macOS.
- [ ] Try other game drivers and check playback duration, loops and fidelity
      by listening to the outputs. The first experiment covers ROM-boot sets
      with standard timing. Legacy save states and timing overrides remain open.
- [ ] Add browser playback after measuring real sets. Keep player validation
      separate from the Synth's register accuracy and sample capture.
- [ ] Replace the Synth sound engine with a permissive implementation before
      distributing it. Keep playback-engine and Synth-core decisions distinct.

## First decisions and feasibility

- [x] Product: **Tetorica Nitro DS Synth**, slug `tetorica-nitro-ds-synth`.
      Public API chip identifier remains undecided.
- [x] Adopt the silver/white, red/magenta dual-screen icon:
      `docs/tetorica_nitro_ds_synth.webp` (1254 × 1254).
      Derive the UI palette from it in the UI phase.
- [ ] Audit reusable DS/2SF engines, their licenses/source obligations, build
      dependencies and browser/WASM feasibility. Confirm which CPU, timer,
      memory and interrupt services the selected engine needs for game drivers.
- [x] Verify CPU-free sound rendering with vio2sf/DeSmuME in WASM.
- [x] Expose bounded decoder and channel state from SkyEmu for UI observation.
      The bridge records the register mirrors and sample position.
- [ ] Preserve upstream source attribution and a readable, reproducible source
      distribution consistent with Tetorica's modification/reuse goal.

## Bounded initial implementation

The original keyboard prototype is archived with the GPL engine. This phase
restores the direct Synth with original BSD-3-Clause code, using the DS sound
register documentation. The existing SkyEmu player remains the song source.

- [x] Implement the CPU-free sound core and check raw channel configuration,
      timer, looping, pan and IMA-ADPCM decoding at 44.1 and 48 kHz.
- [x] Expose the core through AudioWorklet, the shared Keyboard and Code with
      `useSoundChip("nds")`. Keep direct key-off available alongside software
      release smoothing. Check both uses against the same physical voices.
- [x] Prototype PCM8/PCM16/IMA-ADPCM and the restricted PSG/Noise channels in
      the archived experiment.
      All 16 physical channels support sample playback; hardware channels 8–13
      additionally support square waves, and 14–15 additionally support Noise.
      These modes share the physical voices, not independent extra voice pools.
- [x] Restore the browser Keyboard screen, output Envelope/Waveform/Spectrum,
      Auto/physical CH, and hardware controls with the Nitro DS icon palette.
- [x] Share one channel button row across Synth and 2SF views, add the
      Code/Synth workspace switch, and preserve performance keys through
      focused parameter selects.
- [x] Add Files/Cassette and New/Import/Export. Keep the Code workspace
      expanded when switching between Keyboard and Code.
      Keep authored files and their saved versions together in the Cassette.
      Seed `index.js` and `examples/`, and migrate the previous local Code edit.
      The 2SF picker stays available for loading the source collection.
- [x] Verify Cassette round trips, rejected ZIPs, the prior Code draft, and
      saving, discarding and restoring a local project in Chromium and WebKit.
- [x] Add WAV import and conversion to DS PCM8, PCM16 or IMA-ADPCM.
      Show the playback waveform and edit the word-aligned repeat start and
      end. Tune imported samples using their source rate and a root note.
- [x] Save self-contained DS instruments to `presets/` and verify that samples,
      tuning and loop points survive a Cassette export and re-import.
- [x] Load a saved DS instrument into a physical channel from Code. Verify
      the same sample, loop and tuning through `file()`, `loadPreset()` and
      `noteOn()` after a Cassette round trip in Chromium and WebKit.
- [ ] Explain hardware controls separately from driver/software ADSR, modulation,
      allocation and software release smoothing. Show the hardware timer as PCM
      playback rate, pulse frequency or noise clock, with a fixed-rate option.
- [ ] Add the DS sound capture circuit. Start with left/right mixer capture to
      word-aligned PCM8/PCM16 buffers and playable sample reuse. Follow the
      capture timers shared with hardware channels 1/3 (UI CH2/CH4).
- [x] Add direct JavaScript sound-core operations, declarations/completion,
      readable examples and Run/Apply/Stop. Timed-operation APIs are not an
      automatic prerequisite for the first DS prototype.
- [x] Check all five sound modes through a muted AudioWorklet in Chromium and
      WebKit at 44.1 and 48 kHz. Check live pan, direct channel restrictions,
      Keyboard and Code operating together, and release ownership in both
      browsers. Verify Monaco completion and local script recovery in both.
      Listening and comparison against DS hardware remain open.

## 2SF / mini2SF reference path

- [x] Build the pinned SkyEmu WASM with MIT and BSD notices. Verify the
      original fixtures against Native. Keep the generated binary local to
      the preview while preparing the redistribution source set.
- [x] Connect folder selection and Play, Pause / Resume and Stop on the
      local Reference playback page. Keep user files in memory and run the
      emulator in a dedicated Worker. Verify the preview in Chromium and WebKit.
- [x] Verify the actual Chrono Trigger folder opens all 71 song choices and
      reaches audible PCM in Chromium and WebKit with the destination muted.
      The shared library expands into a 32 MiB cartridge with the song overlay.
- [x] Compare Native and WASM on the first eight seconds of each supplied
      Chrono Trigger track. All 27,264,000 stereo frames across 71 tracks
      matched bit for bit at 48 kHz. Human listening remains open.
- [x] Restore the CPU-free Keyboard and Code Synth with a permissive DS sound
      core and keep the existing reference player available on the same page.
- [x] Read a folder containing .2sf/.mini2sf and referenced .2sflib dependencies;
      resolve PSF-style library chains safely, retain originals in Files, and
      report missing dependencies without replacing the current playable sound.
      Save the selected song and its dependency files under `2sf/` while
      keeping their paths and bytes. Check reload and Cassette import in
      Chromium/WebKit and verify a byte-exact real-song Cassette round trip.
- [ ] Start with a reproducible self-authored fixture and existing engine output;
      then validate user-provided sets. Do not bundle commercial game assets.
- [ ] Add song selection, Play/Pause/Resume/Stop and error reporting; preserve
      the current instrument independently from song transport.
- [x] Show a selected physical channel during 2SF playback. Use PCM-timestamped
      SkyEmu register snapshots and refresh the visible view at up to 10 Hz.
      Pause freezes the snapshot for all 16 channels. Verify both browsers,
      with authored fixtures for stereo pan, sample format and pause behavior.
- [x] Evaluate per-CH output muting. SkyEmu exposes no mute mask in the pinned
      API. A mute hook would need to skip mixer contributions while preserving
      register values and decoder progression.
- [x] Audition a paused channel on the keyboard, Capture its sample/settings
      into the current Synth slot, and save a preset usable with `loadPreset()`.
      Preserve the paused song throughout. Start notes from the sample's
      beginning at the selected reference tuning.
      Keep up to 48 PCM-timestamped observations and 8 MiB of sample bytes
      from main RAM or ARM7 private WRAM. Verify the same-address rewrite
      fixture and the captured PCM16 bytes, timer-derived rate, loop and pan.
      The browser check also auditions a Chrono Trigger ADPCM one-shot.
- [ ] Compare captured sound with reference playback under equivalent settings.
      Successful 2SF playback alone is not proof of Synth-core correctness.

## Verification and later scope

- [ ] Validate format decoding, looping/timing, tuning, panning and channel limits
      using deterministic fixtures and actual WASM PCM with physical output muted.
- [ ] Test dependency failures, cancellation, replacement atomicity, keyboard
      ownership, Code continuity and persistence.
- [x] List Nitro DS Synth on the English Tetorica homepage and package the
      standalone itch.io ZIP. Its editable JS/CSS and 2SF renderer passed
      Chromium and WebKit checks from the extracted ZIP. Rebuilding the renderer
      from the included SkyEmu sources reproduced the shipped WASM byte for byte.
- [ ] Verify Chromium/WebKit, Monaco/fallback, desktop/narrow layouts; distinguish
      automated evidence from human listening and real-hardware comparisons.
- [ ] Decide Native/npm/Tauri/release scope after the web prototype is verified.
      No publication, tags or Tauri work is included by this planning record.

SDAT/SSEQ/SBNK/SWAR/SWAV import is an optional additional path. The agreed
reference-playback direction is 2SF/mini2SF, not an SDAT sequencer prerequisite.

References:
- https://mgba-emu.github.io/gbatek/#ds-sound
- https://github.com/xbmc/audiodecoder.2sf
- https://github.com/soltune/procyon2sf/blob/main/docs/TECHNICAL.md

## 2026-11-21 implementation checkpoint

The following notes record the archived prototype. Paths are relative to its
original layout under `build/nds-vio2sf-local/`.

- Pinned unchanged `lib/vio2sf` from Kodi mirror commit
  `232abe97f202bda4deef214989bb9d99a0730540`; original notices, COPYING,
  provenance note and source hashes are under `third_party/vio2sf/`.
- Added isolated CPU-free bridge `tetorica_src/wasm/nds/nds_wasm.cpp` and
  `scripts/build_nds_wasm.sh`. Generated output stays in ignored
  `build/nds-prototype`; no existing SDK/calibrated artifacts are changed.
- Seven silent WASM test cases pass (`node --test tests/nds/core.test.mjs`):
  all 16 PCM voices, mode/channel restrictions, basic timer tuning, pan,
  loops/one-shot termination, ADPCM smoke test, muting and instance isolation.
- Found upstream mute freezes decoder progression. The adapter mutes gain
  around each synchronous render and restores registers; tests confirm a
  muted one-shot still ends.
- Known upstream limits: 2SF mixer bypasses speaker/master-enable gates;
  hardware sound capture and alternate output routing are not validated.
  Raw prototype writes are trusted-fixture only. No public file loading yet.
- GPL source obligations and glue-file notices must be reviewed before
  redistribution. See `third_party/vio2sf/README.md` for exact scope.

### Browser Keyboard checkpoint

- [x] Add AudioWorklet transport with bounded built-in PCM8/PCM16/IMA-ADPCM
      samples, PSG and Noise, 44.1/48 kHz playback, and software release smoothing.
- [x] Verify the browser with the real WASM and muted Chromium/WebKit. A4 is
      within 3 Hz across both device rates and tested pitched modes. The check
      also covers allocation restrictions, real output level, keyboard and
      pointer release, and 375/1280 px layout widths.
- [x] Verify Worklet timing across different block sizes at 44.1/48 kHz,
      channel ownership, panning and headroom when mixing three voices.
- [x] Restore sample loading for WAV with source range, format, loop and ADPCM
      header validation in the current BSD core.
- [ ] Compare ADPCM output against an independent hardware reference.
- [ ] Add Code and its project workspace after replacing the Synth sound
      engine. Build browser 2SF reference playback on the validated player path.
