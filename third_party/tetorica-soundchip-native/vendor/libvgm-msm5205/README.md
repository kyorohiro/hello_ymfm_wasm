# MSM5205 ADPCM sources

The runnable [Tetorica JavaScript decoder](../../reference/javascript/msm5205audioengine.js) follows libvgm's MSM5205 model: ADPCM step table, leaky accumulator, FIFO, reset, prescaler, 3/4-bit mode and external VCLK. It does not build or link libvgm's C framework. Output masking preserves decoder progression. The JavaScript adaptation does not support MSM6585 or a second chip.

## Included upstream source

[upstream/libvgm/emu/cores/msm5205.c](upstream/libvgm/emu/cores/msm5205.c) is an unchanged copy from official libvgm commit `bad50c571db45b872304bdcd0603dd2214f0663e`. Its file header explicitly declares BSD-3-Clause. Copyright notices remain intact; see [LICENSE](LICENSE).

[snapshot-manifest.json](upstream/libvgm/snapshot-manifest.json) records the repository, immutable commit, original path, SHA-256, and omitted dependencies. This independently collected upstream snapshot does not establish which historical revision was used for the JavaScript adaptation.

## Collection boundary

This C source is a reference for inspection and future integration, not a standalone SDK Native or WASM target. Its libvgm integration headers, including `msm5205.h`, and support code are not bundled because they have no explicit license declaration in the pinned source. The [upstream license discussion](https://github.com/ValleyBell/libvgm/issues/129) reports incomplete license assignment. We do not infer a BSD license for those files.

These omitted files are not dependencies of the runnable JavaScript decoder or of the SDK's existing Native/WASM build targets. No ROM or game data is included. The VGM command handler URL in the historical notice is background provenance; that unlicensed player source is not redistributed.
