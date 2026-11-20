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

## Initial implementation and verification

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
  All **180 original-input receipts** matched source at this verification. Authored workspace
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

## Follow-up: reference controls in Code view

- [x] Keep the original Song selector and Play/Pause/Stop outside the hidden
      Synth editor so every expanded view can operate the reference player.
- [x] Verify their visibility and actual VGM transport from Code, including
      Code/song exclusion and preserved paused position. Update the structural
      regression that previously put the song panel inside the hidden editor.

The original reference panel is now a direct child of the main workspace,
before the expanded tabs. Code and Keyboard no longer hide it. Existing player
nodes and actions are reused; showing Code does not start or stop a song.

Follow-up verification: **181/181** ST tests and **8/8** source/readable-ZIP
browser cases passed (Chromium/WebKit × Monaco/fallback). The revised checker
requires the controls to be visible in every view and operates actual generated
VGM Play/Pause/Resume/Stop with Code selected. Paused positions remain exact,
and explicit Code/song playback keeps its existing exclusion. 390 px screenshots
were inspected; physical output was muted throughout.

New readable ZIP: **205 files / 2,492,721 bytes**, SHA-256
`e32f87da3a459ba9e248c17efa33af7fa42e066cf6e67d8ff5002c8c23004b58`.
All 180 original-input receipts match the corrected source. No publication or
commit/push was performed. Evidence:
[verification_ym2149_st_code_player_visible_20261121.json](verification_ym2149_st_code_player_visible_20261121.json).

## Follow-up: compact player and Instrument selection

- [x] Add an accessible fold control for the reference-player panel, available
      in normal and expanded views without changing playback or paused position.
- [x] Keep Instrument selection on the current workspace tab and apply the
      selected sound. File selection for editing remains a separate action.
- [x] Cover both behaviors with regression tests and muted browser checks.

Reference playback uses native `details` / `summary`, expanded by default.
Clicking its heading or using Enter/Space folds it without changing the player;
the fold stays intact when navigating workspace tabs. No audio handler or
additional transport is involved.

Instrument used the same file-opening action as the Files tree. In expanded
YM2149 view the underlying input mode was still Code, so selecting a sound
revealed its JSON. The picker now uses the same validated sound-apply path with
editor opening disabled. It retains the current tab, file, editor/model and
running Code. Explicit Files selection still opens text using the input mode.
Failure/cancellation keeps the previous instrument.

Verification: **185/185** ST tests and **8/8** muted browser cases passed
(source/readable ZIP × Chromium/WebKit × Monaco/fallback). A distinct instrument
was checked against the displayed settings and both client/native registers
while Code kept its owner. Cold, running-Code, playing-song and paused-song fold
checks passed; paused positions remained exact with no audio commands. Folded
390 px Code and desktop YM2149 screenshots were inspected.

Readable ZIP: **205 files / 2,493,446 bytes**, SHA-256
`a08c22d0ca995ff36f7850f3afd7a9e6874c8366e41a5fa40f7a9669aed10c15`.
All 180 original-input receipts match this source revision. No publication,
commit/push or remote CI was performed. Evidence:
[verification_ym2149_st_instrument_fold_20261121.json](verification_ym2149_st_instrument_fold_20261121.json).

## Follow-up: align Files and workspace tabs

- [x] Move the original reference disclosure above the Files/Code columns,
      beside or just above the existing instrument/performance status.
- [x] Align the Files heading controls with Code / YM2149 / Mixer / Keyboard
      tabs on desktop; keep Master accessible without pushing the tabs down.
- [x] Preserve fold/player/editor state and check expanded/restored/narrow
      layouts with Files open and closed. Keep this slice limited to layout.

The original status, reference disclosure and expanded Master now occupy a
shared metadata row before the Files/main columns. Desktop Files heading and
workspace tabs share their top and center Y, including when reference playback
is expanded. Collapsed Reference playback and Master fit beside the status;
narrow layouts stack the common area before Files and Code. Normal Synth view
still restores the original Master to its monitor. No audio/runtime behavior
was changed in this alignment slice.

**185/185** ST tests and **8/8** muted source/readable-ZIP browser cases passed
(Chromium/WebKit × Monaco/fallback). Each case measured 18 desktop alignment
samples across all four tabs, with Reference playback open and folded: maximum
heading/tab top and center differences were both **0 px**. Restored and 390 px
layouts, Files open/closed, Instrument application, folding, running Code and
VGM transport checks passed. Desktop and narrow screenshots were inspected.

Readable ZIP: **205 files / 2,494,089 bytes**, SHA-256
`4939441ac5d9a535b6cb7fec4af374e50dc10de95713433903e318ebd36c27c1`.
All 180 original-input receipts match this revision. No publication,
commit/push or remote CI was performed. Evidence:
[verification_ym2149_st_workspace_alignment_20261121.json](verification_ym2149_st_workspace_alignment_20261121.json).
