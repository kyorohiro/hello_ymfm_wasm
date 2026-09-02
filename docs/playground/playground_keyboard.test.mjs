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

test(
  "write is available from liveLoop callbacks",
  async () => {
    const originalWindow = globalThis.window;
    const writes = [];
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
    };

    try {
      const megaDrive = createMegaDriveStub();
      megaDrive.fm.write = (...args) => writes.push(args);
      const runtime = createPlaygroundRuntime({
        megaDrive,
        guardExecution: false,
      });

      runtime.put(
        "vgm-write",
        "liveLoop('vgm-write', async () => { write(0x28, 0xf0); await sleepSamples(735); });"
      );
      await runtime.play("vgm-write");
      await new Promise((resolve) => setTimeout(resolve, 25));
      runtime.stop();

      assert.deepEqual(writes[0], [0, 0x28, 0xf0]);
    } finally {
      globalThis.window = originalWindow;
    }
  }
);

test(
  "liveCleanup runs when a rerun removes its loop",
  async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
    };

    try {
      const runtime = createPlaygroundRuntime({
        megaDrive: createMegaDriveStub(),
        guardExecution: false,
      });
      runtime.put(
        "ocean",
        "liveCleanup(['ocean'], () => { context.cleaned = (context.cleaned || 0) + 1; }); liveLoop('ocean', async () => { await sleep(1); });"
      );
      await runtime.play("ocean");
      runtime.put("ocean", "");
      await runtime.play("ocean");

      assert.equal(runtime.context.cleaned, 1);
      runtime.stop();
    } finally {
      globalThis.window = originalWindow;
    }
  }
);

test(
  "worker execution is opt-in for a loaded source",
  async () => {
    const originalWindow = globalThis.window;
    const originalWorker = globalThis.Worker;
    const createdWorkers = [];
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
    };
    globalThis.Worker = class FakeWorker {
      constructor(url, options) {
        this.url = url;
        this.options = options;
        createdWorkers.push(this);
      }

      postMessage(message) {
        if (message.type === "run") {
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                type: "complete",
                loopCount: 0,
                keyboardHandlerCount: 0,
              },
            });
          });
        }
      }

      terminate() {}
    };

    try {
      const runtime = createPlaygroundRuntime({
        megaDrive: createMegaDriveStub(),
        guardExecution: false,
      });
      runtime.put("game", "context.started = true;");
      await runtime.play("game", { execution: "worker" });

      assert.equal(createdWorkers.length, 1);
      assert.equal(createdWorkers[0].options.type, "module");
      assert.match(createdWorkers[0].url, /playground_logic_worker\.js$/);
      runtime.stop();
    } finally {
      globalThis.window = originalWindow;
      globalThis.Worker = originalWorker;
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
