# PS1 SPU live voice and reverb editor

Date: 2026-10-28. Base: `e2cadeafb0e1b433d5870b83d62873749e8e9bfa`.
This extends the existing Web Audio PS1 mode. The fixed SDK, C++/WASM core and
Tauri Native adapter are unchanged. No publication has been performed.

## User workflow

Open **SPU**, choose a voice and prepare audio if needed. **Sustain play** holds
the selected voice while the mouse edits controls. **Use Keyboard** connects the
selected voice to the shared floating Guitar/PC/pointer Keyboard. Hold and the
one-second preview remain available.

The tab now exposes Attack/Decay/Sustain/Release rates, sustain level and
exponential/direction switches, with a schematic envelope. Raw words remain in
an advanced section. **Copy voice JavaScript** includes voice settings and the
shared reverb configuration.

ADSR is latched at key-on by the retained core. The default-enabled **Retrigger
my held note after an ADSR edit** option makes an edit audible by restarting
only an audition owned by this editor. Code-owned voices and other channels are
not restarted. Turning the option off leaves the current envelope untouched.
Rates are raw table indexes, not milliseconds; the UI explains the mode-specific
stopped stages and release codes that hold indefinitely.

The reverb section has a per-voice send switch, seven shared presets (Room,
Studio Small/Medium/Large, Hall, Space Echo and Half Echo), Off, and independent
left/right return levels. These are the existing core's approximate effects.
Ineffective upstream Echo/Delay entries and arbitrary register configurations
are not offered. Presets/returns affect the whole SPU; sends belong to voices.

Release enters the programmed release stage. Transport Stop clears all voices
and effect tails immediately while retaining samples, voice presets and effect
settings. Hiding/changing voices and disconnecting retire manual note ownership.

## Implementation

- `ps1_parameters.js` supplies validated ADSR encode/decode/partial-patching and
  frozen preset tables with upstream BSD attribution. Partial ADSR changes retain
  unrelated bits, including ADSR2 bit 13.
- `Ps1Synth` and the Main/Worker client expose `setEnvelope()` and `setReverb()`.
  Voice presets include `reverb`; state includes named envelope fields and
  shared reverb settings. Numeric `envelope` remains ENVX.
- Reverb controls write the existing register API. No C++/WASM rebuild or sample
  RAM reservation is needed by this retained approximation's private delay lines.
  One-shot END clears the applied send upstream; key-on restores the requested
  voice send. Reset restores Off; Stop preserves settings with fresh effect state.
- Inspector edits validate before writing. Audition identities fence stale
  releases and restrict ADSR retriggering to the editor's own note. Performance
  ownership now recognizes PS1 envelope and shared effect commands.
- Actual browser testing exposed a pre-existing inspector use of
  `structuredClone`, which is unavailable in AudioWorkletGlobalScope in the
  tested browser. Validated scalar patches are now copied explicitly, with
  sample descriptors normalized to IDs. A real Worklet regression runs with
  `structuredClone` absent; the dispatch also forwards ownership metadata.
- The panel updates only on entry, Refresh and edits. No periodic reads,
  rendering-time UI updates or conversion work have been added to audio output.
  Pointer/key identity, hidden preview guards and stale latch indicators are
  covered by panel tests.
- Direct Hold/Sustain now use the same `prepareAudition()` output barrier as
  Keyboard. Previously a transport Stop could leave the post-FX output fade at
  zero even though the core accepted a new audition. Preparation restores the
  output; pending Release, tab/voice changes and disconnect prevent late notes.
  Applied snapshots do not retire an audition that is still preparing.
- Browser mirrors, cache revision `ps1-voice-editor-1`, standalone import
  relocation, package membership, declarations and CI checks are updated.
  Cache-only import references also change in shared generated browser modules.

## Local verification

- 116 focused tests pass with no skips: named parameters, actual WASM Synth,
  panel, Main/Worker transport, actual Worklet, performance ownership and chip tabs.
  All seven non-Off presets produce finite tails; Off preserves dry PCM.
- 69 Sample Editor/instrument regression tests and 260 Main/Worker runtime tests
  pass with no skips. All mode declarations pass.
- Final isolated npm installation passes: 989 files, 1,888,687 compressed bytes,
  7,057,904 unpacked bytes, 382 declarations, 1,087 local asset/module references,
  all 28 WASM engines and 15 renderer checks. Installed new APIs, actual SPU
  tails/return levels/Stop, default-safe reset and consumer types pass.
- Source and the actual Run ZIP pass Chromium 153 / WebKit 26.6 × Main / Worker
  (8 routes). The same frozen checker validates all nine named ADSR fields,
  reserved bits, channel isolation, sustained audition, live gain, deferred and
  owned-note retrigger, dry pitch, real wet tails, return-level silence, direct
  audition after normal Stop and after an authored error, Keyboard, hidden/idle
  zero polling, disconnect and release. All captured quanta are continuous and
  finite. Final served bytes match 286 source assets and 214 ZIP assets.
- Standard Synth, VGM Analyzer and Playground packaging commands pass. Four
  archives pass CRC, safe paths and complete stage-byte equality. Run has 922
  entries, within itch.io's 1,000-entry limit.
- Analyzer calibration guard (8 reference levels), actionlint and runtime
  versioner idempotence pass. New unit/browser checks are in itch web CI; remote
  CI has not been run for this work.

Final browser and isolated npm results are recorded in
[ps1_voice_editor_01.json](ps1_voice_editor_01.json). Captured browser PCM uses the
actual SPU/AudioWorklet path with physical output muted. Human listening and
hardware comparison have not been performed.

Run artifact:
`release/hello_ymfm_wasm_ps1-voice-editor-dev_itch_playground_for_run.zip`

SHA256: `e3a1d3c6627cdd8af49c17a86d18ab8a17da5654f22d1ad765e000b4fd65d7a0`.
The complete downloadable archive omits `_for_run` in its name.

The package version remains `0.2.32`. No commit, push, tag, npm publication,
SDK/Tauri import or itch upload was performed. Follow-up milestones are PS1 SDK
adoption and the Tauri Native adapter. Public guide: [PS1 SPU](../ps1_spu.md).
