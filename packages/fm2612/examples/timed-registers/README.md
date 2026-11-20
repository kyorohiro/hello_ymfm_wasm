# Timed register operations

These readable examples use the package's shared timed clients and pure
operation compilers: Sega PSG, YM2413, DMG / Game Boy and SID 6581 / 8580 Preview.

## Offline Node inspection

From a project with the candidate package installed:

```sh
node node_modules/tetorica-fm2612/examples/timed-registers/compile.mjs
node node_modules/tetorica-fm2612/examples/timed-registers/compile-dmg-sid.mjs
```

This prints real PSG command bytes and YM2413 address/value writes. It creates
no AudioContext, WASM instance or output device. The same operation baseline is
reused without mutation. The pure helpers are exported from
`segapsg_operations.js` and `ym2413_operations.js`.

`compile-dmg-sid.mjs` prints DMG and SID raw writes from reset state, including
repeated SID Gate writes and another comparison from the same unchanged
baseline. The pure helpers are `gameboy_operations.js` and `sid_operations.js`.
Reset is uninitialized hardware state: these raw-write examples do not silently
perform high-level initialization or include initialization writes in the trace.

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

## DMG and SID browser example

Open `/node_modules/tetorica-fm2612/examples/timed-registers/dmg-sid.html` from
the same HTTP server. Choose DMG, SID 6581 or SID 8580 Preview, then press
**Start pattern**. Stop the current runtime before choosing another chip.

`dmg-sid.js` owns one AudioContext and uses the package's complete endpoint
helpers: `createGameboyAudio()` with `createGameboyClient()`, or `createSidAudio()`
with `createSidClient()`. The SID endpoint selects 6581 or 8580 explicitly; it does
not change a Playground primary model. The helpers load the real Worklet and
WASM and supply an acknowledged port. `client.initialize()` establishes the
high-level defaults, then `build()`, `captureState()`, `compile()`, `schedule()`
and `clearSchedule()` are available. The host's simple output gain is 20%; this
example does not add the full runtime's calibrated multi-chip mixer.

The example reuses one detached snapshot to compile twice, checks the same
result, schedules a named repeat and closes its owned client/endpoint/context
in Stop/error cleanup. The DMG phrase changes Pulse duty; the SID phrase changes
Pulse width and shared filter Cutoff without replacing neighboring fields.

This is distinct from root `createSoundChip()`: direct creation returns a
low-level PCM core, and its generic `execution:'worklet'` endpoint is not this
high-level timed authoring facade. For Playground Code, use
`await useSoundChip('gameboy')` / `await useSoundChip('sid')` instead of opening
a second AudioContext; those clients expose the same operation methods.

Both DMG and SID shared clients accept `initialState:'client'` using their
existing local resolver metadata and register shadow. This needs no state
request and may lag scheduled or other-writer edits. `current` requests a
coherent renderer snapshot while audio keeps running; supplied snapshots and
`reset` need no renderer request. Snapshots are immutable resolver state, not
full audio or machine save states, and must match the chip instance/configuration.
The standalone SID Synth app borrows its instrument without maintaining a
complete client shadow, so that app explicitly rejects `client`; this package
example uses the shared client and supports it.

DMG/SID high-level methods retain their existing initialization requirements.
The example explicitly initializes its clients; `initialState:'reset'` does not.
SID 8580 Preview requires PAL 985248 Hz. SID same-value control/Gate writes are
kept; no synthetic Off-to-On retrigger or software envelope is inserted. DMG
Wave RAM uploads retain their real DAC-stop behavior. Timed execution and
authoritative capture require Web Audio/AudioWorklet; Native has no timer
fallback. Existing immediate methods remain available.

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
