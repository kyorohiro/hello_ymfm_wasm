# SPC seek control parity — 2026-11-15

Compared the SNES controls with FM2612's `synth_song_seek_controls.js` and aligned the position bar's preview / commit behavior. Pointer dragging and repeated navigation keys preview a held destination through playback polls; release / keyup / blur commits once. Arrow keys move one second, Shift moves ten, Page Up / Down move ten, Home / End select endpoints, and Escape / pointer cancellation / hiding the page discard unfinished drafts. Stop and source replacement cancel drafts. Source identity uses the source ID, so same-name replacements also reset the display.

The player exposes the pending target separately from the actual position. A seeking bar shows that target and remains available for another seek. The existing SPC client fences the superseded seek and retains original playing / paused intent. Stop and output close clear the target, and late replies cannot restore an obsolete position. Cold overlapping seeks share one audio preparation and only submit the newest target.

The bar has a filled position track and accessible time text. Unknown duration displays `—` with a one-hour range. Tagged files use the tagged span; continuing playback may extend the bar within the one-hour seek limit. Tags still do not stop or fade playback. Forward replay seeking remains unchanged; no checkpoint cache or native SDK/WASM update is included.

Validation: 203 Node tests passed, including new control and pending-target/concurrent-preparation cases. Source and independent ZIP pass Chromium / WebKit for Web and mocked Tauri UI. Real pointer/keyboard tests cover silent preview, one commit, playing and paused destinations, Escape, repeated seeks, delayed native seek steps across Stop, same-name replacement, pointer cancellation, blur, accessible time, one audio context / route / Menu and mobile width. Existing SPC playback, Mixer, Code, processor retry and desktop Menu checks pass the final ZIP in all four combinations. Physical speaker output was muted; no human listening or physical CPAL device test was performed.

All 121 browser build inputs in the final ZIP match current files. CI includes the new browser checks on source and packaged ZIP. No Looper / Event Rec work, Tauri checkout changes, commit, push, tag or release was performed.

See [verification receipt](verification_snes_seek_controls_20261115.json). Review ZIP, screenshots and logs are in ignored `build/verification/snes-seek-controls-20261115/`.
