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
live chip state. The npm package (0.2.42+) exposes them from
`tetorica-fm2612/scsp_dsp_assembler.js` (or the extensionless subpath), with
explicit types and [Node / browser examples](../../packages/fm2612/examples/scsp-dsp/README.md).
Install `tetorica-fm2612@^0.2.42` for these pure helpers. The reusable
runtime, public served module and original Synth import path are byte-identical.
This lossless codec is separate from Synth Code's checked `compileDsp()` facade
described below; its source and declaration file remain directly readable.

### Playground Code: inspect instructions

Open [Playground in SCSP mode](../playground/index.html?mode=scsp), then **Files →
examples → scsp → scsp-dsp-roundtrip.js → Code → Run**. The editable example
prints a word table, canonical source and a 512-word round-trip check. Use
`assembleScspDsp()` / `disassembleScspDsp()` directly, or their `pg` aliases,
in Main or Worker. They execute synchronously in JavaScript without changing
the chip. Run still follows the mode's normal audio preparation lifecycle.
This example inspects instructions; it does not upload or start a DSP program.

### Playground Code: run a RAM-free effect

The same **Files → examples → scsp** folder also includes
**scsp-dsp-gain.js** and **scsp-dsp-iir-motion.js**. These assemble and apply a
short program to the selected Playground SCSP, send slot 0 into MIXS0, and
return EFREG0. Their notes follow `beat()` / `setBpm()`, while a separate
four-second `tween()` changes signed Q12 coefficient codes. DSP executes in the
SCSP core; JavaScript supplies the source and coefficient motion.

Playground exposes acknowledged `applyDspProgram()`, `getDspProgram()`,
`getDspCoefficients()`, `setDspCoefficients()` and `setDspReturn()` on the
`useSoundChip('scsp')` object. `setMix(slot, {dspSend:7, directLevel:0})` enables
the live wet path. The initial **ram-free** execution profile has COEF0..2,
MIXS0 and EFREG0, and rejects RAM I/O/address controls and RAW bits. It does not
reserve or overwrite PCM RAM. Program / coefficient edits preserve held voices
and TEMP history; Stop clears history and retains setup; explicit reset clears
setup too. Snapshots are detached from the live owner.

These operations work in Main / Worker Web Audio. Native rejects DSP methods
and nonzero sends with `NotSupportedError`. See the
[Playground DSP API](../scsp.md#run-a-ram-free-dsp-program-in-playground) for
coefficient and routing ranges. This RAM-free profile is separate from the
Synth's reserved Delay-ring profile and effect controls described below.

### Playground / local package: managed Delay ring

The current source build adds **scsp-dsp-delay.js** to Playground's Files. It uses
`await saturn.setDspDelay({enabled:true,timeMs:240,feedback:0.35})` on the same
SCSP instance as its PCM notes. **npm 0.2.43 does not include this new setter**;
the [source-build Node / browser examples](../../packages/fm2612/examples/scsp-dsp/README.md#managed-hardware-delay--unpublished-source-build)
describe installing the local package. Local `ScspSynth` is synchronous;
Playground / Web Audio methods resolve after owner acknowledgement.

The `delay-ring` profile installs the existing six-step Delay and reserves a
managed 64 KiB ring on first use. It leaves already allocated PCM in place and
reuses its reservation. `getDspProgram()` exposes the decoded instruction words,
`delay:{enabled,timeMs,feedback}` and `ram:{address,byteLength}`. Send and return
remain explicit: `setMix(slot,{dspSend:7})`, `setDspReturn({level:7,pan:0})`.

Time accepts integer 20..700 ms, feedback −1..4095/4096 with downward Q12
quantization. Time / Enable changes clear the ring; feedback / send / return
edits retain it. `noteOff()` leaves echoes; Stop clears voices and history while
retaining setup. Reset clears DSP setup but retains reserved RAM unless
`clearRam:true` clears the whole bank. Invalid settings or insufficient free RAM
reject without changing the existing sound. This does not expose arbitrary
RAM layouts or general effect compilation; Native DSP transport rejects it.

### Synth Code: compile, apply, change coefficients

In a fresh project's **Files**, open **examples/dsp-iir-motion.js → Code → Run**.
The [editable example](examples/dsp-iir-motion.js) compiles a three-step IIR,
applies its complete coefficient table, and plays the current PCM A through it.
Its melody follows `setBpm()` through `beat()`, while a separate four-second
`tween()` moves the coefficients. Try Saw to see and hear the smoothing.
Existing saved/imported Files are kept; use **Add files** to add the example
there. The default `index.js` remains the simple PCM / FM melody.

```js
const scsp = await useSoundChip('scsp');
const words = scsp.compileDsp(`
000: TRA=1 XSEL=0 YSEL=1 ZERO=1 COEF=1
001: XSEL=1 YSEL=1 IRA=32 BSEL=1 COEF=2
002: TWT=1 TWA=0 EWT=1 EWA=0 ZERO=1
`);
await scsp.applyDspProgram(words, {
  coefficients: {0: 4095, 1: 3840, 2: 256},
});
await scsp.setDspCoefficients({1: 3072, 2: 1024});
const setup = await scsp.getDspProgram();
const coefficients = await scsp.getDspCoefficients();
```

`compileDsp(source)` is synchronous: it parses and checks the execution profile
locally, returning a new `Uint16Array(512)` without RPC, rendering or mutation.
`useSoundChip()` itself prepares the audio connection. Invalid source reports
its line / step; compilation is not accepted as a remote Worklet command.

The other four methods are asynchronous owner-acknowledged calls on the same
Synth DSP used by the GUI, independent of SSF playback. Program-only Apply
retains current coefficients. An optional **complete** three-entry table uses
the same atomic setup Apply as the GUI. Partial `setDspCoefficients()` edits
retain history and voices; COEF1 also updates saved Feedback. Invalid requests
leave the entire setup unchanged. Argument data is copied before enqueueing.

`getDspProgram()` and Apply return detached `{words, custom, revision,
coefficients}` snapshots. `coefficients` is `{codes:[c0,c1,c2], feedback}`;
`getDspCoefficients()` and the coefficient setter return that smaller object.
Only word-image changes advance `revision`. Coefficient motion does not poll or
transfer the program image. Applied labels and coefficient controls follow
acknowledged changes without replacing the DSP editor draft.

The example uses `livePrepare()` for setup once per Run. Apply updates named
loops while retaining live setup; use Run after changing setup source. Code
Stop releases its notes and retains the shared DSP program / coefficients.
Reload restores only authored Files / draft text, never executes them, and
starts the audio setup with the built-in Delay. These methods do not introduce
sample-timed scheduling or a public npm DSP execution API. The npm codec above
only encodes / decodes instruction images.

### Save the current setup as Code

Choose **DSP → Save setup to Code**, beside **Applied**. This saves the
acknowledged primary Synth program, all three coefficient codes and the five
effect settings as readable JavaScript in **Files → dsp → SCSP DSP setup.js**.
Further saves use numbered names, keeping existing files. An active audio owner
captures program / coefficients / settings together; saving before Enable audio
uses the current passive setup without creating an AudioContext.

Saving does not apply the draft or a staged example, stop the performance, run
code, or switch Keyboard into Code. The saved file is selected for editing.
Select Code and explicitly **Run** it to restore the captured setup through
`compileDsp()`, complete `applyDspProgram()` and `setEffect()` calls. Loading or
restoring the project never executes it automatically.

**Copy / Save .scspasm** still export the draft source verbatim. **Save setup
to Code** instead exports what is applied, so it remains available even when
the draft is invalid or a different example is staged. It does not capture
PCM, notes, voice routing, live RAM / TEMP history or the separate SSF DSP.
The generated script uses the current voices; save an instrument separately
when its sample / voice setup also needs to be kept. Local-storage failure
keeps the new file in Files and offers project export for recovery.

## Applying in the Synth

The first execution profile retains the existing coefficient entries COEF0–2,
address entries MADRS0–1, packed-format 64 KiB ring at RBP=0 / RBL=2, and EFREG0
return. It rejects nonzero RAW bits, IRA above 49, even-step MRD / MWT, TABLE or
NOFL RAM modes, YSEL=1 with COEF above 2, RAM I/O with MASA above 1, and EWT with
EWA other than 0. The audio owner repeats this validation before any writes.
The lossless codec can inspect broader images; codec acceptance alone does not
make an image executable through this profile.

A changed program-only Apply clears the wet ring tail while held keyboard / Code
voices, PCM allocations and the existing coefficients / address tables continue.
Applying the same words without staged coefficients is a no-op and retains the tail. Rejected programs
leave the running program unchanged. Transfer failures restore the previous
image, ring and return before rendering resumes; if restoration itself fails,
the audio owner stops and reports that audio must be restarted.

Apply before **Enable audio** changes this session's setup without creating an
audio device. Startup transfers that acknowledged program. Stop, mode changes
and loading voice presets retain it within the current Synth session. Reloading
the page starts with the built-in program and restores only draft text.
Apply targets the Synth DSP, independently of SSF playback / paused audition.

### Two-tap FIR examples

Choose **Example → 2-tap FIR low-pass → Check → Apply program + coefficients**.
Selecting / checking stages text and `[4095,2048,2048]`; it does not change live
registers. Apply validates and replaces program / recommended coefficients in
one audio-owner transaction. Failure restores program, coefficients, ring and
return together. The same complete setup is a no-op; a coefficient-only setup
replacement clears the ring without rewriting MPRO. Program revision counts
word-image changes. Ordinary live coefficient controls still retain the ring.

[examples/fir2-lowpass.scspasm](examples/fir2-lowpass.scspasm) contains four steps:

1. Compute current history from MIXS0 with COEF0.
2. Read the previous TEMP sample and multiply by COEF1; store the preceding ACC
   as current history with TWT / TWA=0. TRA=1 reads the preceding frame because
   DEC decreases after every DSP frame. Operand reads precede TWT writes.
3. Add the current input multiplied by COEF2 to the preceding history product.
4. EWT emits the preceding accumulator to EFREG0.

With Q12 rounding / saturation, the example approximates
`y[n] = 0.5*x[n] + 0.5*(4095/4096)*x[n-1]`. The history factor uses the largest
positive Q12 coefficient, 4095, rather than unrepresentable +4096. It is a
two-sample average, with gentle high-frequency reduction and no cutoff control.
Time is irrelevant because the program uses TEMP instead of Delay RAM.
Use DSP return with direct level 0 for comparison; a low sine changes little.

Existing TEMP contents may affect the first processed FIR frame after a program
switch. That frame writes current history, so subsequent frames use only current
input history. No voice reset or native rendering is inserted into Apply.
Tests check an independent fixed-point reference, adjacent impulse taps,
frequency response, render partitioning and this one-frame initialization bound.

**2-tap FIR high-pass** uses the exact same 512 words with COEF1 = −2048.
Its readable fixture is [fir2-highpass.scspasm](examples/fir2-highpass.scspasm).
The recommended table `[4095,-2048,2048]` approximates
`y[n] = 0.5*x[n] - 0.5*(4095/4096)*x[n-1]`. It suppresses low frequencies
instead of high ones, with a small Q12 DC residual rather than exact cancellation.
The real core produces adjacent impulse outputs 2048 / −2048 for input 4096.
Switching LP / HP is a coefficient-only setup Apply: no MPRO writes or program
revision change, and held voices / sample phase remain intact.

The UI distinguishes the shared `fir2` word-image family from exact named
coefficient configurations. Applied labels and hints follow live / Code changes;
unmatched taps display **2-tap FIR (custom coefficients)**. The draft's reference
equation continues to describe its chosen example independently of live edits.

**Built-in Delay** stages its program and default coefficient codes for return.
Reset draft restores only source. Reload restores only text, so choose an example
again to stage coefficients. Copy / Save includes descriptive coefficient
comments, not an automatically applied configuration; portable formats are unchanged.

### One-pole IIR example

Choose **Example → 1-pole IIR low-pass → Check → Apply program + coefficients**.
[iir1-lowpass.scspasm](examples/iir1-lowpass.scspasm) uses three physical steps:

1. Read preceding internal output from TEMP at TRA=1 and multiply by COEF1.
2. Add current MIXS0 input multiplied by COEF2 using the preceding accumulator.
3. Store the preceding saturated accumulator at TWA=0 using TWT and emit it
   to EFREG0 using EWT. DEC decrements after the frame, selecting that stored
   value as the next preceding output.

```text
state[n] = sat24(floor(state[n−1] * COEF1 / 4096)
                 + floor(x[n] * COEF2 / 4096))
EFREG0 = state[n] >> 8
```

The feedback is the stored 24-bit state, not the quantized 16-bit EFREG output.
Recommended `[4095,3840,256]` means `a=0.9375`, `b=0.0625`. COEF0 is unused.
Positive active codes adding to 4096 give nominal unity DC gain; individual edits
also change gain. The example has no cutoff / resonance knob or software tuning.

IIR history recurs, so a switch can retain old TEMP influence beyond the FIR's
one-frame bound. The recommended feedback decays, with fixed-point floor effects:
negative zero-input state can settle at −15 internally / −1 PCM16 step. Unit
feedback magnitude, such as COEF1 = −4096, can preserve alternating history.
Stop resets the core's DSP history; Apply / Enable RAM-ring clearing does not.
No native frame is rendered or unrelated voice reset to prime the filter.

Tests match an independent recursive Q24 reference sample for sample, including
signed extremes, impulse decay, frequency response, inherited history, residuals,
render partitions and irrelevant Delay Time changes. This program stays within
the existing profile and never writes sample / Delay RAM.

### Coefficient values

The **Synth DSP coefficients · live** controls edit COEF0–2 without replacing
the microprogram or clearing its ring. Their signed 13-bit codes range from
−4096 through 4095. The DSP multiplier is `code / 4096`; the 16-bit register word
is `(code & 0x1fff) << 3`, with low three bits zero. The UI shows both numbers
and their actual register addresses, `0x700`, `0x702` and `0x704`.

For the built-in Delay the entries scale ring read, feedback and input,
respectively. COEF1 and the existing Feedback control stay synchronized;
Feedback shows the quantized hardware value. The existing Code call
`scsp.setEffect({feedback:-0.5})` selects COEF1 = −2048. Code can also use
`scsp.setDspCoefficients({0:4095,2:2048})`. `getState().dspCoefficients`
exposes their current signed codes for inspection.

COEF0 / COEF2 are session state and survive Stop / mode / voice-preset loads;
reload starts them at 4095. COEF1 is the existing saved Feedback field. Preset
shape is unchanged, but negative / above-0.85 Feedback needs this newer reader.
`.scspasm` Copy / Save exports instructions without coefficient values. Program-only
Apply and Reset draft do not change coefficients. Example Apply
includes its three staged values. SSF has its own DSP; these
controls are disabled during SSF Live editing; Code DSP calls still address
the primary Synth DSP, not the separate SSF engine.

To hear a minimal edit, enable DSP return, change `EWT=1` to `EWT=0`, Check and Apply.
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
Macros, automatic scheduling, additional coefficient entries / RAM-layout editing and general
effect compilation are later work. The Synth Code execution facade above remains
separate from the pure npm assembler / disassembler.
