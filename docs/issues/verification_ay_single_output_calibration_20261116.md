# AY Single Output — shared Mixer remeasurement

Date: 2026-11-16. The AY `flags 0x02` implementation changes the AY WASM and its validation source. Existing calibration evidence must retain its original hashes rather than being relabelled as current. The 153-row historical Playground baseline and all prior measured / verified reports remain unchanged.

## Measurements

- `soundchip_psg_levels_06.json`: 18 fresh offline public-WASM captures. Every PCM statistic and derived gain is exactly equal to PSG05. The measured AY profile remains type 0 / flags 1; this does not claim a separate loudness calibration for Single Output.
- `ps1_ay_single_output_chip_levels_01.json`: 48 PS1 routes and eight FM anchors.
- `wonderswan_ay_single_output_chip_levels_01.json`: 48 WonderSwan routes and eight FM anchors.
- `pokey_ay_single_output_chip_levels_01.json`: 96 POKEY routes, eight FM anchors, eight Sega PSG anchors and eight independent dual-chip checks.
- `scsp_ay_single_output_chip_levels_01.json`: 48 SCSP routes and eight FM anchors.

Each browser matrix uses Chromium / WebKit, 44100 / 48000 Hz, Main / Worker and all named primary / extra / dual roles at 220 / 440 / 880 Hz. All reports passed their complete-coverage and independent pilot-PCM continuity checks. Every physical output was permanently routed through gain zero and asserted muted. Human listening was not performed.

The PS1 rebuild required by the authenticated SDK provenance update retains the original WASM bytes: SHA-256 `cd1223fe41624db415c31395e3eba30cab18c56c46a28d57425dfa71f038f96f`.

## Derived policy

New values are the actual six-decimal canonical ratios. Earlier rounded values were not forced into the new reports. The small differences reflect capture-phase / window variation and stay below 0.01% of the prior gain scale.

| Source / role | Previous | Remeasured |
| --- | ---: | ---: |
| PS1 primary / extra | 0.129331 | 0.129331 |
| WonderSwan primary / extra | 1.172528 | 1.172528 |
| POKEY primary | 0.413033 | 0.413050 |
| POKEY dual first | 0.413034 | 0.413051 |
| POKEY dual second | 0.413034 | 0.413051 |
| POKEY extra | 0.413034 | 0.413052 |
| SCSP primary | 0.128825 | 0.128825 |
| SCSP extra | 0.128826 | 0.128825 |

The shared authored AY listening trim remains 0.85. Existing public PSG measurement defaults and all other source gains remain unchanged. Updated Playground metadata retains the newly measured Sega PSG RMS anchor used by POKEY.

The affected gains were then applied in new complete, muted POKEY and SCSP `--verify` matrices. Both passed, with their exact script / served-source / calibration provenance matching the corresponding new baseline. PS1 / WonderSwan retain their existing applied-gain verification only because the fresh raw measurements derive the same exact gains.

## Strict provenance

Current generators, package validation and itch CI use the new baseline paths. The generated npm policy and its served mirror are tied to the exact new reports through `ay_single_output_mixer_policy_revision_01.json`, independently pinned to object SHA-256 `b9e93e47b6f8980eeb5cf51c8765ccaffcc668d489b4e5b655a7fc37473c5969`.

This transition maps only the two exact generated gain-policy bodies to their exact predecessors for historical dependency checks. It validates five new raw reports, two new affected-gain verification reports and the two unchanged-gain historical verification reports. It grants no renderer / WASM exemption. In particular, the earlier VAB export-only receipt rejects the changed AY WASM; fresh PSG06 and complete current browser reports provide the current provenance instead. Earlier policy receipts and historical measurement files remain immutable.

The pre-change parent commit `2484643630a824dd4168c4731997ff0fe4eec647` was checked in an isolated HEAD archive: all **447 historical guards passed**. Historical source-pair tests now reconstruct archived bodies using the independently pinned VAB receipt and complete before/after digests in a test-only fixture. Production VAB freshness remains stale against the changed AY WASM; the tests do not turn that old receipt into current DSP approval.

Two incidental passive UI import-cache revisions were restored to the exact HEAD bodies in `playground/playground_monaco.js` and `playground/wonderswan_vgm_import.js`. Six already measured browser reports retain their original bytes. Their exact measured aliases and served HEAD bodies are connected only by [the independently pinned cache receipt](ay_single_output_passive_cache_restore_revision_01.json), object SHA-256 `113fdf5c540bcec6a073386d1c349b2fcfaff97de70d87a0619c7125bde9860a`. The helper proves import-cache-value-only edits for the two complete bodies, binds all six report identities and source records, and leaves DSP / future / unrelated edits untouched.

SCSP script validation now checks an exact current raw hash before attempting the older loop-link source reconstruction. PS1 / WonderSwan source failures retain their own calibration context while preserving the original nested reason. No source guard or numerical calibration requirement was relaxed.

## Validation

- 71 targeted calibration, generator, dependency-receipt, tamper-rejection and historical-evidence tests passed.
- The complete historical guard suite passes **459 / 459** after the revision, compared with **447 / 447** at the isolated pre-change HEAD. Existing positive historical source comparisons retain independent before hashes; live obsolete DSP evidence is explicitly rejected.
- `node scripts/generate_soundchip_mixer_presets.mjs --check` passed.
- `node scripts/generate_playground_mixer_defaults.mjs --report docs/issues/playground_chip_levels_01.json --check` passed.
- `node scripts/record_ay_single_output_mixer_policy_revision.mjs --check` passed.
- `node scripts/build_fm2612_package.mjs` passed: 361 runtime modules, 28 chip / engine pairs and 412 generated / checked declarations. The calibration helpers run during repository build validation; the runtime package has no dependency on their local receipt files.
- `git diff --check` passed.

[Machine-readable evidence and hashes](verification_ay_single_output_calibration_20261116.json) records the new report identities, immutable prior evidence, unchanged PS1 WASM and before / after generated-policy hashes.

No commit, push, tag or npm publication was performed.
