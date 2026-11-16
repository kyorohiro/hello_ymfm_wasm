# Console table dependency cache fix — 2026-11-17

## Report and diagnosis

The user reported this startup error at
`http://localhost:8787/synth-ym2149-st/index.html`:

```text
The requested module './playground_log.js' does not provide an export named 'formatLogTable'
```

Read-only HTTP checks against that server returned the current complete logger
(2,169 bytes, SHA-256
`6f9e858988686497c6beb3b07dcd5067761463994c1de1edd4f8acd506a4f0e6`).
Both canonical and served sources export `formatLogTable`. The logger before
the timed API commit was only 842 bytes and had no such export. The three new
consumers still imported its old, unversioned module URL.

A real persistent HTTP-cache regression reproduces the exact error by keeping
that old logger while loading the new importer. This identifies the mixed
dependency version failure, rather than a missing current source export.

## Change

The Synth Code, Main Playground and Worker runtimes now import:

```js
import {formatLogArgs, formatLogTable} from './playground_log.js?v=console-table-1';
```

The Worker imports `serializeLogError` instead of `formatLogArgs`, with the same
versioned URL. Each canonical source and its existing served mirror receives
only this one URL change. The logger implementation, audio algorithms, timed
API semantics and saved data are unchanged. Older consumers that need only
the existing formatting exports may continue to use the compatible bare URL.

Reload the reported page after applying the fix. If the currently open tab still
holds the previous importer, use **Cmd+Shift+R** on macOS. Clearing site storage,
IndexedDB, projects or user preferences is unnecessary.

## Verification

- [Source warm-cache browser report](verification_log_table_cache_browser_20261117.json):
  Chromium / WebKit pass in persistent contexts with request routing disabled.
  The old bare logger is cached with immutable HTTP headers. A fresh-document
  negative control reproduces the missing-export SyntaxError, then the current
  YM2149 page starts in the same context and fetches the versioned logger.
  The bare predecessor stays cached without a second network fetch.
- Before Code Run, readiness requires no AudioContext. Code's `console.table()`
  renders the expected R13 / value row. IndexedDB binary / text and localStorage
  sentinels survive. Every physical destination route is muted with Gain 0.
- CDN scripts are denied by the test server's CSP, so the browser checks use the
  existing local text-editor fallback without Playwright routing disabling cache.
  No uncaught or local-resource errors occur; the expected external-editor
  policy message is distinguished from application failures.
- Log / Code lifecycle tests: 21 pass.
- Main / Worker / shared Synth runtime regressions: 276 pass. The Worker VM
  fixture now injects the actual lifecycle / table imports added by the earlier
  API implementation, and two fake ports accept its existing atomic AY batches.
  All register/value assertions remain unchanged. The Worker file passes 112/112.
- YM2149 Synth / readable deterministic package suite: 126 pass.
- Playground AY dependency-closure package check passes.
- Historical calibration suite: 468/468 pass, including four new exact cache
  revision checks. Both mixer-default generators pass `--check`.

Test groups overlap and their counts must not be added as a unique total.

## Source freshness and distribution

The [new query-only receipt](log_table_import_cache_revision_01.json) contains
six complete before/after hash pairs and pins both unchanged logger targets.
The central AY source verifier first reconstructs only those exact reviewed
import URLs. The original AY timed receipt / pin, measurements, gains, DSP
and WASM remain unchanged. Future body edits, other queries, modified receipts
and modified logger targets still fail validation.

Generated locally, not published:

- `release/tetorica_ym2149_st_synth_log-table-cache-20261117_itch.zip`.
- 202 files, 2,435,707 bytes.
- SHA-256: `6b13cae59c9502f3feae0b0398e42bb329776c6cfa7c74bd1efcb07fb962bbe0`.
- [Packaged warm-cache browser report](verification_log_table_cache_package_browser_20261117.json):
  Chromium / WebKit also pass against `/index.html` in this exact ZIP's stage,
  retaining the cached predecessor and user-storage sentinels. Output is muted.

No npm publication, version change, tag, commit or release upload was performed.
