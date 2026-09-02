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
      assert.match(createdWorkers[0].url, /playground_logic_worker\.js(?:\?|$)/);
      runtime.stop();
    } finally {
      globalThis.window = originalWindow;
      globalThis.Worker = originalWorker;
    }
  }
);

test(
  "worker is reused across runs and terminated by finalize",
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
      constructor() {
        this.terminateCount = 0;
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
        if (message.type === "stop") {
          queueMicrotask(() => {
            this.onmessage?.({ data: { type: "stopped" } });
          });
        }
      }

      terminate() {
        this.terminateCount += 1;
      }
    };

    try {
      const runtime = createPlaygroundRuntime({
        megaDrive: createMegaDriveStub(),
        guardExecution: false,
      });
      runtime.put("game", "context.run = (context.run || 0) + 1;");
      await runtime.play("game", { execution: "worker" });
      await runtime.play("game", { execution: "worker" });

      assert.equal(createdWorkers.length, 1);
      assert.equal(createdWorkers[0].terminateCount, 0);

      await runtime.finalize();
      assert.equal(createdWorkers[0].terminateCount, 1);
    } finally {
      globalThis.window = originalWindow;
      globalThis.Worker = originalWorker;
    }
  }
);

test(
  "worker receives keyboard events and stop does not terminate it",
  async () => {
    const originalWindow = globalThis.window;
    const originalWorker = globalThis.Worker;
    const listeners = new Map();
    const messages = [];
    globalThis.window = {
      addEventListener(type, listener) {
        const registered = listeners.get(type) ?? new Set();
        registered.add(listener);
        listeners.set(type, registered);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      setTimeout,
    };
    globalThis.Worker = class FakeWorker {
      constructor() {
        this.terminateCount = 0;
      }

      postMessage(message) {
        messages.push(message);
        if (message.type === "run") {
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                type: "command",
                command: "keyboard.register",
                args: ["keydown:jump", "keydown"],
              },
            });
            this.onmessage?.({
              data: {
                type: "complete",
                loopCount: 1,
                keyboardHandlerCount: 1,
              },
            });
          });
        }
        if (message.type === "stop") {
          queueMicrotask(() => {
            this.onmessage?.({
              data: { type: "command", command: "audio.stopAll", args: [] },
            });
            this.onmessage?.({
              data: { type: "command", command: "fx.detach", args: [] },
            });
            this.onmessage?.({ data: { type: "stopped" } });
          });
        }
      }

      terminate() {
        this.terminateCount += 1;
      }
    };

    try {
      const megaDrive = createMegaDriveStub();
      let stopAllCount = 0;
      let clearFxCount = 0;
      megaDrive.sample.stopAll = () => { stopAllCount += 1; };
      megaDrive.clearFXChain = () => {
        clearFxCount += 1;
        return [];
      };
      const runtime = createPlaygroundRuntime({
        megaDrive,
        guardExecution: false,
      });
      runtime.put("game", "liveLoop('game', async () => {});");
      await runtime.play("game", { execution: "worker" });
      clearFxCount = 0;
      dispatch(listeners, "keydown", { key: "z", code: "KeyZ" });
      runtime.stop();

      // Stop only posts an intent to the Worker. Its commands perform the
      // audio stop and FX detachment on the main thread.
      assert.equal(stopAllCount, 0);
      assert.equal(clearFxCount, 0);
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.ok(messages.some((message) => message.type === "keyboard" && message.id === "keydown:jump"));
      assert.ok(messages.some((message) => message.type === "stop"));
      assert.equal(messages.filter((message) => message.type === "run").length, 1);
      assert.equal(stopAllCount, 1);
      assert.equal(clearFxCount, 1);
    } finally {
      globalThis.window = originalWindow;
      globalThis.Worker = originalWorker;
    }
  }
);

function dispatch(listeners, type, event = { type }) {
  for (const listener of listeners.get(type) ?? []) {
    listener({ type, ...event });
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
    async close() {},
    clearFXChain() {
      return [];
    },
  };
}
