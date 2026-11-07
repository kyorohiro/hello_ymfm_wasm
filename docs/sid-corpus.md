# Local SID corpus audit

The repository's `check:sid-corpus` tool checks local `.sid` files without opening an audio device. It reads metadata for every file and runs the header's **default subtune only** when the current player accepts it. No songs, firmware or PCM are copied into the report or distribution.

The audit uses the same current WASM backends as [SID Player](sid-player/README.md): bounded PSID VBI, CIA-driven PSID and continuous C64 RSID. The target is explicitly **PAL / 6581**, including unknown/either hints; known NTSC, 8580, multi-SID and other unsupported inputs remain rejected. Only the limited ROM-free environment is used. A ROM-access result does not establish that supplying firmware would make the tune work.

## Run and resume

From the full repository:

```sh
npm run test:sid-corpus
node scripts/check_sid_corpus.mjs --root ww/C64Music \
  --checkpoint release/sid-corpus-audit-20261107/results.jsonl \
  --out docs/issues/sid_corpus_audit_01.json
```

Defaults are **2 seconds of output, 48 kHz, two workers and a 15-second wall-time watchdog per executed file**. `--seconds`, `--sample-rate`, `--workers` and `--timeout-ms` can change these settings. The native init/play budgets still apply; the wall-time watchdog is a separate audit guard. Files are scheduled in deterministic path order; parallel jobs are checkpointed as they finish. Symlinks are not followed.

Press Ctrl+C to cancel in-flight work and retain completed rows. Run the same command with `--resume`:

```sh
node scripts/check_sid_corpus.mjs --root ww/C64Music \
  --checkpoint release/sid-corpus-audit-20261107/results.jsonl \
  --out docs/issues/sid_corpus_audit_01.json --resume
```

Resume verifies the policy, actual runtime sources, native build receipts, WASM bytes and the entire input manifest before reusing results. Changed inputs or execution conditions require a new checkpoint. Worker count can change. A partial final JSONL row after a crash is discarded; corruption in a completed row is rejected. Only one process may own a checkpoint. A stale PID lock is recovered when its old process no longer exists.

Each executed file gets a fresh WASM instance. Worker threads are retired after 64 files and immediately replaced after a watchdog failure. All sibling jobs settle before the checkpoint writer closes. Output paths must remain outside the read-only corpus; aliases to music inputs or other audit outputs are rejected.

## Read the results

The checkpoint starts with a source/policy manifest and appends one result per file. `results.jsonl.inputs.json` contains the deterministic input list. Supported-size inputs have a full SHA-256. Oversized files are rejected before reading their payload; their identity explicitly records only file size, modification time and a bounded header hash. Reports never label that hash as a full-file hash.

The compact summary records counts by status, backend, execution stage and error code, with up to three representative paths per reason. Detailed rows retain numeric native error codes, addresses and init/play phase when known. Successful execution rows include finite sample checks, RMS, peak, rendered frames, cycle counters and Stop checks for zero output and a stable stopped CPU.

| Status | Meaning |
| --- | --- |
| `unsupported` | The header or selected backend requires an unimplemented feature. Metadata rejection reports the first failed rule. |
| `needs_rom` | BASIC requires firmware, or execution observed an unsupported mapped-ROM read. |
| `invalid` | Input layout or the file-size policy failed. |
| `runtime_failed` | Execution, a native budget, CPU JAM/KIL, non-finite output, Stop verification or the worker watchdog failed. |
| `executed_silent` | The complete observation window was exactly zero, with finite output and successful Stop checks. |
| `executed_nonzero` | The complete window contained nonzero finite output and passed Stop checks. |

Nonzero output is not a musical-quality verdict. Silence can be intentional, an initial pause or an unsupported sound technique such as D418 volume-DAC digi. This audit does not cover other subtunes, whole songs, listening quality or complete real-hardware compatibility. Representative browser tests remain separate from this device-free corpus run.

## Current run · 2026-11-07

The eight synthetic-corpus tests passed. They cover real VBI/CIA/RSID output, silence, unsupported targets, ROM requirements, invalid input, CPU failure, checkpoint recovery and invalidation, output protection, stale/concurrent locks, cancellation and replacement after a watchdog timeout.

A five-file pilot over `docs/sid-player/demos` completed with nonzero output and Stop checks for all five demos. Resuming reused all five results, added zero rows and kept the checkpoint SHA-256 unchanged. Its files are under `release/sid-corpus-pilot-20261107/`.

The full `ww/C64Music` run completed **61,157 files, zero remaining**, in about 21.6 minutes: 26,497 nonzero observation windows, 1,050 silent windows, 32,448 unsupported results, 906 ROM requirements/accesses and 256 runtime failures. These are file-level default-song classifications under the stated limits. See [the report](issues/sid_corpus_audit_01.md) and [summary JSON](issues/sid_corpus_audit_01.json).

The checkpoint is `release/sid-corpus-audit-20261107/results.jsonl`. Whole-corpus resume reused all 61,157 rows, added zero results and retained the same checkpoint hash, input-manifest digest, source/WASM fingerprint and classifications. Its summary is `release/sid-corpus-audit-20261107/resume-summary.json`. [Independent verification](issues/sid_corpus_audit_verification_01.json) passed: no missing or duplicate rows, every row matches the input manifest, and all 27,547 completed windows have 96,000 finite samples with zero/stable Stop output.

[Western Games diagnosis](issues/sid_western_games_diagnosis_01.json) found a legitimate 132,113-cycle init followed by genuine CIA I/O in a VBI tune, motivating full-machine VBI support rather than a blind budget increase. This is a candidate for the user's earlier `$1EE4` report; the original input has not been confirmed.
