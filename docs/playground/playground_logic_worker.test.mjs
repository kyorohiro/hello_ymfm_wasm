import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const workerSource = readFileSync(
  new URL("../js/playground_logic_worker.js", import.meta.url),
  "utf8"
);

function createWorkerHarness() {
  const messages = [];
  const context = {
    Error,
    Map,
    Math,
    Promise,
    Set,
    performance,
    clearTimeout,
    postMessage(message) {
      messages.push(message);
    },
    self: {},
    setTimeout,
  };
  vm.runInNewContext(workerSource, context, {
    filename: "playground_logic_worker.js",
  });
  return {
    messages,
    post(data) {
      context.self.onmessage({ data });
    },
    async send(data) {
      this.post(data);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

async function waitFor(predicate, timeoutMs = 100) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error("Timed out waiting for Worker command");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("Worker runs multiple loops, keyboard input, and Stop/Run lifecycle", async () => {
  const worker = createWorkerHarness();
  try {
    await worker.send({
      type: "run",
      presets: {},
      scaleIntervals: {},
      sourceCode: `
        onKeyboardPressKey("jump", () => write(0x22, 0x08));
        const filter = fx.filter({ cutoff: 1200 });
        const layered = fx.parallel(fx.branch(filter));
        fx.setChain([layered]);
        const cycleStart = beginSampleSchedule();
        scheduleWritesSamples(cycleStart, [[0, 0, 0x2a, 0x80]]);
        liveCleanup(["bass", "lead"], () => write(0x22, 0x00));
        liveLoop("bass", async () => {
          fm.keyOn(CH1);
          await sleep(0.002);
        });
        liveLoop("lead", async () => {
          fm.keyOn(CH2);
          await sleep(0.002);
        });
      `,
    });

    const firstComplete = worker.messages.find((message) => message.type === "complete");
    assert.equal(firstComplete?.loopCount, 2);
    assert.equal(firstComplete?.keyboardHandlerCount, 1);
    await waitFor(() => worker.messages.some((message) => message.command === "fm.keyOn" && message.args[0] === 0));
    await waitFor(() => worker.messages.some((message) => message.command === "fm.keyOn" && message.args[0] === 1));
    assert.ok(worker.messages.some((message) => message.command === "fx.compose" && message.args[1] === "branch"));
    assert.ok(worker.messages.some((message) => message.command === "fx.compose" && message.args[1] === "parallel"));
    assert.ok(worker.messages.some((message) => message.command === "fx.setChain"));

    assert.ok(worker.messages.some((message) => message.command === "scheduleWritesSamples"));

    await worker.send({
      type: "keyboard",
      id: "keydown:jump",
      event: { key: "z", code: "KeyZ" },
    });
    assert.ok(worker.messages.some((message) => message.command === "write" && message.args[1] === 0x08));

    await worker.send({ type: "stop" });
    assert.deepEqual(
      worker.messages.slice(-5).map((message) => message.type === "command" ? message.command : message.type),
      ["write", "audio.stopAll", "fx.detach", "audio.disposeHandles", "stopped"]
    );

    await worker.send({
      type: "run",
      presets: {},
      scaleIntervals: {},
      sourceCode: `
        liveLoop("pad", async () => {
          fm.keyOn(CH3);
          await sleep(0.002);
        });
      `,
    });
    const secondComplete = worker.messages.filter((message) => message.type === "complete").at(-1);
    assert.equal(secondComplete?.loopCount, 1);
    assert.equal(secondComplete?.keyboardHandlerCount, 0);
    await waitFor(() => worker.messages.some((message) => message.command === "fm.keyOn" && message.args[0] === 2));
  } finally {
    await worker.send({ type: "stop" });
  }

});

test("Worker resets the sample clock before a stopped VGM loop runs again", async () => {
  const worker = createWorkerHarness();
  const sourceCode = `
    liveLoop("pcm", async () => {
      write(0x2a, 0x80);
      await sleepSamples(4410);
    });
  `;
  const pcmWrites = () => worker.messages.filter(
    (message) => message.command === "write" && message.args[0] === 0x2a
  ).length;

  try {
    await worker.send({ type: "run", presets: {}, scaleIntervals: {}, sourceCode });
    await waitFor(() => pcmWrites() >= 1);
    await new Promise((resolve) => setTimeout(resolve, 380));
    await worker.send({ type: "stop" });

    const writesBeforeRestart = pcmWrites();
    await worker.send({ type: "run", presets: {}, scaleIntervals: {}, sourceCode });
    await waitFor(() => pcmWrites() > writesBeforeRestart);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(pcmWrites(), writesBeforeRestart + 1);
  } finally {
    await worker.send({ type: "stop" });
  }
});

test("Worker keeps context across Run and clears it on Stop", async () => {
  const worker = createWorkerHarness();
  const incrementSource = "context.count = (context.count ?? 0) + 1;";

  await worker.send({ type: "run", presets: {}, scaleIntervals: {}, sourceCode: incrementSource });
  await worker.send({ type: "run", presets: {}, scaleIntervals: {}, sourceCode: incrementSource });
  assert.equal(worker.messages.filter((message) => message.type === "complete").length, 2);

  await worker.send({ type: "stop" });
  await worker.send({
    type: "run",
    presets: {},
    scaleIntervals: {},
    sourceCode: "if (context.count !== undefined) throw new Error('context was not cleared');",
  });

  assert.equal(worker.messages.at(-1)?.type, "complete");
  await worker.send({ type: "stop" });
});

test("Worker serializes an immediate Stop then Run", async () => {
  const worker = createWorkerHarness();
  await worker.send({
    type: "run",
    presets: {},
    scaleIntervals: {},
    sourceCode: "liveCleanup(['loop'], async () => { await Promise.resolve(); write(0x22, 0); }); liveLoop('loop', async () => { await sleep(1); });",
  });

  worker.post({ type: "stop" });
  worker.post({
    type: "run",
    presets: {},
    scaleIntervals: {},
    sourceCode: "liveLoop('next', async () => { await sleep(1); });",
  });
  await waitFor(() => worker.messages.filter((message) => message.type === "complete").length === 2);

  const stoppedIndex = worker.messages.findIndex((message) => message.type === "stopped");
  const secondCompleteIndex = worker.messages.reduce(
    (index, message, currentIndex) => message.type === "complete" ? currentIndex : index,
    -1
  );
  assert.ok(stoppedIndex >= 0);
  assert.ok(stoppedIndex < secondCompleteIndex);
  await worker.send({ type: "stop" });
});
