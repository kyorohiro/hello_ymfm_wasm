# ST YM2149 Code workspace alignment — 2026-11-21

Authorized after the priority correction: finish timed APIs and Code / Synth
workspace rollouts before more highlighting. ST already has the timed API;
this slice aligns its layout while preserving that existing implementation.

- [x] Add Code / Synth layout buttons beside Files.
- [x] Reuse persistent expanded navigation with Code / YM2149 / Mixer /
      Keyboard, retaining expansion when changing view.
- [x] Move the original Master into the expanded workspace and restore it;
      keep one editor/model, transport, Files tree and audio output route.
- [x] Preserve running Code, context/livePrepare/FX and named reservations;
      navigation must not execute Code, cancel schedules, retrigger the shared
      Envelope, stop reference playback or alter paused position.
- [x] Retain keyboard/focus/ARIA behavior and existing Files content/selection.
      No working/saved schema migration, gain policy, new mixer or highlighter
      is included in this layout slice.
- [x] Verify actual markup/shared helper, ST host event forwarding and existing
      timed/current-client-reset-snapshot behavior. Check source/readable ZIP
      in muted Chromium/WebKit with Monaco/fallback and normal/expanded/narrow
      layouts, including ongoing performance and reference transport.
- [x] Record verification and update the per-Synth and shared rollout status.

No npm publication, Tauri update, commit/push/tag or remote CI is requested.
Human listening and long-duration/device testing remain separate.

## Implementation and verification

The ST host opts into the shared persistent layout and forwards view/expansion
events. The Synth reuses `setupSynthExpandedTabs` with its existing YM2149 and
Mixer tabs, Master and Code transport. New slots and a chip-content wrapper
move the existing nodes instead of cloning or replacing them. Input mode and
layout remain separate; selecting chip/Mixer does not run or stop Code.

Local `test:ym2149-st-synth` passed **181/181** and existing
`test:ym2149-timed` passed **91/91**. The new 5 workspace tests use the actual
HTML hierarchy and shared helper, plus host callback/audio readiness checks.

Detailed evidence:
[verification_ym2149_st_code_workspace_20261121.json](verification_ym2149_st_code_workspace_20261121.json).

- Actual source and safely extracted readable ZIP × Chromium/WebKit × local
  Monaco/fallback: **8/8 cases / 48 stage checks** passed. No app changes were
  required after the first implementation; provisional checker-only failures
  are excluded from signoff.
- Code / YM2149 / Mixer / Keyboard order, ARIA/arrow/Home/End focus,
  persistent expansion, header/restoration, original Master/transport/editor/
  model/Files-node identity, JSON/text selection and 1360/390 px normal,
  expanded and restored layouts passed. Desktop/narrow screenshots were
  visually inspected.
- Existing `captureState`, `compile` and a compact eight-entry, 40 Hz R8
  reservation ran through the real AudioWorklet. Register values and native
  frames advanced across views, while the loop/client/context/FX graph stayed
  owned and unchanged. Navigation issued no lifecycle cancellation/reset.
  Master peak at 60%/120% had a **2.0** ratio through the same route.
- A self-authored VGM remained playing through layout switches; nonzero
  paused positions **15,552–16,963 frames** stayed exact and resumed on the
  same player. Layout changes did not Run/Apply code or start a second context.
- Speakers were permanently muted before app startup. Finite, nonzero AC PCM
  was measured upstream; this is not human listening or CPAL/device testing.
  No missing resources, unexpected console/page errors, unhandled rejections
  or external network requests occurred. The 11 local Monaco fixture files
  were pinned and byte-identical in source/ZIP tests.
- Final readable ZIP: **205 files / 2,492,538 bytes**, SHA-256
  `205a72764d503133f559c7941beb563f447bdca950c204cdabba24e7eab9e3ac`.
  All **180 original-input receipts** match current source. Authored workspace
  JavaScript/CSS and shared helpers are unchanged in the ZIP; entry HTML differs
  only by the packager's documented navigation/source-link rewrites.
- `git diff --check` and checker syntax checks passed. No npm publication,
  Tauri import, remote CI, commit/push/tag or public release was performed.

Reproduce with `node scripts/check_ym2149_code_workspace_browser.cjs`.
Choose `--editor=monaco` with the pinned local fixture from the checker config;
use `--root=EXTRACTED_ZIP --entry=/index.html` for the standalone distribution.
The checker always mutes actual physical output paths before the app starts.

ST now has the priority timed API and Code / Synth UI surfaces. Working/saved
Files and other optional ST comparison rows remain separate. The remaining
priority ports are FM2608, 2A03, S-DSP and SCSP; highlighting stays deferred.
