# YM2612 WASM Interface

Build the WASM files:

```sh
sh scripts/build_ym2612_wasm.sh
```

This generates:

- `docs/generated/ym2612_wasm.js`
- `docs/generated/ym2612_wasm.wasm`

Minimal browser-side usage:

```js
import ym2612ModuleFactory from "./generated/ym2612_wasm.js";
import { createYm2612, YM2612_CLOCK } from "../web/ym2612.js";

const ym2612 = await createYm2612(ym2612ModuleFactory);
const sampleRate = ym2612.sampleRate(YM2612_CLOCK);

ym2612.reset();
ym2612.writeRegister(0x30, 0x01);
ym2612.writeRegister(0x34, 0x01);
ym2612.writeRegister(0x38, 0x01);
ym2612.writeRegister(0x3c, 0x01);

const { left, right } = ym2612.generateStereo(128);
console.log(sampleRate, left, right);
```

The JS wrapper provides:

- `reset()`
- `write(offset, data)`
- `writeRegister(register, value, port = 0)`
- `sampleRate(clock = YM2612_CLOCK)`
- `generateStereo(frames)`
- `dispose()`

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
