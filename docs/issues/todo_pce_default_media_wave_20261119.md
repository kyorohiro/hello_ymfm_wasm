# PC Engine default media waveform — 2026-11-19

- [x] Silently prepare the displayed default Sine for MSM5205 and CD-DA at
  startup, so Keyboard / Play works without a prior edit or shape click.
- [x] Keep startup defaults in memory; do not add files, open audio or autoplay.
  Preserve restored Files and newer user edits, imports, Code / transport work.
- [x] Cancel stale initialization on reset/replacement/disposal; retain the
  existing always-auto controls, source fades and media Mixer values.
- [x] Verify focused initialization races and real browser startup / direct
  keyboard playback with physical output muted.

Prior uncommitted work and historical evidence are retained. No native/WASM,
publication, staging or commit changes.

Initialization is invoked once after `codeHost.files.ready`, allowing IDB
restoration's widget reset to finish first. Existing assets, pending imports
and running/busy Code skip the default seed. The widget also skips initial
loading after edits and fences late completions after reset/disposal. Default
Sine is 440 Hz / 50% / 1 s, with existing Smooth edges. It is an implicit
in-memory default; the first real edit still saves a WAV at gesture end.

New/import retain their current source clearing/reset behavior; no background
reseed is scheduled after user-driven workspace replacement. The startup
keyboard readiness assertion in the existing Cassette checker was updated.

Validation: 644/644 PCE tests and 2/2 readable deterministic package tests pass.
Focused source and independently extracted ZIP checks pass 16 groups / four
runs in Chromium / WebKit, with physical output permanently muted. They cover
silent startup/no generated files, unedited 440 Hz computer/screen keyboard
playback for both media, reload, and newer Code material winning over a delayed
default initializer. All 128 non-HTML served assets match source / ZIP.
Evidence: `build/pce-default-wave-20261119/{browser-source,browser-packaged}.json`.
Checker SHA-256:
`4dc4e13492414a0ef7651d818974ee56f1e39e52ea10a5dd0738cb5e9035426e`.

Readable local validation archive:
`release/tetorica_huc6280_synth_media-default-20261119_itch.zip` (201 files;
SHA-256 `28e5c80090b3aa44e18884f1aa6c179fb69b012313fbe407cf0e63fb8d37473c`).
No human listening, staging, commit or publication was performed.
