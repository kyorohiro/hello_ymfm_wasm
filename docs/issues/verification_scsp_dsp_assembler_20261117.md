# SCSP DSP field assembler — first version, 2026-11-17

The first working version is a pure local JavaScript assembler / disassembler
and Node CLI. It makes the existing six-step Delay readable and editable.
The Synth's current DSP installer and UI are not wired to it yet.

## Try later

From the repository root:

```sh
npm run scsp:dsp -- disassemble --delay
```

This displays six physical steps with named control fields. The original,
commented source is [delay.scspasm](../synth-scsp/examples/delay.scspasm).
See [DSP_ASSEMBLER.md](../synth-scsp/DSP_ASSEMBLER.md) for file conversion and
the two local APIs, `assembleScspDsp()` / `disassembleScspDsp()`.
These commands do not start audio.

## Implementation

- Fixed 128-step image, four unsigned 16-bit words per step. Text retains
  physical step numbers, zero gaps, all 25 decoded fields and uninterpreted
  bits. No optimization or pipeline reordering is performed.
- Provisional field syntax with semicolon comments, decimal / hex values,
  case-insensitive names and source-line diagnostics. Missing fields are zero.
  Full / compact display modes both reconstruct the complete 512-word image.
- Unknown / duplicate fields, step ordering, range / integer / input types and
  options are checked without mutating the input. Inherited options and option
  getters cannot silently change output. RAW values cannot overlap named fields.
- CLI uses JSON word arrays without guessing byte order. Invalid input creates
  no output; existing output / input files cannot be overwritten with `--out`.
- `.d.ts`, editable Delay fixture, local usage guide and npm commands included.
  No npm public API, application runtime, DSP installer or live UI change.

## Validation

Detailed evidence: [verification_scsp_dsp_assembler_20261117.json](verification_scsp_dsp_assembler_20261117.json).

- `npm run test:scsp-dsp-assembler`: 12/12 pass (nine codec / WASM tests plus
  three real CLI tests). Independent core-derived field vectors prevent a
  matching encoder / decoder error from passing unnoticed. All 64 instruction
  bits, opaque bits, zero positions and 32 arbitrary whole programs round-trip.
- `npm run test:scsp-synth`: 207/207 pass, including the nine codec tests and
  existing DSP, instrument, preset, Code and deterministic packaging tests.
- The authored fixture equals every word of the untouched legacy Delay.
  On the shipped 44.1 kHz SCSP WASM, feedback 0 and 0.5 each produce 6,174
  stereo frames identical to baseline, with exact partitioned-render equality.
  The 20 ms first echo is present; feedback 0.5 echoes decay approximately by
  half. Changing only `EWT=1` to `EWT=0` silences wet output. PCM RAM beyond
  the DSP reservation remains unchanged.
- Strict TypeScript consumer checks pass for the declaration file, including
  expected rejection of invalid source and options. Both mixer generators
  pass `--check` with their existing gains and measured-source evidence.
- Independent review extracted all 25 field mappings directly from the pinned
  C++ decoder and verified the raw masks. Runtime / installer / processor /
  JS and WASM core files remain byte-identical to HEAD. Diff checks pass.

No physical audio output or human listening was used. PCM is generated offline;
no browser / microphone / device interaction is required for these checks.

## Limits / next step

The syntax is experimental and does not implement SEGA dAsms compatibility.
Bit-valid encoding does not guarantee runnable semantics: some input selections
are unimplemented by the pinned core, and opaque bits are preserved for
inspection rather than recommended for hardware authoring. Zero instructions
can affect the accumulator; memory access and previous-accumulator timing must
remain explicit. Physical Saturn equivalence has not been established.

Program upload is deliberately still separate. The test-only uploader preserves
word 504 when writing the Start address (`0xBF0`), which also changes a real
instruction word. A future live installer needs its own replacement / failure
and ownership design.

No production release ZIP, npm publication, Tauri change, SDK / WASM rebuild,
commit, push or upload was performed. The existing packaging test generated
only temporary validation artifacts. The next small milestone can display this
listing in the DSP tab; live editing / replacement remains a separate decision.
