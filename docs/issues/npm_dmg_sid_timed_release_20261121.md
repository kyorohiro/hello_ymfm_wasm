# tetorica-fm2612 0.2.46 publication

User authorized publishing DMG and SID timed APIs together after committed
revision `33f71b32`. The checkout was clean. npm's official registry reports
`latest: 0.2.45`; use 0.2.46 for this release. Changes are limited to publication
and the DMG Main/Worker timed-lifecycle connections required by installed-package
verification. No commit/push/tag, Tauri import or remote CI are requested.

- [x] Confirm committed source and official registry's latest version.
- [x] Update package metadata and public usage/release notes.
- [x] Repair DMG Main/Worker public-client timed connections found by the
      installed-package checks; verify failed Apply preserves accepted patterns.
- [x] Build/pack and verify the exact installed candidate, modules, WASMs,
      licenses/source kits, declarations and shipped usage examples.
- [x] Verify exact installed DMG/SID Main/Worker scheduling in physically
      muted browser endpoints at 44.1/48 kHz; retain previous Synth evidence.
- [x] Compare the candidate with official 0.2.45 and record payload/integrity.
- [x] Complete official npm login/publication authorization if required.
- [x] Publish the verified archive once; do not retry an accepted publish.
- [x] Retrieve the official archive independently, compare its bytes/integrity,
      verify latest and run isolated installed-package checks.
- [x] Record publication and update the individual TODO statuses.

Evidence directory: `build/npm-dmg-sid-timed-release-20261121/`.
Never retain credentials or login/authorization URLs in release records.

Scope: existing Game Boy Pulse/Wave/Noise and SID 6581/8580 register-only
recording, compilation, detached resolver snapshots and sample-clock scheduling.
Keep Native restrictions, meaningful event writes, existing immediate methods,
timing/ownership and measured mixer policy. No new chip-core/WASM work.


## Validated candidate

`build/npm-dmg-sid-timed-release-20261121/candidate/tetorica-fm2612-0.2.46.tgz`
contains **1,378 files**, **3,015,011 compressed bytes**, **12,231,444 unpacked
bytes**. SHA256:
`e94ff59c684873db946a9f120ee65b0cb793c6e205008f92747a7a0b88cc5749`.
SHA512 integrity:
`sha512-U1iYqjiV3gTSMF/oHZVhA9iJ7E85S+xvfMFHjKSaIIZ1ItL4GxbdSUP7CuJZCEqRubofQ8rQUBt5jb98ykVp7g==`.

All archive files match the built and independently installed files exactly.
The package contains readable DMG/SID recorder/client/state/processor JS and
checked declarations, three new browser/Node example files and the SID source
kit helpers. The installed offline compiler example succeeds with network,
AudioContext and WASM creation blocked.

Build: **404 runtime modules, 28 chip/engine pairs and 467 checked declarations**.
The full isolated package check passes, including existing chip/WASM/source,
license, API and numeric examples. Strict installed NodeNext/Bundler and
browser-without-Node consumers pass, including both timed API type examples.

The exact installed candidate passes **24/24 browser conditions**:
DMG / SID 6581 / SID 8580 × Main / actual logic Worker × 44100 / 48000 Hz ×
Chromium / WebKit. All six shipped browser example runs also pass. Every
physical destination was muted before AudioContext startup. Staged receipts,
failed Apply preservation, snapshots, compact repeats, cancellation and Stop
were verified against actual WASMs; no external requests or unexpected
runtime/console errors. All 233 served file hashes match the exact installed
candidate. See `browser.json` in the evidence directory.

The release check found missing DMG Main/Worker timed-lifecycle wiring. Four
narrow connection changes now expose the existing client and stage reservations
through the existing owner/lifecycle manager. Real Main/Worker route regressions
pass **6/6**. Related tests pass 219 cases; four PSG fixture failures reproduce
against the pre-task runtime body and are recorded separately in
`/tmp/gameboy-release-psg-baseline.log`. No PSG execution fix was made here.

Existing renderer/gain proofs and measurement records were preserved. Exact
non-renderer metadata and DMG connection predecessor contexts keep the existing
source freshness guards strict; **51/51** focused guard tests and current
mixer generation `--check` pass.

Compared with official 0.2.45: **50 added / 56 changed / 0 removed**. This also
publishes the already committed Sega PSG/YM2413 timed API work. Only the YM2413
WASM changes, with matching source/checkpoint receipts; DMG/SID WASMs, license
texts and calibrated gains remain identical. Fixed-SDK provenance/manifest
updates and complete paths are retained in `payload-comparison.json`.

Publication and independent official-archive verification are recorded below.


## Accepted publication

Official npm login and separate browser publication authorization completed.
The single publish command exited **0** with `+ tetorica-fm2612@0.2.46` and an
asynchronous registry-processing notice. Initial metadata returned 404 while
processing; no second publication request was submitted. Official archive and
latest-tag verification follow below. No authentication URLs are retained here.


## Published and independently verified

[Official package 0.2.46](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.46)
is public; `latest` is **0.2.46**. Official publication time:
`2026-11-20T17:02:49.835Z`.

The official archive was downloaded using a fresh registry cache and matches
all candidate bytes, SHA256 and registry SHA512 integrity. A second isolated
offline installation from that official archive passes strict NodeNext/Bundler
and DOM-only type consumers and the shipped offline DMG/SID compilation example.
The candidate's 24 browser conditions and six example runs therefore apply to
these published bytes. Evidence: `registry-verification.json`, `registry/metadata.json`,
`registry/types.log` and `registry/compile-node.log` in the evidence directory.

```sh
npm install tetorica-fm2612@0.2.46
```

No commit, push, tag, itch upload, Tauri import or separate examples-repository
update was performed by the publication task. User staging was observed during
work; final working files should be included when committing.
