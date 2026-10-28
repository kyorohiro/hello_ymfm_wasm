# Experimental PS1 Browser mode — 2026-10-28

Base commit: `3421bb5a` (`PS1 SPU`). This continues the completed
[SPU foundation](ps1_spu_01.md). Usage: [../ps1_spu.md](../ps1_spu.md).

## Implemented

- `Ps1Synth`: 24 physical voices, validated append-only ADPCM sample banks,
  explicit tuning, normalized signed stereo gain, pitch, raw ADSR words and
  key-on/off. Stop immediately clears the decoder/envelope execution while
  retaining samples and presets. Reset can retain samples or clear the bank.
- `Ps1Resampler`: fixed 44.1 kHz input to host output rates. Persistent phase,
  reused buffers, demand-based native batching and at most the interpolation
  endpoints of render-ahead. 44.1 kHz output uses direct blocks. At 48/96 kHz,
  100 host quanta require 100 native calls instead of per-frame WASM calls.
- Browser AudioWorklet endpoint/client: ordered Main/logic-Worker controls,
  reserved host-frame playback, note-owner cancellation and independent manual
  audition leases. Abort, RPC deadline, stale resource response and processor
  failure cleanup are handled. Reinitialization after failure is supported.
- **PlayStation (PS1)** Mode with `spu` / `pg.spu`, a starter and two editable
  examples. The original sample is prepared on all 24 voices before Run.
  Keyboard selects PS1 and a physical channel; the SPU tab edits sample, pitch,
  stereo gain and ADSR and provides Hold / one-second preview / Keyboard.
  Inspector state is read on entry, Refresh or edits; PS1 adds no periodic polling.
- Playground `useSoundChip('ps1')` borrows the primary or reuses an independent
  Browser instance. `createSoundChip('ps1')` creates a separate bank/24 voices.
  Primary lifetime belongs to the mode; independent instances are released on
  Stop. The package-root generic chip factory remains a separate API.
- Monaco and npm declarations cover 24 channels and sync/direct versus async
  client reads. Non-OPN modes expose no FM shortcut. PS1 is unavailable in the
  Tauri Native backend, including a forced Native URL; Web Audio is selected.

## Integration fixes and verification

- Browser startup exposed a missing strict Mixer mode registration. The
  generator now adds PS1 at explicit **unmeasured unity (1.0)**, like the other
  recent sources. Existing gains and measured captures are unchanged. A test
  constructs every selectable mode's Mixer before audio preparation.
- AudioWorklet startup exposed that Emscripten's default incoming API omitted
  `wasmBinary`. The standalone recipe now explicitly supports injected bytes,
  and the Worklet supplies `locateFile` without requiring a global `URL` or
  network fetch. A regression boots the actual generated loader and WASM in
  that restricted environment. The WASM binary and C++ sources are unchanged.
- SPU is registered in the workbench's relocated panels and floating Keyboard
  routing. Selecting voice 24 updates both Keyboard controls immediately.
- Reset is an immediate preparation barrier in Main and Worker: it discards
  prior notes, preserves following reserved commands and precedes later uploads.
  Retained pending uploads still reject their old continuation with `AbortError`
  but adopt their RAM reservations before rejection; clearing RAM fences them
  completely. Empty and seeded bank tests cover later IDs and usable voice 24.
- Runtime cache versions use `ps1-mode-1`. JSDoc-only imports retain the prior
  revision policy: comment changes must not invalidate measured renderer bytes.
  Analyzer's original source hash guard passes unchanged; no measurements or
  recorded hashes were rewritten to bypass it.
  Changed workbench, Keyboard, Mixer policy and generated-loader dependencies
  also receive the new runtime revision to avoid stale cached module graphs.
- Core/Synth/resampler/client/Worklet tests cover actual output, 24th voice,
  signed stereo, pitch, scheduling, ownership, RAM retention, exact Stop silence,
  replay, upload/reset/dispose and resource errors. Host conversion is tested at
  44.1/48/96 kHz. UI tests cover mode selection, 24th-voice routing, normalized
  edits, preview release and no periodic SPU reads. All mode types pass.
- Isolated npm build/install passes 378 declarations, 1,077 asset references,
  all 28 existing WASM engines, PS1 instrument/host-rate replay and consumer
  NodeNext/Bundler/Browser positive/negative types. The candidate contains 981
  files; version is unchanged and nothing was published.
- Synth, VGM Analyzer and Playground packaging commands succeed. Run ZIP has
  916 entries, within itch.io's 1,000-entry limit. Full download includes the
  expanded source; Run keeps its compact source bundle. No audio is initialized
  merely by selecting the mode or inspecting the file catalog.
- Final core/Synth/resampler/client/Worklet suite: **48 passed, zero skipped**.
  Source and the actual Run ZIP pass **Chromium / WebKit × Main / Worker**
  (**8 routes**), including the exact starter twice, both examples, voice 24
  Guitar/PC/pointer input, SPU floating Keyboard, pending upload/reset recovery,
  independent SPU disposal, error recovery, mode round trips and exact Stop
  silence. Idle visible and hidden inspector reads are zero. Desktop and 390 px
  screenshots have no document horizontal overflow.

Final Run ZIP: `release/hello_ymfm_wasm_ps1-mode-dev_itch_playground_for_run.zip`
(916 entries, SHA256 `28f8220eacb04ac9e7a22c58893ad3b993d0a8635e2933a8b5a36a43a060827c`).
Both archives pass CRC, path validation and full staged-file byte comparison.

Final browser results, hashes and archive receipts are recorded in
[ps1_mode_01.json](ps1_mode_01.json). Physical output is muted during automation;
human listening and Tauri GUI validation are separate from these checks.

## Remaining scope

The C++ core and WASM binary are unchanged; the generated JS loader and build
recipe changed to support injected bytes in AudioWorklet. The core's linear interpolation, ADSR and reverb
approximations remain experimental, and sample cache creation can allocate on
the audio thread. No hardware-accuracy or real-time allocation guarantee is
claimed. General PCM → SPU ADPCM encoding, Sample Editor conversion, fixed SDK
adoption and a Tauri Native audio adapter are subsequent milestones.

No commit, push, tag, npm publication, SDK release, Tauri import or itch.io
upload was performed. The work plan is [todo_ps1_01.md](todo_ps1_01.md).
