# SPU expanded Code navigation

Authorized follow-up to the working/saved Files rollout. Reuse the shared
FM2612/HuC6280 navigation without changing sound, transport or file semantics.

- [x] Add Code / Synth layout buttons beside Files.
- [x] Keep expanded layout when choosing Code, PCM, ADSR, FX, Audio,
  PSF / VAB or Keyboard; reuse the existing editor and controls.
- [x] Keep Master and the Code transport reachable in expanded layout.
- [x] Preserve Run, context, held notes, PSF playback and working/saved drafts
  when changing views. Opening import panels must not collapse this layout.
- [x] Verify tab order/keyboard focus, desktop/mobile, fallback/Monaco and a
  readable packaged ZIP using muted local browsers.

No new Mixer, Looper, timed API, npm/Tauri/publication or remote CI in this slice.

## Verification (2026-11-20)

- Shared Code controls/expanded tab tests: 49 passed.
- `npm run test:spu-synth`: 397 passed, including source/package validation.
- `check_spu_working_saved_browser.cjs`: source and final ZIP, muted Chromium
  and WebKit. Expanded tabs, arrow/Home/End navigation, 1240/390 px layouts,
  complete tab labels, header Master, held Gate, same audio graph and continued
  Code loop/context passed; working/saved and full ADPCM edits also passed.
- `check_spu_synth_code_monaco_browser.cjs --engines=chromium`: source and ZIP,
  actual pinned Monaco. All expanded panels and Keyboard return to the same
  editor/model/source/cursor; 1240/390 px expand/restore, completion, type checks,
  readable definition navigation and text/JSON file operations passed.
- `check_spu_synth_psf_manual_browser.cjs --engines=chromium`: added expanded
  navigation while PSF plays; the same source core advances and authored data
  stays unchanged. Existing Pause/Resume, Capture and owner handoff passed.
- `sh scripts/package_itch_spu_synth.sh expanded-navigation-check`: readable
  module graph includes the shared tab adapter; native/source receipts passed.
- Inspected desktop/mobile captures; expanded mobile tabs wrap without clipping.

Physical audio outputs were muted before application startup. No listening,
real-game listening, Tauri build, remote CI or publication was performed.
Expanded layout is retained across tab/view changes during the session; it is
not a new cross-reload layout preference. Master stays in its original header.
