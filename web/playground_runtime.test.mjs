import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { createPlaygroundRuntime } from './playground_runtime.js';
import {createNativeFXController} from './native_fx.js';
import {LiveFX} from './custom_fx.js';
import {createYm2608Client} from './playground_ym2608.js';
import {GameboySynth} from './gameboysynth.js';
import {YM2203Synth} from './ym2203synth.js';
import {YM2608Synth} from './ym2608synth.js';
import {YM2610BSynth, NeoGeoFMSynth} from './ym2610bsynth.js';

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail('Async boundary was not reached');
}
function setup(t, capabilities, runtimeOptions = {}) {
  const listeners = new Set(), statuses = [], logs = [];
  const previous = globalThis.window;
  globalThis.window = {
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn), setTimeout,
  };
  const media = () => ({ stop() {}, stopAll() {}, pause() {}, list: () => [], unload() {} });
  const megaDrive = {
    capabilities, state: 'idle', audioContext: { currentTime: 0 },
    fm: { setPreset() {}, noteOff() {} }, psg: {},
    sample: media(), stream: media(),
    async start() { this.state = 'ready'; }, async resume() {}, async close() {},
    clearFXChain: () => [],
  };
  const runtime = createPlaygroundRuntime({ megaDrive, guardExecution: false, onStatus: s => statuses.push(s), onLog: line => logs.push(line), ...runtimeOptions });
  t.after(() => {
    runtime.stop();
    globalThis.window = previous;
    delete globalThis.playgroundReview;
  });
  return { runtime, megaDrive, listeners, statuses, logs };
}

test('primary Game Boy exposes shared initialized controls without FM shortcuts and survives Stop', async t => {
  const {runtime,megaDrive}=setup(t,{chip:'gameboy',fmChannels:0,psg:false,dac:false});
  const writes=[];
  megaDrive.fm=null;
  megaDrive.gameboy=new GameboySynth({transport:{reset(){},writeRegister:(...args)=>writes.push(args)}});
  megaDrive.gameboy.initialize();
  await runtime.playSource(`
    const prepared=await livePrepare('gameboy',api=>({gameboy:api.gameboy,keys:Object.keys(api)}));
    if(gameboy!==pg.gameboy || prepared.gameboy!==gameboy || await useSoundChip('gameboy')!==gameboy)throw Error('Separate primary APU');
    if(typeof gameboy.dispose!=='undefined')throw Error('Primary lifetime leaked');
    for(const name of ['fm','psg','dac','midi','play','write','CH1','OP1','FM_PRESETS','noteToBlockFnum']) {
      if(name in pg || prepared.keys.includes(name))throw Error('OPN shortcut '+name);
    }
    if(typeof fm!=='undefined'||typeof play!=='undefined'||typeof write!=='undefined'||typeof CH1!=='undefined')throw Error('Unexpected OPN global');
    gameboy.pulse.setVoice(0,{volume:13}); gameboy.pulse.noteOn(0,'A4');
    gameboy.wave.noteOn('C3'); gameboy.noise.keyOn();
  `);
  assert.equal(runtime.fm,null); assert.equal(runtime.gameboy,megaDrive.gameboy);
  assert(writes.some(([reg,v])=>reg===4&&(v&128)));
  const before=writes.length;
  await runtime.stop();
  for(const register of [2,7,10,17])assert(writes.slice(before).some(([r,v])=>r===register&&v===0));
  const stopped=writes.length;
  await runtime.playSource(`gameboy.pulse.noteOn(0,'C4');`);
  assert(writes.slice(stopped).some(([reg,v])=>reg===2&&(v>>4)===13),'Stop retains pulse voice without initialize/reset');
});

test('stopping a Main Game Boy liveLoop releases its held voice', async t => {
  const {runtime,megaDrive}=setup(t,{chip:'gameboy',fmChannels:0,psg:false,dac:false});
  const writes=[];
  megaDrive.fm=null;
  megaDrive.gameboy=new GameboySynth({transport:{reset(){},writeRegister:(...args)=>writes.push(args)}});
  megaDrive.gameboy.initialize();
  writes.length=0;
  await runtime.playSource(`liveLoop('held',async()=>{gameboy.pulse.noteOn(0,'C4');await sleep(60);});`);
  await until(()=>writes.some(([r,v])=>r===4&&(v&128)));
  const before=writes.length;
  await runtime.playSource(`stopLoop('held');`);
  assert(writes.slice(before).some(([r,v])=>r===2&&v===0));
});

test('a stopped Main Game Boy loop cannot release the next script replacement note', async t => {
  const {runtime,megaDrive}=setup(t,{chip:'gameboy',fmChannels:0,psg:false,dac:false});
  const writes=[];
  megaDrive.fm=null;
  megaDrive.gameboy=new GameboySynth({transport:{reset(){},writeRegister:(...args)=>writes.push(args)}});
  megaDrive.gameboy.initialize(); writes.length=0;
  await runtime.playSource(`liveLoop('held',async()=>{gameboy.pulse.noteOn(0,'C4');try{await sleep(60);}finally{gameboy.pulse.keyOff(0);}});`);
  await until(()=>writes.some(([r,v])=>r===4&&(v&128)));
  const before=writes.length;
  await runtime.playSource(`gameboy.pulse.noteOn(0,'E4');stopLoop('held');`);
  await Promise.resolve();
  const replacement=writes.slice(before);
  assert(replacement.some(([r,v])=>r===4&&(v&128)));
  assert(!replacement.some(([r,v])=>r===2&&v===0),'retired loop cannot mute the script replacement');
});

test('primary OPNA exposes one shared SSG/rhythm/ADPCM API and Stop releases all sections', async t => {
  const {runtime, megaDrive} = setup(t, {chip:'ym2608', fmChannels:6, psg:false, dac:false});
  const writes = [], uploads = [], roms = [], canceled = [];
  megaDrive.fm = new YM2608Synth({transport:{reset() {},
    write:(port,register,value) => writes.push([port,register,value]), loadAdpcmMemory:(...args) => {uploads.push(args); return Promise.resolve();},
    loadRhythmRom:bytes => {roms.push(bytes); return Promise.resolve();}, cancelPending:reason => canceled.push(reason),
  }});
  await runtime.playSource(`
    const shared = await livePrepare('sections', ({ssg,rhythm,adpcm}) => ({ssg,rhythm,adpcm}));
    for (const name of ['ssg','rhythm','adpcm']) {
      if (shared[name] !== pg[name]) throw Error('Separate section ' + name);
    }
    if (ssg !== pg.ssg || rhythm !== pg.rhythm || adpcm !== pg.adpcm) throw Error('Separate global sections');
    const {setVolume} = ssg;
    setVolume(0, 12);
    ssg.noteOn(0, 'A4');
    await rhythm.loadRom(new ArrayBuffer(8192));
    rhythm.setVolume(48); rhythm.setVoice('snare', {volume:24, left:true, right:true}); rhythm.keyOn('snare');
    const sample = await adpcm.loadSample({channels:[new Float32Array([0,.5,-.5,0])],sampleRate:8000});
    adpcm.setVolume(180); adpcm.setPan(true,true); adpcm.keyOn({repeat:true});
    context.sections = [ssg,rhythm,adpcm];
  `);
  assert.equal(uploads.length, 1);
  assert.equal(roms.length, 1);
  assert(roms[0] instanceof Uint8Array);
  const before = writes.length;
  await runtime.stop();
  const stopWrites = writes.slice(before);
  for (let channel = 0; channel < 3; channel++) assert(stopWrites.some(([port,r,v]) => port === 0 && r === 8 + channel && v === 0));
  assert(stopWrites.some(([port,r,v]) => port === 0 && r === 0x10 && v === 0xbf));
  assert(stopWrites.some(([port,r,v]) => port === 1 && r === 0 && v === 1));
  assert.deepEqual(canceled, ['Run stopped']);
});

test('primary YM2203 exposes shared SSG tone/noise/envelope and Stop silences all three channels', async t => {
  const {runtime,megaDrive}=setup(t,{chip:'ym2203',fmChannels:3,psg:false,dac:false});
  const writes=[];
  megaDrive.fm=new YM2203Synth({transport:{reset(){},write(port,register,value){writes.push([port,register,value]);}}});
  await runtime.playSource(`
    const prepared=await livePrepare('ssg',({ssg})=>ssg);
    if(ssg!==pg.ssg || prepared!==ssg)throw Error('Separate SSG');
    if(typeof adpcm!=='undefined' || typeof rhythm!=='undefined')throw Error('Unexpected ADPCM/rhythm');
    ssg.tone(0,{frequency:440,volume:12});
    ssg.noise(1,{period:16,volume:8});
    ssg.setEnvelope({period:2000,shape:9});
    ssg.tone(2,{frequency:880,envelope:true});
  `);
  const core=megaDrive.fm;
  assert.equal(core.ssg.registers[0]|core.ssg.registers[1]<<8,Math.round((4000000/2)/(16*440)));
  assert.equal(core.ssg.registers[6],16);
  assert.equal(core.ssg.registers[10],16);
  const before=writes.length;
  runtime.stop();
  for(let ch=0;ch<3;ch++)assert(writes.slice(before).some(([p,r,v])=>p===0&&r===8+ch&&v===0));
  assert.deepEqual(core.ssg._getState().levels,[12,8,16],'Stop retains configured volume/envelope');
});

test('Stop during primary ADPCM decoding prevents a late memory upload or retrigger', async t => {
  const {runtime, megaDrive} = setup(t, {chip:'ym2608', fmChannels:6, psg:false, dac:false});
  const decoded = deferred(), uploads = [], writes = [];
  megaDrive.fm = new YM2608Synth({transport:{reset() {}, write:(port,register,value) => writes.push([port,register,value]),
    loadAdpcmMemory:(...args) => {uploads.push(args); return Promise.resolve();},
  }});
  globalThis.playgroundReview = {decode:decoded.promise, requested:false};
  const running = runtime.playSource(`
    try {
      await adpcm.loadSample(new Uint8Array([1,2,3]), {decodeAudio:() => {
        globalThis.playgroundReview.requested = true;
        return globalThis.playgroundReview.decode;
      }});
      adpcm.keyOn({repeat:true});
    } catch (error) { globalThis.playgroundReview.error = error.message; }
  `);
  await until(() => globalThis.playgroundReview.requested);
  await runtime.stop();
  const stoppedWrites = writes.length;
  decoded.resolve({channels:[new Float32Array([0,.5,-.5,0])],sampleRate:8000});
  await running;
  assert.equal(globalThis.playgroundReview.error, 'Run stopped');
  assert.equal(uploads.length, 0);
  assert.equal(writes.length, stoppedWrites);
});

for (const chip of ['ym2610','ym2610b']) test(`primary ${chip} exposes shared SSG and ADPCM-A/B and Stop releases every section`, async t => {
  const {runtime,megaDrive} = setup(t,{chip,fmChannels:chip==='ym2610'?4:6,psg:false,dac:false});
  const writes=[],uploads=[],canceled=[];
  const core=new YM2610BSynth({transport:{reset(){},
    write:(port,register,value)=>writes.push([port,register,value]),
    loadAdpcmMemory:(type,bytes,address)=>{uploads.push({type,bytes,address});return Promise.resolve();},
    cancelPending:reason=>canceled.push(reason),
  }});
  megaDrive.fm=chip==='ym2610'?new NeoGeoFMSynth(core):core;
  await runtime.playSource(`
    const shared=await livePrepare('sections',({ssg,adpcmA,adpcmB,adpcm})=>({ssg,adpcmA,adpcmB,adpcm}));
    if(adpcm!==adpcmB || pg.adpcm!==adpcmB)throw Error('ADPCM-B alias');
    for(const name of ['ssg','adpcmA','adpcmB','adpcm'])if(shared[name]!==pg[name])throw Error('Separate section '+name);
    if(ssg!==pg.ssg || adpcmA!==pg.adpcmA || adpcmB!==pg.adpcmB)throw Error('Separate globals');
    if(typeof rhythm!=='undefined')throw Error('Unexpected OPNA rhythm');
    ssg.noise(2,{period:16,volume:10});
    await adpcmA.loadMemory(new Uint8Array(256).fill(0x17),256);
    adpcmA.setVolume(48);adpcmA.setVoice(5,{volume:24,left:true,right:true});
    adpcmA.setSample(5,{start:256,end:512});adpcmA.keyOn(5);
    await adpcmB.loadMemory(new ArrayBuffer(256),512);
    adpcmB.setSample({start:512,end:768});adpcmB.setPlaybackRate(8000);
    adpcmB.setVolume(180);adpcmB.setPan(true,true);adpcmB.keyOn({repeat:true});
    fm.setAlgo(${chip==='ym2610'?3:5},7,0);
  `);
  assert.deepEqual(uploads.map(({type,address,bytes})=>[type,address,bytes.length]),[[0,256,256],[1,512,256]]);
  assert(writes.some(([port,r])=>port===1&&r===0xb2),'highest logical FM channel maps to hardware channel 5');
  const before=writes.length;
  runtime.stop();
  const stopped=writes.slice(before);
  for(let ch=0;ch<3;ch++)assert(stopped.some(([port,r,v])=>port===0&&r===8+ch&&v===0));
  assert(stopped.some(([port,r,v])=>port===1&&r===0&&v===0xbf));
  assert(stopped.some(([port,r,v])=>port===0&&r===0x10&&v===1));
  assert.deepEqual(canceled,['Run stopped']);
});

test('Worker playback defaults to 500 ms independently of the DAC scheduler', t => {
  const {runtime} = setup(t);
  assert.equal(runtime.getTiming().workerLookaheadSeconds, .5);
  runtime.setTiming({lookaheadSeconds:.04});
  assert.equal(runtime.getTiming().workerLookaheadSeconds, .5, 'the DAC scheduler setting is independent');
});

for (const seconds of [0, .15, .085, .5, 2]) test(`Worker playback retains the explicit ${seconds} second lead`, async t => {
  const {runtime} = setup(t, undefined, {workerLookaheadSeconds:seconds});
  assert.equal(runtime.getTiming().workerLookaheadSeconds, seconds);
  await runtime.stop();
  assert.equal(runtime.getTiming().workerLookaheadSeconds, seconds, 'Stop preserves the chosen lead');
});

test('chip inspector stays audio-free until initialization and retains subscriptions across finalize/reinitialize',async t=>{
  const {runtime,megaDrive}=setup(t);
  const subscribers=new Set();let starts=0;
  megaDrive.mixer={subscribe:listener=>{subscribers.add(listener);return()=>subscribers.delete(listener);}};
  megaDrive.start=async function(){starts++;this.state='ready';this.psg={};this.node={port:{postMessage(){}}};};
  megaDrive.close=async function(){this.psg=null;this.node=null;this.state='closed';};
  const snapshots=[];const unsubscribe=runtime.chipInspector.subscribe(entries=>snapshots.push(entries.map(entry=>entry.id)));
  assert.deepEqual(runtime.chipInspector.list(),[]);
  await assert.rejects(runtime.chipInspector.read('segapsg'),/not connected/);
  assert.equal(starts,0);assert.equal(subscribers.size,0);
  await runtime.initialize();assert.equal(starts,1);assert.equal(subscribers.size,1);assert.deepEqual(snapshots.at(-1),['segapsg']);
  await runtime.finalize();assert.equal(subscribers.size,0);assert.deepEqual(snapshots.at(-1),[]);
  await runtime.initialize();assert.equal(starts,2);assert.equal(subscribers.size,1);assert.deepEqual(snapshots.at(-1),['segapsg']);
  await runtime.finalize();unsubscribe();
});

test('rerun replaces a liveLoop only after its current iteration completes', async t => {
  const {runtime} = setup(t);
  const old = deferred(), next = deferred(), events = [];
  globalThis.playgroundReview = {old: old.promise, next: next.promise, events};
  await runtime.playSource(`liveLoop('lead',async()=>{globalThis.playgroundReview.events.push('old-start');await globalThis.playgroundReview.old;globalThis.playgroundReview.events.push('old-end');});`);
  await runtime.playSource(`liveLoop('lead',async()=>{globalThis.playgroundReview.events.push('new-start');await globalThis.playgroundReview.next;});`);
  assert.deepEqual(events, ['old-start']);
  old.resolve();
  await until(()=>events.includes('new-start'));
  assert.deepEqual(events, ['old-start','old-end','new-start']);
});

test('Main executes bare and pg seconds timeline APIs', {timeout:2000}, async t => {
  const {runtime} = setup(t);
  globalThis.playgroundReview = [];
  await runtime.playSource(`
    const timeline = createTimeline();
    await timeline.waitUntil(0);
    globalThis.playgroundReview.push('bare');
    await pg.createTimeline().waitUntil(0);
    globalThis.playgroundReview.push('pg');
  `);
  assert.deepEqual(globalThis.playgroundReview,['bare','pg']);
});

test('Main timeline lets the current liveLoop iteration finish after rerun', {timeout:2000}, async t => {
  const {runtime} = setup(t);
  const old = deferred(), next = deferred(), events = [];
  globalThis.playgroundReview = {old:old.promise,next:next.promise,events,done:deferred()};
  await runtime.playSource(`liveLoop('lead',async()=>{
    const timeline = createTimeline();
    globalThis.playgroundReview.events.push('old-start');
    await globalThis.playgroundReview.old;
    await timeline.waitUntil(0);
    globalThis.playgroundReview.events.push('old-end');
  });`);
  await runtime.playSource(`liveLoop('lead',async()=>{
    globalThis.playgroundReview.events.push('new-start');
    globalThis.playgroundReview.done.resolve();
    await globalThis.playgroundReview.next;
  });`);
  assert.deepEqual(events,['old-start']);old.resolve();
  await globalThis.playgroundReview.done.promise;
  assert.deepEqual(events,['old-start','old-end','new-start']);
});

test('Main Stop cancels a pending seconds timeline and rejects later waits', {timeout:2000}, async t => {
  const {runtime} = setup(t);
  globalThis.playgroundReview = {};
  const playing = runtime.playSource(`
    const timeline = createTimeline();
    globalThis.playgroundReview.timeline = timeline;
    globalThis.playgroundReview.entered = true;
    try {
      await timeline.waitUntil(60);
      globalThis.playgroundReview.finished = true;
    } catch (error) {
      globalThis.playgroundReview.error = error.message;
    }
  `);
  await until(()=>globalThis.playgroundReview.entered);
  await runtime.stop();await playing;
  assert.equal(globalThis.playgroundReview.finished,undefined);
  assert.equal(globalThis.playgroundReview.error,'Run stopped');
  await assert.rejects(globalThis.playgroundReview.timeline.waitUntil(61),/Run stopped/);
});

test('rerun removes undeclared liveFx without stopping audio or the current loop', async t => {
  const {runtime,megaDrive} = setup(t);
  const processor = new LiveFX(48000), gate = deferred(), events = [];
  const fx = createNativeFXController(message => processor.command(message));
  megaDrive.audio = {createFXApi:()=>fx};
  megaDrive.getFXChain = ()=>[];
  let stops = 0;
  megaDrive.sample.stopAll = ()=>{stops++;};
  globalThis.playgroundReview = {gate:gate.promise,events};
  await runtime.playSource(`liveFx('distortion',{process(input,output){output.forEach((channel,c)=>channel.set(input[c]));}});liveLoop('lead',async()=>{globalThis.playgroundReview.events.push('old-start');await globalThis.playgroundReview.gate;});`);
  assert(processor.effects.has('distortion'));
  await runtime.playSource(`liveLoop('lead',async()=>{await globalThis.playgroundReview.gate;});`);
  assert(!processor.effects.has('distortion'));
  assert.deepEqual(events,['old-start']);
  assert.equal(stops,0);
});

test('cached livePrepare retains its liveFx on rerun and releases it when absent', async t => {
  const {runtime,megaDrive} = setup(t);
  const processor = new LiveFX(48000), fx = createNativeFXController(message=>processor.command(message));
  megaDrive.audio = {createFXApi:()=>fx};
  megaDrive.getFXChain = ()=>[];
  const source = `await livePrepare('custom-fx',({fx})=>{fx.liveFx('prepared',{process(input,output){output.forEach((channel,c)=>channel.set(input[c]));}});return {};});`;
  await runtime.playSource(source);
  const state = processor.effects.get('prepared').state;
  await runtime.playSource(source);
  assert.equal(processor.effects.get('prepared').state,state);
  await runtime.playSource('');
  assert(!processor.effects.has('prepared'));
  await runtime.playSource(source);
  assert(processor.effects.has('prepared'), 'cached preparation can reactivate its named FX');
});

test('caught errors retain their message and stack in the Playground console', async t => {
  const {runtime, logs} = setup(t);
  await runtime.playSource('try { throw new Error("OPM failure"); } catch (e) { console.log("e", e); } console.warn(new DOMException("Run stopped", "AbortError"));');
  assert.ok(logs.some(line => line.includes('e Error: OPM failure') && line.includes('\n')));
  assert.ok(logs.some(line => line.includes('[warn] AbortError: Run stopped')));
});

for (const route of ['evaluation', 'liveLoop', 'liveCleanup']) {
  test(`Main ${route} logs retain the error message when WebKit stacks contain only locations`, async t => {
    const {runtime, logs} = setup(t);
    t.mock.method(console, 'error', () => {});
    const failure = `const error = new Error('Unknown sample: sonic-pi/ambi-choir');
      error.stack = 'playSample@tauri://localhost/js/tetorica_audio_runtime.js:427:33';
      throw error;`;
    if (route === 'evaluation') {
      await assert.rejects(runtime.playSource(failure), /Unknown sample/);
    } else if (route === 'liveLoop') {
      await runtime.playSource(`liveLoop('choir', async () => { ${failure} });`);
    } else {
      await runtime.playSource(`liveLoop('choir', async () => { await sleep(60); });
        liveCleanup(['choir'], () => { ${failure} });`);
      await runtime.playSource('');
    }
    await until(() => logs.some(line => line.includes('Unknown sample: sonic-pi/ambi-choir')));
    const errorLog = logs.find(line => line.includes('Unknown sample: sonic-pi/ambi-choir'));
    assert.ok(errorLog.includes('Error: Unknown sample: sonic-pi/ambi-choir\nplaySample@tauri://localhost/'));
    if (route !== 'evaluation') assert.ok(errorLog.startsWith(`[${route}:choir] `));
    runtime.stop();
  });
}

test('Main evaluation and live loops retain native Tauri IPC while user network stays blocked', async t => {
  const {megaDrive} = setup(t);
  const requests = [], evaluation = deferred(), iteration = deferred();
  window.URL = URL;
  window.Headers = Headers;
  window.fetch = async (url, init) => {requests.push([url, init.method]);return "IPC ready";};
  const originalFetch = window.fetch;
  window.__TAURI_INTERNALS__ = {
    convertFileSrc: command => `ipc://localhost/${encodeURIComponent(command)}`,
    invoke(command) {
      return window.fetch(this.convertFileSrc(command, "ipc"), {
        method:"POST", headers:{"Tauri-Invoke-Key":"test-key", "Tauri-Callback":"1", "Tauri-Error":"2"},
      });
    },
  };
  const runtime = createPlaygroundRuntime({megaDrive});
  t.after(() => runtime.stop());
  globalThis.playgroundReview = {evaluation:evaluation.promise, iteration:iteration.promise, entered:false, looping:false};
  const playing = runtime.playSource(`
    globalThis.playgroundReview.entered = true;
    await globalThis.playgroundReview.evaluation;
    liveLoop('choir', async () => {
      globalThis.playgroundReview.looping = true;
      await globalThis.playgroundReview.iteration;
    });
  `);
  await until(() => globalThis.playgroundReview.entered);
  assert.throws(() => window.fetch("https://example.com"), /Network access is disabled/);
  assert.equal(await window.__TAURI_INTERNALS__.invoke("mcp_status"), "IPC ready");
  evaluation.resolve();
  await playing;
  await until(() => globalThis.playgroundReview.looping);
  assert.throws(() => window.fetch("https://example.com"), /Network access is disabled/);
  assert.equal(await window.__TAURI_INTERNALS__.invoke("mcp_set"), "IPC ready");
  assert.deepEqual(requests, [["ipc://localhost/mcp_status", "POST"], ["ipc://localhost/mcp_set", "POST"]]);
  runtime.stop();
  iteration.resolve();
  await until(() => window.fetch === originalFetch);
});

test('re-running a prepared sample FX chain retains routing; Stop still detaches and disposes it',async t=>{
 const {runtime,megaDrive}=setup(t,{fmChannels:1});let cleared=0,disposed=0;
 const effect={input:{},output:{},dispose(){disposed++;}};
 let chain=[];
 megaDrive.getFXChain=()=>chain.slice();
 megaDrive.clearFXChain=()=>{cleared++;const previous=chain;chain=[];return previous;};
 globalThis.playgroundReview={setChain(){chain=[effect];},effect};
 const source='await livePrepare("choir-fx",()=>({reverb:globalThis.playgroundReview.effect}));globalThis.playgroundReview.setChain();';
 await runtime.playSource(source);await runtime.playSource(source);
 assert.equal(cleared,0);assert.equal(disposed,0);assert.deepEqual(chain,[effect]);
 runtime.stop();assert.equal(cleared,1);assert.equal(disposed,1);assert.deepEqual(chain,[]);
});

test('fade stop silences output before cleanup and a new Run waits for it', async t => {
  const {runtime, megaDrive} = setup(t, {fmChannels:1});
  const events=[];
  const gain={value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;events.push(['gain',value]);},
    linearRampToValueAtTime(value,time){events.push(['ramp',value,time]);},
    setValueCurveAtTime(curve,time,duration){events.push(['curve',Array.from(curve),time,duration]);}};
  megaDrive.audioContext={state:'running',currentTime:0,destination:{},createGain:()=>({gain,connect(){},disconnect(){}})};
  megaDrive.audio={outputNode:null,connectOutput(){}};
  megaDrive.fm.noteOff=()=>events.push(['cleanup',megaDrive.audioContext.currentTime]);
  await runtime.ensureReady();
  const stopping=runtime.stopWithFade();
  assert.equal(runtime.stopWithFade(),stopping);
  assert.equal(events[1][0],'curve');
  const curve=events[1][1];
  assert.equal(curve[0],1);assert.equal(curve.at(-1),0);
  assert.ok(curve.every((value,i)=>i===0||value<=curve[i-1]));
  assert.ok(curve[0]-curve[1]<0.001);assert.ok(curve.at(-2)<0.001);
  assert.deepEqual(events[1].slice(2),[0,0.12]);
  globalThis.playgroundReview={started:false};
  const restart=runtime.playSource('globalThis.playgroundReview.started=true;');
  await Promise.resolve();assert.equal(globalThis.playgroundReview.started,false);
  megaDrive.audioContext.currentTime=0.045;
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(!events.some(e=>e[0]==='cleanup'));
  megaDrive.audioContext.currentTime=0.125;
  await stopping;await restart;
  assert.ok(events.findIndex(e=>e[0]==='gain'&&e[1]===0)<events.findIndex(e=>e[0]==='cleanup'));
  assert.ok(events.some(e=>e[0]==='ramp'&&e[1]===1));
  assert.equal(globalThis.playgroundReview.started,true);
});

test('fade stop does not wait for a suspended audio clock', async t => {
  const {runtime,megaDrive}=setup(t);
  megaDrive.audioContext.state='suspended';
  await runtime.stopWithFade();
  assert.equal(runtime.getState().playback,'stopped');
});

test('keyboard audition requested during Stop reopens output after cleanup', async t => {
  const {runtime,megaDrive}=setup(t,{fmChannels:1});
  const events=[];
  const gain={value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;events.push(['gain',value]);},
    setValueCurveAtTime(){},linearRampToValueAtTime(value){events.push(['ramp',value]);}};
  megaDrive.audioContext={state:'running',currentTime:0,destination:{},createGain:()=>({gain,connect(){},disconnect(){}})};
  megaDrive.audio={outputNode:null,connectOutput(){}};
  megaDrive.fm.noteOff=()=>events.push(['cleanup']);
  await runtime.ensureReady();
  const stopping=runtime.stopWithFade();
  const audition=runtime.prepareAudition();
  assert.ok(!events.some(event=>event[0]==='ramp'));
  megaDrive.audioContext.currentTime=0.125;
  await stopping;
  assert.equal(await audition,megaDrive.fm);
  const cleanup=events.findIndex(event=>event[0]==='cleanup');
  const resume=events.findIndex(event=>event[0]==='ramp'&&event[1]===1);
  assert.ok(cleanup>=0&&resume>cleanup,'audition must reopen the output after Stop cleanup');
  assert.equal(runtime.getState().playback,'stopped','audition must not restart the script');
});

test('sample preparation completing after Stop cannot reopen output or start a voice', async t => {
  const {runtime,megaDrive}=setup(t,{fmChannels:1});
  const gate=deferred(), ramps=[];let entered=false, plays=0;
  const gain={value:1,cancelScheduledValues(){},setValueAtTime(value){this.value=value;},
    setValueCurveAtTime(){},linearRampToValueAtTime(value){ramps.push(value);}};
  megaDrive.audioContext={state:'running',currentTime:0,destination:{},createGain:()=>({gain,connect(){},disconnect(){}})};
  megaDrive.audio={outputNode:null,connectOutput(){}};
  megaDrive.sample.play=()=>{plays++;};
  globalThis.playgroundReview={delayResume(){megaDrive.resume=()=>{entered=true;return gate.promise;};}};
  await runtime.playSource('globalThis.playgroundReview.delayResume(); liveLoop("choir",async()=>{await sample.play("choir");await sleep(60);});');
  await until(()=>entered);
  const stopping=runtime.stopWithFade();
  megaDrive.audioContext.currentTime=0.125;
  await stopping;
  gate.resolve();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(plays,0);
  assert.equal(gain.value,0);
  assert.deepEqual(ramps,[],'the old sample request must not fade the output back in');
  assert.equal(runtime.getState().playback,'stopped');
  megaDrive.resume=async()=>{};
  await runtime.playSource('liveLoop("new",async()=>{await sample.play("choir");await sleep(60);});');
  await until(()=>plays===1);
  assert.equal(plays,1,'an explicit new Run still starts audio');
  assert.deepEqual(ramps,[1]);
});

for (const example of ['chip-raw/gameboy-raw-write-sample', 'gameboy/gameboy-synth']) test(`Game Boy ${example} compiles with the full Playground global argument list`, async t => {
  const {runtime} = setup(t);
  const source = await readFile(new URL(`../docs/playground/examples/${example}.js`, import.meta.url), 'utf8');
  globalThis.playgroundReview = {compiled: false};
  // Compile the entire example in its real scope, without opening an audio device.
  await runtime.playSource('globalThis.playgroundReview.compiled = true; return;\n' + source);
  assert.equal(globalThis.playgroundReview.compiled, true);
});

test('stop prevents a late evaluation from registering loops and keyboard handlers', async t => {
  const { runtime, listeners } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, loops: 0 };
  const running = runtime.playSource(`
    globalThis.playgroundReview.entered = true;
    await globalThis.playgroundReview.gate;
    onKeyboardPressKey('late', () => {});
    liveLoop('late', async () => { globalThis.playgroundReview.loops++; await sleep(60); });
  `);
  await until(() => globalThis.playgroundReview.entered);
  runtime.stop(); gate.resolve(); await running;
  assert.equal(listeners.size, 0);
  assert.equal(globalThis.playgroundReview.loops, 0);
  assert.equal(runtime.getState().playback, 'stopped');
});

test('an older evaluation cannot replace a newer run or change its state', async t => {
  const { runtime, listeners } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, hits: 0 };
  const old = runtime.playSource('globalThis.playgroundReview.entered = true; await globalThis.playgroundReview.gate;');
  await until(() => globalThis.playgroundReview.entered);
  await runtime.playSource("onKeyboardPressKey('new', () => { globalThis.playgroundReview.hits++; });");
  gate.resolve(); await old;
  assert.equal(listeners.size, 1);
  for (const fn of listeners) fn({});
  assert.equal(globalThis.playgroundReview.hits, 1);
  assert.equal(runtime.getState().playback, 'running');
});

for (const execution of ['main', 'worker']) {
  test(`stop during audio initialization prevents ${execution} code from running`, async t => {
    const { runtime, megaDrive } = setup(t);
    const gate = deferred(); let entered = false;
    megaDrive.start = () => { entered = true; return gate.promise; };
    const previous = globalThis.Worker;
    globalThis.Worker = class { constructor() { assert.fail('Stopped run created a Worker'); } };
    t.after(() => { globalThis.Worker = previous; });
    globalThis.playgroundReview = { ran: false };
    const pending = runtime.playSource('globalThis.playgroundReview.ran = true;', { execution });
    await until(() => entered);
    runtime.stop(); gate.resolve(); await pending;
    assert.equal(globalThis.playgroundReview.ran, false);
    assert.equal(runtime.getState().playback, 'stopped');
  });
}

test('syntax errors leave stopped state and allow the next run', async t => {
  const { runtime, statuses } = setup(t);
  await assert.rejects(runtime.playSource('const = ;'), SyntaxError);
  assert.equal(runtime.getState().playback, 'stopped');
  assert.ok(statuses.some(s => s.startsWith('Error:')));
  await runtime.playSource("onKeyboardPressKey('valid', () => {});");
  assert.equal(runtime.getState().playback, 'running');
});

test('finalize settles pending Worker runs and main-mode stop waits; late Worker messages are ignored', { timeout: 1000 }, async t => {
  const { runtime, listeners } = setup(t);
  const previous = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
  };
  t.after(() => { globalThis.Worker = previous; });
  const cancelled = assert.rejects(runtime.playSource('await sleep(60);', { execution: 'worker' }), { name: 'AbortError' });
  await until(() => workers.length > 0);
  const main = runtime.playSource("onKeyboardPressKey('late', () => {});");
  const lateMessage = workers[0].onmessage;
  await runtime.finalize();
  await cancelled; await main;
  lateMessage({ data: { type: 'complete', loopCount: 1 } });
  assert.equal(workers[0].terminated, true);
  assert.equal(listeners.size, 0);
  assert.equal(runtime.getState().playback, 'stopped');
});

test('removing a sounding loop releases its note', async t => {
  const { runtime, megaDrive } = setup(t);
  const notes = [];
  megaDrive.fm.noteOn = c => notes.push(['on', c]);
  megaDrive.fm.noteOff = c => notes.push(['off', c]);
  await runtime.playSource('liveLoop("lead", async () => { await play("C4", { duration: 60 }); });');
  await runtime.playSource('');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(notes, [['on', 0], ['off', 0]]);
});

test('cancelled loop does not release the replacement note on the same channel', async t => {
  const { runtime, megaDrive } = setup(t);
  const notes = [];
  megaDrive.fm.noteOn = c => notes.push(['on', c]);
  megaDrive.fm.noteOff = c => notes.push(['off', c]);
  await runtime.playSource('liveLoop("old", async () => { await play("C4", { duration: 60 }); });');
  await runtime.playSource('liveLoop("new", async () => { await play("D4", { duration: 60 }); });');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(notes, [['on', 0], ['on', 0]]);
});

test('late prepare completion cannot repopulate the cache after stop', async t => {
  const { runtime } = setup(t);
  const gate = deferred();
  globalThis.playgroundReview = { gate: gate.promise, entered: false, value: null };
  const pending = runtime.playSource('await livePrepare("asset", async () => { globalThis.playgroundReview.entered = true; await globalThis.playgroundReview.gate; return "old"; });');
  await until(() => globalThis.playgroundReview.entered);
  runtime.stop();
  gate.resolve(); await pending;
  await runtime.playSource('globalThis.playgroundReview.value = await livePrepare("asset", () => "new");');
  assert.equal(globalThis.playgroundReview.value, 'new');
});

function workerBridge(t) {
  const workers=[],previous=globalThis.Worker;
  globalThis.Worker=class {
    constructor(){this.responses=[];workers.push(this);}
    postMessage(message){
      if(message.type==='run')queueMicrotask(()=>this.onmessage?.({data:{type:'complete',loopCount:2}}));
      if(message.type==='stop')queueMicrotask(()=>{
        this.onmessage?.({data:{type:'command',command:'audio.stopAll',args:[]}});
        this.onmessage?.({data:{type:'stopped'}});
      });
      if(message.type==='response')this.responses.push(message);
    }
    terminate(){this.terminated=true;}
    send(data){this.onmessage({data});}
  };
  t.after(()=>{globalThis.Worker=previous;});return workers;
}
test('a delayed Worker Stop must finish before the next Run is sent', async t => {
  const {runtime, megaDrive}=setup(t);
  const previous=globalThis.Worker, workers=[];
  globalThis.Worker=class {
    constructor(){this.runs=0;workers.push(this);}
    postMessage(message){
      if(message.type==='run') {this.runs++;queueMicrotask(()=>this.onmessage({data:{type:'complete',loopCount:1}}));}
      if(message.type==='stop')this.stopping=true;
    }
    terminate(){}
  };
  t.after(()=>{globalThis.Worker=previous;});
  await runtime.playSource('',{execution:'worker'});
  const worker=workers[0];runtime.stop();
  const restarting=runtime.playSource('',{execution:'worker'});
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(worker.runs,1,'the old 100ms timeout must not allow another Run');
  let cleanupDone=false;
  megaDrive.sample.stopAll=()=>{cleanupDone=true;};
  worker.onmessage({data:{type:'command',command:'audio.stopAll',args:[]}});
  worker.onmessage({data:{type:'stopped'}});
  await restarting;
  assert.equal(cleanupDone,true);
  assert.equal(worker.runs,2);
  assert.equal(runtime.getState().playback,'running');
  runtime.stop();worker.onmessage({data:{type:'stopped'}});
});
test('Worker play durations do not serialize independent live-loop notes or Stop',async t=>{
 const {runtime,megaDrive}=setup(t),workers=workerBridge(t),notes=[],offs=[];
 megaDrive.fm.noteOn=ch=>notes.push(ch);megaDrive.fm.noteOff=ch=>offs.push(ch);
 await runtime.playSource('',{execution:'worker'});const w=workers[0];
 w.send({type:'request',id:1,command:'play',args:['E2',{channel:0,duration:60}]});
 w.send({type:'request',id:2,command:'play',args:['E4',{channel:1,duration:60}]});
 try{
  await until(()=>notes.length===2);
  assert.deepEqual(notes,[0,1]);assert.equal(w.responses.length,0,'each caller still waits for its own note');
  w.send({type:'command',command:'audio.stopAll',args:[]});
  await until(()=>offs.length>=6);
 }finally{await runtime.finalize();}
});
test('Worker -> Stop -> main live loop -> Stop cancels the main loop and releases notes',async t=>{
 const {runtime,megaDrive}=setup(t),workers=workerBridge(t);let offs=0;
 megaDrive.fm.noteOff=()=>offs++;
 await runtime.playSource('',{execution:'worker'});runtime.stop();
 globalThis.playgroundReview={finished:false};
 await runtime.playSource(`liveLoop('main',async()=>{await sleep(60);globalThis.playgroundReview.finished=true;});`);
 assert.equal(workers[0].terminated,true);
 const before=offs;runtime.stop();assert(offs>before,'Stop must release main-mode voices');
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(globalThis.playgroundReview.finished,false);
 assert.equal(runtime.getState().playback,'stopped');
 await runtime.finalize();
});

test('main MIDI output emits FM notes, uses fixed CH1 and Stop cancels held voices', async t => {
 const {runtime,megaDrive}=setup(t);const writes=[];
 megaDrive.fm.write=(...args)=>writes.push(args);megaDrive.psg.write=()=>{};
 await runtime.playSource(`if(CH1!==0||CH16!==15||pg.CH16!==CH16)throw new Error('Channel constants'); const out=midi.output('tetorica-ym2612',{channel:CH1}); await out.setVoice(FM_PRESETS.sine); await out.noteOn('C4');`);
 assert(writes.some(([p,r,v])=>r===0x28&&v===240));
 runtime.stop();assert(writes.some(([p,r,v])=>r===0x28&&v===0));
});

test('MIDI file playback schedules FM/PSG at tempo-derived times and completes',async t=>{
 const {runtime,megaDrive}=setup(t);const scheduled=[];const started=performance.now();
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=> (performance.now()-started)/1000});
 megaDrive.fm.write=()=>{};megaDrive.fm.scheduleWrites=entries=>scheduled.push(...entries);megaDrive.psg.write=()=>{};
 const bytes=[77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,12,0,0x90,60,100,4,0x80,60,0,0,255,47,0];
 await runtime.playSource(`setTiming({lookaheadSeconds:.02,schedulerIntervalMs:5}); await midi.playFile(new Uint8Array(${JSON.stringify(bytes)}),[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0}]);`);
 const writes=scheduled.filter(e=>e.type==='psg-write');assert(writes.length>=4);
 const on=writes[0].time,off=writes.find(e=>e.value===0x9f).time;
 assert(Math.abs(off-on-4*.5/96)<1e-9);
});

test('MIDI import applies full-scale bend from another track to the routed source channel',async t=>{
 const {runtime,megaDrive}=setup(t),scheduled=[];const started=performance.now();
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=> (performance.now()-started)/1000});
 megaDrive.fm.write=()=>{};megaDrive.fm.scheduleWrites=entries=>scheduled.push(...entries);megaDrive.psg.write=()=>{};
 const tracks=[ [2,0xe0,127,127,2,0xe0,0,64,0,255,47,0], [0,0x90,60,100,6,0x80,60,0,0,255,47,0] ];
 const bytes=[77,84,104,100,0,0,0,6,0,1,0,2,0,96];
 for(const tr of tracks)bytes.push(77,84,114,107,0,0,0,tr.length,...tr);
 await runtime.playSource(`setTiming({lookaheadSeconds:.02,schedulerIntervalMs:5}); await midi.playFile(new Uint8Array(${JSON.stringify(bytes)}),[{part:'[1,0,"",1]',destination:'tetorica-ym2612',channel:8,preset:'sine',bendRange:12}]);`);
 const highs=scheduled.filter(e=>e.register===0xa4);
 assert.equal(highs.length,3);assert.equal(highs[1].value,highs[0].value+8);assert.equal(highs[2].value,highs[0].value);
 assert(Math.abs(highs[1].time-highs[0].time-2*.5/96)<1e-9);
 assert.equal(scheduled.filter(e=>e.register===0x28&&e.value===240).length,1);
});

test('MIDI import applies cross-track CC at event time and releases sustain on pedal-up',async t=>{
 const {runtime,megaDrive}=setup(t),scheduled=[];const started=performance.now();
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=> (performance.now()-started)/1000});
 megaDrive.fm.write=()=>{};megaDrive.fm.scheduleWrites=entries=>scheduled.push(...entries);megaDrive.psg.write=()=>{};
 const tracks=[
  [0,0xb0,64,127,2,0xb0,11,0,2,0xb0,11,127,2,0xb0,64,0,2,255,47,0],
  [0,0x90,60,127,3,0x80,60,0,5,255,47,0],
 ];
 const bytes=[77,84,104,100,0,0,0,6,0,1,0,2,0,96];
 for(const tr of tracks)bytes.push(77,84,114,107,0,0,0,tr.length,...tr);
 await runtime.playSource(`setTiming({lookaheadSeconds:.02,schedulerIntervalMs:5}); await midi.playFile(new Uint8Array(${JSON.stringify(bytes)}),[{part:'[1,0,"",1]',destination:'tetorica-sega-psg',channel:CH16}]);`);
 const writes=scheduled.filter(e=>e.type==='psg-write');
 const origin=writes[0].time;
 const volumes=writes.filter(e=>(e.value&0xf0)===0x90);
 assert.deepEqual(volumes.map(e=>[Math.round((e.time-origin)*192),e.value]),[[0,0x90],[2,0x9f],[4,0x90],[6,0x9f]]);
});

test('main CC API reaches the rack and Stop silences a sustained FM voice',async t=>{
 const {runtime,megaDrive}=setup(t),writes=[];
 megaDrive.fm.write=(...args)=>writes.push(args);megaDrive.psg.write=()=>{};
 await runtime.playSource(`const o=midi.output('tetorica-ym2612'); await o.cc(64,127);await o.noteOn('C4');await o.noteOff('C4');await o.cc(10,0);`);
 assert.equal(writes.filter(([p,r,v])=>r===0x28&&v===0).length,0);
 assert.equal(writes.at(-1)[2]&192,128);
 runtime.stop();assert(writes.some(([p,r,v])=>r===0x28&&v===0));
});

test('compiled standalone MIDI code plays through the main runtime without reading a MIDI asset',async t=>{
 const {midiToSource}=await import('./midi_source.js');
 const {runtime,megaDrive}=setup(t),writes=[];const start=performance.now();
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=>(performance.now()-start)/1000});
 megaDrive.fm.write=()=>{};megaDrive.psg.write=v=>writes.push(v);
 const bytes=Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,12,0,0x90,60,127,4,0x80,60,0,0,255,47,0]);
 const source=midiToSource(bytes,[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0}]);
 await runtime.playSource(source);
 assert(writes.includes(0x90));assert.equal(writes.at(-1),0x9f);
});

test('main Worker bridge uses MIDI channel state with automatic voice allocation',async t=>{
 const {runtime,megaDrive}=setup(t),workers=workerBridge(t),writes=[];
 megaDrive.fm.write=(...args)=>writes.push(args);megaDrive.psg.write=()=>{};
 await runtime.playSource('',{execution:'worker'});const w=workers[0];let requestId=0;
 const request=async(method,args)=>{
  const id=++requestId;w.send({type:'request',id,command:'midi.invoke',args:[method,args]});
  await until(()=>w.responses.some(r=>r.id===id));const result=w.responses.find(r=>r.id===id);
  assert(!result.error);return result.value;
 };
 const note=await request('noteOn',['tetorica-ym2612',4,60,100]);
 assert(writes.some(([p,r,v])=>r===0x28&&v===240));writes.length=0;
 await request('pitchBend',['tetorica-ym2612',4,1]);
 assert.deepEqual(writes.map(([p,r])=>[p,r]),[[0,0xa4],[0,0xa0]]);
 await request('release',['tetorica-ym2612',4,60,note]);
 assert.equal(writes.at(-1)[2],0);await runtime.finalize();
});

test('generated MIDI module stops during sample wait and runs again on main',async t=>{
 const {midiToSource}=await import('./midi_source.js');
 const {runtime,megaDrive}=setup(t),writes=[];const start=performance.now();
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=>(performance.now()-start)/1000});
 megaDrive.fm.write=()=>{};megaDrive.psg.write=v=>writes.push(v);
 function entry(ticks) {
  const track=[0,0x90,60,127,ticks,0x80,60,0,0,255,47,0];
  const bytes=Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,0,96,77,84,114,107,0,0,0,track.length,...track]);
  const module=midiToSource(bytes,[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0}],{module:true});
  return `const song=await(async()=>{${module.replace(/^export /gm,'')} return {initCh,runAllCh};})();await song.initCh(pg);await song.runAllCh();`;
 }
 const pending=runtime.playSource(entry(96));
 await until(()=>writes.includes(0x90));runtime.stop();await pending;
 assert.equal(runtime.getState().playback,'stopped');assert(writes.includes(0x9f));
 writes.length=0;await runtime.playSource(entry(1));
 assert(writes.includes(0x90));assert.equal(writes.at(-1),0x9f);
});

test('fixed channel configuration reaches the main and Worker rack',async t=>{
 const {runtime,megaDrive}=setup(t),writes=[],workers=workerBridge(t);
 megaDrive.fm.write=(...args)=>writes.push(args);megaDrive.psg.write=()=>{};
 await runtime.playSource(`await midi.enableSoundChip('tetorica-ym2612',{roundRobin:false});await midi.output('tetorica-ym2612',{channel:CH4}).noteOn('C4');`);
 assert(writes.some(([p,r,v])=>r===0x28&&v===0xf4));runtime.stop();writes.length=0;
 await runtime.playSource('',{execution:'worker'});const worker=workers[0];
 worker.send({type:'request',id:101,command:'midi.invoke',args:['enableSoundChip',['tetorica-ym2612',{roundRobin:false}]]});
 await until(()=>worker.responses.some(r=>r.id===101));assert(!worker.responses.find(r=>r.id===101).error);
 worker.send({type:'request',id:102,command:'midi.invoke',args:['noteOn',['tetorica-ym2612',5,60,100]]});
 await until(()=>worker.responses.some(r=>r.id===102));assert(writes.some(([p,r,v])=>r===0x28&&v===0xf6));
});

test('Stop during a held MIDI liveLoop note completes hard mute and allows restart',async t=>{
 const {runtime,megaDrive}=setup(t),writes=[];
 megaDrive.fm.write=(...args)=>writes.push(args);megaDrive.psg.write=()=>{};
 globalThis.playgroundReview={held:false};
 await runtime.playSource(`
  const lead=midi.output('tetorica-ym2612',{channel:CH4});
  liveLoop('held-midi',async()=>{
   await lead.noteOn('C4');
   globalThis.playgroundReview.held=true;
   await beat(100);
   await lead.noteOff('C4');
  });
 `);
 await until(()=>globalThis.playgroundReview.held);
 writes.length=0;
 assert.doesNotThrow(()=>runtime.stop());
 assert.equal(runtime.getState().playback,'stopped');
 assert(writes.some(([p,r,v])=>r===0x28&&v===0));
 assert(writes.some(([p,r,v])=>r===0x40&&v===127));
 await runtime.playSource(`const lead=midi.output('tetorica-ym2612');await lead.noteOn('E4');`);
 assert(writes.some(([p,r,v])=>r===0x28&&v===0xf0));
});

test('Worker observer updates synth state without sending audio or waiting for a reply', async t => {
 const {runtime,megaDrive}=setup(t),workers=workerBridge(t);
 const writes=[];
 const {YM2612Synth}=await import('./ym2612synth.js');
 megaDrive.fm=new YM2612Synth({transport:{write(port,register,value){writes.push([port,register,value]);},clearDacPlayback(){}}});
 await runtime.playSource('',{execution:'worker'});
 writes.length=0;
 workers[0].send({type:'chip-observer',event:{method:'setAlgo',args:[0,5,3]}});
 assert.equal(megaDrive.fm.channels[0].algorithm,5);
 assert.equal(writes.length,0);
 assert.equal(workers[0].responses.length,0);
 megaDrive.fm.setAlgo(0,4,2);
 assert.ok(writes.length>0,'normal UI transport is restored after observation');
 await runtime.finalize();
});

test('OPNA Worker observations preserve remembered SSG volume and UI snapshots wait for completed shadows', async t => {
 const {runtime,megaDrive}=setup(t,{chip:'ym2608',fmChannels:6,psg:false,dac:false},{onMegaDriveEvent(){}});
 const workers=workerBridge(t),writes=[],messages=[];
 let listener;
 megaDrive.addListener=fn=>{listener=fn;return()=>{listener=null;};};
 megaDrive.fm=new YM2608Synth({transport:{write(port,register,value){
  writes.push([port,register,value]);listener?.({type:'write',port,register,value});
 }}});
 await runtime.playSource('',{execution:'worker'});
 const worker=workers[0],post=worker.postMessage.bind(worker);
 worker.postMessage=message=>{messages.push(message);post(message);};
 writes.length=0;
 worker.send({type:'chip-observer',event:{method:'write',args:[0,8,0]}});
 worker.send({type:'chip-observer',event:{method:'ssgState',args:[{
  registers:Array.from(megaDrive.fm.ssg.registers),levels:[12,0,0],
 }]}});
 assert.equal(writes.length,0,'observer updates must not send duplicate audio');
 assert.equal(megaDrive.fm.ssg._getState().levels[0],12);
 megaDrive.fm.ssg.keyOn(0);
 assert.equal(writes.at(-1)[2],12);
 megaDrive.fm.ssg.keyOff(0);
 assert.equal(messages.length,0,'snapshot waits until keyOff restores its remembered volume');
 await Promise.resolve();
 const state=messages.filter(message=>message.type==='chip-state').at(-1).state;
 assert.equal(state.ssg.registers[8],0);
 assert.equal(state.ssg.levels[0],12);
 await runtime.finalize();
});

test('main scheduleWritesSamples routes mixed FM and PSG tuples on the shared sample clock',async t=>{
 const {runtime,megaDrive}=setup(t),scheduled=[];
 megaDrive.fm.scheduleWrites=entries=>scheduled.push(...entries);
 await runtime.playSource(`const start=beginSampleSchedule(); scheduleWritesSamples(start, [[0,0,0x22,8],[0,'psg',0x85],[0,'psg',0x12]]);`);
 assert.deepEqual(scheduled.map(e=>e.type??'fm'),['fm','psg-write','psg-write']);
 assert.equal(new Set(scheduled.map(e=>e.time)).size,1);
 assert.deepEqual(scheduled.map(e=>e.value),[8,0x85,0x12]);
});

test('useSoundChip returns existing FM, supports const fm and preserves play and reevaluation',async t=>{
 const {runtime,megaDrive}=setup(t);const notes=[];
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=>performance.now()/1000});
 megaDrive.fm.noteOn=(...args)=>notes.push(args);
 globalThis.playgroundReview={};
 await runtime.playSource(`
  const fm = await useSoundChip('ym2612');
  if (fm !== pg.fm || fm !== await pg.useSoundChip('ym2612')) throw Error('Different FM');
  const pair = await Promise.all([useSoundChip('ym2612'),useSoundChip('ym2612')]);
  if (pair[0] !== fm || pair[1] !== fm) throw Error('Concurrent identity');
  globalThis.playgroundReview.fm=fm;
  fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
  await play('C4', {channel:CH1,duration:0.001});
 `);
 await runtime.playSource(`
  if (await useSoundChip('ym2612') !== globalThis.playgroundReview.fm) throw Error('Not reused');
  fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
  await play('C4',{channel:CH1,duration:0.001});
 `);
 assert.equal(notes.length,2);assert.deepEqual(notes[0],notes[1]);
 runtime.stop();await runtime.playSource(`const fm = await useSoundChip('ym2612'); if(fm!==pg.fm)throw Error('Restart identity');`);
});
test('useSoundChip rejects unsupported options on Main',async t=>{
 const {runtime}=setup(t);
 await assert.rejects(runtime.playSource(`await useSoundChip('ym2612',{id:'fm1'});`),/options/);
});


for(const [chip,channels] of [['ym2203',3],['ym2610',4]])test(`Main useSoundChip ${chip} aliases selected FM and preserves play`,async t=>{
 const {runtime,megaDrive}=setup(t,{chip,fmChannels:channels,psg:false,dac:false});
 const notes=[];megaDrive.fm.noteOn=(...args)=>notes.push(args);
 Object.defineProperty(megaDrive.audioContext,'currentTime',{get:()=>performance.now()/1000});
 await runtime.playSource(`
  const fm = await useSoundChip('${chip}');
  if(fm!==pg.fm)throw Error('Different FM');
  const [a,b]=await Promise.all([useSoundChip('${chip}'),useSoundChip('${chip}')]);
  if(a!==fm || b!==fm)throw Error('Different instances');
  context.fm=fm;fm.setPreset(CH1,FM_PRESETS['one-op-basic']);
  await play('C4',{channel:CH1,duration:0.001});
 `);
 await runtime.playSource(`if(await useSoundChip('${chip}')!==context.fm)throw Error('Not reused');`);
 assert.equal(notes.length,1);
 runtime.stop();await runtime.playSource(`const fm=await useSoundChip('${chip}');if(fm!==pg.fm)throw Error('Restart');`);
});

test('YM2203 startup and exported FM presets work with the real mono synth',async t=>{
 const {runtime,megaDrive}=setup(t,{chip:'ym2203',fmChannels:3,psg:false,dac:false});
 const writes=[];
 megaDrive.fm=new YM2203Synth({transport:{write:(port,register,value)=>writes.push([port,register,value])}});
 await runtime.playSource(`
  const fm=await useSoundChip('ym2203');
  if(fm!==pg.fm)throw Error('Different primary FM');
  for(const preset of Object.values(FM_PRESETS))fm.setPreset(CH1,preset);
  fm.setPreset(CH1,FM_PRESETS['one-op-basic']);
 `);
 assert.equal(megaDrive.fm.channels[0].algorithm,7);
 assert(writes.length>0);
 assert(writes.every(([port])=>port===0));
});

test('selected YM2608 keeps useSoundChip full-client ownership and import APIs',async t=>{
 const {runtime}=setup(t,{chip:'ym2608',fmChannels:6,psg:false,dac:false});
 const clients=[],commands=[];
 // Exercise registry selection without opening an AudioWorklet in Node. The
 // full client deliberately differs from the selected global FM facade.
 globalThis.playgroundReview={create:async(name,options)=>{
  assert.equal(name,'ym2608');assert.deepEqual(options,{id:'ym2608:shared'});
  const port={start(){},close(){},postMessage(message){commands.push(message);if(message.id)queueMicrotask(()=>port.onmessage({data:{id:message.id}}));}};
  const client=createYm2608Client(port);clients.push(client);return client;
 }};
 t.after(()=>clients.forEach(client=>client.dispose()));
 const source=`
  pg.createSoundChip=globalThis.playgroundReview.create;
  const [opna,again]=await Promise.all([useSoundChip('ym2608'),useSoundChip('ym2608')]);
  if(opna!==again||opna===pg.fm)throw Error('Full-client identity');
  if(typeof opna.setAlgo!=='function'||!opna.ssg||!opna.rhythm||!opna.adpcm)throw Error('Missing OPNA controls');
  await opna.setClock(7987200);
  opna.resetRegisters();opna.rhythm.setVolume(40);
  await opna.adpcm.loadMemory(new Uint8Array([0x12]),8);
  await opna.prepareTimeline([[0,0,8,15]],[],1);await opna.playTimeline();
  context.opna=opna;
 `;
 await runtime.playSource(source);
 await runtime.playSource(`if(await useSoundChip('ym2608')!==context.opna)throw Error('Not reused');`);
 assert.equal(clients.length,1);
 for(const method of ['clock','reset','memory','prepareTimeline','playTimeline'])assert(commands.some(command=>command.method===method),method);
 runtime.stop();await runtime.playSource(source);assert.equal(clients.length,2);
});

for(const method of ['sleep','sleepSamples','beat'])test(`Main tracked failure ends its loop during ${method} without retrying`,async t=>{
 const {runtime,statuses}=setup(t);let reject;
 globalThis.playgroundReview={task:new Promise((_,r)=>{reject=r;}),runs:0,after:false};
 await runtime.playSource(`liveLoop('upload',async()=>{globalThis.playgroundReview.runs++;pg.trackAsync(globalThis.playgroundReview.task);await ${method}(600000);globalThis.playgroundReview.after=true;});`);
 reject(new Error('memory transfer failed'));
 for(let i=0;i<100&&!statuses.includes('Loop error: upload');i++)await new Promise(r=>setTimeout(r,1));
 assert.ok(statuses.includes('Loop error: upload'));assert.equal(globalThis.playgroundReview.runs,1);assert.equal(globalThis.playgroundReview.after,false);
});
