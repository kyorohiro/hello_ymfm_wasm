# tetorica-fm2612 0.2.42 — release checklist

The user requested npm publication after the isolated SCSP DSP assembler
preparation milestone. Registry latest was 0.2.41, and 0.2.42 was unused. Publish
the exact validated 0.2.42 archive, then verify registry integrity and downloaded
bytes / imports independently.

- [x] Check registry latest, unused next patch and current npm account.
- [x] Update package version and API / example documentation to 0.2.42.
- [x] Build readable modules / exact public declarations and pack the candidate.
- [x] Install that exact payload in an isolated Node consumer; check the full
  package, all 28 WASM engines, Node example and strict public declarations.
- [x] Compare the candidate with public 0.2.41 and review the release diff.
- [x] Verify the exact archive in Chromium / WebKit without runtime side effects.
- [x] Complete additional npm publication authentication if required.
- [x] Publish the validated archive with the latest tag.
- [x] Verify registry metadata, SHA1 / SHA512 and downloaded archive bytes.
- [x] Install the published version independently and record final results.

Authentication URLs, credentials and OTPs are not stored in release records.
Work stays in branch `work/scsp-dsp-npm-20261117`, worktree
`w/_codex-scsp-dsp-npm-20261117`, while the main checkout remains clean at
`c0b9a24e`. No merge, commit, push, git tag, Tauri / itch release or examples-repo
update is part of this publication task. No audio output device is used.

## Candidate

`build/npm-scsp-dsp-release-20261117/candidate/tetorica-fm2612-0.2.42.tgz`:
1,281 files, 2,870,201 compressed bytes, 11,653,581 unpacked bytes.

- SHA256: `c50decd33deee6e72507c22b760a9910d6fa6f20628c794ba8e47782dd04cba6`.
- SHA1: `70891c2ff9f4de838db5c6076e0d50cb265d0208`.
- SHA512 integrity: `sha512-PFN9vsuVQBKBi+4iNNQDRRuyGIi3W+USwWanAZGiF6/AkqjEg7Kuwx1EX3wI++ffxZL7YClDeGHJCTIlAm9kxg==`.

The tarball used by the complete installed package checks is byte-identical to
this publication candidate. Build output includes 372 runtime modules, 28
chip / engine pairs and 424 checked declarations. Strict NodeNext / Bundler /
browser DOM-only types and 17 codec / CLI tests pass. The preparation milestone
also retains 288 unchanged Synth test results.

## Changes since 0.2.41

Six added files: pure `scsp_dsp_assembler.js` / `.d.ts` and the Node / browser
example's README, HTML, module and declaration. Five existing files change:
package metadata, README, runtime guide / manifest and source-kit guide.
1,270 existing files remain byte-identical, with **no changes to existing
JavaScript, WASM or declarations** and no removed files. No native rebuild or
calibration change. The pure helper / types use the original Synth codec bytes.

Comparison and candidate-check evidence are retained under
`build/npm-scsp-dsp-release-20261117/`. The original development verification
record remains historical; it describes the previous unpublished 0.2.41 candidate.

The exact candidate also passes Chromium / WebKit, six cases each (12 total).
Both direct imports and the packaged example attempt zero AudioContext, fetch,
WASM or XHR initializations, with no missing assets or uncaught errors.

## Publication accepted; registry processing

The user completed the official npm publication authorization. Publishing the
exact candidate exited 0 with `+ tetorica-fm2612@0.2.42`. The first metadata
check still returned latest 0.2.41 / no 0.2.42. Wait for registry processing;
do not submit a second publication after acceptance.

## Published and verified

`tetorica-fm2612@0.2.42` is available on the public npm registry, and `latest`
points to 0.2.42. [Package page](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.42).
The registry publication time is 2026-11-17T14:57:42.775Z. The downloaded
registry archive is byte-for-byte identical to the tested candidate, with matching
SHA1 / SHA256 / registry SHA512 integrity. No second publish was submitted
while registry processing completed.

The downloaded archive was independently installed; both import subpaths, exact
source / declaration / example bytes, owned word arrays, field validation and
the packaged Node example pass. Strict NodeNext / Bundler / browser DOM-only
declarations also pass on that published installation. Candidate browser
evidence applies to the same exact bytes.

Registry archive, verification and isolated consumer remain under
`build/npm-scsp-dsp-release-20261117/`. [Machine release record](npm_scsp_dsp_release_20261117.json).
Source changes are still uncommitted in the dedicated worktree; main remains
clean at c0b9a24e. Main integration / git commit / push, other repositories,
Tauri and itch releases were not performed. Earlier preparation records retain
their original unpublished 0.2.41 candidate data.

## Main integration follow-up — 2026-11-18

The user requested committing and reflecting the published 0.2.42 source into
main / GitHub. Earlier statements that main was unchanged or changes were
uncommitted describe the preparation / publication phases only. Current
integration status is tracked in
[todo_scsp_dsp_main_integration_20261118.md](todo_scsp_dsp_main_integration_20261118.md).

Main integration completed on 2026-11-18: source commit
`7c3a8f093ba5237864569a47bd73f67a01bc5cb2` was fast-forwarded into main and
pushed to GitHub. Local / origin / GitHub API commit equality and 17 focused
tests passed. The previous uncommitted-worktree / unchanged-main descriptions
are historical. See the linked integration TODO for the completion evidence.
