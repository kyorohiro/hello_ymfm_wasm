# Daily01 WASM / PCM diagnostic

The diagnostic loads current `web/` processor source and shipped `docs/generated/` modules without changing production files. Interventions are applied only to temporary in-memory instances. Run one benchmark process at a time on an otherwise idle machine.

From the repository root:

```sh
node --expose-gc --experimental-vm-modules path/to/audit.mjs --root=. --out=/private/tmp/daily01-wasm-repeat
```

The default ten-condition matrix uses 48 kHz / 128 output frames, 1,500 warmup blocks, 5,000 measured blocks per trial and five trials. Each condition then gets a separate allocation sampling pass. At 48 kHz this is 13.333 seconds of generated audio per measured trial, rendered offline as quickly as possible. No device is opened.

Optional parameters:

```sh
# Only check all condition PCM hashes; no timing or heap profiler.
node --expose-gc --experimental-vm-modules path/to/audit.mjs --root=. --smoke --out=/private/tmp/daily01-wasm-pcm

# Re-run one condition, preserving default five timing trials.
node --expose-gc --experimental-vm-modules path/to/audit.mjs --root=. --case=huc6280:indexed --out=/private/tmp/daily01-huc-indexed

# Separate allocation-only repeat.
node --expose-gc --experimental-vm-modules path/to/audit.mjs --root=. --phase=alloc --out=/private/tmp/daily01-wasm-alloc

# Verify non-unity volume on the current and owned-indexed HuC paths.
node --expose-gc --experimental-vm-modules path/to/audit.mjs --root=. --smoke --case=huc6280:current --volume=0.7 --out=/private/tmp/daily01-huc-volume-current
node --expose-gc --experimental-vm-modules path/to/audit.mjs --root=. --smoke --case=huc6280:indexed --volume=0.7 --out=/private/tmp/daily01-huc-volume-indexed
```

Compare the two non-unity-volume SHA256 values; the full default matrix automatically verifies hashes within each chip. `--blocks`, `--warmup`, `--trials` accept positive integers. `--case` accepts the following:

| Chip | Conditions |
| --- | --- |
| ym2612 | baseline |
| gameboy | current, borrowed |
| ym2413 | current, direct, borrowed, both |
| huc6280 | current, borrowed, indexed |

`direct` bypasses ccall for numeric generation only. `borrowed` removes public-owned intermediate data only in the private temporary chip instance. `indexed` preserves owned arrays and volume scaling while replacing mapped `Float32Array.from` with indexed loads/stores. Neither public production API nor chip math is modified. Game Boy does not have a `direct` condition because its generated cwrap already has a numeric fast path.

Read `report-results.json` for the curated observed run. Timing is from the first matrix plus an added indexed condition; allocation measurements are from a distinct corrected allocation-only repeat, with timestamps retained. The raw initial pass counted disposal free calls in its allocation section; those raw counts are superseded, not used by the report. Raw timing and correctness were unaffected.

The Node VM experiment is an isolated cost comparison. It does not measure WebKit/Safari/Tauri output deadlines or explain past audible noise. Overrides are host functions attached to VM objects, so VM boundary/JIT decisions can also affect results. Allocation sampling is approximate, adds overhead, and does not comprehensively count external ArrayBuffer backing stores. Use derived PCM byte counts separately. Reusable borrowed-view results are consumed immediately and do not demonstrate public result lifetime safety.

## HuC same-realm validation

`huc-same-realm.mjs` independently verifies the mapped-copy issue using normal ESM imports of the public engine and shipped module factory, with no VM or Worklet harness. It alternates current/indexed trial order (AB/BA), uses the same warmup/block/trial counts, and measures allocation separately.

```sh
node --expose-gc path/to/huc-same-realm.mjs --root=. --out=/private/tmp/daily01-huc-same-realm
```

`huc-same-realm-results.json` confirms approximately 129.50 MB -> 2.20 MB sampled allocation (~98.3% reduction) while preserving owned PCM and non-unity gain. Current trial means were 89.11/88.90/90.95/108.22/99.37 us; indexed were 80.26/76.96/77.09/76.65/77.18 us. A 60.04 ms current outlier inflates the aggregate mean, so use the full trial distribution and retain the offline/OS-scheduling caveat. Same-realm correctness includes zero frames and compares 67,872 emitted frames per condition at each volume (1 and 0.7); both hashes match. Native steady malloc/free/memory replacements remain zero. This validates that the main mapped-copy allocation issue is not an artifact of the VM harness; it still does not establish browser allocation totals or deadline behavior.
