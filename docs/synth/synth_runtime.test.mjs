import test from "node:test";
import assert from "node:assert/strict";
import { attachOutputEnvelopeTap } from "./synth_runtime.js";

test("Synth opts into worklet envelope messages and forwards the data", () => {
  let listener;
  const commands = [];
  const envelopes = [];
  attachOutputEnvelopeTap({
    megaSynth: { node: { port: {
      addEventListener(type, callback) {
        assert.equal(type, "message");
        listener = callback;
      },
      postMessage(command) {
        assert.equal(typeof listener, "function");
        commands.push(command);
      },
    } } },
    onEnvelope: values => envelopes.push(values),
  });
  assert.deepEqual(commands, [{ type: "set-output-envelope", enabled: true }]);
  const values = new Float32Array([0.1, 0.2]);
  listener({ data: { type: "output-envelope", rmsValues: values } });
  listener({ data: { type: "output-envelope", rmsValues: [0.3] } });
  listener({ data: { type: "unrelated", rmsValues: [1] } });
  assert.deepEqual(envelopes, [values, [0.3]]);
});
