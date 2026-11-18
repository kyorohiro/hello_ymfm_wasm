# FM2608 Synth ADPCM-B noteOff guard — 2026-11-18

Requested scope: reduce the click when the PC98 Synth keyboard or high-level Code noteOff releases ADPCM-B. Preserve immediate hardware behavior for raw keyOff. Keep shared YM2608 runtime/native code and unrelated staged SCSP work unchanged.

## Initial findings

- `docs/synth-fm2608/audio.js` calls `chip.adpcm.keyOff()` immediately for keyboard ADPCM-B noteOff.
- `docs/synth-fm2608/code_client.js` currently borrows the raw ADPCM client and tracks raw keyOn/keyOff ownership. A scoped high-level release hook is needed without replacing raw keyOff.
- ADPCM-B has a hardware volume register (port 1, register 11), but no hardware envelope/release setting. The app owns one combined OPNA output, so fading the common output would also attenuate FM/SSG/rhythm.
- Investigate whether existing audio-owner scheduling can ramp only ADPCM-B volume at sample-time boundaries without adding a new common runtime/native queue. If only main-thread writes are available, evaluate a bounded app-only schedule and report its timing limits before committing to it.

## Required ownership/race handling

- A release tail must not send keyOff or restore an old volume into a new keyOn, new preset/sample, reset, Code session, or disposed audio owner.
- High-level noteOn restores the authored ADPCM volume before retriggering; raw keyOff remains immediate.
- Short and long notes, rapid On/Off/On, volume/preset edits during a tail, Stop and session retirement need focused tests.

## Validation

- Measure actual offline YM2608 PCM around release discontinuities against raw keyOff; use no physical output.
- Verify high-level keyboard and Code paths use the same guard and preserve authored register shadows/preset export.
- Run focused app tests and relevant native-render tests. Do not alter calibration reports or native gain to improve the result.

Status: implementation and validation complete; the mechanism and timing/ownership constraints are recorded below.

## Implemented mechanism

- Added app-only `adpcm_noteoff_guard.js`. A high-level release schedules 64 linear ADPCM-B volume-register steps over 8 ms, then an atomic zero-volume / decoder Key Off / latest nominal-volume restore at the final frame.
- The existing YM2608 worklet frame queue is reused without modification. This standalone owner starts one session once. Each tail gets a unique owner; canceling it never restarts/stops the session or clears unrelated FM/SSG reservations.
- A 128-output-frame lead avoids compressing the first queued steps into a late initial worklet quantum. Total ordinary release is 10.907 ms at 44.1 kHz or 10.667 ms at 48 kHz; the fade itself is 8 ms. No JavaScript timer drives the fade.
- Keyboard ADPCM noteOff and scoped Code `opna.adpcm.noteOff()` use this release. `opna.adpcm.keyOff()` and raw register reset remain immediate hardware paths. Low-level/shared YM2608 APIs, native core and Mixer/calibration gains are unchanged.
- Physical release writes bypass authored register shadows. Requested Gate Off is visible immediately, while canonical volume remains unchanged for live controls, preset capture and Cassette export. Volume/mute edits during an editor tail retarget only its remaining deadline. Retrigger, raw stop/reset, sample/preset replacement, Stop and disposal invalidate the old tail; no old restore/keyOff reaches a new note.

## Manual song reference path

The playing reference client and separate paused-audition client have app-local frame queues using the same guard. Their existing `processFrames` rendering is sliced only at active release-write boundaries; the no-release path calls the original renderer directly. Physical fades bypass the song timeline/register observer, and only the manual requested Gate Off display is overlaid. The original VGM state, source file, frozen song frames and paused position remain unchanged.

A later real VGM program write that changes the ADPCM level/range or retriggers it retires the manual tail before applying that program write. Last actual gate write wins. Raw parameter changes cannot receive an obsolete scheduled volume restore; mutes cannot be undone by the tail. Reference raw keyOff remains immediate. Resume, Seek, replacement and disposal retire the separate manual owner.

## Validation completed

- `node --test docs/synth-fm2608/*.test.mjs test/runtime/ym2608synth.test.mjs test/runtime/playground_performance_queue.test.mjs`: **172/172 PASS**.
- Native installed-guard measurement: `build/fm2608-pcm-noteoff-guard-20261118/measurement.json` / `measure_actual.mjs`; **30 offline cases PASS**, covering raw / keyboard / Code at 44.1 and 48 kHz with 1 ms, 4 ms, 13.7 ms, 100 ms and 1 s held notes.
- Worst adjacent-sample stop step: 44.1 kHz **0.177826 → 0.023013 (87.06% reduction)**; 48 kHz **0.153989 → 0.021422 (86.09% reduction)** across these default-sine release phases. The remaining differences include ordinary waveform/ADPCM interpolation motion; this is not a perceptual guarantee for every supplied sample.
- Held/attack PCM is identical before release. Raw keyOff is still at the requested frame. Guarded stop is exactly 128 frames plus round(8 ms × sampleRate). Every tested capture retains nominal volume192 throughout; concurrent new volumes99/87 are preserved.
- Native tests cover rapid Off/On, preset edits, Code-session replacement, one-shot natural end and silence after the bounded tail. The unchanged native interpolation pipeline can carry one pre-retrigger output sample; the following 2047 tested samples match raw retrigger exactly, with no stale stop.
- Queue tests retain unrelated same-session FM/SSG writes on cancellation and disposal. Manual-reference tests cover paused isolation, mode/Repeat, raw stop, rapid retrigger, mute, canonical capture and a later VGM volume87/keyOn inside the old human tail.
- No physical sound output or listening was used. Measurement verifies common YM2608 runtime/worklet/queue/WASM bytes still equal HEAD; no calibration report or native gain was changed.

Source and independently extracted ZIP passed the existing muted Chromium / WebKit checks. See [the combined verification](verification_pce_opna_refinements_20261118.md). No commit or publication requested/performed.
