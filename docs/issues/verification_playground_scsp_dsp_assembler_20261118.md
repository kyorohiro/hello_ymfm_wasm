# SCSP DSP instruction helpers in Playground — 2026-11-18

Work is in the normal `main` checkout, based on `6beead41`. No publication,
version bump, commit, push, native build or release tag is part of this task.

## Behavior

Playground Main / Worker and the shared Code runtime expose the existing pure
`assembleScspDsp(source)` and `disassembleScspDsp(words, options?)` functions as
globals and `pg` aliases. All point to the public codec without a new RPC or
chip facade. A result is an independent 512-word `Uint16Array`; the optional
full listing retains all 128 physical positions. Invalid input retains the
codec's diagnostics. The codec, DSP execution profile and audio lifecycle are
unchanged. In particular, Run may prepare the selected mode's audio as before;
calling either helper adds no audio preparation or chip commands.

In SCSP mode open **Files → examples → scsp → scsp-dsp-roundtrip.js → Code →
Run**. The example prints physical word values, canonical source and a complete
round-trip check. It sends no notes and does not apply a DSP program. Existing
saved files, edited examples and the current `index.js` are retained. Global /
`pg` completion help and source navigation lead to the real public codec.

## Verification

- Playground suite and package dependency graph: **1,345 passed**.
- Existing SCSP Synth / packaging suite: **288 passed**.
- Binding tests exercise real Main, logic Worker and shared Code execution for
  canonical and served modules; global / pg identity, independent data, errors
  and no-transport behavior pass.
- Strict declarations pass SCSP / YM2612 / PS1 in NodeNext and Bundler with
  DOM-only ambient types. Negative inputs/options, published signature parity,
  global / pg source targets and completion help are covered. Shared Synth
  declaration regressions also pass.
- Isolated Chromium and WebKit, Main and Worker: actual Files selection and Run
  toolbar, word table, canonical text, RAW preservation, diagnostics and edited
  file retention pass. Physical output was permanently muted before modules
  loaded. The helper probes add no contexts, worklet nodes, port messages or
  Worker transport; upstream output is zero. No listening was performed.
- External CDN loading was intentionally blocked in these isolated runs, so
  the editor used its text fallback. Monaco's types and navigation are verified
  separately by the strict declaration and source-navigation tests.

Full-suite checks also exposed pre-existing test fixture drift in `6beead41`:
VM imports / exported Worklet class handling, the PS1 VAB and Neo Geo examples,
the dedicated Mega CD catalog, and C64's Web Audio-only policy. Fixtures now
follow the existing implementations; no runtime behavior was changed for them.

## Distribution and calibration

- Both mixer generators pass `--check`. An exact source revision reconstructs
  all 14 reviewed predecessor files at `6beead41` before older source proofs.
  Codec / audio / WASM / gains and original measurement reports remain fixed.
  Dependency edits and future unreviewed bodies are still rejected. Each proof
  shares owned reads only within that invocation; subsequent proofs revalidate.
  All **110** calibration revision tests pass, including tamper cases. A second
  reviewer compared every reconstructed file with `git show 6beead41`.
- `sh scripts/package_itch_playground.sh scsp-dsp-helpers-20261118` passes its
  source checks and package reference checks and creates both ZIPs. Download:
  **1,326 files / 1,509 ZIP entries**. Browser: **1,000 files / 1,000 entries**.
  Both CRCs and every archive / stage byte are verified. The complete source
  archive preserves all **304** original source files byte-for-byte.
- The browser layout initially exceeded itch's limit by three entries. The
  existing corresponding-source archive now also holds PS1 / SCSP build
  receipts and the upstream snes_spc change log. Complete download layout,
  licenses, notices, runtime modules, examples and declaration bytes remain
  intact. Existing UI bundling behavior is unchanged.
- Actual standalone readable Playground runs pass the same Chromium / WebKit,
  Main / Worker cases as the source tree. All **313** source and **311** package
  assets served during those runs match the checked files afterward.
- The final `_for_run.zip` was extracted into a separate directory. Chromium /
  WebKit pass actual Files selection, example Run and global / pg helper probes
  in Main / Worker through DOM-only controls. The UI bundle is unmodified;
  all **234** served assets match the extracted ZIP. Typed words, full positions,
  RAW data, errors, no added transport, mute and zero output are verified.
- FM2612 Synth's explicit distribution list now includes the codec JS and types
  required by the shared Code runtime. Its actual package passes **477** local
  references, CRC and byte checks. Other Synth packagers follow dependencies
  automatically. Relevant packaging / archive tests: **35 passed**.
- Example generation, artifact profile checks, canonical / served source copies,
  JavaScript / shell syntax and `git diff --check` pass.

Browser evidence is in
[verification_playground_scsp_dsp_browser_20261118.json](verification_playground_scsp_dsp_browser_20261118.json).
Archive hashes and counts are in
[verification_playground_scsp_dsp_packages_20261118.json](verification_playground_scsp_dsp_packages_20261118.json).
The exact compatibility proof is
[playground_scsp_dsp_helpers_source_revision_01.json](playground_scsp_dsp_helpers_source_revision_01.json).

Generated files remain under `release/`, with the label
`scsp-dsp-helpers-20261118`; no upload was performed.
