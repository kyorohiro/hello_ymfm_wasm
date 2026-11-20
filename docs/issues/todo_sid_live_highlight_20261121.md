# SID Live changed-value highlighting — 2026-11-21

Authorized after npm 0.2.46 / examples work. Highlight the existing selected
song / Code channel controls; retain the same editor, Live following, manual
editing, channel ownership and working/saved Files behavior.

- [x] Reuse the shared bounded CSS pulse and scalar highlighter over the
      existing Waveform / Pulse width / ADSR / Sync / Ring / Filter controls.
- [x] Add default-on Highlight changes beside Live, with a separate persistent
      SID preference and an Off path that performs no value comparisons.
- [x] Establish fresh baselines on source/session/channel/model changes,
      Pause/Seek, Live Off, waiting/error, document hiding and folded/focused
      controls. First observation must not flash every field.
- [x] Use the existing observation cadence only: no extra polling, register
      reads/writes, audio commands, waveform copies or forced layout reads.
- [x] Verify scalar changes, bounded animation, Off/reset/disposal and actual
      Code / SID song behavior in muted Chromium/WebKit, source/readable ZIP.
- [x] Record verification and update the SID alignment TODO/documentation.

Output-only channel switches, Looper/Event Rec, additional timing/native APIs,
npm publication, Tauri imports, commit/push/tag and remote CI are outside this
slice. Numeric audio checks remain separate from human listening.

## Implementation

The existing shared scalar highlighter and 420 ms CSS pulse are applied to
cached editor controls and frequency/Gate/observable Envelope readouts. The
continuously advancing position is excluded. Reduced motion uses a 1 ms pulse.
Rapid changes share one active pulse; no forced reflow restarts it. Existing
`data-changed` diagnostics remain, but their former persistent color/outline
rules have been replaced by the optional bounded animation.

`Highlight changes` is beside the existing Live checkbox and defaults On. A
separate local preference (`tetorica-sid-synth-live-highlight`) survives reload;
storage failures do not interrupt the app. Off clears active animations and
does not read highlight scalars or availability. Live observation and editing
continue independently. The adapter consumes the existing <=20 Hz display
updates and adds no clock, audio commands, register reads/writes or waveform
array comparisons. Intermediate writes may be missed.

Owner/origin, a read-only session epoch, selected CH, model, sample rate and
clock identify each comparison scope. Frames moving backwards also reset it.
Initial, paused, waiting/error, Live Off, hidden/folded and focused states
establish new baselines. Dimmed Pulse width and observed frequency ratio still
show changing registers/calculated values when visible. Session epochs expose
existing Code/import generation counters without altering transport behavior.

## Local verification

Detailed evidence: [verification_sid_live_highlight_20261121.json](verification_sid_live_highlight_20261121.json).

- `npm run test:sid-synth`: **347/347** passed, including editor/host, ownership,
  working/saved, Code, import, timing and readable ZIP checks. The focused
  adapter/shared/live/import group also passed **79/79**; the adapter/shared
  subset contains 16 tests, including Off with throwing getters and disposal.
- `check_sid_live_highlight_browser.cjs`: source and actual extracted readable
  ZIP × Chromium/WebKit, **4/4 cases / 28 stages**. Each checks both 6581 and
  8580 Code observations, plus the self-authored melody/filter PSID fixture.
  Verified selective/bounded pulses, unchanged-value silence, CH/fold/focus/
  hidden resets, Off without stopping Code or adding sound commands, Pause/
  Resume and exact paused song position, preference reload, no startup audio,
  and 1360/390 px normal/expanded layouts. Physical outputs were muted before
  startup; real finite, nonzero AC PCM was measured upstream.
- Existing Code Live regression: both browsers / both models passed, including
  authored setup preservation, bounded polling, Apply, Keyboard continuation,
  and rejection of stale observations after Stop. Its former read-only and
  Keyboard-stops-Code assumptions were updated to the already supported direct
  CH editing/continuation behavior; visual assertions now inspect the actual
  CSS animation class rather than only `data-changed` diagnostics.
- Final readable ZIP: **359 files / 3,696,028 bytes**, SHA-256
  `5115fbe8a7c74173304519a36d2fa5648ad713a477723cf5d2df7f2c439be5e9`.
  All 285 original-input receipts match current source. The new adapter and
  shared helper are included as readable, byte-identical modules.
- Full browser behavior ran on the initial ZIP, then the final ZIP incorporated
  README-only documentation. Every one of its **109 served assets** matches the
  tested extraction exactly; **108** also match source paths directly. The root
  HTML is intentionally rebased. Final source/archive provenance is verified
  separately, with no executable asset differences between the ZIPs.
- Desktop and narrow screenshots were visually inspected. No unexpected page
  errors, unhandled rejections, missing assets or external requests occurred.
  `git diff --check` passed. No listening, remote CI, commit/push/tag, npm
  publication or Tauri import was performed.

Reproduce against source with `node scripts/check_sid_live_highlight_browser.cjs`.
Use `--root=EXTRACTED_ZIP --entry=/index.html` for the standalone ZIP. All browser
checks permanently mute physical destinations before app startup.
