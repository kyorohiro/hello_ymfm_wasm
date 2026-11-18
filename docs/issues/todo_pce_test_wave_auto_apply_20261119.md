# PC Engine test-wave automatic application — 2026-11-19

User accepts the current media levels and software preview method for now,
and requests removal of Reload test wave so edits always apply automatically.

- [x] Remove Load / Reload and Auto load mode from the test-wave widgets.
  Keep 120 ms latest-only previews and gesture-end WAV persistence.
- [x] Apply shape, drawing, Frequency, PCM level, Length and Smooth edges
  automatically; keep idle loading silent and lifecycle/ownership fences.
- [x] Clarify that 30% is an adjustable app balance, and generated WAV
  replacement / fades are software assistance, not extra chip controls.
- [x] Verify widget behavior and real source / standalone ZIP UI in muted
  Chromium / WebKit. Preserve earlier uncommitted work and historical evidence.

No source renderer, native/WASM, gain, publication, staging or commit changes.

The existing 120 ms coalescing, single in-flight update, generation cancellation
and gesture-end Files save are retained. The first edit/shape choice prepares
the sample silently; playback still starts from Keyboard / Play. Errors can be
retried by adjusting a control. Existing explicit file/sample loading controls
are separate and remain available.

The former New Cassette browser checker was also aligned with the automatic
test-wave UI, preserving its PC-98 path and historical receipts. It passed
17 PCE Chromium groups. The app suite passed 640/640 and deterministic readable
packaging passed 2/2. Current evidence lives in
`build/pce-media-auto-20261119/`; source / actual extracted ZIP checks use the
updated media checker and permanently muted output. Human listening is separate.

Final media browser checks passed 40 groups / four runs across source and the
independently extracted ZIP in Chromium / WebKit. All 128 non-HTML served
assets match; no page errors, missing files or unexpected external requests.
390px layouts were reviewed. The checker SHA-256 is
`0693c0d0f04a5266a2adce40a95a38a2fa49b6f2bf24151e6d3ac38e94c39736`.
Receipts: `browser-source.json`, `browser-packaged.json` and
`cassette-browser-source.json` in the evidence directory above.

Readable local validation archive:
`release/tetorica_huc6280_synth_media-auto-20261119_itch.zip` (201 files, six
browser entries; SHA-256
`90abfa3f506a73a75a9e8ee18d6da36f1bd03014ff3d5329da621f853ca43963`).
