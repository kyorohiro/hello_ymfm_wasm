# Original Tetorica SID demos

These four small PSID v2 programs were written for Tetorica. They are not game music or game rips.

| File | What it demonstrates |
| --- | --- |
| `tone.sid` | Dry Triangle at A4, with Gate held after initialization. |
| `pulse.sid` | An eight-note test pattern, Pulse-width changes and Gate release/retrigger. |
| `noise.sid` | Noise-frequency changes and Gate release/retrigger. |
| `melody-filter.sid` | Saw with the same test notes, Gate changes and shared low-pass cutoff/resonance changes. |

Every file selects one PAL 6581, VBI timing and one song. The original 6502 `init` and `play` routines return with RTS. They call no ROM routines, read no SID registers, contain no samples and keep their counter in their own payload. The browser player supplies periodic play calls. These demos illustrate the supported subset; they do not establish compatibility with arbitrary `.sid` files.

The source builder [fixture.mjs](fixture.mjs) is an unchanged copy of `test/fixtures/sid-reference/fixture.mjs` in the Tetorica repository. [provenance.json](provenance.json) records the builder hash and each generated file's size, SHA-256 and entry points. The builder's expected register writes describe order and byte values, not CPU timestamps. The browser player and external reference player can have different initialization and scheduling cycles.

To reproduce all four `.sid` files with Node.js, run this from this directory:

```sh
node --input-type=module -e 'import {writeFile} from "node:fs/promises"; import {createSidReferenceFixture,SID_REFERENCE_FIXTURES} from "./fixture.mjs"; for(const profile of SID_REFERENCE_FIXTURES) await writeFile(profile+".sid",createSidReferenceFixture(profile).bytes);'
```

The builder, program bytes, note/control data and this document are original Tetorica work under [BSD-3-Clause](LICENSE.txt). No third-party player source, ROM image, commercial tune or copyrighted sample is included.

Format reference: [HVSC SID file format](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt).
