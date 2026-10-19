import {createSnesClient} from '../../web/playground_snes.js';
import {createPerformanceSender} from '../../web/playground_performance_sender.js';
import {midiToOpnPitch, opnPitchFromHz} from '../../web/soundchip_pitch.js';
import {CHIP_CLOCKS} from '../../web/playground_chip_clock.js';
import {createYm2151Client} from '../../web/playground_ym2151.js';
import {createDx7Client} from '../../web/playground_dx7.js';
import {serializeLogError} from '../../web/playground_log.js';
import {createSegaPsgClient} from '../../web/playground_segapsg.js';
import {resolvePlaySeconds,resolvePlayDuration} from '../../web/playground_duration.js';
import {createLoopAsyncTasks} from '../../web/playground_async_tasks.js';
import {createCycle, createPlaygroundMusic} from '../../web/playground_music.js';
import {createOpnClient} from '../../web/playground_opn.js';
import {createRf5c164Client} from '../../web/playground_rf5c164.js';
import {createYm2608Client} from '../../web/playground_ym2608.js';
import {createSoundChipRegistry} from '../../web/playground_soundchips.js';
import {createGameboyClient} from '../../web/playground_gameboy.js';
import {createNativeSampleController} from "../../web/native_sample.js";
import {createNativeNoiseController, controlNativeNoise} from "../../web/native_noise.js";
import {createNativeFXController,createLiveFxLifecycle} from "../../web/native_fx.js";
import {createWorkerDac} from "../../web/playground_worker_dac.js";
import {createWorkerChip} from "../../web/playground_worker_chip.js";
import {createMidiApi, createMidiRack} from "../js/playground_midi.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { hzToBlockFnum } from "../js/pitch.js";
import {createDeadlineScheduler,createBeatClock,runTween} from '../js/playground_clock.js';

const workerSource = readFileSync(
  new URL("../js/playground_logic_worker.js", import.meta.url),
  "utf8"
);

function createWorkerHarness(overrides = {}) {
  const messages = [];
  const context = {
    createPerformanceSender, serializeLogError,
    midiToOpnPitch, opnPitchFromHz, CHIP_CLOCKS, resolvePlaySeconds, resolvePlayDuration, createBeatClock, runTween, createNativeSampleController, createNativeNoiseController, controlNativeNoise, createWorkerDac, atob, createMidiApi, createMidiRack, createWorkerChip, createNativeFXController, createLiveFxLifecycle, DOMException, structuredClone,
    createSnesClient, createDx7Client, createYm2151Client, createSegaPsgClient, createLoopAsyncTasks, createCycle, createDeadlineScheduler, createOpnClient, createGameboyClient, createSoundChipRegistry, createRf5c164Client, createYm2608Client,
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
    ...overrides,
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

function createTimedWorkerHarness(start = 10) {
  let time = start;
  const tasks = new Set();
  const worker = createWorkerHarness({
    performance: { timeOrigin: 0, now: () => time * 1000 },
    createPerformanceSender: options => createPerformanceSender({...options, now: () => time * 1000}),
    consumeSetupTime(seconds) { time += seconds; },
    setTimeout(fn, ms) {
      const task = { fn, at: time + Math.max(0, ms) / 1000 };
      tasks.add(task);
      return task;
    },
    clearTimeout: task => tasks.delete(task),
  });
  const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  return {
    worker,
    now: () => time,
    logs: () => worker.messages.filter(message => message.command === 'log').map(message => message.args),
    async advance(seconds) {
      const target = time + seconds;
      for (let count = 0; count < 10000; count++) {
        await flush();
        const next = [...tasks].sort((a, b) => a.at - b.at)[0];
        if (!next || next.at > target) {
          time = Math.max(time, target);
          await flush();
          if (![...tasks].some(task => task.at <= target)) return;
          continue;
        }
        tasks.delete(next);
        time = Math.max(time, next.at);
        next.fn();
      }
      assert.fail('Worker generated an unbounded burst of expired waits');
    },
    async run(sourceCode, lookaheadSeconds = 0, runOptions = {}) {
      worker.post({ type: 'run', presets: {}, scaleIntervals: {}, timing: { lookaheadSeconds }, sourceCode, ...runOptions });
      await this.advance(0);
      const error = worker.messages.find(message => message.type === 'execution-error');
      assert.equal(error, undefined, error?.message);
    },
    async stop() { worker.post({ type: 'stop' }); await this.advance(0); },
  };
}

function mainCycle(loop = null) {
  return createPlaygroundMusic({
    noteToSemitone: {}, scaleIntervals: {}, synth: () => null, presets: {},
    activeNotes: new Set(), sleep: async () => {}, getCurrentLoopContext: () => loop,
  }).cycle;
}

test('Worker cycles three- and four-item sequences independently across loop iterations like Main', async () => {
  const f = createTimedWorkerHarness();
  try {
    await f.run(`let iteration=0; liveLoop('lead', async () => {
      console.log('cycles', cycle([.04,.04,.08]), cycle(['C','D','E','F']));
      await sleep(.01); if(++iteration===12)stopLoop('lead');
    });`);
    await f.advance(.121);
    const loop = {cycleState: new Map(), cycleCallIndex: 0}, cycle = mainCycle(loop);
    const expected = Array.from({length: 12}, () => {
      loop.cycleCallIndex = 0;
      return [cycle([.04,.04,.08]), cycle(['C','D','E','F'])];
    });
    assert.deepEqual(f.logs().filter(args => args[0] === 'cycles').map(args => [...args].slice(1)), expected);
    assert.deepEqual(expected.slice(0, 4), [[.04, 'C'], [.04, 'D'], [.08, 'E'], [.04, 'F']]);
  } finally { await f.stop(); }
});

test('Worker unnamed call slots remain independent even when their arrays have identical values', async () => {
  const f = createTimedWorkerHarness();
  try {
    await f.run(`let iteration=0; liveLoop('lead', async () => {
      console.log('slots', cycle([10,20,30]));
      await sleep(.001);
      console.log('slots', cycle([10,20,30]));
      await sleep(.001); if(++iteration===4)stopLoop('lead');
    });`);
    await f.advance(.01);
    assert.deepEqual(f.logs().map(args => args[1]), [10,10,20,20,30,30,10,10]);
  } finally { await f.stop(); }
});

test('Worker sibling loops keep separate sequence positions across asynchronous waits', async () => {
  const f = createTimedWorkerHarness();
  try {
    await f.run(`let a=0,b=0;
      liveLoop('a', async () => {
        console.log('a', cycle([1,2,3])); await sleep(.01);
        console.log('a-after',cycle(['a','b'])); if(++a===5)stopLoop('a');
      });
      liveLoop('b', async () => {
        console.log('b', cycle([1,2,3])); await sleep(.015);
        console.log('b-after',cycle(['a','b'])); if(++b===3)stopLoop('b');
      });`);
    await f.advance(.06);
    const values = label => f.logs().filter(args => args[0] === label).map(args => args[1]);
    assert.deepEqual(values('a'), [1,2,3,1,2]);
    assert.deepEqual(values('b'), [1,2,3]);
    assert.deepEqual(values('a-after'), ['a','b','a','b','a']);
    assert.deepEqual(values('b-after'), ['a','b','a']);
  } finally { await f.stop(); }
});

test('Worker named cycles share their key within a loop without consuming unnamed slots', async () => {
  const f = createTimedWorkerHarness();
  try {
    await f.run(`let iteration=0; liveLoop('lead', async () => {
      console.log('named', cycle('notes',[1,2,3]), cycle(['x','y']), cycle('notes',[1,2,3]));
      await sleep(.01); if(++iteration===4)stopLoop('lead');
    });`);
    await f.advance(.041);
    const loop = {cycleState: new Map(), cycleCallIndex: 0}, cycle = mainCycle(loop);
    const expected = Array.from({length: 4}, () => {
      loop.cycleCallIndex = 0;
      return [cycle('notes',[1,2,3]), cycle(['x','y']), cycle('notes',[1,2,3])];
    });
    assert.deepEqual(f.logs().map(args => [...args].slice(1)), expected);
    assert.deepEqual(expected, [[1,'x',2],[3,'y',1],[2,'x',3],[1,'y',2]]);
  } finally { await f.stop(); }
});

test('Worker global cycles match Main and start fresh for each source evaluation', async () => {
  const f = createTimedWorkerHarness();
  const source = `console.log('global', cycle([1,2,3]),cycle([1,2,3]),cycle([1,2,3]),cycle([1,2,3]),cycle('named',['a','b']),cycle('named',['a','b']));`;
  try {
    await f.run(source);
    await f.run(source);
    const cycle = mainCycle();
    const expected = [cycle([1,2,3]),cycle([1,2,3]),cycle([1,2,3]),cycle([1,2,3]),cycle('named',['a','b']),cycle('named',['a','b'])];
    assert.deepEqual(f.logs().map(args => [...args].slice(1)), [expected, expected]);
    assert.deepEqual(expected, [1,2,3,1,'a','b']);
  } finally { await f.stop(); }
});

test('Worker same-name Run replacement preserves loop sequence positions until Stop', async () => {
  const f = createTimedWorkerHarness();
  try {
    await f.run(`liveLoop('lead',async()=>{
      console.log('old',cycle([1,2,3,4])); await sleep(.1);
    });`);
    await f.advance(.025);
    await f.run(`let iteration=0; liveLoop('lead',async()=>{
      console.log('new',cycle([1,2,3,4])); await sleep(.1);
      if(++iteration===4)stopLoop('lead');
    });`);
    assert.deepEqual(f.logs().map(args => [...args]), [['old',1]]);
    await f.advance(.476);
    assert.deepEqual(f.logs().map(args => [...args]), [['old',1],['new',2],['new',3],['new',4],['new',1]]);
    await f.stop();
    await f.run(`liveLoop('lead',async()=>{
      console.log('restarted',cycle([1,2,3,4]));stopLoop('lead');
    });`);
    assert.deepEqual([...f.logs().at(-1)], ['restarted',1]);
  } finally { await f.stop(); }
});

test('Worker note/rest pattern uses the same .04/.04/.08 beat sequence and timing as Main', async () => {
  const f = createTimedWorkerHarness();
  const commands = [];
  f.worker.post({type: 'chip-port', port: {postMessage: batch => commands.push(...batch), close() {}}});
  try {
    await f.run(`setBpm(120);let iteration=0;liveLoop('lead',async()=>{
      await play('E4',{channel:CH1,duration:.08});
      const rest=cycle([.04,.04,.08]);console.log('rest',rest,performance.now()/1000);
      await beat(rest);if(++iteration===6)stopLoop('lead');
    });`);
    await f.advance(.65);
    const loop = {cycleState: new Map(), cycleCallIndex: 0}, cycle = mainCycle(loop);
    let time = 10;
    const expected = Array.from({length: 6}, () => {
      loop.cycleCallIndex = 0;
      const rest = cycle([.04,.04,.08]);
      time += .08;
      const result = ['rest', rest, time];
      time += rest * .5;
      return result;
    });
    assert.equal(f.logs().length, expected.length);
    f.logs().forEach((args, i) => {
      assert.deepEqual([...args].slice(0,2), expected[i].slice(0,2));
      assert(Math.abs(args[2] - expected[i][2]) < 1e-8, `note ${i+1} timing`);
    });
    assert.equal(commands.filter(command => command.type === 'write' && command.register === 0x28 && command.value === 0xf0).length, 6);
  } finally { await f.stop(); }
});

test('Worker cycle rejects invalid sequences with the same error as Main', async () => {
  const f = createTimedWorkerHarness();
  try {
    await f.run(`for(const value of [[],null,3]){
      try{cycle(value);}catch(error){console.log('invalid',error.message);}
    }try{cycle('key',[]);}catch(error){console.log('invalid',error.message);}`);
    const cycle = mainCycle();
    const expected = [[], null, 3].map(value => {
      try { cycle(value); } catch (error) { return error.message; }
    });
    try { cycle('key', []); } catch (error) { expected.push(error.message); }
    assert.deepEqual(f.logs().map(args => args[1]), expected);
    assert(expected.every(message => message === 'cycle() requires a non-empty array'));
  } finally { await f.stop(); }
});

for (const lookahead of [0, .25]) test(`Worker sample/file/sample switch avoids expired-write bursts (lookahead ${lookahead}s)`, async () => {
  const f = createTimedWorkerHarness();
  try {
    await f.run(`liveLoop('vgm', async () => {
      await sleepSamples(441); console.log('old', performance.now()/1000);
      await sleepSamples(441000); console.log('cancelled');
    });`, lookahead);
    await f.advance(lookahead + .01);
    assert.equal(f.logs().filter(args => args[0] === 'old').length, 1);
    await f.run(`liveLoop('other-file', async () => { await sleep(60); });`, lookahead);
    await f.advance(20 - f.now());
    await f.run(`liveLoop('vgm', async () => {
      for (let i=0;i<4;i++) {
        await sleepSamples(441); console.log('new', performance.now()/1000);
      }
      stopLoop('vgm');
    });`, lookahead);
    const events = () => f.logs().filter(args => args[0] === 'new');
    assert.equal(events().length, 0);
    await f.advance(lookahead + .009);
    assert.equal(events().length, 0, 'fresh writes must wait instead of catching up to the old origin');
    for (let i = 1; i <= 4; i++) {
      await f.advance(i === 1 ? .002 : .01);
      assert.equal(events().length, i, 'only one new 10ms event is due');
      assert.ok(Math.abs(events().at(-1)[1] - (20 + lookahead + i * .01)) < 1e-10);
    }
    assert.ok(!f.logs().some(args => args[0] === 'cancelled'));
    assert.ok(!f.worker.messages.some(message => message.type === 'log' && message.level === 'error'));
  } finally { await f.stop(); }
});

test('Worker sibling sample loops share the commit origin despite synchronous setup work', async () => {
  const f = createTimedWorkerHarness();
  try {
    await f.run(`liveLoop('old', async () => { await sleepSamples(4410000); });`, .25);
    await f.advance(10);
    await f.run(`
      liveLoop('first', async () => {
        console.log('position', 'first', beginSampleSchedule());
        const wait=sleepSamples(441); consumeSetupTime(.003); await wait;
        console.log('event', 'first', performance.now()/1000); stopLoop('first');
      });
      liveLoop('second', async () => {
        console.log('position', 'second', beginSampleSchedule());
        await sleepSamples(441);
        console.log('event', 'second', performance.now()/1000); stopLoop('second');
      });
    `, .25);
    const positions = f.logs().filter(args => args[0] === 'position');
    assert.deepEqual(positions.map(args => args[2]), [441000, 441000]);
    await f.advance(.26);
    const events = f.logs().filter(args => args[0] === 'event');
    assert.deepEqual(events.map(args => args[1]), ['first', 'second']);
    for (const [, , at] of events) assert.ok(Math.abs(at - 20.26) < 1e-10);
  } finally { await f.stop(); }
});

test('Worker same-name replacement preserves the current sample iteration and cursor', async () => {
  const f = createTimedWorkerHarness();
  try {
    await f.run(`liveLoop('vgm', async () => {
      console.log('old-start', performance.now()/1000);
      await sleepSamples(4410); console.log('old-middle', performance.now()/1000);
      await sleepSamples(4410); console.log('old-end', performance.now()/1000);
    });`, .25);
    await f.advance(.025);
    await f.run(`liveLoop('vgm', async () => {
      console.log('new-start', performance.now()/1000, beginSampleSchedule());
      await sleepSamples(441); console.log('new-end', performance.now()/1000); stopLoop('vgm');
    });`, .25);
    assert.deepEqual(f.logs().map(args => args[0]), ['old-start']);
    await f.advance(.326);
    assert.deepEqual(f.logs().map(args => args[0]), ['old-start', 'old-middle']);
    await f.advance(.1);
    assert.deepEqual(f.logs().map(args => args[0]), ['old-start', 'old-middle', 'old-end', 'new-start']);
    const start = f.logs().find(args => args[0] === 'new-start');
    assert.ok(Math.abs(start[1] - 10.45) < 1e-10);
    assert.equal(start[2], 8820);
    await f.advance(.01);
    const end = f.logs().find(args => args[0] === 'new-end');
    assert.ok(Math.abs(end[1] - 10.46) < 1e-10);
  } finally { await f.stop(); }
});

test('Worker shared tempo retimes beat, tween, direct FM and MIDI notes while seconds stay fixed',async()=>{
  let time=0;const tasks=new Set(),commands=[];
  const worker=createWorkerHarness({performance:{now:()=>time*1000},
    setTimeout(fn,ms){const entry={fn,at:time+ms/1000};tasks.add(entry);return entry;},
    clearTimeout:entry=>tasks.delete(entry),
  });
  async function advance(seconds){
    const target=time+seconds;
    for(let count=0;count<10000;count++){
      for(let i=0;i<50;i++)await Promise.resolve();
      const next=[...tasks].sort((a,b)=>a.at-b.at)[0];
      if(!next||next.at>target){time=target;for(let i=0;i<50;i++)await Promise.resolve();return;}
      tasks.delete(next);time=next.at;next.fn();
    }
    assert.fail('Worker clock did not advance');
  }
  worker.post({type:'chip-port',port:{postMessage:batch=>commands.push(...batch),close(){}}});
  worker.post({type:'run',presets:{},scaleIntervals:{},capabilities:{chip:'ym2612',fmChannels:6,dac:true},sourceCode:`
    setBpm(120);
    const output=midi.output('tetorica-ym2612');
    await Promise.all([
      beat(1).then(()=>console.log('beat',performance.now()/1000)),
      tween({beats:1},progress=>{if(progress===1)console.log('tween',performance.now()/1000);}),
      play('C4',{beats:1}).then(()=>console.log('fm',performance.now()/1000)),
      output.play('E4',{beats:1}).then(()=>console.log('midi',performance.now()/1000)),
      sleep(.5).then(()=>console.log('seconds',performance.now()/1000)),
      sleepSamples(48000/2,48000).then(()=>console.log('samples',performance.now()/1000))
    ]);
  `});
  await advance(.25);worker.post({type:'tempo',bpm:60});await advance(.25);
  let logs=worker.messages.filter(message=>message.command==='log');
  assert.deepEqual(logs.map(message=>message.args[0]).sort(),['samples','seconds']);
  await advance(.25);
  logs=worker.messages.filter(message=>message.command==='log');
  for(const name of ['beat','tween','fm','midi']){
    const log=logs.find(message=>message.args[0]===name);assert(log,name);assert(Math.abs(log.args[1]-.75)<1e-8,name);
  }
  assert(worker.messages.some(message=>message.type==='tempo'&&message.bpm===60));
  worker.post({type:'stop'});await advance(0);
});

test('Worker console preserves errors across the message boundary', async () => {
  const worker = createWorkerHarness();
  await worker.send({type: 'run', presets: {}, scaleIntervals: {}, sourceCode: 'console.log(new Error("OPM failure")); console.error(new DOMException("Run stopped", "AbortError"));'});
  const logs = structuredClone(worker.messages.filter(message => message.command === 'log' || message.command === 'error'));
  assert.ok(logs.some(message => message.command === 'log' && message.args[0].includes('Error: OPM failure')));
  assert.ok(logs.some(message => message.command === 'error' && message.args[0].includes('AbortError: Run stopped')));
  await worker.send({type: 'stop'});
});

test('Worker liveLoop preserves an error message omitted from a WebKit stack', async () => {
  const worker = createWorkerHarness();
  try {
    await worker.send({type: 'run', sourceCode: `liveLoop('choir', async () => {
      const error = new Error('Unknown sample: sonic-pi/ambi-choir');
      error.stack = 'playSample@tauri://localhost/js/tetorica_audio_runtime.js:427:33';
      throw error;
    });`});
    await waitFor(() => worker.messages.some(message => message.type === 'log'));
    const log = worker.messages.find(message => message.type === 'log');
    assert.equal(log.message, '[liveLoop:choir] Error: Unknown sample: sonic-pi/ambi-choir\nplaySample@tauri://localhost/js/tetorica_audio_runtime.js:427:33');
  } finally { await worker.send({type: 'stop'}); }
});

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

test('Stop before Worker run initialization cancels that run and permits restart', async () => {
  const worker=createWorkerHarness();
  worker.post({type:'run',sourceCode:'console.log("old run");',presets:{},scaleIntervals:{}});
  worker.post({type:'stop'});
  await waitFor(()=>worker.messages.some(message=>message.type==='stopped'));
  await worker.send({type:'run',sourceCode:'liveLoop("new",async()=>{console.log("new run");await sleep(60);});',presets:{},scaleIntervals:{}});
  assert.ok(!worker.messages.some(message=>message.command==='log'&&message.args[0]==='old run'));
  assert.ok(worker.messages.some(message=>message.command==='log'&&message.args[0]==='new run'));
  assert.ok(worker.messages.some(message=>message.type==='complete'&&message.loopCount===1));
  await worker.send({type:'stop'});
});

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

test('Worker rerun prunes old liveFx while its loop finishes and keeps cached preparation', async()=>{
 const worker=createWorkerHarness(),fxMessages=[];
 await worker.send({type:'native-fx',port:{postMessage:data=>fxMessages.push(data),close(){}}});
 const source=`await livePrepare('fx-resource',({fx})=>{fx.liveFx('distortion',{process(input,output){output.forEach((channel,c)=>channel.set(input[c]));}});return {};});liveLoop('lead',async()=>{console.log('old-start');await sleep(.08);console.log('old-end');await sleep(.04);});`;
 try {
  await worker.send({type:'run',sourceCode:source});
  await worker.send({type:'run',sourceCode:source});
  assert.equal(fxMessages.filter(m=>m.op==='live-fx'&&m.action==='register').length,1);
  await worker.send({type:'run',sourceCode:`liveLoop('lead',async()=>{console.log('new-start');await sleep(60);});`});
  assert(fxMessages.some(m=>m.op==='live-fx'&&m.action==='remove'&&m.name==='distortion'));
  assert(!worker.messages.some(m=>m.command==='audio.stopAll'));
  await waitFor(()=>worker.messages.some(m=>m.command==='log'&&m.args[0]==='new-start'),1000);
  const logs=worker.messages.filter(m=>m.command==='log').map(m=>m.args[0]);
  assert(logs.indexOf('old-end')<logs.indexOf('new-start'));
 } finally {await worker.send({type:'stop'});}
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
for(const name of ['rf5c164','ym2608','gameboy','ym2203','ym2610','ym2612','segapsg','ym2151','dx7','snes'])test(`Worker useSoundChip ${name} shares pending creation, reuses and disposes on Stop`,async()=>{
 const worker=createWorkerHarness(),sent=[];let closed=0;
 const port={start(){},postMessage:data=>sent.push(data),close(){closed++;}};
 const source=`const [a,b]=await Promise.all([useSoundChip('${name}'),useSoundChip('${name}')]);
 if(a!==b || (context.chip && context.chip!==a))throw Error('identity');context.chip=a;
 if('${name}'==='snes' && (typeof a.loadBRR!=='function'||typeof a.writeDsp!=='function'))throw Error('Missing SNES DSP API');
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

test('selected YM2608 Worker preserves the shared full client through reevaluation and Stop',async()=>{
 const worker=createWorkerHarness({Uint8Array}),ports=[];
 const source=`
  const [opna,again]=await Promise.all([useSoundChip('ym2608'),useSoundChip('ym2608')]);
  if(opna!==again||opna===fm||(context.opna&&context.opna!==opna))throw Error('Full-client identity');
  if(typeof opna.setAlgo!=='function'||!opna.ssg||!opna.rhythm||!opna.adpcm)throw Error('Missing OPNA controls');
  context.opna=opna;await opna.setClock(7987200);
  opna.resetRegisters();opna.rhythm.setVolume(40);
  await opna.adpcm.loadMemory(new Uint8Array([0x12]),8);
  await opna.prepareTimeline([[0,0,8,15]],[],1);await opna.playTimeline();
 `;
 try {
  for(let run=0;run<2;run++) {
   const from=worker.messages.length;
   await worker.send({type:'run',capabilities:{chip:'ym2608',fmChannels:6,psg:false,dac:false},sourceCode:source});
   const requests=worker.messages.slice(from).filter(message=>message.command==='pcm.create');
   assert.equal(requests.length,1);
   const commands=[];let closed=0;
   const port={start(){},close(){closed++;},postMessage(message){commands.push(message);if(message.id)queueMicrotask(()=>port.onmessage({data:{id:message.id}}));}};
   ports.push({commands,get closed(){return closed;}});
   await worker.send({type:'response',id:requests[0].id,value:port});
   await waitFor(()=>worker.messages.slice(from).some(message=>message.type==='complete'));
   await worker.send({type:'run',sourceCode:source});
   await waitFor(()=>worker.messages.slice(from).filter(message=>message.type==='complete').length===2);
   assert.equal(worker.messages.slice(from).filter(message=>message.command==='pcm.create').length,1);
   for(const method of ['clock','memory','prepareTimeline','playTimeline'])assert.equal(commands.filter(command=>command.method===method).length,2,method);
   assert.equal(commands.filter(command=>command.method==='reset').length,3); // Constructor plus both evaluations.
   await worker.send({type:'stop'});
   assert.equal(commands.filter(command=>command.method==='dispose').length,1);assert.equal(closed,1);
  }
 }finally{await worker.send({type:'stop'});}
 assert.equal(ports.length,2);
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

for(const method of ['sleep','sleepSamples','beat'])test(`Worker tracked error interrupts ${method} and does not retry`,async()=>{
 const worker=createWorkerHarness();
 await worker.send({type:'run',sourceCode:`liveLoop('upload',async()=>{console.log('entered');pg.trackAsync(new Promise((_,reject)=>setTimeout(()=>reject(new Error('memory failed')),10)));await ${method}(600000);console.log('after');});`});
 await waitFor(()=>worker.messages.some(m=>m.type==='log'&&m.message.includes('memory failed')));
 await new Promise(r=>setTimeout(r,25));
 assert.equal(worker.messages.filter(m=>m.command==='log'&&m.args?.[0]==='entered').length,1);
 assert.equal(worker.messages.filter(m=>m.command==='log'&&m.args?.[0]==='after').length,0);
 await worker.send({type:'stop'});
});

test('Worker fallback preserves beat length for tempo-aware Main playback',async()=>{
 const worker=createWorkerHarness();
 await worker.send({type:'run',presets:{},scaleIntervals:{},sourceCode:"setBpm(240); await play('C4', {beats: 2});"});
 const request=worker.messages.find(m=>m.type==='request'&&m.command==='play');
 assert.equal(request.args[1].beats,2);assert.equal(request.args[1].seconds,undefined);
 await worker.send({type:'response',id:request.id,result:null});await worker.send({type:'stop'});
});
test('Worker direct play rejects conflicting units before register writes',async()=>{
 const worker=createWorkerHarness(),commands=[];
 await worker.send({type:'chip-port',port:{postMessage:batch=>commands.push(...batch),close(){}}});
 await worker.send({type:'run',presets:{},scaleIntervals:{},capabilities:{chip:'ym2612',fmChannels:6,dac:true},sourceCode:"await play('C4', {beats:1, seconds:1});"});
 assert.ok(worker.messages.some(m=>m.type==='execution-error'&&m.message.includes('only one')));
 assert.equal(commands.length,0);await worker.send({type:'stop'});
});

test('Worker fallback pitch helpers use numeric clock metadata and await setClock replies',async()=>{
 const worker=createWorkerHarness();
 worker.post({type:'run',capabilities:{chip:'ym2612'},timing:{chipClock:7670454},sourceCode:`
  console.log('before',JSON.stringify(noteToBlockFnum('A4')));
  await fm.setClock(3835227);
  console.log('after',fm.clock,JSON.stringify(hzToBlockFnum(440)));
 `});
 await waitFor(()=>worker.messages.some(m=>m.command==='fm.setClock'));
 const request=worker.messages.find(m=>m.command==='fm.setClock');assert.ok(request.id);
 assert.ok(!worker.messages.some(m=>m.command==='log'&&m.args[0]==='after'));
 worker.post({type:'response',id:request.id});
 await waitFor(()=>worker.messages.some(m=>m.command==='log'&&m.args[0]==='after'));
 const before=worker.messages.find(m=>m.command==='log'&&m.args[0]==='before');
 const after=worker.messages.find(m=>m.command==='log'&&m.args[0]==='after');
 assert.deepEqual(JSON.parse(before.args[1]),midiToOpnPitch(69));
 assert.equal(after.args[1],3835227);assert.deepEqual(JSON.parse(after.args[2]),midiToOpnPitch(69,3835227));
 await worker.send({type:'stop'});
});

test('Worker remove/re-add starts a new runner while the old same-name cleanup is pending', async () => {
  let releaseOldCleanup, releaseNewIteration;
  const worker = createWorkerHarness({
    holdOldCleanup(resolve) { releaseOldCleanup = resolve; },
    holdNewIteration(resolve) { releaseNewIteration = resolve; },
  });
  const logCount = value => worker.messages.filter(message =>
    message.command === 'log' && message.args?.[0] === value).length;
  const run = sourceCode => worker.send({type: 'run', presets: {}, scaleIntervals: {}, sourceCode});
  try {
    await run(`liveLoop('x', async () => {
      console.log('old-enter');
      try { await sleep(100); }
      finally {
        await new Promise(holdOldCleanup);
        console.log('old-cleanup-finished');
      }
    });`);
    await waitFor(() => logCount('old-enter') === 1);
    await run('');
    await waitFor(() => typeof releaseOldCleanup === 'function');
    await run(`liveLoop('x', async () => {
      console.log('new-enter');
      await new Promise(holdNewIteration);
      console.log('new-iteration-finished');
    });`);
    await waitFor(() => logCount('new-enter') === 1);
    assert.equal(logCount('old-cleanup-finished'), 0,
      'the new runner must start before the removed runner finishes its asynchronous cleanup');

    releaseOldCleanup();
    await waitFor(() => logCount('old-cleanup-finished') === 1);
    // Drain the old runner's catch/finally after its callback's final log.
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(logCount('new-enter'), 1, 'the old runner must not execute the replacement callback');
    await run(`liveLoop('x', async () => {
      console.log('updated-enter');
      await sleep(100);
    });`);
    assert.equal(logCount('updated-enter'), 0,
      'the old finally must not delete the replacement runner and cause an extra start on Run');

    releaseNewIteration();
    await waitFor(() => logCount('updated-enter') === 1);
    assert.equal(logCount('new-iteration-finished'), 1);
    assert.equal(logCount('old-enter'), 1);
    assert.ok(!worker.messages.some(message => message.type === 'execution-error'));
  } finally {
    releaseOldCleanup?.();
    releaseNewIteration?.();
    await worker.send({type: 'stop'});
  }
});

const performanceCapabilities = {chip: 'ym2612', fmChannels: 6, psg: true, dac: true};
function performanceClock(f, session = 1) {
  return {session, audioSeconds: 30, performanceEpochMs: f.now() * 1000, lookaheadSeconds: .15};
}
function commandPackets(packets, predicate) {
  return packets.filter(packet => packet.performance && packet.commands.some(predicate));
}

test('Worker performance mode stamps atomic FM, PSG and FX tempo commands against one audio anchor', async () => {
  const f = createTimedWorkerHarness(), chipPackets = [], fxPackets = [];
  f.worker.post({type: 'chip-port', port: {postMessage: data => chipPackets.push(data), start() {}, close() {}}});
  f.worker.post({type: 'native-fx', port: {postMessage: data => fxPackets.push(data), start() {}, close() {}}});
  try {
    await f.run(`setBpm(120); fm.setAlgo(CH1,7,0);
      liveLoop('lead',async()=>{fm.noteOn(CH1,'E4');psg.tone(PSG1,{period:400,attenuation:4});
      const filter=fx.filter({cutoff:1000});fx.setChain([filter]);setBpm(90);
      await sleep(.08);fm.keyOff(CH1);await sleep(100);});`, 0,
      {performance: performanceClock(f), capabilities: performanceCapabilities});
    const on = commandPackets(chipPackets, command => command.register === 0x28 && command.value === 0xf0)[0];
    assert.equal(on.performance.time, 30.15);
    assert.deepEqual(on.commands.map(command => command.register), [0xa4, 0xa0, 0x28]);
    const psg = commandPackets(chipPackets, command => command.type === 'psg-write');
    assert.ok(psg.length > 0);
    assert.ok(psg.every(packet => packet.performance.owner === on.performance.owner && packet.performance.time === on.performance.time));
    const tempo = commandPackets(fxPackets, command => command.op === 'tempo' && command.beatSeconds === 60 / 90)[0];
    assert.equal(tempo.performance.owner, on.performance.owner);
    assert.equal(tempo.performance.time, on.performance.time);
    await f.advance(.08);
    const off = commandPackets(chipPackets, command => command.register === 0x28 && command.value === 0)[0];
    assert.ok(Math.abs(off.performance.time - on.performance.time - .08) < 1e-12);
    assert.equal(off.performance.owner, on.performance.owner);
  } finally {await f.stop();}
});

test('Worker hot Run retains the continuing loop owner and cancels only removed future notes', async () => {
  const f = createTimedWorkerHarness(), packets = [];
  f.worker.post({type: 'chip-port', port: {postMessage: data => packets.push(data), start() {}, close() {}}});
  const options = {performance: performanceClock(f), capabilities: performanceCapabilities};
  try {
    await f.run(`liveLoop('lead',async()=>{fm.noteOn(CH1,'E4');await sleep(.08);fm.keyOff(CH1);await sleep(.02);});
      liveLoop('removed',async()=>{try{fm.noteOn(CH2,'G4');await sleep(100);}finally{fm.keyOff(CH2);}});`, 0, options);
    const leadOwner = commandPackets(packets, command => command.register === 0x28 && command.value === 0xf0)[0].performance.owner;
    const removedOwner = commandPackets(packets, command => command.register === 0x28 && command.value === 0xf1)[0].performance.owner;
    assert.notEqual(leadOwner, removedOwner);
    packets.length = 0;
    await f.run(`fm.setAlgo(CH1,6,0);liveLoop('lead',async()=>{fm.noteOn(CH1,'A4');await sleep(100);});`, 0, options);
    assert.ok(packets.some(packet => packet.type === 'performance-cancel-owner' && packet.owner === removedOwner));
    assert.ok(!packets.some(packet => packet.type === 'performance-cancel-owner' && packet.owner === leadOwner));
    assert.equal(commandPackets(packets, command => command.register === 0xb0)[0].performance.owner, 'script');
    assert.ok(!packets.some(packet => Array.isArray(packet) && packet.some(command => command.register === 0x28 && command.value === 1)),
      'canceled finally cannot send an unowned immediate key off');
    assert.ok(!commandPackets(packets, command => command.register === 0x28 && command.value === 0xf0).length);
    await f.advance(.1);
    const replacement = commandPackets(packets, command => command.register === 0x28 && command.value === 0xf0)[0];
    assert.equal(replacement.performance.owner, leadOwner);
    assert.equal(replacement.performance.session, 1);
  } finally {await f.stop();}
});

test('Worker Stop fences the old performance and the next Run starts a fresh session without delayed cleanup writes', async () => {
  const f = createTimedWorkerHarness(), packets = [];
  f.worker.post({type: 'chip-port', port: {postMessage: data => packets.push(data), start() {}, close() {}}});
  try {
    await f.run(`liveLoop('lead',async()=>{try{fm.noteOn(CH1,'E4');await sleep(100);}finally{fm.keyOff(CH1);}});`, 0,
      {performance: performanceClock(f, 1), capabilities: performanceCapabilities});
    await f.stop();
    assert.ok(packets.some(packet => packet.type === 'performance-stop' && packet.session === 1));
    assert.ok(packets.some(packet => Array.isArray(packet) && packet.some(command => command.type === 'clear-scheduled-writes')));
    packets.length = 0;
    await f.run(`liveLoop('lead',async()=>{fm.noteOn(CH1,'G4');await sleep(100);});`, 0,
      {performance: performanceClock(f, 2), capabilities: performanceCapabilities});
    const on = commandPackets(packets, command => command.register === 0x28 && command.value === 0xf0)[0];
    assert.equal(on.performance.session, 2);
    assert.ok(packets.filter(packet => packet.performance).every(packet => packet.performance.session === 2));
  } finally {await f.stop();}
});

test('Worker explicit DAC/sample schedules keep their own origin instead of receiving the performance lead twice', async () => {
  const f = createTimedWorkerHarness(), packets = [];
  f.worker.post({type: 'chip-port', port: {postMessage: data => packets.push(data), start() {}, close() {}}});
  try {
    await f.run(`await dac.loadBase64('tone','AAAAAIA=');beginSampleSchedule();
      scheduleWritesSamples(0,[[0,0,0x2b,128]]);dac.playStream('tone',{atSamples:0});fm.noteOn(CH1,'E4');`, .25,
      {performance: performanceClock(f), capabilities: performanceCapabilities});
    const immediate = packets.filter(Array.isArray).flat();
    assert.ok(immediate.some(command => command.type === 'load-dac-bank'));
    assert.ok(immediate.some(command => command.type === 'begin-sample-schedule' && command.lookaheadSeconds === .25));
    assert.ok(immediate.some(command => command.type === 'sample-writes' && command.entries[0].sample === 0));
    assert.ok(immediate.some(command => command.type === 'sample-dac-bank' && command.sample === 0));
    assert.ok(!commandPackets(packets, command => ['sample-writes', 'sample-dac-bank', 'load-dac-bank'].includes(command.type)).length);
    assert.equal(commandPackets(packets, command => command.register === 0x28)[0].performance.time, 30.15);
  } finally {await f.stop();}
});

test('Worker native sample RPC restores its loop owner before following FM, FX and noise commands', async () => {
  const f = createTimedWorkerHarness(), chipPackets = [], fxPackets = [];
  const fxPort = {start() {}, close() {}, postMessage(data) {
    fxPackets.push(data);
    if (data.op === 'sample' && data.action === 'load') {
      Promise.resolve().then(() => fxPort.onmessage({data: {op: 'sample-response', id: data.id, value: true}}));
    }
  }};
  f.worker.post({type: 'chip-port', port: {postMessage: data => chipPackets.push(data), start() {}, close() {}}});
  f.worker.post({type: 'native-fx', port: fxPort});
  try {
    await f.run(`await sample.load('tone','test.wav');
      liveLoop('a',async()=>{fm.keyOn(CH1);await sample.play('tone');
        fm.noteOn(CH1,'E4');fx.filter({cutoff:1234});noise.create({gain:.1});await sleep(100);});
      liveLoop('b',async()=>{fm.keyOn(CH2);await sleep(100);});`, 0,
      {performance: performanceClock(f), capabilities: performanceCapabilities});
    const decode = f.worker.messages.find(message => message.command === 'sample.decode');
    assert.ok(decode);
    f.worker.post({type: 'response', id: decode.id, value: {sampleRate: 48000, channels: [new Float32Array([0, .1, 0])]}});
    await f.advance(0);
    const playing = commandPackets(fxPackets, command => command.op === 'sample' && command.action === 'play')[0];
    assert.ok(playing);
    const a = commandPackets(chipPackets, command => command.register === 0x28 && command.value === 0xf0)[0].performance.owner;
    const b = commandPackets(chipPackets, command => command.register === 0x28 && command.value === 0xf1)[0].performance.owner;
    assert.notEqual(a, b); assert.equal(playing.performance.owner, a);
    const request = playing.commands[0];
    fxPort.onmessage({data: {op: 'sample-response', id: request.id, value: 19}});
    await f.advance(0);
    const after = commandPackets(chipPackets, command => command.register === 0xa4).at(-1);
    assert.equal(after.performance.owner, a);
    for (const packet of commandPackets(fxPackets, command => command.op === 'create' || command.op === 'noise')) {
      assert.equal(packet.performance.owner, a); assert.equal(packet.performance.time, after.performance.time);
    }
    assert.ok(!f.worker.messages.some(message => message.type === 'execution-error'));
  } finally {await f.stop();}
});

test('Worker independent DX7 RPC preserves its owner across a sibling loop and stamps following notes', async () => {
  const f = createTimedWorkerHarness(), chipPackets = [], dxPackets = [];
  const dxPort = {start() {}, close() {}, postMessage: data => dxPackets.push(data)};
  f.worker.post({type: 'chip-port', port: {postMessage: data => chipPackets.push(data), start() {}, close() {}}});
  try {
    await f.run(`const dx=await createSoundChip('dx7');
      liveLoop('a',async()=>{fm.keyOn(CH1);await dx.setFeedback(2);dx.noteOn(60,100);fm.noteOn(CH1,'E4');await sleep(100);});
      liveLoop('b',async()=>{fm.keyOn(CH2);await sleep(100);});`, 0,
      {performance: performanceClock(f), capabilities: performanceCapabilities});
    const create = f.worker.messages.find(message => message.command === 'pcm.create');
    assert.ok(create);
    f.worker.post({type: 'response', id: create.id, value: {port: dxPort, id: 'dx7:test', voices: [{index: 0, name: 'INIT'}], selectedVoice: 0}});
    await f.advance(0);
    const feedback = commandPackets(dxPackets, command => command.method === 'setFeedback')[0];
    assert.ok(feedback);
    const a = commandPackets(chipPackets, command => command.register === 0x28 && command.value === 0xf0)[0].performance.owner;
    const b = commandPackets(chipPackets, command => command.register === 0x28 && command.value === 0xf1)[0].performance.owner;
    assert.notEqual(a, b); assert.equal(feedback.performance.owner, a);
    dxPort.onmessage({data: {id: feedback.commands[0].id, value: {voices: [{index: 0, name: 'INIT'}], selectedVoice: 0}}});
    await f.advance(0);
    const on = commandPackets(dxPackets, command => command.method === 'noteOn')[0];
    assert.equal(on.performance.owner, a);
    const fm = commandPackets(chipPackets, command => command.register === 0xa4).at(-1);
    assert.equal(fm.performance.owner, a); assert.equal(fm.performance.time, on.performance.time);
  } finally {await f.stop();}
});

for (const [name, body, expectedErrors] of [
  ['canceled clock RPC', 'await fm.setClock(4000000);', 0],
  ['user cleanup exception', "throw new Error('cleanup failed');", 1],
]) test(`Worker Stop completes device teardown and subsequent cleanup after ${name}`, async () => {
  const f = createTimedWorkerHarness(), chipPackets = [], fxPackets = [];
  f.worker.post({type: 'chip-port', port: {postMessage: data => chipPackets.push(data), start() {}, close() {}}});
  f.worker.post({type: 'native-fx', port: {postMessage: data => fxPackets.push(data), start() {}, close() {}}});
  await f.run(`liveCleanup(['lead'],async()=>{console.log('first cleanup');${body}});
    liveCleanup(['lead'],()=>{console.log('next cleanup');});
    liveLoop('lead',async()=>{fm.noteOn(CH1,'E4');noise.create({gain:.1});await sleep(100);});`, 0,
    {performance: performanceClock(f), capabilities: performanceCapabilities});
  const chipBoundary = chipPackets.length, fxBoundary = fxPackets.length;
  await f.stop();
  assert.ok(f.worker.messages.some(message => message.type === 'stopped'), 'Stop must acknowledge without the Runtime timeout');
  assert.equal(f.logs().filter(args => args[0] === 'first cleanup').length, 1);
  assert.equal(f.logs().filter(args => args[0] === 'next cleanup').length, 1);
  const chipCleanup = chipPackets.slice(chipBoundary), fxCleanup = fxPackets.slice(fxBoundary);
  assert.ok(!chipCleanup.some(packet => packet.performance), 'late user commands cannot reserve new sound after Stop');
  assert.ok(chipCleanup.filter(Array.isArray).flat().some(command => command.type === 'clear-scheduled-writes'));
  assert.equal(chipCleanup.filter(Array.isArray).flat().filter(command => command.type === 'write' && command.register >= 0x40 && command.register <= 0x4e && command.value === 127).length, 24);
  assert.ok(fxCleanup.some(command => command.op === 'noise' && command.action === 'dispose'));
  assert.ok(fxCleanup.some(command => command.op === 'reset'));
  assert.ok(f.worker.messages.some(message => message.command === 'audio.stopAll'));
  const errors = f.worker.messages.filter(message => message.type === 'log' && message.level === 'error');
  assert.equal(errors.length, expectedErrors);
  if (expectedErrors) assert.match(errors[0].message, /cleanup failed/);
  try {
    await f.run(`liveLoop('fresh',async()=>{fm.noteOn(CH1,'G4');await sleep(100);});`, 0,
      {performance: performanceClock(f, 2), capabilities: performanceCapabilities});
    const on = commandPackets(chipPackets, command => command.register === 0x28 && command.value === 0xf0).at(-1);
    assert.equal(on.performance.session, 2);
  } finally {await f.stop();}
});
