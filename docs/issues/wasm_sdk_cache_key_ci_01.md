# WASM SDK CI: WonderSwan timeline cache key

Date: 2026-10-27.

## Failure

[Run 40431173080](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40431173080)
and [run 40432531260](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40432531260)
built all 28 cores, then stopped at the seventh comparison, Nuked OPN2.
The nested failure was the Web/docs source synchronization assertion, before
PCM comparison. A JSDoc import added `?v=wonderswan-pcm-timeline-1`, while
four checkers' explicit cache-key allowlists still ended at older revisions.

## Repair

Added that known cache key to the existing normalizers in the Nuked OPN2,
YM3438, YMF276 and YMF288 checkers. The four-line patch preserves all other
source, output, ABI and exact PCM checks. No workflow or runtime change is
needed. Published npm packages do not include this CI failure; no package
republish is needed.

## Validation

- Read-only audit of all 28 checkers / 68 Web/docs pairs: all synchronize after
  normalization. Before the patch, only the four identified checkers failed.
- The workflow's four guard-test files: 95 passed, zero failures.
- Downloaded the real Linux Emscripten 6.0.6 builds from the failed CI artifact
  and reran the complete checker locally: 28 artifacts / 55 outputs / 40,360
  exact comparisons, maximum difference zero. Runtime/build inputs remained
  unchanged. The local comparison used Node 26.12.0; the failed CI used
  Node 22.23.3. No new compilation was performed in this repair.

```sh
node scripts/check_wasm_sdk.mjs \
  --sdk-dir /private/tmp/wasm-sdk-ci-40431173080/rebuilt \
  --work-dir /private/tmp/wasm-sdk-wonderswan-cache-fix
```

Source and generated sound cores, SDK, Mixer values and published npm archives
are unchanged. Detailed receipts are in
[wasm_sdk_cache_key_ci_01.json](wasm_sdk_cache_key_ci_01.json).
The repair remains uncommitted locally; no push or remote CI run with the
patch was performed. Push the commit to rerun the unchanged workflow.
