# tetorica-fm2612 0.2.44 — managed SCSP DSP Delay

The user approved npm publication and adding examples in the separate
`w/tetorica-fm2612-examples` repository. Source starts at committed managed
Delay revision af738181. The public registry initially had latest 0.2.43;
0.2.44 was unused and the authenticated account was kyorohiro.

## Candidate and checks

Exact checked archive:
`build/npm-scsp-dsp-delay-release-20261118/candidate/tetorica-fm2612-0.2.44.tgz`.
1,299 files, 2,899,956 compressed bytes, 11,730,559 unpacked bytes.

- SHA256: `224e477c4ecd5b01b16296c296cea150992a9a93d6802060e08d3f239ecb8ffe`.
- SHA1: `bc991f0e0634d34e45d331edd92b1068a0150669`.
- SHA512 integrity: `sha512-wOua7x33rGkNmY2PcPO5oN6xNd6r6O0dc/q+HdyjcW2nwIEx9N41OsujNTE/6AXodZw4RgicPnP3b77iGNR15A==`.

The publication candidate was copied from the archive used by the complete
isolated installed-package check, without repacking. Build: 376 modules,
28 chip / engine pairs, 432 checked declarations. All existing package consumers,
the new managed Delay, original Gain / IIR, Node examples and strict NodeNext /
Bundler / DOM-only declarations pass. No Node audio device was opened.

Compared with public 0.2.43: seven files added, 21 changed, none removed. All
37 WASM files, native corresponding sources and license / notice files retain
their bytes. Changes include the committed managed Delay runtime, its public
types, readable examples and release documentation. One inferred Looper
declaration becomes `number | null` instead of `any`; Looper JavaScript is
unchanged. Native media declaration property ordering changes without changing
its structure. No runtime implementation was changed during publication work.

Chromium / WebKit pass the exact installed Delay and Gain / IIR examples at
44.1 / 48 kHz. Physical output is permanently muted. Cold initialization,
release tail, coefficient history, Time clear, Stop, held PCM ownership and
390px layout pass; missing files, external requests and page errors are zero.
The pure codec and its installed example also pass both browsers without
initializing AudioContext or WASM.

## Examples repository

The examples checkout initially pinned 0.2.41 and had only SCSP PCM / LFO /
modulation examples. Preparation adds assembly / Gain / IIR and managed Delay
under the existing Saturn / SCSP hierarchy. The new Node WAV checks pass with
the exact candidate, including PCM preservation, release echoes, feedback decay
and Stop silence. Both lessons pass Chromium / WebKit at 44.1 / 48 kHz in Main /
Worker (16 cases), with permanently muted physical output. The existing SCSP
examples pass 12 browser cases and their raw PCM / Node WAV checks; all 54
offline Node examples pass. The final readable-editor / replay-state source is
the browser-verified source retained in the generated docs.

The examples repo now pins exact 0.2.44, using the official registry URL and
matching SHA512 in its lockfile. Clean `npm ci --ignore-scripts` passes.
Both site builds pass; dist / docs contain 1,622 identical files, every example
source is copied unchanged, and all 83 catalog targets exist. The installed,
dist-vendor and docs-vendor payloads each contain all 1,299 official package
files with zero missing, extra or changed files. A parent-side independent
tarball audit confirms these bytes and dependency metadata.

New lessons are `examples/saturn/scsp/04-dsp-programs` and
`examples/saturn/scsp/05-dsp-delay`. The official clean install passes their
Node numeric checks again. Browser evidence applies to the same final site
bytes. Its `notes/scsp-dsp-verification-20261118.md` and machine distribution
record retain the details. The examples repo's private version remains 0.1.0.

## Published and independently verified

The user completed npm authorization. Publishing the exact candidate exited 0
with `+ tetorica-fm2612@0.2.44`. Initial metadata listed latest 0.2.43 during
processing; one publication was submitted. The public registry now has 0.2.44
and `latest` points to it.

[Public package](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.44).
Publication time: `2026-11-17T18:04:39.326Z` (2026-11-18 JST).
Official archive verification: `2026-11-17T18:04:55.486Z`.
The downloaded registry archive is byte-for-byte identical to the validated
candidate, with matching SHA1 / SHA256 / registry SHA512 integrity.

The official archive was independently installed in a second offline consumer.
Exact source / declaration / example bytes, pure assembly, real Gain / IIR /
Delay PCM, lifecycle, invalid atomic requests and the shipped Node examples
pass again. Strict installed NodeNext / Bundler / DOM-only types pass again.
Browser validation applies to the same identical published bytes.
Examples-repository dependency / lockfile / vendor regeneration and independent
final consistency checks are complete.

```sh
npm install tetorica-fm2612@0.2.44
node node_modules/tetorica-fm2612/examples/scsp-dsp/delay.mjs
```

Evidence is retained under `build/npm-scsp-dsp-delay-release-20261118/`.
[Task checklist](todo_npm_scsp_dsp_delay_release_20261118.md).
Credentials, OTPs and authentication URLs are excluded from release records.
No commit / push / tag, itch upload or Tauri update is part of this task.
