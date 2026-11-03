# Web runtime source map

`web/` contains the reusable JavaScript sound-chip runtime: low-level WASM
wrappers, note/preset helpers, Web Audio output, VGM playback, live-code execution,
and the JavaScript side of Native host integration. Tests currently sit beside
the runtime modules.

Start with the [project overview and goals](../README.md#project-goals) for
Tetorica's purpose, [package documentation](../packages/fm2612/README.md) for
reuse, and [feature status](../docs/feature-status.md) for chip/backend coverage.
This document identifies where to edit the implementation.

## Choose an entry point

| What you need | Start here | Responsibility |
| --- | --- | --- |
| A chip by name | [soundchip.js](soundchip.js), [factory reference](soundchip.md) | Factory, supported chip IDs and execution options |
| Registers and PCM | [ym2612.js](ym2612.js), [ps1_spu.js](ps1_spu.js), [scsp.js](scsp.js) | Low-level chip access; WASM factories can be supplied by the caller |
| Notes, presets and instruments | [ym2612synth.js](ym2612synth.js), [ps1synth.js](ps1synth.js), [scspsynth.js](scspsynth.js) | Musical operations built on the chip APIs; coverage varies by chip |
| Browser audio output | [genesisaudioengine.js](genesisaudioengine.js), [ym2612-worklet.js](ym2612-worklet.js) | AudioContext/AudioWorklet lifecycle and audio rendering |
| Embedded live coding | [playground_runtime.js](playground_runtime.js), [playground_logic_worker.js](playground_logic_worker.js) | Script execution, loops and chip control |
| VGM playback | [vgm_runtime.js](vgm_runtime.js), [ym2612vgm.js](ym2612vgm.js) | Parsing, playback state and chip commands |
| PCM/sample conversion | [wav.js](wav.js), [ps1_adpcm_encoder.js](ps1_adpcm_encoder.js), [snes_brr_encoder.js](snes_brr_encoder.js) | File formats, encoding and sample data |
| Native host connection | [native_genesis_synth.js](native_genesis_synth.js), `native_genesis_extra_*.js` | JavaScript adapters for a host's native sound engine |
| Mixer and effects | [soundchip_mixer.js](soundchip_mixer.js), [megasynth_fx.js](megasynth_fx.js) | Source levels, routing and effects |

The chip wrappers, Synth helpers and audio-output layers are separate entry
points. Choose register/PCM APIs for an emulator or renderer, Synth helpers for
notes and instruments, and the Playground runtime for live-code execution.
PS1 SPU and SCSP use their standalone modules; their presence does not imply
support in the package-root `createSoundChip()` factory.

## Source, generated output and applications

| Location | Role and update path |
| --- | --- |
| `web/` | Edit the shared runtime here. `*.test.mjs` and `*.types.test.ts` verify these modules. |
| [`docs/js/`](../docs/js/) | Served runtime copies and some independent browser implementations. [`sync_web_js_to_docs.sh`](../scripts/sync_web_js_to_docs.sh) lists the shared copies and rewrites their asset URLs. |
| [`docs/generated/`](../docs/generated/) | Generated Emscripten loaders and WASM. Update through the chip build scripts and the pinned SDK sources. |
| [`docs/playground/`](../docs/playground/) | The Playground application: editor, FILES, import dialogs and chip panels. Its UI uses the runtime in `docs/js/`. |
| [`docs/synth/`](../docs/synth/), [`docs/synth-spu/`](../docs/synth-spu/), [`docs/synth-scsp/`](../docs/synth-scsp/) | The separate instrument-editing applications. |
| [`docs/vgm_analyzer/`](../docs/vgm_analyzer/) | Analyzer UI and analysis/export workflows. |
| [`packages/fm2612/`](../packages/fm2612/) | npm package metadata and user documentation. [`copy_full_web_runtime.mjs`](../scripts/copy_full_web_runtime.mjs) and [`build_fm2612_package.mjs`](../scripts/build_fm2612_package.mjs) assemble `dist/fm2612/`. |
| [`third_party/tetorica-soundchip-native/`](../third_party/tetorica-soundchip-native/) | The pinned C/C++ SDK sources used by the WASM builds. Upstream: [tetorica-soundchip-native](https://github.com/kyorohiro/tetorica-soundchip-native). |
| `msfa_dx7/` | Vendored DX7 package and local integration. See its [provenance](msfa_dx7/README.vendor.md) and [`sync_dx7_runtime.mjs`](../scripts/sync_dx7_runtime.mjs). |

Runtime imports, Worker/Worklet URLs and generated-asset locations are part of
the integration contract. The npm payload has a flat module layout; the website
uses `js/` and `generated/`. Source moves require corresponding build/sync and
URL updates. See the [organization TODO](../docs/issues/todo_web_organization_01.md)
for the proposed test separation; it has not been performed.

## Build and check

Run these commands from the repository root, choosing the ones relevant to the
change:

| Task | Command |
| --- | --- |
| Rebuild YM2612 WASM | `sh scripts/build_ym2612_wasm.sh` |
| Synchronize shared website modules | `sh scripts/sync_web_js_to_docs.sh` |
| Build the reusable npm payload and declarations | `npm run build:fm2612` |
| Check packaged runtime and types | `npm run test:fm2612` and `npm run test:fm2612:types` |
| Run runtime and Analyzer tests | `npm run test:analyzer` |
| Assemble the browser Playground | `sh scripts/package_itch_playground.sh` |

The normal YM2612 WASM build verifies and compiles the fixed SDK source release.
It requires Emscripten and Python 3; no separate SDK checkout or download is
needed. See the [build and update instructions](../docs/building_ym2612_wasm.md).
It generates `docs/generated/ym2612_wasm.js` and
`docs/generated/ym2612_wasm.wasm`.

## Low-level YM2612 example

From a browser module under `web/`, served over HTTP:

```js
import ym2612ModuleFactory from "../docs/generated/ym2612_wasm.js";
import { createYm2612, YM2612_CLOCK } from "./ym2612.js";

const ym2612 = await createYm2612(ym2612ModuleFactory);
const sampleRate = ym2612.sampleRate(YM2612_CLOCK);

ym2612.reset();
ym2612.writeRegister(0x30, 0x01);
ym2612.writeRegister(0x34, 0x01);
ym2612.writeRegister(0x38, 0x01);
ym2612.writeRegister(0x3c, 0x01);

const { left, right } = ym2612.generateStereo(128);
console.log(sampleRate, left, right);
ym2612.dispose();
```

This illustrates register access and PCM generation. For a complete playable
voice, use the [register-level beep lesson](../docs/introductions/tetorica_ym2612_soundchip_beep.html)
or the [Web/Node examples](https://github.com/kyorohiro/tetorica-fm2612-examples).
Node callers can supply preloaded WASM through `moduleOptions.wasmBinary`.

The JS wrapper provides:

- `reset()`
- `write(offset, data)`
- `writeRegister(register, value, port = 0)`
- `sampleRate(clock = YM2612_CLOCK)`
- `generateStereo(frames)`
- `dispose()`

Audio generation accepts integer frame counts from `0` through `0x1000000`;
invalid counts throw `RangeError` before entering WASM. This applies to all
chip wrappers and to `generateStereoWithInternalEnvelope()`.

The ymfm-backed YM2203, YM2608, YM2610/B and YM2612 timers advance with
generated audio, at output-sample boundaries. Reads and writes do not advance
their time. Where `setHooks()` is available, `onIrq` also reports the final IRQ
state after a generation call. Nuked-OPN2 retains its existing clocked-write
behavior.

YM2608 `loadAdpcmARom(bytes, offset)` accepts partial writes within the 8 KiB
internal rhythm ROM. Invalid ranges throw `RangeError`; the raw C ABI ignores
invalid ranges without modifying the ROM.

## Playground Runtime

If you want to embed Tetorica-style live code into a browser app or game,
use the reusable Playground runtime layer:

```js
import {
  Playground,
} from "./playground_runtime.js";

const pg =
  Playground({
    audioWorkletUrl:
      "./ym2612-worklet.js",
    ym2612WasmUrl:
      "./generated/ym2612_wasm.wasm",
    segaPsgWasmUrl:
      "./generated/segapsg_wasm.wasm",
  });

await pg.initialize();

pg.load("stage1", `
setBpm(120);

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);

liveLoop("lead", async () => {
  await play("C4", {
    channel: CH1,
    duration: 0.18,
  });
  await beat(0.5);
});
`);

await pg.play("stage1");

console.log(pg.getState());
```

Current core methods:

- `initialize()`
- `finalize()`
- `load(name, sourceCode)`
- `getState()`
- `put(name, sourceCode)` for backward compatibility
- `get(name)`
- `play(name)`
- `playSource(sourceCode)`
- `stop()`
- `clear()`

This keeps the Playground-style API, but removes the Monaco editor and the
current app UI from the dependency surface.

`logicWorkerUrl` is reserved for a future worker-backed execution path and is
not implemented yet.

## VGM Runtime

If you want a small browser-side VGM playback wrapper instead of wiring
`GenesisAudioEngine` and `VgmPlayer` yourself, use:

```js
import {
  VgmRuntime,
} from "./vgm_runtime.js";

const vgm =
  VgmRuntime({
    audioWorkletUrl:
      "./vgm-output-worklet.js",
  });

await vgm.initialize();
await vgm.load(vgmArrayBuffer);
await vgm.play();
```

Current core methods:

- `initialize()`
- `load(buffer, parserOptions?)`
- `play()`
- `pause()`
- `resume()`
- `replay()`
- `stop()`
- `finalize()`
- `getState()`
- `setLoopEnabled(enabled)`
- `setPrefetchFactor(factor)`
- `setMaxFillStepsPerProcess(steps)`

`pause()` preserves pending audio in both the player and output worklet;
`resume()` continues from that position. With looping enabled, files without
an explicit loop point repeat from the beginning without discarding their tail.

`finalize()` cancels pending initialization/playback startup with `AbortError`.
An engine that finishes loading after cancellation is disposed. A subsequent
`initialize()` waits for the previous owned AudioContext to close before starting.

## Reuse, licenses and references

The runtime is designed to be used independently of the editor applications.
Use the [npm package](../packages/fm2612/README.md) for built modules and asset
deployment, or the [native SDK](https://github.com/kyorohiro/tetorica-soundchip-native)
for C/C++ integration and WASM recipes. The [CLI/API reference](../CLI.md) covers
VGM analysis and exports.

Tetorica's original code uses the [BSD-3-Clause license](../LICENSE). Chip cores,
vendored packages and assets retain their own licenses; the [root license and
attribution guide](../README.md#license-and-attribution) identifies them. The
package/release source bundles include component notices and corresponding
sources. See [chip notes](../Memo.md#chip-playback-notes-english) and
[Analyzer support](../docs/vgm_analyzer/support.html) for implementation limits.
