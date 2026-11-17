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
