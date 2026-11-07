# Original SID reference programs

`fixture.mjs` builds four small, newly authored 6502 diagnostic programs:

- `tone`: dry Triangle at A4, with no Gate changes after initialization.
- `pulse`: an eight-note diagnostic pattern, Pulse-width changes and Gate release/retrigger.
- `noise`: Noise frequency changes and Gate release/retrigger.
- `melody-filter`: Saw with the same diagnostic notes, Gate changes and shared low-pass cutoff/resonance changes.

They are not game rips. The programs call no ROM routines, read no SID registers, use no copyrighted samples, and keep their counter inside their loaded payload. `init` and `play` return with RTS. The external player supplies actual C64 initialization and periodic play calls. The generated header requests a single PAL 6581 and VBI timing.

The expected register writes describe order, address and byte values only. They make no prediction about CPU cycle positions or uniform frame periods. Reference timestamps must come from the external C64 engine. The tiny opcode executor in the unit test checks only fixture assembly; it is not a replacement CPU or a timing reference.

The builder, generated program bytes, note/control data and this document are original Tetorica work under BSD-3-Clause; see the repository [LICENSE](../../../LICENSE). No GPL player source is included in these fixtures.

Format reference: [HVSC SID file format](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt), retrieved 2026-11-07. The Node parser deliberately accepts only the v2/v3/v4 single-SID PAL/6581 reference subset, despite newer format versions existing.
