# tetorica-fm2612 0.2.45 publication

User authorized npm publication after the committed ASWAN shared timed API
revision 6fcee57b. Registry latest was 0.2.44; 0.2.45 was the candidate and is now published.
Do not change execution code, push/tag or import Tauri releases in this task.

- [x] Confirm clean source checkout and published version.
- [x] Update package version and describe intervening public runtime features.
- [x] Build, pack and verify installed declarations/modules/WASM.
- [x] Verify the exact installed candidate in muted browser Main/Worker endpoints.
- [x] Compare candidate with 0.2.44 and record integrity and payload changes.
- [x] Publish once, completing official npm authorization if requested.
- [x] Independently retrieve and verify the official archive and latest tag.
- [x] Record verification and update release status.

Evidence directory: `build/npm-wonderswan-timed-release-20261120/`.
Credentials and authentication URLs must not be retained in release records.

## Candidate verification

Archive: `build/npm-wonderswan-timed-release-20261120/candidate/tetorica-fm2612-0.2.45.tgz`.
1328 files, 2,944,618 compressed bytes,
11,906,078 unpacked bytes. SHA256: `3aacaf64226d3d9180964891321744331b12a9d7a5d5401917a95587c93b402c`.
SHA512 integrity: `sha512-VxgH+EFTgP9pTX3NFF/kdeKzBySdr10r8cs97y7i9c4eLxIuOgpDi3FWTQ3b6zYPqg5QPySWm8KWJA9yZa1q8w==`.

Build: 388 copied runtime modules, 28 chip/engine pairs and 446 checked JSDoc
declarations. Isolated installed-package module/WASM/source/license checks pass.
The exact candidate independently passes installed NodeNext, Bundler and
DOM-only positive/negative declarations, plus the shipped SCSP routing Node
numeric example. Muted Chromium/WebKit pass WonderSwan Main/Worker at 44.1/48
kHz (eight cases) and the installed SCSP two-path routing example.
Physical destinations are permanently muted before routing/startup.

Compared with public 0.2.44: 29 added, 80
changed, 0 removed. Complete paths are in
`payload-comparison.json`. License files are unchanged. One WASM changes:
`generated/ym2608_wasm.wasm`, from the already committed four-source OPNA Mixer
work, with matching JS and source/SDK receipts. All other WASMs retain their
bytes. This release also includes HuC6280 and PS1 timed APIs, shared scheduler
and type changes, SCSP two-bus routing, and remeasured calibration policy.
The OPNA four-source validation is recorded separately in
[todo_fm2608_four_source_mixer_20261119.md](todo_fm2608_four_source_mixer_20261119.md).
No execution code was changed during publication preparation.

npm login initially returned 401; official browser login and separate web
publication authorization completed. The single publish command exited 0 with
`+ tetorica-fm2612@0.2.45`, reporting asynchronous package processing. Initial
registry metadata still returns 404 while processing; no second publish request
has been submitted. Official archive verification is pending.

The exact candidate matches every one of the 1,328 validated staged files.
Additional real OPNA four-source gain tests pass 11 cases. Credentials and
authentication URLs are intentionally not recorded.

## Published and independently verified

The single npm publish request succeeded. After asynchronous registry processing,
0.2.45 is public and `latest` points to it.

[Official package](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.45).
Publication time: `2026-11-20T03:47:17.561Z`. Independent retrieval: `2026-11-20T03:47:20.296Z`.

The downloaded official archive is byte-for-byte identical to the validated
candidate; registry SHA512 integrity and the retained SHA256 match. Therefore
candidate browser/runtime evidence applies to the published bytes. A second
isolated offline consumer installs the downloaded official archive; strict
NodeNext/Bundler/DOM-only types and the SCSP two-path numeric example are checked
again. Evidence: `registry-verification.json`, `registry/types.log` and
`registry/routing-node.log` under the evidence directory.

```sh
npm install tetorica-fm2612@0.2.45
```

No commit, push, tag, itch upload, Tauri import or separate examples-repository
update was performed during this publication task.
