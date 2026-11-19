# SPU Live changed-value highlighting

- [x] Reuse the existing bounded CSS pulse over scalar values displayed from
  the selected PSF / Code CH. Do not compare or copy PCM arrays for highlights.
- [x] Add default-on Highlight changes beside Live, with a separate SPU local
  preference and a functional Off switch.
- [x] Reset baselines on source/session/CH changes, Pause/Seek, Live Off,
  waiting/error and hidden/inactive controls; no false flash on first display.
- [x] Add no polling, timers, forced layout reads or audio/register writes.
  Leave Code, PSF, keyboard ownership and working/saved Files unchanged.
- [x] Verify scalar comparisons, hidden/focused controls, Off/reset/disposal,
  real muted Code/PSF updates and readable packaged assets locally.

Waveform/sample-data diffing, new transport/API features, npm/Tauri/publication
and remote CI are outside this slice.

## Verification (2026-11-20)

- SPU adapter + shared highlighter: 13 unit checks passed. Includes initial
  baselines, bounded pulses, Off/disposal without reads, per-control hidden /
  focused / unknown states, scope and frame rollback, and scalar-only input.
- `npm run test:spu-synth`: 403 passed, including readable package/source checks.
- `check_spu_synth_parameters_keyboard_browser.cjs`: source and final ZIP,
  muted Chromium/WebKit. Actual Code ADSR change activates the CSS pulse;
  Off clears it without stopping observation, and re-enable/CH/tab changes
  establish fresh baselines. Existing ownership, effects and keyboard pass.
- `check_spu_synth_psf_manual_browser.cjs --engines=chromium`: source and ZIP;
  audible PSF Pitch changes pulse and Pause clears the display. Existing
  independent Synth edits, layout navigation, Capture and transport pass.
- `check_spu_working_saved_browser.cjs`: muted Chromium/WebKit; Highlight Off
  survives reload, while draft/accepted sound, Code continuity and navigation
  remain intact.
- `sh scripts/package_itch_spu_synth.sh live-highlight-check`: passed; the new
  readable adapter and shared helper are included with source receipts.
- `git diff --check`: passed. Physical destinations muted before app startup;
  no listening, npm/Tauri release, remote CI, commit or push.

Highlight changes follows existing <=20 Hz observations. Intermediate writes
may be missed. Scalar fields only: no waveform/sample comparison or claim to
show every register write. It adds no polling/timers/audio commands/layout
reads. CSS owns the 420 ms pulse; reduced-motion uses a 1 ms pulse. The separate
SPU preference defaults On and storage failures do not interrupt the synth.
