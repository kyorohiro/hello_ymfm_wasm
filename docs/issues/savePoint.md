# Save Point

Last updated: 2026-08-24

## Latest Playground architecture direction

- `MegaSynth`
  now has listener support:
  - `addListener(listener)`
  - `removeListener(listener)`
- The intended responsibility split is now clearer:
  - `YM2612Synth`
    - readable low-level FM control layer
    - should stay thin
  - `MegaSynth`
    - browser/runtime wrapper
    - high-level FM event hub for demos/apps
  - `docs/playground`
    - subscribes to `MegaSynth.addListener(...)`
    - updates controller UI from those events
- `docs/playground/playground.js`
  has already started this shift:
  - Operator tab sync is no longer driven directly from the `fm` proxy
  - it now listens through `MegaSynth` events

## Important Playground direction

- Playground is expected to grow with:
  - TFI / VGI support
  - envelope UI imported from `docs/synth`
  - FX controller tab
  - guitar/fretboard-style input
  - more Sonic Pi-like live coding features
- Because of that, avoid letting `docs/playground/playground.js`
  become a "single giant file" again.
- The preferred long-term split is:
  1. `web/*`
     - shared library/runtime/features
  2. `docs/synth/*`
     - isolated learning/demo widgets
  3. `docs/playground/*`
     - orchestration/integration layer

## Suggested future Playground file split

- `playground_runtime.js`
  - `runCode`
  - `liveLoop`
  - `play`
  - `beat`
  - `sleep`
  - `livePrepare`
- `playground_editor.js`
  - Monaco init
  - completion / hover
  - fallback textarea
- `playground_console.js`
  - console tab
  - helper tab
  - log formatting
- `playground_sync.js`
  - subscribe to `MegaSynth`
  - push events into operator/future FX tabs
- `playground_examples.js`
  - example code strings
- `playground_operator_tab.js`
  - operator controller UI
- `playground_fx_tab.js`
  - future FX controller UI

## Recent browser/runtime observation

- A short temporary pause during playback was observed once or twice.
- It did not reproduce reliably afterwards.
- Current interpretation:
  - likely browser main-thread pause / GC / extension / temporary UI load
  - not yet strong evidence of a deterministic music-timing bug
- Also observed:
  - `Unchecked runtime.lastError: Could not establish connection...`
  - this does not appear to come from this repository code

## liveLoop error behavior reminder

- As of 2026-08-30, the intended distinction is:
  - top-level Run failure before `commitLiveLoops()`
    - keep the previously committed live loops running
  - error inside an already running liveLoop iteration
    - keep the loop alive
    - if the newly swapped callback fails, roll back to the last stable callback
    - if the current stable callback itself fails, report the error and retry
- This distinction should stay explicit in future Playground refactors.
- "Rollback to previous callback version for the same loop name" is now part of
  the live performance behavior when a hot-swapped callback fails.
  - likely browser extension / external page script noise
- For now:
  - treat both as investigation notes, not confirmed repo bugs

## Current sync status interpretation

- FM-side synchronization is now "organized enough" to move forward.
- Remaining sync work is mainly:
  - future FX-side synchronization
  - deciding how much raw low-level write sync is worth exposing
  - possible reuse of the same observer pattern in `docs/synth`

## Latest low-level YM2612 status

- `Ym2612` now exposes:
  - `write(offset, data)`
  - `read(offset)`
  - `readStatus()`
  - `getIrq()`
  - `setHooks({ onWrite, onRead, onIrq })`
- `YM2612Synth` now exposes readable low-level helpers:
  - `write(port, register, value)`
  - `writeAddress(port, register)`
  - `writeData(value)`
  - `read(offset)` on direct transport
  - `readStatus()` on direct transport
  - `setHooks({ onWrite, onRead, onIrq })`
- `AudioWorklet` side now forwards IRQ state back to the main thread.
- Remaining low-level gap:
  - synchronous `read()` does not make sense across `AudioWorklet`
  - if needed, add a separate `readAsync()` path
- After `readAsync()`, the next low-level work should be:
  - busy flag exposure
  - timer A / timer B exposure

## Latest Playground / FX / Monaco status

- `docs/playground/playground.js`
  now includes:
  - `livePrepare(name, async ({ fx, fm, log }) => { ... })`
  - `fx.gain(...)`
  - `fx.eq(...)`
  - `fx.filter(...)`
  - `fx.delay(...)`
  - `fx.reverb(...)`
  - `fx.setChain([...])`
  - `fx.clear()`
- `web/megasynth.js`
  / `docs/js/megasynth.js`
  now support a master FX chain after the YM2612 output:
  - `setFXChain()`
  - `getFXChain()`
  - `connect()`
  - `clearFXChain()`
  - `connectOutput()`
- `web/megasynth_fx.js`
  / `docs/js/megasynth_fx.js`
  now include:
  - `createGainFX(...)`
  - `createEqFX(...)`
  - `createFilterFX(...)`
  - `createDelayFX(...)`
  - `createReverbFX(...)`

## Important `livePrepare(...)` interpretation

- `livePrepare(name, fn)` is now the first mechanism for:
  - "do this once"
  - "reuse this across Run"
- Current behavior:
  - first time with a name:
    - execute `fn`
    - store result
  - later calls with the same name:
    - do not execute `fn` again
    - return the stored result
- This is useful especially for:
  - FX node creation
  - shared master chain objects
  - future browser-side live coding state
- Current limitation:
  - if the code inside `livePrepare("main-fx", ...)` changes
  - but the name stays the same
  - the old prepared result is still reused
- Likely future additions:
  - `livePrepareReset(name)`
  - `livePrepareClearAll()`

## Current Playground examples

- `FX Loop`
  now uses `livePrepare("fx-loop-chain", ...)`
  for reusable:
  - `filter`
  - `delay`
  - `reverb`
- `FX Motion`
  now uses `livePrepare("fx-motion-chain", ...)`
  for reusable:
  - `gain`
  - `eq`
  - `filter`
  - `delay`
  - `reverb`
- `FX Motion` also now proves that `liveLoop("fx-motion", ...)`
  can move:
  - `eq.bass`
  - `eq.mid`
  - `eq.treble`
  - `filter.cutoff`
  - `delay.mix`
  - `reverb.mix`
  while other loops are playing

## Current click-noise interpretation

- `Run` can still produce a short click / noise.
- Strong current suspect:
  - master FX chain is disconnected / reconnected
  - graph changes happen while audio is live
- `livePrepare(...)` reduces needless FX recreation,
  but does not fully solve routing click noise yet.
- Likely next fix:
  - fade master gain down briefly
  - rebuild chain
  - fade up again

## Monaco status

- `docs/playground/index.html`
  and `docs/playground/playground.js`
  now have a first Monaco-based editor path.
- Current behavior:
  - try loading Monaco from CDN
  - if it succeeds:
    - use Monaco
    - enable Tetorica-specific completion
  - if it fails:
    - keep fallback `textarea`
- Current Monaco completion focus:
  - `liveLoop`
  - `livePrepare`
  - `play`
  - `beat`
  - `nextBeat`
  - `setBpm`
  - `fx.`
  - `fm.`
  - `MEGADRIVE_FM_PRESETS["..."]`
- Current Monaco hover focus:
  - small explanations for:
    - `liveLoop`
    - `livePrepare`
    - `beat`
    - `nextBeat`
    - `fx`
    - `fm`

## Files to read first next time

1. `docs/playground/playground.js`
   - live runtime
   - `livePrepare(...)`
   - FX API
   - Monaco completion setup
2. `docs/playground/index.html`
   - Monaco host + fallback textarea
   - helper text
3. `docs/issues/playground_fx.md`
   - current FX design and implemented direction
4. `docs/issues/playground_autocomplete.md`
   - completion direction
   - Monaco-oriented next ideas

## Likely next steps

1. Verify Monaco behavior more deeply in browser:
   - completion quality
   - cursor behavior
   - fallback behavior
2. Decide whether `FX Motion` should become the default example.
3. Add `livePrepareReset(name)` / `livePrepareClearAll()`.
4. Reduce FX chain click noise on `Run`.
5. Expand Monaco completion:
   - object field completion
   - more snippets
   - better preset/value suggestions

## Playground status

- `docs/playground/index.html`
  now exists as a small browser-side JavaScript playground entry point.
- `docs/playground/playground.js`
  now has a first working runtime for:
  - `play(note, { channel, duration, preset })`
  - `sleep(seconds)`
  - `scale()`
  - `choose()`
  - `rand()` / `randInt()`
  - `setBpm()`
  - `beat()`
  - `nextBeat()`
  - `liveLoop(name, async () => {})`
  - `stopLoop(name)`
  - `stopAllLoops()`
  - raw `fm` access through `YM2612Synth`

## Important Playground interpretation

- The Playground is not only a demo page.
- It is meant to be the "this looks easy enough to try" entry point.
- That is why `docs/index.html` now links to:
  - `Playground`
  - above the normal `Demos` section
- The intent is:
  - show JavaScript first
  - make YM2612 feel approachable
  - then let people drop down into raw `fm` control later

## Current Playground sample state

- The default sample is now the `live-loop` example.
- It uses:
  - one bass loop
  - one lead loop
  - shared BPM / beat timing
- The original example bug:
  - sample code used `MEGADRIVE_FM_PRESETS["2op-bell"]`
  - but the actual preset key is `MEGADRIVE_FM_PRESETS["two-op-bell"]`
- This was fixed in:
  - `docs/playground/playground.js`

## Important note about `nextBeat()`

- `await nextBeat()` inside every `liveLoop()` cycle makes the loop re-attach to the next integer beat each time.
- Because of that, shortening:
  - `duration`
  - `beat(...)`
  may not feel effective if `nextBeat()` is still called every cycle.
- For faster lead patterns, removing per-cycle `nextBeat()` is currently more illustrative.

## Files to read first next time

1. `docs/playground/playground.js`
   - runtime behavior
   - helper API
   - sample examples
2. `docs/playground/index.html`
   - Playground page structure
   - helper list text
3. `docs/index.html`
   - top-level entry positioning
   - Playground is intentionally shown before Demos
4. `docs/issues/playground.md`
   - longer-term design notes
   - why JavaScript / why `liveLoop`

## Likely next Playground steps

1. Make the default `live-loop` sample feel musically better.
2. Decide whether `nextBeat()` should be:
   - a manual helper only, or
   - also have a "first loop only" convenience pattern.
3. Add safer live coding behavior:
   - replacing loops
   - stopping loops
   - handling broken user code
4. Continue toward the original direction:
   - Sonic Pi style `liveLoop`
   - but with YM2612 / Mega Drive specificity still visible.

## Looper direction changed

- The first `MegaSynthLooper` implementation used event replay:
  - record `noteOn` / `noteOff`
  - replay those events through YM2612 later
- That worked conceptually but still hit practical note cut problems.
  - YM2612 only has 6 FM channels.
  - Even after splitting live and loop synth instances, overdub units could still interfere.
- Current decision:
  - use recorded audio as the main looper playback source
  - keep events / patch snapshots as side metadata for export and analysis

## Latest looper observation

- Even after:
  - splitting live and playback synth instances
  - remapping playback channels per unit
  - scheduling new units into the current loop cycle immediately
- `unit 2` and later can still break up during playback.
- The audible result is:
  - notes sometimes cut partway through
  - overdub playback is not stable enough for the main user-facing looper path

Interpretation:

- this is no longer just a small scheduling bug
- it is strong evidence that the event-replay approach is the wrong primary looper playback model here

## Current looper-related code state

- `web/megasynth_looper.js`
  still contains the event-based looper implementation.
- `docs/js/megasynth_looper.js`
  is synced with the same event-based structure.
- `scripts/verify_megasynth_looper.mjs`
  now includes a 2-unit replay check and passes.
  This verifies the current event-looper channel remap behavior, but that is no longer the final target.

## Output bus preparation added to synth demo

- `docs/synth/synth_runtime.js`
  now accepts `outputNode` and passes it into `MegaDriveSynth`.
- `docs/synth/synth.js`
  now creates:
  - `liveOutputBus`
  - `loopOutputBus`
  - `liveCaptureNode`

Current graph direction:

- live YM2612 runtime
  - outputs to `liveOutputBus`
  - `liveOutputBus` goes to destination
  - `liveOutputBus` also goes to `liveCaptureNode`
- loop YM2612 runtime
  - outputs to `loopOutputBus`
  - `loopOutputBus` goes to destination

This was added so the next looper implementation can record only the live bus.

## Next likely steps for looper

1. Add audio recording for one unit from `liveCaptureNode`.
2. Store that result as unit audio.
3. Switch loop playback from event replay to audio replay.
4. Keep event log and patch snapshot as export-oriented metadata.

## Current UI / YM2612 learning demo status

- `docs/operator1.html`
  1-operator YM2612 learning demo now exists.
  It is no longer only a "play beep" page.
  It now tries to help the reader connect:
  - register parameters
  - envelope intent
  - actual generated sound
- The current demo exposes these parameters:
  - `MULTI`
  - `TL`
  - `AR`
  - `D1R`
  - `D2R`
  - `SL`
  - `RR`
  - `Pitch`
  - `Block`
- Layout was compacted so the parameter UI and `Envelope` panel fit in one desktop window more easily.
  - controls are smaller
  - `Envelope` is placed beside the controls
  - `Waveform` and `Spectrum` are below
- The `Envelope` panel now keeps its drawing after playback ends.
  - only `Waveform` and `Spectrum` return to idle
  - `Envelope` stays as a parameter/result reference view
- `docs/operator2.html`
  A 2-operator YM2612 learning demo now exists.
  It focuses on the jump from "single operator" to actual FM relationships:
  - `parallel`
  - `serial`
  - `feedback`
  The page currently lets the user compare:
  - operator 1 / operator 2 frequency multipliers
  - operator 1 / operator 2 total levels
  - shared `AR` / `RR`
  - `feedback`
  - `Pitch` / `Block`
  In the current design:
  - parallel mode uses algorithm 7 and leaves operator 1 + operator 2 audible
  - serial mode uses algorithm 4 and focuses on the `O1 -> O2` path while muting the other pair

## Important interpretation for `docs/operator1.html`

- The orange envelope line is not "real measured chip internals".
- It is a parameter guide built from:
  - `AR`
  - `D1R`
  - `D2R`
  - `SL`
  - `RR`
  - `TL`
- The cyan line is based on the actual generated audio output.
  - it is computed from the generated stereo samples
  - it is closer to an output amplitude trace than to an internal operator envelope
- This difference is expected.
  FM output amplitude can look very different from the intended parameter envelope because:
  - modulation changes harmonic balance
  - phase interaction changes visible amplitude
  - the final waveform is not a direct envelope plot

## What was added to `docs/operator1.html`

- parameter UI for:
  - `D1R`
  - `D2R`
  - `SL`
- register writes for operator 4:
  - `0x5c` for `AR`
  - `0x6c` for `D1R`
  - `0x7c` for `D2R`
  - `0x8c` for `SL/RR`
- actual output envelope overlay:
  - built from generated `left/right` sample arrays
  - uses short-window RMS buckets
  - normalized and drawn as the cyan overlay

## Current design decision

- For now, prefer "faithful to the actual heard sound" over "more smoothed and easier to read".
- That means:
  - keep the cyan line relatively honest to the generated output
  - do not over-smooth it just to make it look like the orange guide
- If a later toggle is added, it should be optional:
  - `raw output`
  - `slightly smoothed`

## Important unresolved point

- `docs/operator1.html` still does not show an explicitly staged `key on` -> `key off` boundary.
- A possible next improvement is:
  - generate a hold segment
  - then send `key off`
  - then generate the release segment
  - draw a vertical `key off` marker on the envelope panel
- This would make the `RR` / release part easier to understand.

## Another important unresolved point

- The cyan line is still derived from output audio, not YM2612 internal operator state.
- If "real internal envelope" is ever required:
  - JS/WASM interface changes alone are not enough
  - a C++-side export is needed
  - possibly a minimal debug getter in `ymfm` or a wrapper around it
- Current decision:
  - do not change `ymfm` yet
  - stay with output-based observation first

## Current status

- `docs/beep.html`
  YM2612 beep demo works in the browser.
- `docs/psg.html`
  Sega PSG demo works in the browser.
- `docs/vgm.html`
  VGM file can be parsed and played with YM2612 + PSG.
  Streaming playback now works in the browser.
  `Play`, `Pause`, `Resume`, `Replay`, `Stop`, and basic `Loop` controls now exist.
  `AudioWorklet` is now used when available, with `ScriptProcessorNode` fallback.
- `docs/embed.html`
  A small browser integration sample now exists to show both the VGM playback path and the direct chip control path.
- `docs/ym2612vgm.js`
  Minimal VGM support was expanded to reduce `SKIP`.

## VGM support added today

- YM2612 register write
  - `0x52`
  - `0x53`
- PSG write
  - `0x50`
- Wait / end
  - `0x61`
  - `0x62`
  - `0x63`
  - `0x66`
  - `0x70-0x7f`
- YM2612 DAC / stream related
  - `0x67` data block: store block data
  - `0x80-0x8f`: DAC write + wait
  - `0x90-0x95`: minimal DAC stream handling
  - `0xe0`: data bank seek

## What changed

- `docs/ym2612vgm.js`
  Added data block loading, YM2612 DAC handling, and minimal DAC stream playback.
- `web/ym2612vgm.js`
  Synced with `docs/ym2612vgm.js`.
- `docs/vgm.html`
  Wait rendering was split so DAC stream writes can happen during playback timing.
  Playback was moved from full offline rendering to chunked streaming playback.
  The page now uses `GenesisAudioEngine` + `VgmPlayer`.
  Browser audio output now prefers `AudioWorklet`.
- `docs/embed.html`
  Added a smaller sample that uses `GenesisAudioEngine` and `VgmPlayer` with a simpler UI.
  It now documents the decision to keep VGM playback and direct chip control as separate paths.

## What we observed

- The second VGM plays without `SKIP`.
- The first VGM also has no `SKIP` now, but sound starts after a long delay.
- That likely means:
  - the song has a long silent intro, or
  - the interesting part starts later, or
  - the track structure depends on data that is not ideal for this minimal player yet.

## Important interpretation

- "No sound at first" is not automatically a parser bug now.
- If there is no `SKIP`, the next thing to inspect is the VGM content itself:
  - long wait before first key-on
  - long wait before audible FM/PSG part
  - DAC-heavy intro
- The old "wait until 100% render" behavior was also a playback-model issue.
- After switching to streaming playback, audio starts before full rendering finishes.
- `Loop` now works both for:
  - VGM files with a loop offset
  - VGM files without a loop offset by restarting from the beginning
- queue draining after playback end needed a bug fix
  - audio must continue until `queuedFrames === 0`
- `Stop` is now distinct from `Pause`
  - `Pause` keeps the current position
  - `Resume` continues from that position
  - `Stop` resets to the beginning
- After switching to `AudioWorklet`, the progress text may feel a little less smooth.
  - This looks like a UI update timing difference, not an audio stability problem.
  - `queuedFrames` still stays healthy and scrolling does not become heavy.
- For practical browser/game design, VGM playback and direct chip control should be treated as separate paths for now.
  - VGM is good for prepared BGM.
  - direct chip control is good for experiments, realtime input, and future programmatic composition.
  - automatic coexistence is not guaranteed when the song already uses YM2612 / PSG resources tightly.

## Still not fully supported

- `0x68` PCM RAM write is still skipped.
- Special / uncommon `0x67` block types are still skipped.
- DAC stream handling is minimal.
- Real hardware accuracy is not the goal yet.
- `AudioWorklet` is used for output timing, but the player logic still runs on the main thread.

## Scope risk

- Building a serious "full VGM player" could easily consume 2-4 months.
- The expensive part is not only implementation.
- It also includes:
  - command coverage
  - DAC / PCM correctness
  - testing assets
  - result verification
  - compatibility differences between VGM files

## Practical scope for this repository

- This repository does not need to become a complete VGM player first.
- A more realistic target is:
  - a YM2612 + PSG learning-oriented VGM player
  - browser / WASM playback
  - support for a practical subset of Genesis / DefleMask-oriented VGM data
  - clear documentation about what is supported and what is not

## `examples/vgmrender` vs `web/ym2612vgm.js`

- `examples/vgmrender`
  - broader as a general VGM renderer
  - supports many `ymfm` chips, not only `YM2612`
  - renders to WAV offline
  - good as a reference for classic VGM command handling
- `web/ym2612vgm.js`
  - narrower, but closer to this repository's browser goal
  - focused on `YM2612 + PSG`
  - already has browser-oriented streaming playback
  - already has practical `0x90-0x95` DAC stream handling that is useful for some Genesis / DefleMask files

## What can still be borrowed from `examples/vgmrender`

- Priority 1: improve docs/comments around the classic YM2612 DAC route
  - explain `0x67` type `0x00` as the YM2612 PCM data bank
  - explain `0xE0` as seek within that PCM bank
  - explain `0x80-0x8f` as "write one DAC byte to `0x2A` and wait"
- Priority 2: make `0x68` more than a skip
  - current `web/ym2612vgm.js` only logs and skips `0x68`
  - first useful step is to parse and store:
    - data type
    - read offset
    - write offset
    - size
  - after that, decide whether target Genesis files actually need full behavior
- Priority 3: strengthen unsupported-command handling
  - when a command is not implemented, prefer:
    - known byte length
    - safe skip
    - clear log
  - this is safer than hard-failing on every uncommon command

## Important difference to remember

## 2026-08-21: TFI import/export status

- `web/tfi.js`
  - minimal TFI import/export helper now exists
  - current scope is 42-byte TFI
  - import:
    - `parseTfi(data)`
    - converts TFI operator file order `S1, S3, S2, S4` into logical operators `1, 2, 3, 4`
    - converts TFI detune values into YM2612 register detune values
  - export:
    - `createTfiFromPreset(preset)`
    - converts current logical operator preset data back into TFI byte layout
- `scripts/verify_tfi_import.mjs`
  - verifies:
    - operator order mapping
    - detune conversion
    - import/export round-trip

## `YM2612Synth` status for TFI

- `web/ym2612synth.js`
  - now accepts:
    - `rs`
    - `ssg`
    - `sr` as an alias for the same `0x70` register currently exposed as `d2r`
- important note:
  - current demo/UI naming still says `D2R`
  - TFI terminology would call the same register `SR`
  - this is a naming/UI issue more than a register support issue

## `docs/synth` status

- `docs/synth/index.html`
  - can now import TFI from the synth UI
  - can now export the current synth state as `.tfi`
- current flow:
  - choose a preset or edit knobs
  - import a `.tfi` file if needed
  - continue editing
  - export the current state back to `.tfi`

## `docs/synth` remaining work for TFI-friendly editing

- add `RS` control to the UI
- add `SSG-EG` control to the UI
- rename `D2R` to `SR` or `SR/D2R`
- possibly make a slightly more TFI-oriented operator panel later

## Packaging / release note

- `scripts/package_web_runtime_release.sh`
  - now includes `tfi.js`
- `scripts/sync_web_js_to_docs.sh`
  - now includes `tfi.js`
- `scripts/package_itch_synth.sh`
  - now includes `tfi.js`
  - rewrite for `docs/synth/synth.js` was generalized:
    - `../js/*.js` -> `./js/*.js`
  - this reduces future breakage when adding another shared JS file

## Important itch.io note

- the error
  - `Blocked a frame with origin ...`
  is mostly iframe noise from itch.io itself
- the real bug we hit was:
  - `tfi.js` 404 in the packaged synth build
- this was fixed by:
  - adding `tfi.js` to the package
  - rewriting the import path for packaged `synth.js`

- `examples/vgmrender` is not automatically "better" for this repository's goal.
- It is a stronger general VGM reference.
- But for this repository:
  - browser playback
  - `YM2612 + PSG`
  - DefleMask-oriented Genesis subset
  are more important than full generic coverage.

## Suggested next implementation order for `web/ym2612vgm.js`

1. Add clearer comments/doc for `0x67`, `0x80-0x8f`, and `0xE0`.
2. Add a structured `0x68` parser instead of pure skip.
3. Extend the raw command length table only for commands likely to appear in Genesis VGM files.
4. Only after that, decide whether to import more behavior from `vgmrender`.

## Progress added on 2026-08-17

- `0x68` is no longer only "skip and forget".
- `web/ym2612vgm.js` and `docs/ym2612vgm.js` now parse and store `0x68` PCM RAM write metadata:
  - `type`
  - `readOffset`
  - `writeOffset`
  - `size`
  - `commandOffset`
- A helper now exists:
  - `pcmRamWriteSummary()`
- Playback for `0x68` is still not implemented.
- But the parser can now preserve enough information to inspect real files and decide whether implementation is needed.

## `docs/vgm.html` status for `0x68`

- `docs/vgm.html` now has a dedicated section:
  - `0x68 PCM RAM Write`
- After loading a file, the page can now show:
  - where each `0x68` appears
  - its parsed offsets
  - its size
- This makes browser-side inspection possible before adding playback behavior.

## Safe-skip improvement added on 2026-08-17

- `web/ym2612vgm.js` and `docs/ym2612vgm.js` now have a small `ignoredCommandLength()` helper.
- Some known unsupported commands no longer hard-fail immediately.
- They are now:
  - length-checked
  - warned
  - safely skipped
- Current safe-skip coverage includes:
  - `0x30-0x3f`
  - `0x4f`
  - `0x40-0x4e`
  - `0x5d`
  - `0xb0-0xbf`
  - `0xc0-0xdf`
  - `0xe1-0xff`

## Why this matters

- This does not make the player "more correct" yet.
- It makes the parser more robust for mixed or broader VGM files.
- It reduces unnecessary hard parser stops when a file contains unrelated commands that this repository does not intend to render yet.

## Still intentionally not done

- `0x68` playback behavior
- full generic VGM compatibility
- broad support for non-Genesis chips
- automatic interpretation of every skipped command

## DefleMask-oriented finding

- At least one target Genesis VGM uses YM2612 DAC stream commands in a practical way.
- Observed pattern:
  - `0x67` data blocks
  - `0x90` stream target setup for YM2612 register `0x2a`
  - `0x91` data bank setup
  - repeated `0x92` with frequency `16000`
  - repeated `0x95` with block switching between `0x0000` and `0x0001`
  - final `0x94` stop
- This means `0x90-0x95` cannot always be ignored for DefleMask-oriented Genesis support.
- The good news is that this pattern still looks practical to support.

## Important reminder

- "Achieve this repository's goals" is not the same as "support all VGM files".
- Avoid accidentally turning this repository into a full compatibility project too early.

## Genesis-oriented work list

- Phase 1: keep the current base stable
  - keep `docs/beep.html` working
  - keep `docs/psg.html` working
  - keep `docs/vgm.html` working for the current sample VGMs
- Phase 2: clarify the Genesis audio model in docs
  - explain that Mega Drive / Genesis audio is mainly `YM2612 + PSG`
  - explain which part is FM and which part is PSG
  - explain where DAC / PCM belongs in YM2612
- Phase 3: strengthen VGM parsing for Genesis use
  - confirm handling for `0x50`
  - confirm handling for `0x52` / `0x53`
  - confirm handling for waits and loop-related behavior
  - document which DAC / PCM commands are supported now
  - inspect whether `0x68` matters for target Genesis VGM files
- Phase 4: prepare small test assets
  - one short FM-only Genesis VGM
  - one short PSG-including Genesis VGM
  - one short DAC / PCM-including Genesis VGM
  - keep them short enough for easy debugging
- Phase 5: improve debug visibility
  - show accumulated VGM time while parsing
  - show first YM2612 key-on timing
  - show first PSG write timing
  - show first DAC activity timing
  - show unsupported commands clearly
- Phase 6: define the practical compatibility target
  - write "supported Genesis VGM subset"
  - write "known unsupported patterns"
  - avoid claiming full VGM compatibility
- Phase 7: browser embedding path
  - keep the WASM build instructions simple
  - keep the JavaScript API simple
  - show the minimum code needed to connect to Web Audio
  - keep the demo pages as small reference implementations
- Phase 8: learning examples
  - add an example for YM2612 FM note playback
  - add an example for PSG tone playback
  - add an example for YM2612 DAC playback
  - add an example for mixed YM2612 + PSG playback
- Phase 9: optional later work
  - add better loop handling
  - add stricter DAC stream behavior
  - add more Genesis-focused VGM compatibility
  - consider DefleMask-oriented workflow notes

## Priority view

### Must

- keep `docs/beep.html`, `docs/psg.html`, and `docs/vgm.html` working
- document the Genesis audio model as `YM2612 + PSG`
- keep YM2612 / PSG / basic VGM playback understandable
- clarify the current supported VGM subset
- prepare short Genesis-focused VGM test assets
- keep the WASM + JavaScript browser path simple and reproducible
- add learning examples for:
  - YM2612 FM
  - PSG tone
  - YM2612 DAC
  - mixed YM2612 + PSG

### Nice to have

- improve debug visibility in `docs/vgm.html`
- show first key-on / first PSG / first DAC timing
- add better loop handling
- add clearer DefleMask-oriented workflow notes
- support more Genesis VGM command patterns as needed by real samples
- treat VGM DAC stream control `0x90-0x95` as a future compatibility target unless target Genesis / DefleMask files require it

### Not now

- full VGM compatibility
- real hardware accuracy tuning
- broad support for many non-Genesis chip targets
- turning this repository into a general-purpose VGM player project

## Current decision about `0x90-0x95`

- `0x90-0x95` DAC stream control is postponed for now.
- Reason:
  - it is part of broader VGM compatibility work
  - it can easily expand the scope too much
  - it should only be prioritized if target Genesis / DefleMask VGM files actually require it
- Important distinction:
  - YM2612 register writes such as `register=0x94` are normal FM register writes
  - that is different from VGM command `0x94`

## Game integration path

- Current playback style in `docs/vgm.html`
  - stream audio in chunks during playback
- This is good for:
  - debugging
  - command analysis
  - confirming that realtime audio can be generated
- This is closer to game use, but not finished yet because:
  - main-thread work still matters
  - loop handling is still basic
  - `AudioWorklet` output exists, but generation is not fully moved off the main thread yet

## What is needed for game-oriented playback

- audio generation that can feed Web Audio continuously
- start / stop / reset controls
- loop handling
- stable timing for long playback
- low enough main-thread cost for browser game use
- move from `ScriptProcessorNode` demo style toward `AudioWorklet` when needed

## Practical next steps toward game use

1. Keep the current streaming demo stable.
2. Keep `play / pause / resume / replay / stop / loop` behavior stable.
3. Confirm YM2612 + PSG + target DAC stream subset work during streaming.
4. Keep the `AudioWorklet` path stable and verify fallback behavior.
5. Move more generation/control work off the main thread only if needed.
6. Add a small game-like sample after streaming becomes stable.

## Proposed interface split

- Prefer a 3-layer structure for easier embedding:
  - chip layer

## Documentation direction added later

- `docs/index.html` is now being treated as the main browser-side entrance page.
- The page is now split into at least these entry sections:
  - `Demos`
  - `About YM2612`
  - `YM2612 Wasm`
- The direction is:
  - keep Markdown notes as repository source notes
  - add browser-readable HTML pages under `docs/info/`
  - let `docs/index.html` link to them as a small learning hub

## `docs/info/` direction

- `ex00.md`, `ex00_ja.md`, and `ex00_vgm.md` remain as original working notes.
- Browser-readable pages were added under `docs/info/`:
  - `info/index.html`
  - `info/ym2612.html`
  - `info/ym2612-ja.html`
  - `info/vgm.html`
  - `info/wasm.html`
  - `info/vgmplayer.html`
  - `info/audioworklet.html`
- Current interpretation:
  - Markdown files are the original notes / source material
  - `docs/info/*.html` are the public browser-reading path

## Demo page source links

- Source links were added to these browser demo pages:
  - `docs/beep.html`
  - `docs/psg.html`
  - `docs/embed.html`
  - `docs/vgm.html`
- The intent is:
  - demo first
  - source second
  - reduce the gap between "I heard it" and "where is the code?"

## Upstream-friendly reminder

- Do not treat upstream `examples` as project-owned documentation space.
- Keep `examples` easy to merge from upstream.
- Prefer:
  - repository notes in `ex00*.md`
  - browser-readable pages in `docs/info/`
  - demo implementations in `docs/*.html`

## Release packaging reminder

- A release zip was created for the first public browser-side runtime bundle:
  - `release/hello_ymfm_wasm_v0.0.1_web_runtime.zip`
- It currently contains:
  - `web/`
  - `docs/generated/`

## Current documentation/product split

- `hello_ymfm_wasm` is moving toward:
  - YM2612 / ymfm learning notes
  - browser demos
  - WASM / JavaScript integration examples
  - Genesis / DefleMask bridge notes
- The larger composer/tool idea should stay separate as another project.

## Good next steps after a break

1. Re-open `docs/index.html` and confirm the top-level site structure still feels right.
2. Continue growing `docs/info/` rather than pushing too much text into `README.md`.
3. Consider adding an FM-focused page next:
   - 1 operator
   - 2 operators in parallel
   - 2 operators in series
   - feedback
4. If possible later, connect parameter changes to:
   - audible output
   - waveform view
   - FFT view
  - player layer
  - audio output layer

### 1. Chip layer

- Purpose:
  - keep YM2612 / PSG handling low level
  - expose register writes and sample generation only
- Examples:
  - `Ym2612`
  - `SegaPSG`
  - optional combined `GenesisAudioEngine`

### 2. Player layer

- Purpose:
  - parse and drive VGM playback
  - hide chip-specific details from app / game code
- Candidate class:
  - `VgmPlayer`
- Candidate responsibilities:
  - `load(buffer)`
  - `reset()`
  - `play()`
  - `stop()`
  - `setLoopEnabled(enabled)`
  - `isPlaying()`
  - `sampleRate()`
  - `process(left, right, frames)`

### 3. Audio output layer

- Purpose:
  - connect the player to browser audio output
  - keep Web Audio details separate from VGM / chip logic
- Candidate implementations:
  - current demo-oriented `AudioWorklet` path
  - `ScriptProcessorNode` fallback path

## Why `process(left, right, frames)` is important

- It fits browser audio callback style well.
- It is reusable for:
  - streaming playback
  - offline rendering
  - future game-engine integration
- It gives a cleaner boundary than exposing raw register writes to app code.

## Interface direction for game use

- Do not force a single interface style.
- A practical split is:
  - high-level API for BGM
  - low-level API for SFX / realtime control

### High-level API

- Good for:
  - VGM playback
  - BGM handling
  - simple browser/game integration
- Prefer methods such as:
  - `load`
  - `play`
  - `stop`
  - `loop`
  - `process`

### Low-level API

- Good for:
  - sound effects
  - realtime note control
  - direct YM2612 / PSG experimentation
- Prefer methods such as:
  - `writeYm2612(port, register, value)`
  - `writePsg(value)`
  - possible future helpers like `noteOn` / `noteOff`

## Likely class direction

- `GenesisAudioEngine`
  - low-level YM2612 + PSG control
  - sample generation via `process(left, right, frames)`
- `VgmPlayer`
  - high-level VGM playback built on top of `GenesisAudioEngine`

## Why this split makes sense

- BGM and SFX do not always want the same API.
- VGM playback wants a higher-level player abstraction.
- Game SFX may still want direct register access.
- This keeps the repository useful for both:
  - embedding music playback
  - experimenting with chip-level sound design

## Good next steps

1. In `docs/vgm.html`, show more timing information:
   - total wait before first audible section
   - first key-on timing
   - first YM2612 DAC activity timing
2. Add a simple debug view:
   - command index
   - accumulated VGM samples
   - accumulated seconds
3. If needed, make the progress display smoother without changing the audio path:
   - UI-only refresh with `requestAnimationFrame` or a light timer
4. If the first VGM still feels suspicious, inspect which command appears just before the first audible sound.
5. Only after that, decide whether `0x68` or stricter DAC stream behavior is worth implementing.

## Files to reopen next time

- `docs/vgm.html`
- `docs/ym2612vgm.js`
- `web/ym2612vgm.js`

## Short reminder for future me

- The project is already past the "can browser/WASM make sound?" phase.
- The next work is mostly about VGM behavior, timing visibility, incremental compatibility, and game-oriented API cleanup.
- Do not overreact to silence if `SKIP` is already gone.
