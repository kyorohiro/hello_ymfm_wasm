import {createOpnClient} from '../../web/playground_opn.js';
import {createRf5c164Client} from '../../web/playground_rf5c164.js';
import {createYm2608Client} from '../../web/playground_ym2608.js';
import {createSoundChipRegistry} from '../../web/playground_soundchips.js';
import {createGameboyClient} from '../../web/playground_gameboy.js';
import {createNativeSampleController} from "../../web/native_sample.js";
import {createNativeNoiseController, controlNativeNoise} from "../../web/native_noise.js";
import {createNativeFXController} from "../../web/native_fx.js";
import {createWorkerDac} from "../../web/playground_worker_dac.js";
import {createWorkerChip} from "../../web/playground_worker_chip.js";
import {createMidiApi, createMidiRack} from "../js/playground_midi.js";
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
    createNativeSampleController, createNativeNoiseController, controlNativeNoise, createWorkerDac, atob, createMidiApi, createMidiRack, createWorkerChip, createNativeFXController, DOMException, structuredClone,
    createDeadlineScheduler, createOpnClient, createGameboyClient, createSoundChipRegistry, createRf5c164Client, createYm2608Client,
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
  vm.runInNewContext(workerSource.replace(/^import .*;\n/gm, "").replace(/^import .* from "\.\/(?:playground_clock|pitch|native_fx)\.js";\n/gm, ""), context, {
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

test('Worker forwards fixed-channel configuration before notes',async()=>{
 const worker=createWorkerHarness();
 try {
  worker.post({type:'run',presets:{},scaleIntervals:{},sourceCode:`await midi.enableSoundChip('tetorica-ym2612',{roundRobin:false});await midi.output('tetorica-ym2612',{channel:CH4}).noteOn('C4');`});
  const configure=await nextMidiRequest(worker,0);
  assert.equal(configure.args[0],'enableSoundChip');assert.equal(configure.args[1][1].roundRobin,false);
  worker.post({type:'response',id:configure.id});
  const note=await nextMidiRequest(worker,1);assert.equal(note.args[0],'noteOn');assert.equal(note.args[1][1],3);
  worker.post({type:'response',id:note.id,value:123});
  await waitFor(()=>worker.messages.some(m=>m.type==='complete'),1000);
 } finally {await worker.send({type:'stop'});}
});

test('native FX commands go directly to Worklet port, never the main audio bridge', async()=>{
 const worker=createWorkerHarness();const fxMessages=[];
 await worker.send({type:'native-fx',port:{postMessage:d=>fxMessages.push(d),close(){}}});
 await worker.send({type:'run',sourceCode:`
  setBpm(100);
  const f=fx.filter({cutoff:1000});
  fx.setChain([fx.parallel(fx.branch(f))]);
  f.cutoff.rampTo(2000,.1);
 `});
 assert.ok(worker.messages.some(m=>m.type==='complete'));
 assert.ok(fxMessages.some(m=>m.op==='chain'));
 assert.ok(fxMessages.some(m=>m.op==='parameter'&&m.value===2000));
 assert.ok(!worker.messages.some(m=>m.command?.startsWith('fx.')||m.command==='audio.call'));
 await worker.send({type:'stop'});assert.equal(fxMessages.at(-1).op,'reset');
});

test("Direct chip port plays FM, PSG and MIDI without main-thread audio replies", async () => {
  const worker = createWorkerHarness();
  const commands = [];
  await worker.send({type: 'chip-port', port: {postMessage: batch => commands.push(...batch), close() {}}});
  await worker.send({
    type: 'run', presets: {}, scaleIntervals: {},
    capabilities: {chip: 'ym2612', fmChannels: 6, psg: true, dac: true},
    sourceCode: `
      fm.setAlgo(CH1, 7, 0);
      await play('C4', {duration: 0.001});
      psgTone(PSG1, 400, 4);
      const lead = midi.output('tetorica-ym2612', {channel: CH1});
      await lead.noteOn('E4');
      await lead.pitchBend(0.2);
      await lead.noteOff('E4');
    `,
  });
  await waitFor(() => worker.messages.some(m => m.type === 'complete'), 1000);
  assert.ok(!worker.messages.some(m => m.type === 'error'), JSON.stringify(worker.messages));
  assert.ok(commands.some(c => c.type === 'write' && c.register === 0x28 && c.value >= 0xf0));
  assert.ok(commands.some(c => c.type === 'psg-write'));
  assert.ok(worker.messages.some(m => m.type === 'chip-observer'));
  assert.ok(!worker.messages.some(m => m.command === 'play' || m.command === 'midi.invoke' || m.command?.startsWith('fm.') || m.command === 'psgTone'));
  await worker.send({type: 'stop'});
  assert.ok(commands.some(c => c.type === 'clear-scheduled-writes'));
  assert.ok(worker.messages.some(m => m.type === 'stopped'));
});

test("Direct chip Stop releases a long note and permits another Run", async () => {
  const worker = createWorkerHarness();
  const commands = [];
  await worker.send({type: 'chip-port', port: {postMessage: batch => commands.push(...batch), close() {}}});
  const run = {type: 'run', presets: {}, scaleIntervals: {}, capabilities: {chip: 'ym2612', fmChannels: 6, psg: true, dac: true}};
  worker.post({...run, sourceCode: `await play('C4', {duration: 60});`});
  await waitFor(() => commands.some(c => c.register === 0x28 && c.value === 0xf0));
  await worker.send({type: 'stop'});
  await waitFor(() => worker.messages.some(m => m.type === 'stopped'));
  assert.ok(commands.some(c => c.register === 0x28 && c.value === 0));
  commands.length = 0;
  await worker.send({...run, sourceCode: `await play('D4', {duration: 0.001});`});
  await waitFor(() => commands.some(c => c.register === 0x28 && c.value === 0xf0));
  await worker.send({type: 'stop'});
});

test('DAC loading and scheduling reach the direct port without main replies', async () => {
  const worker = createWorkerHarness(), commands = [];
  await worker.send({type:'chip-port',port:{postMessage: batch=>commands.push(...batch),close(){}}});
  await worker.send({type:'run',presets:{},scaleIntervals:{},capabilities:{chip:'ym2612',fmChannels:6,psg:true,dac:true},sourceCode:`
    await dac.loadBase64('tone', 'AAAAAIA=');
    const start = beginSampleSchedule();
    dac.playStream('tone', {atSamples:start});
    dac.schedule(start, [[44,128]]);
    dac.scheduleBase64(start, 'AAAAAIA=');
    scheduleWritesSamples(start, [[88,0,0x2b,0],[88,"psg",0x85],[88,"psg",0x12]]);
    fm.scheduleWrites([{time:1,port:0,register:0x2a,value:128}]);
  `});
  await waitFor(()=>worker.messages.some(m=>m.type==='complete'),1000);
  assert.ok(commands.some(c=>c.type==='load-dac-bank'));
  assert.ok(commands.some(c=>c.type==='sample-dac-bank'));
  assert.equal(commands.filter(c=>c.type==='sample-writes').length,3);
  assert.deepEqual(JSON.parse(JSON.stringify(commands.filter(c=>c.type==='sample-writes').at(-1).entries.slice(1))), [{sample:88,type:'psg-write',value:0x85},{sample:88,type:'psg-write',value:0x12}]);
  assert.ok(!worker.messages.some(m=>m.command?.startsWith('dac.') || m.command==='scheduleWritesSamples' || m.command?.startsWith('fm.')));
  await worker.send({type:'stop'});
  assert.ok(commands.some(c=>c.type==='clear-dac-playback'));
  assert.ok(commands.some(c=>c.type==='reset-sample-schedule'));
});

test('native noise is controlled without any main-thread audio request',async()=>{
 const worker=createWorkerHarness(),commands=[];
 await worker.send({type:'native-fx',port:{postMessage:d=>commands.push(d),close(){}}});
 await worker.send({type:'run',presets:{},scaleIntervals:{},sourceCode:`
  const voice=noise.create({type:'pink',attack:0.1});
  voice.filter.set('bandpass',1200,.5);
  control(voice,{gain:.2,pan:-.3,cutoff:800,slide:.1});
  if(voice.gain.get()!==.2)throw new Error('wrong target');
  voice.stop();voice.start();
 `});
 await waitFor(()=>worker.messages.some(m=>m.type==='complete'),1000);
 assert.ok(commands.some(c=>c.op==='noise'&&c.action==='create'));
 assert.ok(commands.some(c=>c.op==='noise'&&c.action==='parameter'&&c.seconds===.1));
 assert.ok(!worker.messages.some(m=>m.command?.startsWith('noise.')||m.command?.startsWith('audio.')));
 await worker.send({type:'stop'});
 assert.ok(commands.some(c=>c.op==='noise'&&c.action==='dispose'));
});

test('prepared sample playback and voice stop use the direct Worklet port',async()=>{
 const worker=createWorkerHarness(),commands=[];
 const port={start(){},close(){},postMessage(d){commands.push(d);if(d.op==='sample'&&d.id)queueMicrotask(()=>port.onmessage({data:{op:'sample-response',id:d.id,value:d.action==='play'?7:undefined}}));}};
 await worker.send({type:'native-fx',port});
 worker.post({type:'run',presets:{},scaleIntervals:{},sourceCode:`
   await sample.load('hit','hit.wav');
   const voice=await sample.play('hit',{loop:true});voice.stop();
   await sample.play('hit');sample.stop('hit');
 `});
 await waitFor(()=>worker.messages.some(m=>m.command==='sample.decode'));
 const load=worker.messages.find(m=>m.command==='sample.decode');
 await worker.send({type:'response',id:load.id,value:{sampleRate:48000,channels:[Float32Array.of(.5,0)]}});
 await waitFor(()=>worker.messages.some(m=>m.type==='complete'),1000);
 assert.equal(commands.filter(d=>d.op==='sample'&&d.action==='play').length,2);
 assert.ok(commands.some(d=>d.action==='stopVoice'));
 assert.ok(!worker.messages.some(m=>['sample.play','sample.stop','sample.pcm'].includes(m.command)));
 await worker.send({type:'stop'});assert.ok(commands.some(d=>d.op==='sample'&&d.action==='clear'));
});

test('liveFx registration and context update use direct port from Code',async()=>{
 const worker=createWorkerHarness(),commands=[];
 await worker.send({type:'native-fx',port:{postMessage:d=>commands.push(d),close(){}}});
 await worker.send({type:'run',sourceCode:`
  liveFx("custom", {context:{gain:.5},process(input,output,state,context){
   output[0].set(input[0]);
  }});
  fx.updateContext("custom",{gain:.25});
 `});
 assert.ok(worker.messages.some(m=>m.type==='complete'),JSON.stringify(worker.messages));
 assert.equal(commands.find(m=>m.action==='register').name,'custom');
 assert.equal(commands.find(m=>m.action==='context').context.gain,.25);
 assert.ok(!worker.messages.some(m=>m.command?.startsWith('fx.')));
 await worker.send({type:'stop'});
});

 test('Game Boy high-level client survives Worker Run/Stop/re-Run and owns one port per run', async () => {
  const worker = createWorkerHarness();
  for (let run = 0; run < 2; run++) {
    const messages = []; let closed = 0;
    const from = worker.messages.length;
    await worker.send({type:'run', presets:{}, scaleIntervals:{}, sourceCode: `
      const gb = await createSoundChip('gameboy');
      gb.initialize(); gb.pulse.setVoice(0, {volume: 9, envelope: {period: 2}});
      gb.pulse.setNote(0, 'C4'); gb.pulse.keyOn(0);
    `});
    await waitFor(() => worker.messages.slice(from).some(m => m.command === 'pcm.create'));
    const req = worker.messages.slice(from).find(m => m.command === 'pcm.create');
    await worker.send({type:'response', id:req.id, value:{postMessage:m=>messages.push(m),close:()=>closed++}});
    assert.ok(messages.some(m=>m.method==='writeRegister' && m.args[0]===4 && (m.args[1]&128)));
    await worker.send({type:'stop'});
    assert.equal(messages.filter(m=>m.method==='dispose').length,1);
    assert.equal(closed,1);
  }
 });

test('Worker useSoundChip aliases global FM, permits const fm, reuses on reevaluation and forwards play',async()=>{
 const worker=createWorkerHarness();
 const source=`const fm = await useSoundChip('ym2612');
 const pair=await Promise.all([useSoundChip('ym2612'),useSoundChip('ym2612')]);
 if(pair[0]!==fm || pair[1]!==fm || (context.fm && context.fm!==fm))throw Error('identity');
 context.fm=fm;fm.setPreset(CH1,FM_PRESETS['one-op-basic']);await play('C4',{channel:CH1,duration:0.001});`;
 try {
  for(let i=0;i<2;i++) {
   await worker.send({type:'run',sourceCode:source,presets:{'one-op-basic':{}},capabilities:{chip:'ym2612'}});
   await waitFor(()=>worker.messages.filter(m=>m.command==='play').length===i+1);
   await worker.send({type:'response',id:worker.messages.filter(m=>m.command==='play').at(-1).id});
   await waitFor(()=>worker.messages.filter(m=>m.type==='complete').length===i+1);
  }
  assert.equal(worker.messages.filter(m=>m.command==='fm.setPreset').length,2);
  assert.equal(worker.messages.filter(m=>m.command==='play').length,2);
  assert.equal(worker.messages.filter(m=>m.command==='pcm.create' || m.command==='fm.then').length,0);
 }finally{await worker.send({type:'stop'});}
});
for(const name of ['rf5c164','ym2608','gameboy','ym2203','ym2610','ym2612'])test(`Worker useSoundChip ${name} shares pending creation, reuses and disposes on Stop`,async()=>{
 const worker=createWorkerHarness(),sent=[];let closed=0;
 const port={start(){},postMessage:data=>sent.push(data),close(){closed++;}};
 const source=`const [a,b]=await Promise.all([useSoundChip('${name}'),useSoundChip('${name}')]);
 if(a!==b || (context.chip && context.chip!==a))throw Error('identity');context.chip=a;
 if('${name}'==='ym2608' && (typeof a.setClock!=='function'||typeof a.resetRegisters!=='function'))throw Error('Missing YM2608 import API');`;
 try {
  await worker.send({type:'run',capabilities:{chip:name==='ym2612'?'ym2203':'ym2612'},sourceCode:source});
  const requests=worker.messages.filter(m=>m.command==='pcm.create');assert.equal(requests.length,1);
  await worker.send({type:'response',id:requests[0].id,value:port});
  await waitFor(()=>worker.messages.some(m=>m.type==='complete'));
  await worker.send({type:'run',sourceCode:source});
  await waitFor(()=>worker.messages.filter(m=>m.type==='complete').length===2);
  assert.equal(worker.messages.filter(m=>m.command==='pcm.create').length,1);
 }finally{await worker.send({type:'stop'});}
 assert.equal(sent.filter(m=>m.method==='dispose').length,1);assert.equal(closed,1);
});
test('Worker late chip initialization after Stop is disposed and next run retries',async()=>{
 const worker=createWorkerHarness(),sent=[];let closed=0;
 const source=`await useSoundChip('rf5c164');`;
 await worker.send({type:'run',sourceCode:source});
 const pending=worker.messages.find(m=>m.command==='pcm.create');
 await worker.send({type:'stop'});
 await worker.send({type:'response',id:pending.id,value:{start(){},postMessage:m=>sent.push(m),close(){closed++;}}});
 await waitFor(()=>worker.messages.some(m=>m.type==='execution-error'));
 assert.equal(closed,1);assert.equal(sent[0].method,'dispose');
 await worker.send({type:'run',sourceCode:source});
 assert.equal(worker.messages.filter(m=>m.command==='pcm.create').length,2);
 const retry=worker.messages.filter(m=>m.command==='pcm.create').at(-1);
 await worker.send({type:'response',id:retry.id,error:'test init failure'});
 await worker.send({type:'stop'});
});


for(const name of ['ym2203','ym2610'])test(`Worker useSoundChip ${name} returns selected FM without creating an extra chip`,async()=>{
 const worker=createWorkerHarness();
 try {
  await worker.send({type:'run',capabilities:{chip:name},sourceCode:`
   const [a,b]=await Promise.all([useSoundChip('${name}'),useSoundChip('${name}')]);
   if(a!==fm || b!==fm)throw Error('identity');context.fm=a;a.keyOff(CH1);
  `});
  await waitFor(()=>worker.messages.some(m=>m.type==='complete'));
  await worker.send({type:'run',sourceCode:`const fm=await useSoundChip('${name}');if(fm!==context.fm)throw Error('reuse');fm.keyOff(CH1);`});
  await waitFor(()=>worker.messages.filter(m=>m.type==='complete').length===2);
  assert.equal(worker.messages.filter(m=>m.command==='fm.keyOff').length,2);
  assert.equal(worker.messages.filter(m=>m.command==='pcm.create'||m.command==='fm.then').length,0);
 }finally{await worker.send({type:'stop'});}
});

for (const name of ['ym2612', 'ym2203', 'ym2610']) test(`Worker creates independent ${name} clients and disposes both`, async () => {
 const worker = createWorkerHarness(), sent = [[], []];
 try {
  await worker.send({type: 'run', sourceCode: `const [a,b]=await Promise.all([createSoundChip('${name}'),createSoundChip('${name}')]);if(a===b||a===fm)throw Error('identity');a.noteOn(0,4,600);b.noteOff(0);`});
  const requests = worker.messages.filter(m=>m.command==='pcm.create');
  assert.equal(requests.length, 2);
  for (let i=0;i<2;i++) await worker.send({type:'response', id:requests[i].id, value:{start(){}, close(){}, postMessage:d=>sent[i].push(d)}});
  await waitFor(()=>worker.messages.some(m=>m.type==='complete'));
  assert.ok(sent.every(messages=>messages.some(m=>m.method==='write')));
 } finally { await worker.send({type:'stop'}); }
 assert.ok(sent.every(messages=>messages.filter(m=>m.method==='dispose').length===1));
});
