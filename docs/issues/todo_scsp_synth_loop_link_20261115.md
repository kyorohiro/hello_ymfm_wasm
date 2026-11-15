# SCSP Attack / loop link support

Requested 2026-11-15 after the v0.0.1 Web release.

- [x] Verify the native LPSLNK envelope transition and existing register support.
- [x] Expose a strict optional `loopLink` envelope setting in shared JavaScript
      APIs, state and type declarations, defaulting to false for older sounds.
- [x] Preserve the setting through instrument edits, Code, grouped voices and
      existing portable preset formats without changing older preset behavior.
- [x] Display the setting in SSF Live view and provide an editable hardware
      control after Capture in the SCSP Synth Envelope section.
- [x] Allow ordinary PCM capture with Attack / loop link and preserve the
      programmed loop-start threshold; keep unsupported modes explained.
- [x] Test actual native envelope transitions, pitch / loop / preset round
      trips, paused audition, Capture and failure preservation.
- [x] Audit local SSF eligibility, validate the packaged Web app with muted
      browser output and update guide / CI / handoff records.

Scope is hardware LPSLNK (Attack / loop link), not a software envelope or
native phase continuation. Attack hold, envelope bypass, reverse loops,
linked-slot FM capture and DSP programming remain separate work. No Tauri,
npm publication or new release is requested in this task.

## Implemented behavior

The existing MAME-derived native core already implements LPSLNK. A true
`envelope.loopLink` programs bit 14 of the slot's second envelope word on the
next keyOn. Attack transitions to Decay 1 when sample playback reaches LSA,
even before full Attack level. Reaching full Attack level alone retains
Attack until that threshold. KeyOff can start Release before LSA.

The setting is strictly boolean and optional. Old presets / state snapshots
normalize an omitted field to false. Requested Envelope changes affect new
notes, preserving held voices. State copies, editor / transport snapshots,
grouped keyboard and Code voices retain it. The shared JavaScript runtime,
Playground completion declarations and runtime TypeScript definitions agree.
The npm source is ready for the next publication; this task does not publish.

The Synth Envelope section adds a hardware checkbox with collapsed help.
It is read-only in SSF Live and editable in the authored view after Capture.
A small Synth-only controller leaves the shared Playground PCM draft editor
unchanged. Same-time SSF snapshots expose the flag beside other Envelope
fields, and Capture retains it and the forward-loop start in existing presets.

A linked one-shot with nonzero LSA remains unavailable with a precise reason:
the high-level one-shot adapter programs LSA=0 and cannot preserve a separate
threshold. Zero-threshold one-shots are representable. Capture does not add a
loop or silently move the threshold. Other prior exclusions remain in force,
and captured instruments remain dry / newly triggered rather than restoring
song DSP or native phase.

## Verification

- 139 SCSP Synth / actual-WASM / packaging tests passed, plus 57 shared SCSP
  runtime tests, 125 calibration revision / policy tests and TypeScript checks.
- Actual native tests show linked Attack retained through frame 511 and
  Decay beginning at LSA=512, early Release, explicit Off / reset clearing
  bit 14, strict invalid-value rejection and held-note preservation.
- Capture / export / load retains complete PCM, loop start and LPSLNK. A
  fresh unlinked note keeps rising after the linked sample's threshold.
  Keyboard / Code PCM and 2/4/6-operator group allocation retain the flag.
- Twelve local SSF files at 1 / 2 / 3 seconds produce 376 active PCM
  slot-observations. All 376 now pass full capture conversion, versus 173
  before this change. The additional 203 all use linked forward loops with
  nonzero LSA. Each of those 203 was loaded into the actual Synth core and
  rendered 8,192 finite, nonzero stereo frames. These are repeated
  observations, not 376 unique instruments. All 12 files have eligible slots
  at the tested positions. No game data is copied into source or archives.
- The optional API's exact source revision is authenticated separately from
  passive UI revisions. Original reports / gains / native binaries remain
  unchanged. Original reference programs (both roles, 220 / 440 / 880 Hz)
  produce byte-identical PCM and register traces with reconstructed old code,
  new code omitting the field and new code explicitly setting false. The
  proof covers 289,944 held and 39,690 release frames per variant. Any later
  source edit or changed pinned dependency remains stale.
- Browser checks found a reproducible WebKit lost-click bug: replacing the
  Pause button's text node every 50 ms could suppress a trusted click between
  pointerdown / pointerup. The label now changes only when its value changes.
  A causal probe improved from 6/24 to 24/24 successful clicks at 5 / 60 /
  120 ms hold durations, preserving child identity until the click. Unit and
  permanent 120 ms held-click browser regressions cover the fix.
- The actual 351-file ZIP passed Capture's 13 scenario groups and Live's 10
  groups in both Chromium and WebKit, plus the existing basic Synth, Code,
  VGM Song and SSF folder regressions. Captured LPSLNK On / Off produced
  repeatable fresh-note RMS ratios of about 4.9 for the original slow-Attack
  fixture while retaining the same 2,048 samples and LSA=512. Both true and
  false persisted through Files / JSON save and reload; paused position,
  authored draft, one AudioContext and 390 px layout were preserved.
  ZIP SHA-256:
  `9552a05cd2dca798e0fcb7d1d360f14f22724a2afad341beccbae98ba62105c0`.
- Physical browser output is muted throughout automated checks. Native and
  real-set audits create no audio device. Human listening remains pending.

```sh
npm run test:scsp-synth
npm run test:runtime:types
node --test test/runtime/*scsp*.test.mjs
node --test scripts/mixer_calibration_scsp_loop_link_revision.test.mjs
npm run test:scsp-synth:capture-browser
```
