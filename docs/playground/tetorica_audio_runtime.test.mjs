import test from "node:test";
import assert from "node:assert/strict";

import { TetoricaAudioRuntime } from "../js/tetorica_audio_runtime.js";

test("disposing an FX chain releases every unit and clears the routing state", () => {
  const disposed = [];
  const runtime = new TetoricaAudioRuntime();
  runtime.fxChain = [
    { dispose() { disposed.push("first"); } },
    { dispose() { disposed.push("second"); } },
  ];

  runtime.disposeFXChain();

  assert.deepEqual(disposed, ["first", "second"]);
  assert.deepEqual(runtime.getFXChain(), []);
});
