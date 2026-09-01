import test from "node:test";
import assert from "node:assert/strict";

import {
  createPlaygroundRuntime,
} from "../js/playground_runtime.js";

test(
  "named keyboard handlers are replaced on rerun and cleared on stop",
  async () => {
    const originalWindow = globalThis.window;
    const listeners = new Map();
    globalThis.window = {
      addEventListener(type, listener) {
        let registered = listeners.get(type);
        if (!registered) {
          registered = new Set();
          listeners.set(type, registered);
        }
        registered.add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
    };

    try {
      const runtime = createPlaygroundRuntime({
        megaDrive: createMegaDriveStub(),
        guardExecution: false,
      });

      runtime.put(
        "keyboard",
        "onKeyboardPressKey('input', () => { context.count = (context.count || 0) + 1; });"
      );
      await runtime.play("keyboard");
      dispatch(listeners, "keydown");
      assert.equal(runtime.context.count, 1);

      runtime.put(
        "keyboard",
        "onKeyboardPressKey('input', () => { context.count = (context.count || 0) + 10; });"
      );
      await runtime.play("keyboard");
      dispatch(listeners, "keydown");
      assert.equal(runtime.context.count, 11);

      runtime.stop();
      dispatch(listeners, "keydown");
      assert.equal(
        listeners.get("keydown")?.size ?? 0,
        0
      );
    } finally {
      globalThis.window = originalWindow;
    }
  }
);

function dispatch(listeners, type) {
  for (const listener of listeners.get(type) ?? []) {
    listener({ type });
  }
}

function createMegaDriveStub() {
  return {
    state: "idle",
    audioContext: {
      currentTime: 0,
    },
    fm: {
      setPreset() {},
      noteOff() {},
    },
    psg: {},
    sample: {
      stop() {},
      stopAll() {},
      unload() {},
      isLoaded() { return false; },
      get() { return null; },
      list() { return []; },
    },
    stream: {
      stop() {},
      pause() {},
      unload() {},
      isLoaded() { return false; },
      get() { return null; },
      list() { return []; },
    },
    async start() {
      this.state = "ready";
    },
    async resume() {},
    clearFXChain() {
      return [];
    },
  };
}
