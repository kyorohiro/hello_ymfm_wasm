# POKEY VGM package candidate validation

2026-10-27. Local verification only; no npm publication.

`tetorica-vgm` was built and packed with the development POKEY changes. Its manifest remains `0.2.15`, so this tarball is an unpublished candidate and is different from the already published `tetorica-vgm@0.2.15`.

Artifact: `/private/tmp/pokey-analyzer-npm/tetorica-vgm-0.2.15.tgz`, 901,483 bytes. SHA-256: `f04a33327c4df3d1c119f211c328666abcd5887f8d6c2c895b7108c3769f9141`.

The standalone checker installs that existing tarball into a fresh consumer using `npm install --offline --ignore-scripts`. Runtime imports resolve to the installed package. Original synthetic fixtures supply input; no game music, ROM, external service or audio device is used.

Verified:

- Every one of the 277 tarball files exactly matches both `dist/vgm` and the installed package. Relative imports across 168 JavaScript modules resolve.
- All four single-chip channels and all eight dual-chip channels render audible WAVs and become exact silence with their own mute ID. Header clocks, dual selection and available controls are preserved.
- Public API and CLI analysis, support, gzip decoding, lossless commented VGM/JSON round trips and interval WAV rendering agree.
- Noise/tone and second-chip volume-only DAC stream intervals match the corresponding continuous WAV samples exactly, including starts inside output blocks.
- Mixer IDs `pokey` / `pokey:2` remain independent at explicit unity. Cold Stop/replay matches exactly. Disposing the first core leaves the second core's continuation PCM unchanged.
- POKEY WASM, original BSD notices, exact licensed upstream core, C++ adaptation, C ABI and build recipe are included. All nine SDK source inputs match their recorded hashes; only documented standalone recipe paths are relocated.
- Unsupported variant flags and unavailable score/FM voice exports remain explicit.

```sh
node scripts/build_cli.mjs
npm pack ./dist/vgm --pack-destination /private/tmp/pokey-analyzer-npm --json
node scripts/check_pokey_vgm_package.mjs /private/tmp/pokey-analyzer-npm/tetorica-vgm-0.2.15.tgz --out=docs/issues/atari_pokey_vgm_package_01.json --stage=dist/vgm
```

The checker itself does not rebuild or publish. Full file hashes and behavioral evidence are recorded in [atari_pokey_vgm_package_01.json](atari_pokey_vgm_package_01.json). Physical hardware and listening comparisons are outside this check.
