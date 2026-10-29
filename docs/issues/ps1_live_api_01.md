# PS1 instrument API: live ADSR

Date: 2026-10-29.

`Ps1Synth.setEnvelope()`, `setPreset()` and `setChannel()` now apply changed ADSR
words to the current envelope stage by default. This extends the existing live
editor behavior to ordinary script, Worker and Native instrument controls.
There is no note retrigger, sample-position reset or envelope-level reset.
Attack edits during Sustain do not restart Attack, and Sustain Level remains
Decay's target rather than a direct volume setting during Sustain.

```js
spu.setEnvelope(0, {sustainRate:60, sustainDecrease:true});
// Skip updating the currently running envelope:
spu.setEnvelope(0, {attackRate:80}, {live:false});
```

The same optional third argument works with raw-word presets and the channel
alias. Both ADSR words are written before one explicit refresh. Invalid options
are rejected before writes. Same-value ADSR edits and volume/pitch/sample-only
changes do not refresh deferred values. A later changed live ADSR patch refreshes
the complete registered envelope. UI inspector edits retain their own checkbox
and manual-note ownership rule; ordinary API defaults do not bypass that rule.

The raw C API, `Ps1Spu.write()`, C++ source and generated WASM remain unchanged.
They retain the pinned MAME port's latched behavior unless the host explicitly
calls the existing refresh extension. SDK 0.1.7 remains the same unpublished
local candidate. No DuckStation source is copied into this implementation.

## Native application order

Native prepares future commands using a projected authoring state. Deciding
whether a value changed at that point could miss an immediate edit whose value
matched a future reservation. It could also combine a present AR change with
future SR bits from the same raw register word.

The Native adapter now sends only explicitly requested preset fields. Named
ADSR patches carry per-field masks, merged with applied registers on the audio
callback. Conditional refresh compares the batch's initial and final applied
ADSR words, after all writes. This preserves deferred and same-value behavior,
reserved bits and unrelated future settings. Mask and refresh operations require
the declared matching voice; masks are nonzero 16-bit values restricted to that
voice's two ADSR registers. Manual-note leases remain enforced.

## Verification

- 84 JS tests pass with actual cores, including Attack/Decay/Sustain/Release,
  gate=false release tails, exact sustained AR phase, one refresh per complete
  patch, invalid options, deferred/same-value/unrelated edits, Main/Worker options
  and additional SPUs. Native JS contributes 19 of those tests.
- Linked Native PS1: 18 pass. Native regression: 763 pass, two existing
  benchmark/device checks ignored. Actual primary/additional cores cover ordinary
  edits, masked merge and conditional refresh, including future-vs-immediate
  ordering. Independent read-only review found no blocker.
- [Offline shipped-WASM evidence](ps1_live_api_offline_01.json) covers all three
  ordinary setters, phase/current-level preservation, gradual sustain change and
  explicit deferral, in addition to the existing manual-transition checks.
- [Source browser checks](ps1_live_api_browser_01.json) pass Chromium/WebKit ×
  Main/Worker (four routes). Ordinary public code exercises primary and additional
  SPUs, all three setters and explicit deferral; existing graph, Keyboard, PCM,
  reverb, channel isolation, disconnect, recovery and continuity checks remain.
- [Actual Run ZIP](ps1_live_api_run_browser_01.json) passes WebKit Main/Worker
  (two routes), including both public instrument roles and the same editor path.
  Browser output is captured before a permanently muted physical destination.
  No human listening, physical audio device or Tauri GUI result is claimed.
- New full raw calibration records for PS1, WonderSwan and POKEY use exact current
  script/runtime/WASM hashes. All seven earlier raw records remain byte-identical.
  374 calibration/history/generator tests and both generator checks pass. New raw
  reports have continuous independent PCM pilots and no global-clock diagnostics.
  Earlier diagnostics remain in their original reports.
- PS1 gain remains 0.128832 and WonderSwan 1.172528. POKEY's new RMS rounding gives
  primary/extra 0.413033 and both dual roles 0.413034, at most 0.00145% different
  from the preceding capture. The generator derives these directly from the new
  observations; there is no hand-written gain correction.
- Local npm distribution: 335 modules, 28 engines, 385 declarations, 1,004 files.
  Isolated installation, actual PCM, license/source checks and NodeNext/Bundler/
  browser types pass. All selected Playground mode declarations also compile.

## Distribution and retained attempts

Both Playground ZIPs pass CRC. The browser Run ZIP contains 931 files,
SHA256 `6f2525d0d141eab95cc581a357559a586bc3965312564799e79667a3a0b74952`.
The complete ZIP is SHA256
`627410d3b2c80166d9ecce7f7d63036aefa3185641edd3f713edad57abe67e77`.
Tauri imports its 1,066 nonmetadata payloads and verifies the lock and fixed SDK.

The first source-browser attempt reached WebKit/Worker before a premature
readback assertion failed: the test waited exactly the Worker's 0.5-second lead,
while readback itself is immediate. It now waits one second before checking
applied values. A second attempt saw one startup HTTP 404 for the default Mixer
module; its cause is not established. The third complete four-route source run
and the two-route actual ZIP run passed with all acceptance checks intact.
Both failed logs are retained under `/private/tmp/ps1-live-api-browser-attempt*.log`;
the detailed JSON distinguishes them from the successful evidence.

Changes are uncommitted in the main and Tauri repositories. The SDK repository
is clean. No SDK/npm/itch publication, commit, push or remote CI is performed.
See [the structured record](ps1_live_api_01.json) for hashes and artifact metadata.
