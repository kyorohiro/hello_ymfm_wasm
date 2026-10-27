# WonderSwan npm release

Date: 2026-10-27.

Published and verified:

| Package | Version | Included changes |
| --- | --- | --- |
| [tetorica-vgm](https://www.npmjs.com/package/tetorica-vgm/v/0.2.15) | 0.2.15 | WonderSwan playback, note exports, written Wave RAM and timed Voice PCM extraction through API / CLI; JSON / ZIP / WAV exports and updated usage metadata. |
| [tetorica-fm2612](https://www.npmjs.com/package/tetorica-fm2612/v/0.2.29) | 0.2.29 | WonderSwan WASM / Synth, shared Playground AudioWorklet and timed register / RAM / Voice PCM playback; fixed SDK 0.1.4 source packaging and notices. |

Both `latest` tags point to these versions. The published tarballs were
downloaded from the registry and match the validated archives byte for byte;
registry SHA1 / SHA512 integrity values also match.

## Validation

- VGM: isolated offline install, API / CLI JSON / ZIP / WAV agreement, full
  middle-window Voice PCM WAV equality with original rendering, reported song
  extraction (ten Voice captures, six unused RAM candidates), 16 CLI regression
  tests and 467 local dependency references.
- FM: exact-archive offline install, all 841 archive members compared with the
  checked stage and installed package, 981 local references, 15 renderers,
  27 real WASM engines, consumer types under NodeNext / Bundler / Browser,
  and WonderSwan direct WASM plus real AudioWorklet playback in Chromium and
  WebKit. Browser physical output was muted.

The FM general checker independently repacked the same stage; the compressed
size differed, so all file contents were compared rather than assuming archive
equality. The exact retained archive was additionally installed and checked.

Calibrated Mixer values are unchanged. Music payloads are not distributed.
README local-install examples and release notes match the new versions.

Receipts, hashes and commands/results are in
[npm_wonderswan_release_01.json](npm_wonderswan_release_01.json).
No commit, tag, push, CI dispatch or itch.io release was performed.
