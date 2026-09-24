import {createMidiApi} from "../js/playground_midi.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { hzToBlockFnum } from "../js/pitch.js";
import { createDeadlineScheduler } from "../js/playground_clock.js";

const workerSource = readFileSync(
  new URL("../js/playground_logic_worker.js", import.meta.url),
  "utf8"
);

function createWorkerHarness() {
  const messages = [];
  const context = {
    createMidiApi, DOMException,
    createDeadlineScheduler,
    hzToBlockFnum,
    Error,
    Map,
    Math,
    Promise,
    Set,
    performance,
    clearTimeout,
    fetch() {
      return Promise.resolve("network");
    },
    postMessage(message) {
      messages.push(message);
    },
    setTimeout,
  };
  context.self = context;
  vm.runInNewContext(workerSource.replace(/^import \{createMidiApi\}.*;\n/m, "").replace(/^import .* from "\.\/(?:playground_clock|pitch)\.js";\n/gm, ""), context, {
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

test("Worker forwards ordered operator entries without changing their values", async () => {
  const worker = createWorkerHarness();
  await worker.send({
    type: "run", presets: {}, scaleIntervals: {},
    sourceCode: 'fm.setOperators(CH4, [[OP1, { tl: 20 }], [OP3, { dt: 3, multi: 4 }], [OP1, { tl: 20 }]]);',
  });
  const command = worker.messages.find((message) => message.command === "fm.setOperators");
  assert.deepEqual(JSON.parse(JSON.stringify(command?.args)), [3, [[0, { tl: 20 }], [2, { dt: 3, multi: 4 }], [0, { tl: 20 }]]]);
  await worker.send({ type: "stop" });
});

async function waitFor(predicate, timeoutMs = 100) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error("Timed out waiting for Worker command");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test("Worker sample positions advance across loop cycles", async () => {
  const worker = createWorkerHarness();
  try {
    await worker.send({
      type: "run", presets: {}, scaleIntervals: {},
      sourceCode: `
        let cycles = 0;
        liveLoop("timeline", async () => {
          scheduleWritesSamples(beginSampleSchedule(), [[0, 0, 0x22, 0]]);
          await sleepSamples(441);
          if (++cycles === 3) stopLoop("timeline");
        });
      `,
    });
    await waitFor(() => worker.messages.filter((m) => m.command === "scheduleWritesSamples").length >= 3, 1000);
    assert.deepEqual(worker.messages.filter((m) => m.command === "scheduleWritesSamples").map((m) => m.args[0]), [0, 441, 882]);
  } finally {
    await worker.send({ type: "stop" });
  }
});

test("Worker Stop cancels a long wait without resuming user code", async () => {
  const worker = createWorkerHarness();
  await worker.send({
    type: "run", presets: {}, scaleIntervals: {},
    sourceCode: 'liveLoop("long", async () => { await sleep(60); write(0x22, 8); });',
  });
  await worker.send({ type: "stop" });
  assert.ok(worker.messages.some((m) => m.type === "stopped"));
  assert.ok(!worker.messages.some((m) => m.command === "write"));
});

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

test("Worker blocks network access in source and liveLoop callbacks", async () => {
  const worker = createWorkerHarness();
  try {
    await worker.send({
      type: "run",
      presets: {},
      scaleIntervals: {},
      sourceCode: 'await fetch("https://example.com/");',
    });
    await waitFor(() => worker.messages.some((message) => message.type === "execution-error"));
    assert.match(
      worker.messages.find((message) => message.type === "execution-error")?.message ?? "",
      /Network access is disabled/
    );

    await worker.send({
      type: "run",
      presets: {},
      scaleIntervals: {},
      sourceCode: `
        liveLoop("network", async () => {
          await fetch("https://example.com/");
        });
      `,
    });
    await waitFor(() => worker.messages.some((message) => message.type === "log" && /Network access is disabled/.test(message.message)));
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

test('stop interrupts a top-level sleep and prevents late loop registration', async () => {
  const worker = createWorkerHarness();
  await worker.send({ type: 'run', sourceCode: 'fm.noteOn(0,4,500); await sleep(60); liveLoop("late", async () => { await sleep(60); });' });
  await waitFor(() => worker.messages.some(m => m.command === 'fm.noteOn'), 1000);
  await worker.send({ type: 'stop' });
  await waitFor(() => worker.messages.some(m => m.type === 'stopped'), 1000);
  assert.ok(worker.messages.some(m => m.command === 'audio.stopAll'));
  await waitFor(() => worker.messages.some(m => m.type === 'execution-error'), 1000);
  assert.ok(!worker.messages.some(m => m.type === 'complete'));
  await worker.send({ type: 'run', sourceCode: 'log("restarted");' });
  await waitFor(() => worker.messages.some(m => m.type === 'complete'), 1000);
  assert.equal(worker.messages.find(m => m.type === 'complete').loopCount, 0);
  await worker.send({ type: 'stop' });
});

test('stop during worker preparation does not cache the late result', async () => {
  const worker = createWorkerHarness();
  await worker.send({ type: 'run', sourceCode: 'await livePrepare("asset", async () => { await sample.load("asset", "x"); return "old"; });' });
  await waitFor(() => worker.messages.some(m => m.command === 'sample.load'), 1000);
  const request = worker.messages.find(m => m.command === 'sample.load');
  await worker.send({ type: 'stop' });
  await waitFor(() => worker.messages.some(m => m.type === 'stopped'), 1000);
  await worker.send({ type: 'response', id: request.id });
  await waitFor(() => worker.messages.some(m => m.type === 'execution-error'), 1000);
  await worker.send({ type: 'run', sourceCode: 'log(await livePrepare("asset", () => "new"));' });
  await waitFor(() => worker.messages.some(m => m.command === 'log'), 1000);
  assert.equal(worker.messages.find(m => m.command === 'log').args[0], 'new');
  await worker.send({ type: 'stop' });
});


async function nextMidiRequest(worker,index) {
 await waitFor(()=>worker.messages.filter(m=>m.command==='midi.invoke').length>index);
 return worker.messages.filter(m=>m.command==='midi.invoke')[index];
}

test('Worker preserves the MIDI channel through voice, bend, sustain and note release',async()=>{
 const worker=createWorkerHarness();
 worker.post({type:'run',presets:{},scaleIntervals:{},sourceCode:`const o=midi.output('tetorica-ym2612',{channel:CH16});await o.setVoice({algorithm:7});await o.setPitchBendRange(12);await o.pitchBend(-1);await o.cc(64,127);await o.noteOn('C4');await o.noteOff('C4');`});
 const handle=15;
 const expected=[['setVoice',[handle,{algorithm:7},null]],['setPitchBendRange',['tetorica-ym2612',handle,12]],['pitchBend',['tetorica-ym2612',handle,-1]],['cc',['tetorica-ym2612',handle,64,127]],['noteOn',['tetorica-ym2612',handle,60,100]],['release',['tetorica-ym2612',handle,60,42]]];
 for(let i=0;i<expected.length;i++) {
  const message=await nextMidiRequest(worker,i);assert.deepEqual(JSON.parse(JSON.stringify(message.args)),expected[i]);
  worker.post({type:'response',id:message.id,value:expected[i][0]==='noteOn'?42:undefined});
 }
 await worker.send({type:'stop'});
});

test('Worker timeline preserves the MIDI channel for note-off',async()=>{
 const worker=createWorkerHarness();
 worker.post({type:'run',presets:{},scaleIntervals:{},sourceCode:`const o=midi.output('tetorica-sega-psg',{channel:CH2});const t=midi.createTimeline();await t.waitUntil(0);await o.noteOn(60);await t.waitUntil(.001);await o.noteOff(60);`});
 const on=await nextMidiRequest(worker,0);assert.equal(on.args[0],'noteOn');worker.post({type:'response',id:on.id,value:99});
 const off=await nextMidiRequest(worker,1);assert.equal(off.args[0],'release');assert.equal(off.args[1][1],1);assert.equal(off.args[1][3],99);
 worker.post({type:'response',id:off.id});await worker.send({type:'stop'});
});

test('generated MIDI module completes, stops in sleepSamples, and restarts on Worker',async()=>{
 const {midiToSource}=await import('../../web/midi_source.js');
 const worker=createWorkerHarness();let cursor=0,voice=0;
 function entry(ticks) {
  const track=[0,0x90,60,100,ticks,0x80,60,0,0,255,47,0];
  const bytes=Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,track.length,...track]);
  const module=midiToSource(bytes,[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0}],{module:true});
  return `const song=await(async()=>{${module.replace(/^export /gm,'')} return {initCh,runAllCh};})();await song.initCh(pg);await song.runAllCh();`;
 }
 async function respond(method) {
  const request=await nextMidiRequest(worker,cursor++);assert.equal(request.args[0],method);
  worker.post({type:'response',id:request.id,value:method==='noteOn'?++voice:undefined});
 }
 try {
  worker.post({type:'run',presets:{},scaleIntervals:{},sourceCode:entry(1)});
  for(const method of ['setPitchBendRange','noteOn','release','cc'])await respond(method);
  await waitFor(()=>worker.messages.some(m=>m.type==='complete'),1000);
  worker.post({type:'run',presets:{},scaleIntervals:{},sourceCode:entry(96)});
  await respond('setPitchBendRange');await respond('noteOn');
  await worker.send({type:'stop'});
  await waitFor(()=>worker.messages.some(m=>m.type==='stopped'),1000);
  assert(worker.messages.some(m=>m.command==='audio.stopAll'));
  // Stop may issue additional cleanup requests. They must not affect the next run.
  cursor=worker.messages.filter(m=>m.command==='midi.invoke').length;
  worker.post({type:'run',presets:{},scaleIntervals:{},sourceCode:entry(1)});
  for(const method of ['setPitchBendRange','noteOn','release','cc'])await respond(method);
  await waitFor(()=>worker.messages.filter(m=>m.type==='complete').length===2,1000);
 } finally {await worker.send({type:'stop'});}
});
