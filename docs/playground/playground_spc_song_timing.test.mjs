import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {buildSpcSongSource} from './playground_spc_song_source.js';
import {createPlaygroundClock,createSecondsTimeline} from '../../web/playground_clock.js';

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const DIRECTORY = '/spc/timing';

function densePerformance() {
  const clockRate = 1024000, initialDsp = new Uint8Array(128), events = [];
  const preset = {adsr1:0,adsr2:0,gain:127,volumeLeft:64,volumeRight:64};
  for (let channel = 0; channel < 8; channel++) events.push({
    type:'noteOn',clock:0,channel,sourceNumber:0,sampleId:0,pitch:4096,preset,
  });
  // Stagger the eight voices. Each individual voice changes only every 16 ms,
  // while the combined song needs one control dispatch every 2 ms.
  for (let index = 1; index < 500; index++) events.push({
    type:'pitch',clock:Math.round(index * .002 * clockRate),
    channel:index % 8,pitch:4096 + index,
  });
  for (let channel = 0; channel < 8; channel++) events.push({type:'noteOff',clock:clockRate,channel});
  return {version:1,clockRate,durationClocks:clockRate,initialDsp,events,
    samples:[{id:0,sourceNumber:0,brr:Uint8Array.of(3,0,0,0,0,0,0,0,0),loop:true,loopStartSamples:0}],
    warnings:[],controlStepMs:0,statistics:{rawWrites:events.length}};
}

async function executeWithSchedulingCost(generated, {stallAt = Infinity} = {}) {
  let seconds = 100, disposed = false, done = false, failure;
  const tasks = [], calls = [];
  const audio = {get currentTime() {return seconds;}};
  const setTimer = (fn, milliseconds) => {
    const task = {fn,at:seconds + Math.max(.004,milliseconds / 1000)};
    tasks.push(task); return task;
  };
  const clearTimer = task => {task.cancelled = true;};
  const createTaskChannel = () => {
    const channel = {port1:{close() {}},port2:{close() {},postMessage() {
      tasks.push({at:seconds + .00005,fn:() => channel.port1.onmessage()});
    }}};
    return channel;
  };
  const clock = createPlaygroundClock({
    runtime:{bpm:120,clockStartTime:null,sampleClockStartTime:null},
    getAudioContext:() => audio,getCurrentRunToken:() => 1,getCurrentLoopContext:() => null,
    setTimer,clearTimer,createTaskChannel,
  });
  const createTimeline = () => createSecondsTimeline({now:clock.nowSeconds,sleep:clock.sleep});
  const files = new Map(generated.files.map(entry => [entry.path,entry]));
  const file = async (relative,{type}) => {
    seconds += .025; // Assets are loaded before the musical origin is fixed.
    const entry = files.get(path.posix.resolve(DIRECTORY,relative));
    assert(entry);
    return type === 'json' ? JSON.parse(entry.data) : entry.data.slice().buffer;
  };
  const snes = new Proxy({}, {get(_,method) {
    if (method === 'then') return undefined;
    if (method === 'dispose') return () => {disposed = true;};
    return (...args) => {
      calls.push({method,args,at:seconds});
      // Validation and MessagePort copying cost time even with an idle DSP.
      seconds += method === 'loadBRR' ? .015 : .0002;
      return method === 'loadBRR' ? {id:0} : undefined;
    };
  }});
  const play = new AsyncFunction('createSoundChip','file','sleep','createTimeline',generated.source)(
    async () => snes,file,clock.sleep,createTimeline,
  ).then(() => {done = true;},error => {failure = error; done = true;});
  let stalled = false;
  for (let iteration = 0; iteration < 10000 && !done; iteration++) {
    for (let microtask = 0; microtask < 16; microtask++) await Promise.resolve();
    if (done) break;
    tasks.sort((left,right) => left.at - right.at);
    const task = tasks.shift();
    if (!task || task.cancelled) continue;
    seconds = Math.max(seconds,task.at);
    const first = calls.find(call => call.method === 'keyOn');
    if (!stalled && first && seconds - first.at >= stallAt) {seconds += .075; stalled = true;}
    task.fn();
  }
  assert(done,`Generated song must finish under the bounded simulated scheduler (${JSON.stringify({seconds,calls:calls.length,lastCall:calls.at(-1),tasks:tasks.length})})`);
  await play;
  if (failure) throw failure;
  assert(disposed,'Generated song must release its instrument after completion');
  return {calls};
}

for (const stallAt of [Infinity,.4]) {
  test(`dense readable song keeps one-second duration despite dispatch cost${stallAt < Infinity ? ' and a 75 ms UI stall' : ''}`, async t => {
    const performance = densePerformance();
    const generated = buildSpcSongSource(performance,DIRECTORY);
    const {calls} = await executeWithSchedulingCost(generated,{stallAt});
    const starts = calls.filter(call => call.method === 'keyOn');
    const stops = calls.filter(call => call.method === 'keyOff');
    const pitches = calls.filter(call => call.method === 'setPitch');
    assert.equal(starts.length,8); assert.equal(stops.length,8);
    assert.equal(pitches.length,507,'All meaningful changes survive catch-up; this is not event truncation');
    const duration = stops.at(-1).at - starts[0].at;
    assert(duration >= .99 && duration <= 1.025,
      `A one-second song took ${duration.toFixed(6)} s; event/timer delays must not accumulate into slow playback`);
    assert(starts.at(-1).at - starts[0].at <= .006,'Simultaneous voices must stay grouped');
    assert(stops.at(-1).at - stops[0].at <= .003,'Simultaneous note-offs must stay grouped');
    t.diagnostic(JSON.stringify({requestedSeconds:1,measuredSeconds:duration,pitchOperations:pitches.length,stallSeconds:stallAt < Infinity ? .075 : 0}));
  });
}
