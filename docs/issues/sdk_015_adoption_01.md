# SDK 0.1.5 local candidate adoption

The application imports a complete **408-file SDK 0.1.5 source candidate** and
builds **29 WASM artifacts / 57 outputs**. POKEY adds its BSD adaptation,
explicitly licensed upstream original, independent Native handles and WASM ABI.
The existing 55 generated output files remain byte-identical.

The source archive is local and unpublished. Its SHA-256 is
`aebde59e8c8c95ea55d69d42b17e6b9ef2231835a4935411292948e740d98a07`.
`third_party/soundchip-sdk.json` records the archive and manifest hashes, plus
`localCandidate`: base commit `f45cd2749ce20aeb77f39fcf90facf2772c5fa85`
and the five release metadata/documentation paths changed from it. Thus
`sourceCommit` does not claim that the local 0.1.5 candidate already exists as a
Git commit or published tag. Hash, file-set, regular-file and offline checks
remain mandatory. The published SDK 0.1.4 was not modified.

Emscripten 6.0.6 rebuilt all 29 artifacts. The complete receipt verifies 175
unique source/build inputs. A separate build through the application's fixed
SDK POKEY recipe produced the same JS/WASM bytes. Its WASM SHA-256 is
`99871b375b6022435684c902bfffeda386e026332c3e12f7bc8dfcaddc9a6f22`.

Validation passed 70 SDK Python tests, 22 application import/provenance tests
and 76 inventory/batch CLI tests. The extracted source archive audit and ten
standalone JavaScript-reference checks passed. The new POKEY comparison passed
114 cases and 933,888 compared stereo frames, with exact PCM/read-map agreement,
partition invariance and reset replay. Each build separately passed the SDK
ABI smoke over 1,524,102 frames, including independently specified DAC gain,
four physical voices and dual-handle lifecycle isolation.

POKEY source-level output remains raw positive mono duplicated left/right at
the legacy `/32768` scale. No speaker filter, routing or new Mixer calibration
is introduced by this SDK import. Native/WASM agreement does not establish
Atari hardware equivalence, real-time deadline performance or listening quality.

The maintainer can commit the SDK release changes, push `main`, then push
`v0.1.5`. Its configured GitHub Actions validate five Native platforms and
YM2612/WonderSwan/POKEY WASM before publishing the tagged source ZIP and
`SHA256SUMS`. No tag, remote workflow or release was created by this local task.
After publication, explicitly refresh consumer provenance from that published
archive, retaining the hash-pinned offline workflow.

Machine-readable evidence: [sdk_015_adoption_01.json](sdk_015_adoption_01.json).
