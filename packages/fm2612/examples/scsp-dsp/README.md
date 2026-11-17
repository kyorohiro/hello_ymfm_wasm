# SCSP DSP assembly round trip

This example uses the pure assembler subpath in `tetorica-fm2612` 0.2.42 or
later. It has no other dependencies and does not initialize WASM, Web Audio or
a native audio device.

From a separate project, install the package and run:

```sh
npm install tetorica-fm2612@^0.2.42
node node_modules/tetorica-fm2612/examples/scsp-dsp/roundtrip.mjs
```

For the browser, serve that project directory with a static server:

```sh
python3 -m http.server 8080
```

Open <http://localhost:8080/node_modules/tetorica-fm2612/examples/scsp-dsp/>.
The HTML import map points to the installed package's own ES module. Keep this
example at its packaged URL, or adjust the two import-map URLs if you copy it.
No bundler, CDN, application repository or network service is required.

`roundtrip.mjs` assembles a three-step IIR instruction image and recovers its
canonical field source. The array contains all 128 physical steps, four unsigned
16-bit words per step. Default disassembly retains internal zero steps and
omits trailing zero positions; assembling it reconstructs the complete image.

This produces an instruction image, not sound. Coefficients, RAM, routing and
execution are separate. The lossless assembler accepts a wider field format
than the SCSP Synth's guarded execution profile. Successful assembly does not
guarantee a runnable, stable or hardware-exact effect. RAW fields preserve bits
uninterpreted by the pinned core when inspecting existing words; use zero for
undefined bits when authoring programs.

The provisional syntax follows Tetorica's pinned SCSP decoder. It is not SEGA
assembler compatibility. The helper and example use BSD-3-Clause; SCSP native
core notices remain in the package's `licenses/` and `sources/` directories.

## Render Gain and IIR with Node

The execution examples use `tetorica-fm2612` **0.2.43 or later**. Install the
package, then run the shipped module from your project directory.

```sh
npm install tetorica-fm2612@^0.2.43
node node_modules/tetorica-fm2612/examples/scsp-dsp/execution.mjs
```

`execution.mjs` creates two SCSP instances in sequence and renders their stereo
PCM into owned arrays at 44,100 Hz. Each receives the same impulse. Gain uses
COEF0 = 2048 for a factor of 0.5. The one-pole IIR uses COEF1 = 3840 for its
history and COEF2 = 256 for its new input. The result table reports exact output
equality with independent fixed-point arithmetic and confirms that PCM RAM
retains its bytes.

From a module in your project root, import the installed example by its file
path to obtain its rendered arrays.

```js
import {runDspExamples} from './node_modules/tetorica-fm2612/examples/scsp-dsp/execution.mjs';

const {gain, iir} = await runDspExamples();
console.log(gain.actual, iir.actual); // Float32Array stereo-left output.
console.log(gain.reference, iir.reference);
```

Rendering loads the installed SCSP WASM and leaves output device selection to
your application.

## Play and edit in the browser

Serve the project with the same static server command above. Open
<http://localhost:8080/node_modules/tetorica-fm2612/examples/scsp-dsp/execution.html>
and press **Start audio**. Choose **Gain** or **IIR low-pass**, then move a
coefficient slider while the note is held. **Stop** closes this example's audio
session. The displayed source and acknowledged setup show what runs on the chip.

The browser imports `createScspAudio()`, `createScspClient()` and the assembler
from local package subpaths. Slot 0 sends into MIXS0, and EFREG0 returns the
processed signal. A separate output gain sets the example's listening level to
20%. The sine and saw waveforms are prepared once per session, so changing
programs reuses the two sample handles. Coefficient changes retain the held note
and the DSP's history.

Coefficient codes are signed integers from -4096 to 4095, scaled by 4096.
These examples use the RAM-free execution profile with COEF0..2 and EFREG0.
Its validator rejects RAM I/O, address controls and opaque RAW bits. The source,
coefficient table, slot send and effect return remain explicit in the JavaScript.

The `ScspSynth` methods run synchronously over an owned core in the Node example.
The browser client resolves its asynchronous calls after the AudioWorklet applies
them. Read program state with `getDspProgram()` and coefficient state with
`getDspCoefficients()`. `applyDspProgram()` accepts a complete optional coefficient
table, while `setDspCoefficients()` merges a partial patch.

## Managed hardware Delay (0.2.44)

`delay.mjs` and `delay.html` use `setDspDelay()` in **0.2.44 or later**.
From a separate project, install the package and run the included module:

```sh
npm install tetorica-fm2612@^0.2.44
node node_modules/tetorica-fm2612/examples/scsp-dsp/delay.mjs
```

The Node example renders a 50 ms sine note followed by one second of hardware
DSP echoes into owned stereo arrays. It confirms nonzero wet output after
release and unchanged source PCM; it never opens an output device. Import
`runDelayExample()` from the example file to inspect `held`, `tail`, the decoded
instruction source and the applied `delay` / `ram` snapshots.

Serve that installed project and open
<http://localhost:8080/node_modules/tetorica-fm2612/examples/scsp-dsp/delay.html>.
**Start audio** prepares the chip without playing a note. **Play A3** starts it,
and **Release note** leaves its echoes. **Stop audio** closes this example's
audio session. The explicit Time and Q12 Feedback controls show the actual
configuration and disassembled Delay program.

`setDspDelay({enabled: true, timeMs: 240, feedback: 0.35})` reserves one managed
64 KiB ring on first use, without moving or overwriting PCM. It is shared by
the slots in that SCSP instance. Time is an integer 20..700 ms; feedback is
−1..4095/4096 and quantized downward to signed Q12. Time / Enable changes clear
the ring. Feedback / send / return changes retain its tail and held voices.
`noteOff()` releases the voice without clearing the tail. Code Stop clears
history / voices and retains setup; `reset()` clears DSP setup but retains the
RAM reservation, while `reset({clearRam:true})` releases the bank and ring.

This is the existing bounded Delay program, not arbitrary DSP RAM access or
automatic effect compilation. The pure assembler and released Gain / IIR
examples above keep their existing behavior. The Delay controls require Web
Audio Main / Worker or a local owned `ScspSynth`; Native DSP transport rejects
them explicitly with `NotSupportedError`.

## Two input / output paths — unpublished source build

`routing.mjs` and `routing.html` use a new source-build routing extension.
**The published npm 0.2.44 does not include it.** Build the repository package
with `npm run build:fm2612`, then install that local `dist/fm2612` directory in
a separate project:

```sh
npm install /path/to/hello_ymfm/dist/fm2612
node node_modules/tetorica-fm2612/examples/scsp-dsp/routing.mjs
```

The Node example sends identical original impulses through two simultaneous
paths. MIXS0 reaches Gain / EFREG0 on the left; MIXS1 reaches one-pole IIR /
EFREG1 on the right. It compares both channels with independent fixed-point
calculations, checks unchanged PCM RAM and verifies Stop silence. Import
`runRoutingExample()` from that file to inspect its owned `actual` and
`reference` stereo arrays, decoded source and acknowledged setup.

Serve the installed project and open
<http://localhost:8080/node_modules/tetorica-fm2612/examples/scsp-dsp/routing.html>.
**Start audio** explicitly starts two equal saw notes at A3. Gain and IIR
history controls change COEF0 and COEF1 / COEF2 while notes remain held. The
two Return checkboxes mute each effect output separately. **Stop** closes this
page's audio session. Program source, actual returns and each slot's input bus
remain visible, with a separate 20% output gain for listening.

```js
saturn.setMix(0, {directLevel: 0, dspSend: 7, dspInput: 0});
saturn.setMix(1, {directLevel: 0, dspSend: 7, dspInput: 1});
await saturn.setDspReturn(0, {level: 7, pan: 31}); // Left.
await saturn.setDspReturn(1, {level: 7, pan: 15}); // Right.
```

The source extension accepts `dspInput:0|1` in `setPreset()` / `setMix()` and
output `0|1` in the indexed Return call. Input bus, output number and physical
slot are distinct. A slot sends to one MIXS bus; the DSP instructions determine
which EFREG receives it. The example uses IRA=32 / 33 and EWA=0 / 1.

The legacy `setDspReturn({level,pan})` still addresses output 0. An indexed call
adds a detached `returns:[return0,return1]` snapshot; `return` remains output 0's
alias. The profile name stays `ram-free`, and this five-step program does not
allocate a Delay ring. The managed fixed Delay retains its MIXS0 → EFREG0 path.
Routing changes do not retrigger held slots. Native DSP transport rejects these
controls explicitly. This example does not add arbitrary RAM programs, a new
DSP language or an effect-graph editor.
