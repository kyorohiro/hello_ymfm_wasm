# Timed Sega PSG / YM2413 register operations

These readable examples use the package's shared timed clients and pure
operation compilers. Package publication is separate from this source change.

## Offline Node inspection

From a project with the candidate package installed:

```sh
node node_modules/tetorica-fm2612/examples/timed-registers/compile.mjs
```

This prints real PSG command bytes and YM2413 address/value writes. It creates
no AudioContext, WASM instance or output device. The same operation baseline is
reused without mutation. The pure helpers are exported from
`segapsg_operations.js` and `ym2413_operations.js`.

## Standalone browser

Serve the project directory over HTTP:

```sh
python3 -m http.server 8080
```

Open `/node_modules/tetorica-fm2612/examples/timed-registers/` and press **Start
patterns**. The import map addresses the installed package itself, with no CDN
or bundler. Keep the example at that URL or adjust the import-map prefix if you
copy it. **Stop** cancels reservations and closes the audio runtime.

`browser.js` uses `createTetoricaSynth({chip:'segapsg',ym2413:true})`. Tone/Noise
and a fixed YM2413 instrument share the runtime's calibrated mixer. The pattern
is compact; it is not a pre-expanded stream or a JavaScript timing loop.

## Playground / Synth Code

Paste `playground.js` into a mode supporting Sega PSG and YM2413. It uses the
same `useSoundChip(...).build/compile/schedule` API and `beat()`-paced live loop.
Changing `setBpm()` changes how often a phrase is reserved. Offsets inside a
built pattern and `repeatSeconds` remain explicit seconds/reference samples.

## Timing, state and hardware semantics

`build()` executes its synchronous callback once and records serializable
operations without reading or editing the live chip. Both `atSample()` and
`atSeconds()` are absolute offsets; the default reference sample rate is 44100 Hz,
independent of the output device. Compilation resolves a private copy of the
baseline; scheduling resolves again against actual renderer state at execution.
Partial fields preserve neighboring bits and repeated writes remain in order.

`compile()` defaults to a coherent Worklet capture. `reset` and a previously
captured snapshot compile without a renderer request. YM2413 `client` uses the
existing 64-byte local register shadow, which can lag scheduled or other writes.
PSG `client` explicitly rejects because its local shadow lacks periods/Noise
metadata. Snapshots are detached operation-resolution state, not oscillator,
Envelope or LFSR audio save states. Native capture/scheduling rejects; local
recording and reset compilation remain available, with no timer fallback.

User-patch registers are shared by all YM2413 instrument-0 channels. The carrier
has no shared TL; use per-channel attenuation. Rhythm ownership is per drum,
although Hi-hat/Snare and Tom/Cymbal share physical channels and level bytes.
Game Gear stereo operations require a stereo-enabled PSG; mono Master System
rejects them. Hardware keyOff behavior is retained; scheduling adds no fade or
synthetic retrigger. For a fresh YM2413 attack, allow an Off-to-On interval.
