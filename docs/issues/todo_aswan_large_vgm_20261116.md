# ASWAN Synth: dense real-game VGM import

- [x] Reproduce the attached FFIV WonderSwan Color VGZ limit error and measure
      expanded source size, event density, PCM runs and prepared timeline work.
- [x] Correct conversion / preparation so supported real songs can be extracted
      and played without discarding meaningful hardware writes or weakening
      callback-density validation. Keep original bytes and current sound safe.
- [x] Batch long-song seek work without yielding after every 2048 frames;
      preserve cancellation, the 30-second deadline and failed-seek rollback.
- [x] Add original regression fixtures and exact playback/extraction checks;
      verify shared consumers and readable standalone packaging as applicable.
- [x] Verify the supplied local file without bundling game assets, update the
      guide/verification, rebuild and check the dev ZIP.

No publication, commit, tag, new AudioContext or new game assets in the repository.
Physical audio stays muted during automated browser checks.

## Completed behavior and verification

- The supplied 230,975-byte VGZ expands to 1,775,392 bytes and 457,616 ordinary
  writes. Its prepared estimate is 14,643,712 bytes; the former 8 MiB bound
  rejected it despite a peak density of only 95 writes per 128 samples.
- ASWAN host extraction / reference preparation explicitly opt into a bounded
  32 MiB budget. All original writes, including repeated control/noise commands,
  remain ordered. Worklet / Code defaults stay at 8 MiB and density checks stay
  at 512 writes per 128 frames. Existing source / entry / expansion guards remain.
- The real file extracts 353 usable sounds. Its full 20,650,022 stereo frames
  (468.254 seconds) match the independent native VgmPlayer route exactly.
- The real browser exposed a second issue: 2048-frame timer yields made a
  467-second seek exceed 30 seconds. Native blocks and per-block cancellation /
  deadline checks remain; progress and yields now batch at 8ms / 64 blocks.
  Middle seeks are about 0.93s and ending seeks about 1.8–1.9s in both browsers.
- 167 ASWAN tests, 62 shared converter / Timeline / Worklet tests and 36 extra
  CI tests pass. Source and freshly extracted final ZIP pass all 13 generic
  groups plus five real-file groups in Chromium and WebKit. Physical output
  stayed muted and each app used one AudioContext and one destination.
- Default audio is unchanged against 12 offline native / WASM / Worklet routes.
  A narrow, independently pinned complete-source revision preserves immutable
  historical measurements. Both changed served inputs validate against all four
  measured reports; future byte/dependency changes still fail the check.
- Rebuilt the 135-file dev ZIP; CI now covers dense conversion, default/host
  budgets, callback density, long-seek cancellation and source provenance.

The global Mixer freshness command has an unrelated pre-existing Monaco
definitions hash mismatch. The HEAD validator and HEAD source reproduce the
same failure; this task leaves that source and the historical reports intact.
See [baseline proof](aswan_large_vgm_calibration_baseline_20261116.json).

The [Monaco calibration follow-up](todo_monaco_definition_calibration_20261116.md)
subsequently resolved this blocker with an exact passive source-navigation
revision; the historical failure evidence above is retained.

See [verification](verification_aswan_large_vgm_20261116.json) and
[full native comparison](aswan_epilogue_native_20261116.json). No game assets or
audio recordings are included. Human listening and publication were not performed.
