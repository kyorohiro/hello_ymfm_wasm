# HuC6280 Synth: Keyboard / Code and Files

- [x] Inspect the existing HuC6280 processor, public JS API and shared Synth
      Code/Files architecture; keep one physical six-channel chip and its gain.
- [x] Add `useSoundChip("huc6280")` on the same chip as the instrument UI,
      including Wave, Noise, hardware LFO and software-fed DDA as supported.
      Preserve register edits, safe note ownership and explicit Stop behavior.
- [x] Add common Keyboard/Code tabs, Run/Apply/Stop, maximize, Monaco types and
      source navigation, starter `index.js`, runtime helpers and software FX.
- [x] Add Files, presets/text/binary/project import/export and local recovery,
      using the reconnect-safe storage contract. Restoration never runs Code.
- [x] Keep Code running while switching views, editing controls/waves or loading
      instruments. Show physical-channel state/editing with sparse manual changes to the
      authored preset; keep raw Code writes separate; keep source/LFO/DDA constraints explicit.
- [x] Preserve existing keyboard, VGM sound extraction, audio import, Pitch,
      presets, DDA/sample data and desktop output hooks.
- [x] Verify actual WASM/Worklet output and async cleanup in Node and muted
      Chromium/WebKit; package readable sources, types and licenses.
- [x] Update README, verification and CI. No commit, push, tag or publication.

Match the FM2612/SPU/DMG layout and interaction conventions. Use the chip object
for Code notes; no global `play()` starter. Software scheduling, envelopes,
effects, pitch helpers and DDA sample supply must be labelled as software.
No song player/sequencer or new VGM playback backend in this slice.

No physical audio. Headless checks install destination gain zero before app JS
and Chromium mute; only one browser batch may run at a time. Keep user storage
and imported files untouched; use self-authored fixtures for verification.

Verified with 284 Node tests and 76 muted browser checks across Chromium / WebKit,
including the standalone ZIP. See [verification](verification_huc6280_synth_code_20261113.json).
No publication was performed.
