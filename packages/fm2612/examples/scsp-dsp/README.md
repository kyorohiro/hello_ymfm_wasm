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
