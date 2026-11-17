# tetorica-fm2612 0.2.43 — SCSP DSP execution

The user approved npm validation and publication of the SCSP DSP execution
milestone. Work uses the normal main checkout at
`941c0e7879e38afaa69f1651db635bfd146e9890`. Publication preparation changes
metadata, public declarations, examples, documentation and validation only.
Runtime execution changes were already committed at that source revision.

## Candidate

`build/npm-scsp-dsp-execution-20261118/candidate/tetorica-fm2612-0.2.43.tgz`
contains 1,292 files, 2,893,863 compressed bytes and 11,702,037 unpacked bytes.
SHA-256: `2ec7e7a481ee089873e9410ce154e8537fd7af22b88408a4940badb71b8df441`.
The publication candidate is copied from the exact archive used by the full
isolated installed-package check, without repacking.

Compared with public 0.2.42: 11 files added, 22 changed, none removed. All 37
WASM files and native source / license files retain their bytes. New modules
provide the guarded RAM-free program owner and live coefficients. Existing
Main / Worker dispatch and the public SCSP facade carry those execution methods.
No native rebuild or calibration change was performed.

## Validation

- Build: 375 runtime modules, 28 chip / engine pairs, 429 checked declarations.
- Exact archive installed into a separate offline consumer: complete package
  checks and all 28 WASM engine loads pass.
- Gain and IIR stereo PCM match independent fixed-point references exactly.
  Live coefficient edits, held program reapplication and failed requests retain
  the expected history, held PCM and RAM. Ownership, routing, Stop and reset pass.
- The packaged Node module renders offline; direct and symlink CLI execution
  work, while importing the example alone starts no engine or audio device.
- Strict NodeNext / Bundler / DOM-only declarations pass, including Node and
  browser MessagePort transports and positive / negative DSP signatures.
- The pure assembler and its installed browser example pass Chromium / WebKit
  without creating AudioContext, fetching a sound engine or initializing WASM.

- Installed execution examples pass Chromium / WebKit at 44.1 / 48 kHz (four
  cases). Full / half / zero Gain and live IIR feedback change the actual signal;
  held sample ownership and RAM remain intact. Stop is silent, 390px layout has
  no overflow, and there are no missing assets, page errors or external requests.
  All physical output routes remain permanently muted.

## Publication and independent verification

Publishing the exact candidate exited 0 with `+ tetorica-fm2612@0.2.43`.
The initial version lookup returned 404 during registry processing; after the
version metadata appeared, the archive briefly returned 404 as well. One
publication was submitted. Both now resolve, and `latest` points to 0.2.43.

[Public package](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.43).
Registry publication time: `2026-11-17T17:11:52.151Z` (2026-11-18 JST).
Official archive verification completed at `2026-11-17T17:13:03.148Z`.
It is byte-for-byte identical to the tested candidate, with matching SHA1,
SHA256 and registry SHA512 integrity:

- SHA1: `b2506dc6398ff79c1f3f44f3f7a6b77249abe66c`.
- SHA512: `sha512-B5EH+VVyQNXqXXQfAQDhzW45wpLY3x2aYKeJN/idU7gYNbx2w07s1y9g5Bn9sk4lzE1beQkYduRBwze4DLMI8A==`.

The official archive was independently installed into a second offline consumer.
Exact source / declaration / example bytes, pure assembler checks, real DSP
Gain / IIR output, live history, ownership, routing, rejected requests,
Stop / reset and the shipped Node CLI pass again. Strict installed types pass
again in NodeNext, Bundler and DOM-only configurations, including Node ports.
Browser evidence applies to these identical published bytes. The
[machine release record](npm_scsp_dsp_execution_release_20261118.json) retains
candidate hashes, registry metadata, comparison and validation summaries.

```sh
npm install tetorica-fm2612@0.2.43
node node_modules/tetorica-fm2612/examples/scsp-dsp/execution.mjs
```

Evidence is retained under `build/npm-scsp-dsp-execution-20261118/` and the
linked [task checklist](todo_npm_scsp_dsp_execution_20261118.md).
Authentication URLs, OTPs and credentials are excluded from release records.
No git commit / push / tag, Tauri / itch release or other repository update is
part of this publication task. Browser checks permanently mute physical output;
rendered signal measurements do not constitute listening verification.
