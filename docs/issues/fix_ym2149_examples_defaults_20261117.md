# Default YM2149 example files and startup cache — 2026-11-17

The user could not find the manual **Files → Examples** workflow, then asked
for `examples/` to be present by default. This follow-up makes sample discovery
part of normal Files startup. A separate New Project action is a future TODO.

## Behavior

Open **Files**, choose `examples/sync-buzzer.js`, switch to **Code**, and press
**Run**. `examples/README.md` explains the experiment. Pressing **Examples**
is optional; it repairs missing files without replacing edited examples.

After a successful initial storage read / validated restoration, the Files
adapter atomically inserts only missing example files into the known workspace.
This applies to fresh workspaces and older saved drafts. Successful additions
use the existing save debounce. Existing source, sound settings, selection,
Keyboard / Code mode and edited or case-colliding examples remain intact.
Startup never opens audio or runs the sample.

The pure project constructor and explicit Cassette import are unchanged. Import
does not inject files into a user-selected archive. If a stored draft cannot
be read or validated, automatic insertion / saving do not overwrite unknown
stored data. If the known project is full or a file occupies `examples/`,
insertion fails atomically with a nonfatal status message; Files remains usable.

## Cache identity

The old Files adapter could render a functioning panel without Examples because
the prefeature startup URLs were unchanged. The entire relevant YM2149 chain
now has fresh identities:

- HTML → `synth.js?v=ym-examples-1`.
- Synth → `code_host.js?v=ym-examples-1`.
- Code host → `code_files.js?v=ym-examples-1`.
- Code host → `playground_code_runtime.js?v=console-table-1`, which imports the
  versioned logger from the earlier cache fix.

Only import URLs change in the entry / Synth / Code host; the Files adapter
adds the startup insertion. Runtime, DSP, mixer gains, WASM and the immutable
calibration receipts are unchanged by this follow-up.

## Verification

- Files integration tests: 34/34 pass, covering fresh / restored default saves,
  edited files, delayed storage, read / validation / apply failure, atomic
  capacity and directory conflicts, manual repair and early sound edits.
- `npm run test:ym2149-st-synth`: 134/134 pass, including readable deterministic
  package verification. The 34 Files cases are included in this count.
- [Source persistent-cache report](verification_ym2149_examples_cache_browser_20261117.json)
  and [packaged persistent-cache report](verification_ym2149_examples_cache_package_browser_20261117.json)
  both pass Chromium / WebKit. The regression uses real 2e67ed92 prefeature UI
  modules with immutable HTTP caching and no request routing. It first shows
  the old panel without Examples or sample files, then current startup in the
  same persistent context with automatic sample files before any repair click.
  All five versioned resources load, while the old graph stays cached.
- These checks compare exact shipped example text in the saved draft and retain
  existing `index.js`, settings, selection, Keyboard mode and IndexedDB /
  localStorage text / binary sentinels. No AudioContext is created by discovery.
  Re-adding via Examples is idempotent; no uncaught or missing-local-file errors.
- [Packaged performance browser report](verification_ym2149_default_examples_performance_browser_20261117.json)
  also passes Chromium / WebKit: the default sample runs, displays its compiled
  R13 row, changes rates independently of melody, accepts CH1 controls / keys,
  and retains its Apply / cancellation / Stop behavior. Physical output stays
  muted while actual pre-mute PCM is measured.
- Both existing mixer-default generation checks pass. No runtime / audio-source
  remeasurement or calibration-receipt change is needed for this UI follow-up.

Generated locally, not published:

- `release/tetorica_ym2149_st_synth_examples-defaults-20261117_itch.zip`.
- 202 files, 2,436,606 bytes.
- SHA-256: `19eabb273ba4ea4eac73fb1edff82924d8455dfab285cdb7cd1387a2af0c97a0`.

The readable source archive and hash receipt include the updated startup modules
and Files adapter. Package root HTML retains the cache queries. No automatic
commit, tag, publication or user-storage deletion is performed.

## Later New Project design

The user noted that a New Project action would help with initialization. It is
recorded in [TODO](todo_ym2149_st_synth_20261116.md). This change introduces no
project replacement or reset button; preserving / exporting the current project
before replacement needs a separate concrete workflow.
