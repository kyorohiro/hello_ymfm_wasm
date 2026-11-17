# tetorica-fm2612 0.2.41 — release checklist

The user requested npm publication after the YM2612 timed API implementation.
The source tree was clean at `0ea54fd3`; registry latest was 0.2.40 and 0.2.41
was unused. Publish the validated 0.2.41 tarball, then independently download
that exact version and verify all bytes and registry integrity.

- [x] Check source status, latest registry version and unused next patch version.
- [x] Update package version, local-install examples and release notes.
- [x] Build readable modules, declarations, WASM and corresponding source kits;
  independently install the actual candidate and run package / type checks.
- [x] Compare the candidate against the published 0.2.40 payload and record the
  relevant changes, including earlier unreleased AY/YM2149 timed operations.
- [x] Complete official npm login / publication authentication as required.
- [x] Publish the exact validated tarball with the latest tag.
- [x] Verify registry version / latest, SHA1 / SHA512 and exact downloaded bytes.
- [x] Record results and mark the timed API TODO as published.

Authentication URLs, tokens and OTPs are not stored in release records. Existing
timed API evidence covers 4033 runtime tests, 699 Synth tests and 28 muted browser
cases; repeat only the versioned-payload checks needed for publication. No git
commit, push, tag, Tauri / itch publication or examples-repository update is part
of this task. No physical audio output is used.

Changes since published 0.2.40 include AY/YM2149 and YM2612 operation recording,
compilation / reusable control snapshots / Worklet scheduling; current shared
runtime fixes also include AY Single Output / flags, SCSP loop-link, WonderSwan
dense VGM timeline handling, HuC6280 state/seek, S-DSP direct voice editing and
YM2608 independent FM/SSG gains. The YM2612 default path is separately proven
byte-identical to its pre-timed implementation. This is not a claim that all
chip WASMs or all chip output are unchanged from the older npm release.

## Validated candidate

`build/npm-ym2612-timed-release-20261117/tetorica-fm2612-0.2.41.tgz`
contains 1275 files (2,871,871 compressed bytes). SHA256:
`8389403b0ecc1833718ba4acf22e19720e4ed7c52402acc345e92a00c11a1fb4`.
The exact tarball was independently installed and checked: all 28 WASM engines,
15 renderers, musical helpers, YM2612 local/reset compilation and packed fields,
repeated keys, Native restrictions, source kits, exports and strict declarations
under NodeNext / Bundler / browser without Node ambient types.

Local build has 371 runtime modules and 422 generated declarations. Full
installed-check log: `/private/tmp/npm-ym-timed-installed-041.log`. Candidate
hashes and payload comparison are retained under
`build/npm-ym2612-timed-release-20261117/`. Login completed through the official
npm flow; publication may require separate authorization.

## Publication accepted; registry processing

Official npm login and separate publication authorization completed. The final
publish command exited 0 with `+ tetorica-fm2612@0.2.41` and reported that the
package was being processed. The first registry query still returned 404;
wait for visibility without submitting another publication.

The published 0.2.40 tarball comparison has 22 added files, no removed files,
125 changed files and 1128 unchanged files. Changed WASMs include AY8910,
HuC6280, SPC, YM2608 and both SID8580 endpoint / machine binaries. The SID8580
update adds live manual register writes and source-write revision tracking;
the upstream sidera model is unchanged. The complete comparison and candidate
hashes are retained with the release artifacts. Publication status is tracked
in [npm_ym2612_timed_release_20261117.json](npm_ym2612_timed_release_20261117.json).

## Published and verified

`tetorica-fm2612@0.2.41` is available on the public registry and `latest` points
to 0.2.41. [Package page](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.41).
The downloaded registry tarball is byte-for-byte identical to the validated
candidate, with matching SHA256, registry SHA1 and SHA512 integrity. No second
publication was submitted after acceptance; registry processing was allowed
to finish.

Registry tarball and verification:
`build/npm-ym2612-timed-release-20261117/registry/tetorica-fm2612-0.2.41.tgz`
and `build/npm-ym2612-timed-release-20261117/registry-verification.json`.
The machine-readable release record preserves the payload comparison and
candidate checks. Git commit / push / tag, other repositories, Tauri and itch
publication were not performed. Historical implementation verification reports
retain their original pre-publication package version and status.
