# SPC: keep an owned AudioContext closed after late WebKit startup

Date: 2026-10-26

## Result

Fixed the unresolved initialization-close case from
[SPC WASM SDK adoption](wasm_sdk_spc_adoption_01.md). In the tested WebKit,
`AudioContext.close()` resolved with state `closed`, but the context subsequently
returned to `running`. No late SPC node was created and initialization already
rejected with `AbortError`; the context lifecycle was the remaining problem.

The original committed runtime reproduced the late transition in **19 of 20**
attempts after normal 44.1/48 kHz playback. Each affected context closed when
explicitly closed a second time. The same diagnostic sequence with the fix
passed **20 of 20** attempts.

## Change

[`web/spc_audio.js`](../../web/spc_audio.js) closes an owned context through a
context-specific helper. It installs a `statechange` listener before closing,
coalesces concurrent close requests and rechecks state after the close promise
resolves. If the browser later reports a non-closed state, the listener closes
that same context again. Both explicit disposal and failure cleanup use it.

The listener deliberately remains attached to that discarded context: removing
it on the first `closed` event would miss the late transition. It captures only
the context and pending closure, not the player, asset promises, nodes or media.
A WeakMap prevents duplicate listeners. There is no polling, timeout retry or
wait for unfinished asset loading. The original `close()` promise remains
idempotent; later cleanup is driven by the browser's state changes.

Supplied contexts remain host-owned. Immediate `resume()` remains in its current
position so that this fix does not move it outside the initiating user action.
Audio generation, WASM, resampling, scheduling, Mixer/FX and gains are unchanged.
The corresponding `docs/js/spc_audio.js` contains the same change while retaining
its existing website URLs and cache queries.

## Engine source investigation

Playwright 1.63.0 identifies its WebKit upstream as
[`4d05d732e5a84f32675bef4cc135a2e7a9269a87`](https://github.com/microsoft/playwright/blob/v1.63.0/browser_patches/webkit/UPSTREAM_CONFIG.sh).
At that revision, the AudioContext constructor queues `lazyInitialize`, and
[`startRendering()`](https://github.com/WebKit/WebKit/blob/4d05d732e5a84f32675bef4cc135a2e7a9269a87/Source/WebCore/Modules/webaudio/AudioContext.cpp#L336-L352)
sets `Running` in a successful asynchronous destination callback without
rechecking `Closed`. The explicit resume path and implicit startup have separate
callbacks. This provides a plausible source-level explanation for the measured
late state transition; the exact native callback was not instrumented.

Moving resume after asset loading could lose user-activation timing and still
leave implicit startup pending. Waiting for `addModule()` during disposal could
hang on an unresponsive request. The event-driven cleanup preserves prompt
disposal and the current startup order.

## Verification

- Regression tests: owned initialization with an abort-ignoring fetch still
  pending, late browser startup, repeated close/state notifications, concurrent
  close coalescing, untouched shared context and late startup after processor
  failure. The SPC audio test file passes all **20 tests**.
- Relevant SPC/SNES suite: **128 tests passed**, including real WASM/native PCM,
  resampling, RAM/DSP state, Worklet clients, observation and trace/replay.
- Actual Chromium/WebKit: all **4 playback cases** at 44.1/48 kHz and **40
  repeated initialization-close cases** passed. These retain the real context
  state assertion and the full preceding playback sequence.
- Browser tests mute only the final output branch. The production Worklet,
  renderer, Mixer/FX and pre-output PCM monitoring remain active.
- FM npm package: isolated tarball installation, real renderers, asset/import
  closure, declarations and type checks passed. No package was published.

Detailed evidence is in [spc_webkit_close_01.json](spc_webkit_close_01.json).
The original adoption report's `browserLifecycle.passed=false` is historical
evidence and has not been rewritten as a passing original run. The result here
resolves that follow-up locally; Safari.app/Tauri listening and a new remote CI
of this JavaScript fix were not performed.

## Sega PSG CI checkpoint

The already-running separation CIs completed successfully before this fix:

- [Main run 40286728456](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40286728456),
  head `f0b786294e62081a200f2e419b92f9a39cf1a15f`: 81 guard tests,
  27 WASM builds, 53 outputs and 39,982 exact comparisons passed.
- [SDK run 40286698097](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/40286698097),
  head `0e9379bf7e6ae2951ad0e3d8ea2db24cfca55415`: Native Windows x86_64,
  Linux x86_64/arm64 and macOS x86_64/arm64 all passed, each with 51 audit tests
  and 24 CTest cases from the extracted source release. YM2612 WASM and archive
  verification passed too.

These CI heads do **not** include this subsequent SPC JavaScript fix. Both fixed
SDK 0.1.1 snapshots remain unchanged. Tauri's three pre-existing collector
changes remain uncommitted; this task did not edit or synchronize them.
