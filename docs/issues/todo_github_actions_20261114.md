# GitHub Actions failures: 2026-11-14

Request: inspect and fix failing GitHub Actions after the HuC6280 CD-ROM² work.
Starting HEAD: `05259630b8c03a14e6f0eb383e6f1f978668c417`.
Logs and local validation receipts: `build/huc6280-ci-fix-20261114/`.

- [x] List recent runs and collect failure logs; separate shared failures from individual checks.
- [x] Fix the HuC6280 WebKit VGM selection/preset check and retain its functional assertions.
      Run: 43562812804.
- [x] Fix the DMG per-channel output/state comparison after inspecting the actual differing fields.
      Run: 43562812829.
- [x] Update the Python HuC6280 build-layout contract to cover its required native include directory and four state exports.
      Run: 43562812933.
- [x] Fix the runtime-staging comparison for intentional import cache revisions without accepting arbitrary edits.
      Runs: 43562812738, 43562812748.
- [x] Fix the SPU initial heading assertion to distinguish hidden PSF views from visible content.
      Run: 43562812813.
- [x] Resolve the FM controls calibration receipt mismatch using the repository's calibration rules;
      retain measured reports and the stale-source guard.
      Runs: 43562812744, 43562812762; also affects downstream Synth packaging.
- [x] Keep independent SID core/player/RSID builds outside the SDK-wrapper fixture's stubbed build dispatcher.
      Found by the related `test:runtime-artifacts` local check.
- [x] Align the SID Synth workflow's live-presets and song-manual checker CLI argument format.
      Run: 43569076020.
- [x] Complete the Analyzer ZIP's common-factory dependency closure (RF5C164 notes, VAB and SID sources/artifacts).
      Revealed by the real packaging command after resolving the calibration failure.
- [x] Run the installed npm tarball check, including its muted browser checks, past the repaired preflight.
      Keep the DX7 and Playground HuC checker destination routes muted, including the main output.
- [x] Run relevant local checks, review the current HEAD runs for additional failures, and record results.

## Completed checks

- HuC6280: delayed host acknowledgement regression8 tests; the actual ZIP's Chromium/WebKit30 checks each.
- DMG: all264 tests, comparing the complete Live snapshot at the run's actual consumed frame;
  all16 output mask PCM comparisons and independently summed channels remain checked.
- SPU: actual ZIP in Chromium/WebKit; initial instrument headings and hidden PSF controls,
  loops/Morph/Pitch, all24 voices, PMON/Noise,20MiB WAV and VAB/PSF paths pass.
- SDK/npm preflight:136 tests. Runtime artifact/build-wrapper checks:30 tests.
- Calibration:125 tests. Receipt02 reconstructs the authenticated receipt01 body, then the original
  measured source. Receipt01, all four measurement reports and the product controls remain unchanged.
- Python offline SDK build-route tests: all146 pass, including the HuC state exports and native include path.
- SID live-presets/song-manual: Chromium/WebKit30 checks; workflow source/ZIP argument parsing4 cases pass.
- Real Playground and FM2612 Synth packaging commands succeed with version `actions-fix-20261114`.
- Analyzer packaging succeeds with version `actions-fix-vgm-20261114`; its strict validator checks857
  local references, including corresponding source kits. Both packaged SID models generate finite,
  nonzero PCM offline. Added runtime JS matches the original source; WASM/receipts/licenses match.
- Installed npm tarball validation (`node scripts/check_fm2612_package.mjs --browser`) exits0:
  Node exports/types/actual WASM and SID6581/8580, DX7 and HuC Main/Worker pass on both browsers.
  DX7/HuC checkers now mute the full destination route while preserving their real PCM monitors.

[Verification record](verification_github_actions_20261114.json) contains receipt/log/archive hashes.
Diagnostic failures before the final fixes are retained separately; the final receipts are explicitly named.

All browser checks are physically muted. Native/WASM DSP and volume defaults are not edited.
The current remote runs contain the original failing code; the fixes need a new commit/push before
GitHub Actions can validate them remotely.

No physical audio output. No release/tag/npm publication is part of this fix.
Do not report remote CI success before a run containing the fixes has actually passed.
