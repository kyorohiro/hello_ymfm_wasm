# Experimental SCSP DSP field assembler

This first version makes the existing Delay program readable and editable.
The pure codec translates text to a complete 128-step program and back, without
connecting to a chip, uploading a program or opening an audio device.

The Synth's **DSP** tab adds a draft editor and **Check → Apply to Synth**.
Editing and Check leave the running program unchanged. Check reports source
lines and physical steps, and displays the canonical instructions. Apply uses
the narrower execution profile below. The collapsed built-in reference explains
the original six-step Delay; SSF playback owns a separate DSP program.

**Copy .scspasm** / **Save .scspasm** export the current draft verbatim, including
invalid or unapplied edits. A restored local draft is never applied automatically.
**Reset draft** loads the built-in text; Check and Apply explicitly restore the
running program. DSP source is separate from voice presets / Cassette exports.

Start with [examples/delay.scspasm](examples/delay.scspasm). It is the same
six-step program as [delayProgram()](dsp.js), expressed with the pinned core's
field names. The syntax is provisional; it is not SEGA assembler compatibility.

## Read and edit

Run from the repository root:

```sh
node scripts/scsp_dsp_assembler.mjs disassemble --delay
node scripts/scsp_dsp_assembler.mjs assemble docs/synth-scsp/examples/delay.scspasm --out /tmp/scsp-delay-words.json
node scripts/scsp_dsp_assembler.mjs disassemble /tmp/scsp-delay-words.json
```

The first command displays the current Delay's decoded instructions. The second
creates a JSON array of 512 word values. The third turns those values back into
text. `--out` refuses to overwrite an existing file; omit it to print to stdout.

```text
003: XSEL=1 YSEL=1 EWT=1 ZERO=1 COEF=1
```

This is physical step 3. It selects several controls that operate in parallel,
including effect output and a coefficient index. It is not a sequence of
ordinary CPU instructions. The shifter / output path uses the previous
accumulator; this step also computes a new accumulator value. Coefficients,
RAM addresses, routing and Start remain separate configuration.

## Text format

- One line is `decimal-step: FIELD=value FIELD=value ...`; steps are 0–127,
  strictly increasing. Missing positions are zero-filled, not shifted away.
- Field names are case-insensitive. Values are unsigned decimal or `0x` hex;
  single-bit controls use 0 or 1. Missing fields are zero.
- `;` starts a comment. Empty / comment-only text represents an all-zero image.
- `002:` is an explicitly zero instruction. Zero does not mean a harmless
  software NOP, so the codec never reorders instructions or removes positions.
- `RAW0` through `RAW3` retain bits not interpreted by the pinned core's field
  decoder. Their allowed masks are `0x8000`, `0x1000`, `0x0000`, `0x0180`.
  They cannot overlap named fields. These names do not assert that the bits
  are reserved or inert on physical hardware. Preserve them when inspecting
  existing words; do not introduce nonzero undefined bits as hardware-authoring
  advice. The [SEGA manual](https://antime.kapsi.fi/sega/files/ST-077-R2-052594.pdf)
  directs authors to write undefined bits as zero.
- Duplicate steps / fields, unknown fields, invalid numbers and out-of-range
  values are rejected. Disassembly expects exactly 512 integer word values in
  0–65535; it does not guess byte order from a binary file.

Compact disassembly omits only trailing all-zero positions. Internal zero
steps retain their numbers, and assembly always reconstructs all 512 words.
`includeTrailingZeros: true` displays all 128 positions.

## JavaScript

```js
import {assembleScspDsp,disassembleScspDsp} from './dsp_assembler.js';
import {delayProgram} from './dsp.js';

const source = disassembleScspDsp(delayProgram());
const words = assembleScspDsp(source); // A new Uint16Array(512).
console.log(disassembleScspDsp(words, {includeTrailingZeros:true}));
```

These are pure local functions. They neither mutate their inputs nor resolve
live chip state, and are not yet part of the npm / Synth Code public API.
The source and declaration file can be read directly.

## Applying in the Synth

The first execution profile retains the existing coefficient entries COEF0–2,
address entries MADRS0–1, packed-format 64 KiB ring at RBP=0 / RBL=2, and EFREG0
return. It rejects nonzero RAW bits, IRA above 49, even-step MRD / MWT, TABLE or
NOFL RAM modes, YSEL=1 with COEF above 2, RAM I/O with MASA above 1, and EWT with
EWA other than 0. The audio owner repeats this validation before any writes.
The lossless codec can inspect broader images; codec acceptance alone does not
make an image executable through this profile.

A changed Apply clears the wet ring tail while held keyboard / Code voices,
PCM allocations and the existing coefficients / address tables continue.
Applying the same words is a no-op and retains the tail. Rejected programs
leave the running program unchanged. Transfer failures restore the previous
image, ring and return before rendering resumes; if restoration itself fails,
the audio owner stops and reports that audio must be restarted.

Apply before **Enable audio** changes this session's setup without creating an
audio device. Startup transfers that acknowledged program. Stop, mode changes
and loading voice presets retain it within the current Synth session. Reloading
the page starts with the built-in program and restores only draft text.
Apply targets the Synth DSP, independently of SSF playback / paused audition.

To hear a minimal edit, enable Delay, change `EWT=1` to `EWT=0`, Check and Apply.
The wet output disappears while direct voice output continues. Reset draft,
Check and Apply restores the built-in program. The existing Time / Feedback /
Send / Return controls remain available; edited programs may use them differently.

## Validation and limits

```sh
npm run test:scsp-dsp-assembler
npm run test:scsp-synth
```

Tests compare independent field vectors, opaque bits and whole-program round
trips. The authored Delay must reproduce the existing 512 words exactly, then
produce identical real PCM on the shipped SCSP WASM. An intentional edit is
also checked to change wet output. No audio device is used.

The field mapping follows the pinned MAME-derived SCSP core in
`third_party/tetorica-soundchip-native/vendor/mame-scsp/scspdsp.cpp`.
Passing these checks proves consistency with that core and the existing Delay,
not cycle-exact physical Saturn behavior. Odd-step memory access and pipeline
positions remain the author's responsibility. Range-valid fields are not a
guarantee of a meaningful runnable program (for example, the core's input
selection has fewer implemented sources than IRA's six-bit encoding permits).
Macros, automatic scheduling, custom coefficient / RAM-layout editing and general
effect compilation are later work. No public npm or Synth Code DSP API is added.
