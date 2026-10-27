# CD-ROM² npm release

Status: **published; latest tag and exact registry tarball parity verified**.

The release target is `tetorica-fm2612 0.2.32` only. It adds CD-DA and PC Engine MSM5205 ADPCM application-audio APIs, C/WASM cores, browser endpoints, sample preparation, common-clock offline mixing, declarations and complete source/license bundles. These are separate APIs rather than new generic `createSoundChip()` names. `tetorica-vgm`, existing chip gains and the fixed SDK are unchanged.

The candidate is `/private/tmp/npm-cdrom2-release-20261028/tetorica-fm2612-0.2.32.tgz`, containing 929 files. SHA-256: `57a8a6acc607b304b3fdadd2c525a3cee78f2ece85023d3cafd802c1461583c1`. Every archive member matches staging and its isolated install.

Verification passed: 55 audio tests plus real core parity checks; all 28 packaged WASM engines; 367 declarations and three TypeScript consumer configurations; both README Node examples producing 48 kHz stereo WAV; and eight isolated Chromium/WebKit browser cases covering CD-DA/MSM5205 at 44.1/48 kHz. Browser checks used the exact installed candidate with default relative assets and no repository fallback. Output was captured and physically muted. No human listening assessment is claimed.

CD-DA `pause()`, `resume()` and `stop()` now correctly allow omitted timing options in generated types; runtime behavior is unchanged. Source notices and provenance were independently checked, and no external sample/disc ROM was added.

Candidate hashes, tests and source evidence are recorded in [npm_cdrom2_release_01.json](npm_cdrom2_release_01.json). The publish command completed with exit code 0 after browser authentication. After npm processing, `0.2.32` became available and `latest` matched. The registry archive was downloaded again and was byte-identical to the validated candidate; its SHA-1, SHA-512 integrity and all 929 member hashes also matched. [Published package](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.32). No SDK publication, itch.io upload, Examples update, commit, push or tag is part of this task.
