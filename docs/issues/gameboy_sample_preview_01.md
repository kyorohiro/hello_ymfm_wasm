# Game Boy Sample Editor conversion preview

Date: 2026-10-28

## Behavior

Open **Menu → Sample Editor…**, select **Game Boy · 32-point wave**, and load a
recording or choose **Draw a cycle**. The editor shows the edited selection and
the converted 32-sample, 4-bit wave RAM side by side. On narrow screens they stack
vertically. Expand **Wave RAM values (0–15)** to inspect the exact samples.

**Preview Game Boy** plays the converted wave at the selected root MIDI note for
0.85 seconds. It uses an isolated real Game Boy WASM core and the shared standard
Game Boy listening gain, applied once. The preview passes through the existing
Web Audio or injected Native Sample Editor playback route. It does not edit the
live Game Boy instance or its Mixer strip. **Stop preview**, editing, changing the
target, closing the editor, and backend/session invalidation retire pending audio.

Save the sample and Run `examples/gameboy/gameboy-sampler.js` to play it from
Keyboard. Comparison, chip preview, and the saved instrument use the same existing
`renderGameboyWave()` conversion. The project still stores original Float32 WAV
and non-destructive edit settings; there is no second saved waveform to diverge.

Wave RAM is independently pitched. Preview uses the integer root MIDI note,
matching the existing Keyboard instrument's `wave.setNote()` behavior. Tuning cents
remain sample metadata; this change does not alter that existing Game Boy behavior.
Preview notes below C1 (MIDI 24) are rejected with a range message. Other sample
targets retain their existing PCM previews.

## Implementation

- `web/playground_sample_gameboy_preview.js` and its docs mirror return bounded
  comparison points and owned, finite stereo PCM. Native state is released after
  both successful and failed generation, with short endpoint fades.
- The Sample Editor Worker snapshots source/settings before asynchronous WASM
  loading. The core loads only when chip preview is requested.
- The UI coalesces comparison work, discards stale replies, and reuses results on
  viewport changes. Conversions are not posted while dragging. There is no new
  recurring polling loop or live-chip readback/write from painting.
- Loading failure refreshes the retained sample instead of leaving comparison
  pending. Canvas border sizing and scroll margins keep the dialog within narrow
  viewports.
- Packaging includes the new helper and its preset dependency. The page, Worker,
  CSS, and helper use the `gameboy-sample-preview-1` cache revision. Run-only UI
  bundling remains enabled, and the shared Worker/helper stay separate assets.
- The itch web CI now includes the real-core conversion tests and the new
  Chromium/WebKit editor/host/packaged-ZIP regression checker.

## Verification and publication

Local focused audio tests passed (53 cases). The exact updated CI unit-test
command passed (36 cases, including archive/preparation tests and seven new
real-core tests). The existing Sample Editor browser regression passed in both
Chromium and WebKit, including recording cleanup, asset roundtrips, editing,
capacity errors, and pending Native preview cancellation. Physical output is muted.

The new Chromium/WebKit checker passed all six routes: editor fixture, full
Playground save/Keyboard handoff, and the exact minified Run ZIP using public UI.
It verified every saved wave RAM value, real PCM, stale-result cancellation,
loading-failure recovery, and zero horizontal overflow at 390px. The Run ZIP is
890 entries, with both the helper and its preset dependency included. Screenshots
were inspected; no physical output was played.

The [companion receipt](gameboy_sample_preview_01.json) records these checks,
exact ZIP hashes, and source hashes. Native playback was checked through injected
adapter contracts and adapter unit tests; Tauri GUI listening was not performed.
New code remains uncommitted and its updated CI has not run on GitHub yet. No npm
publication, SDK release, Tauri import, or app upload was made.

The previous release CI at `v0.93.2+1+test` / `3db298f7` passed all four workflows,
including Ubuntu packaging/browser checks. That result predates this feature.
