# itch packaging command audit

Started: 2026-11-14.

- [x] Execute all 12 requested shell entry points with unique audit versions,
      preserving existing release ZIPs and staging directories.
- [x] Validate produced ZIPs, entry points and local asset references using
      existing package checks where available.
- [x] Check renamed/compatibility commands and explain duplicate-output cases.
- [x] Investigate and fix actual packaging failures; keep calibration and
      provenance guards effective.
- [x] Record results, scope and any browser/runtime verification limitations.

Requested commands: package_itch_2a03_synth.sh, package_itch_dmg_synth.sh,
package_itch_gameboy_synth.sh, package_itch_huc6280_synth.sh,
package_itch_nes_synth.sh, package_itch_scsp_synth.sh,
package_itch_sid_synth.sh, package_itch_snes_synth.sh,
package_itch_spu_synth.sh, package_itch_synth.sh,
package_itch_vgm_analyzer.sh, package_itch_playground.sh.

No commit, push or publishing is requested. Browser checks, if needed, must
intercept physical audio output at zero gain.

Packaging results:
- All 12 shell entry points exited 0 with distinct audit version arguments.
- Seven Synth package suites passed 14 Node tests. All nine outputs from the
  delegated Synth commands have identical ZIP/stage file bytes and valid CRCs.
- The four FM/Analyzer/Playground artifacts passed the existing strict release
  archive validator, including full/Run source provenance and hosting limits.
  Default filenames were normalized only in an isolated audit directory.
- gameboy is an alias for dmg; nes is an alias for 2a03. Invoking each alias
  with its canonical command's already built audit version correctly returned
  "Archive already exists" and preserved the original ZIP hash.
- 2A03, DMG, HuC6280, SCSP, SID and SNES refuse an existing same-version ZIP.
  SPU, FM, Analyzer and Playground regenerate it. At inventory time, the
  HuC6280 default dev ZIP already existed; use a new version to preserve it.
- Playground's *_for_run.zip is the browser upload; the other ZIP is the full
  downloadable kit. The audited Run ZIP has 1000 files; the full kit has 1312.

Completed: 2026-11-14. No packaging defect or source change was needed.

Browser verification (all physical output muted):
- Eight Synth products started successfully in Chromium/WebKit: 16 runs,
  no page errors, missing local assets or startup AudioContext creation.
  This matrix checks UI startup, not every sound or Code feature.
- FM Synth: two packaged browser runs passed TFI import, actual keyboard PCM,
  quiet release and replay.
- Playground Run: 20 cases passed across both browsers, Main/Worker and
  genesis/mega-cd/gameboy/nes/wonderswan, with actual PCM and Stop/Rerun.
- Analyzer: both browsers passed the existing Mixer/gain/preferences and
  OPNA borrowed-PCM suite, using an additional pre-page physical mute.
- The temporary startup runner initially used the wrong SPU keyboard selector.
  Its failed receipt/runner were preserved; the runner alone was corrected and
  SPU passed both browsers. Product code was unchanged.

All browsers and HTTP servers completed cleanup. No listening, long-duration,
itch-hosted deployment, Tauri, commit/push or publication was performed.

Verification: [verification_itch_packaging_audit_20261114.json](verification_itch_packaging_audit_20261114.json).
Local logs and receipts: build/itch-packaging-audit-20261114/.
