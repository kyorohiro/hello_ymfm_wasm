import {createSpcClient} from './playground_spc.js?v=y8950-adpcm-ui-1';
import {createSnesClient} from './playground_snes.js?v=y8950-adpcm-ui-1';
import {encodeBrr} from './snes_brr_encoder.js?v=snes-brr-encoder-1';
import {encodeAdpcmA} from './adpcm_a_sample.js?v=adpcm-a-encoder-1';
import {encodePs1Adpcm} from './ps1_adpcm_encoder.js?v=ps1-adpcm-encoder-1';
import {createPerformanceSender} from './playground_performance_sender.js?v=ps1-mode-1';
import {midiToOpnPitch, opnPitchFromHz} from './soundchip_pitch.js';
import {CHIP_CLOCKS} from './playground_chip_clock.js?v=pokey-prepare-1';
import {createNesClient} from './playground_nes.js?v=pokey-prepare-1';
import {borrowNativeApi, createNativeWorkerApis, createNativePrimaryClient} from './playground_native_primary.js?v=ps1-native-1';
import {createDx7Client} from './playground_dx7.js?v=y8950-adpcm-ui-1';
import {createPWM32XClient} from './pwm32x_playback.js?v=pokey-prepare-1';
import {OPL_CHIPS} from './playground_opl.js?v=pokey-prepare-1';
import {YM2413_INSTRUMENTS as OPLL_INSTRUMENTS,YM2413_USER_PRESETS as OPLL_USER_PRESETS} from './ym2413synth.js?v=pokey-mode-1';
import {OPL_PRESETS} from './opl_synth.js?v=audio-numeric-bindings-1';
import {createYm2151Client} from './playground_ym2151.js?v=pokey-prepare-1';
import {createSegaPsgClient} from './playground_segapsg.js?v=pokey-prepare-1';
import {resolvePlaySeconds,resolvePlayDuration} from './playground_duration.js?v=shared-beat-clock-1';
import {createLoopAsyncTasks} from './playground_async_tasks.js';
import {createCycle} from './playground_music.js?v=audio-stability-2';
import {createOpnClient} from './playground_opn.js?v=ps1-mode-1';
import {createSoundChipRegistry} from './playground_soundchips.js?v=ps1-mode-1';
import {validateSoundChipOptions} from './playground_soundchip_options.js?v=pokey-mode-1';
import {createMusicalKeyboard, createKeyboardApiGuard, keyboardBinding, registerKeyboardScope} from './playground_keyboard.js?v=audio-numeric-bindings-1';
import {createSampleInstrument as createSampleInstrumentFactory} from './playground_sample_instrument.js?v=ps1-pcm-waveform-1';
import {createGameboyClient} from './playground_gameboy.js?v=pokey-prepare-1';
import {createYm2608Client} from './playground_ym2608.js?v=ps1-mode-1';
import {createRf5c164Client} from './playground_rf5c164.js?v=pokey-prepare-1';
import {createNativeSampleController} from './native_sample.js?v=audio-stability-2';
import {createNativeGenesisFX} from './native_genesis_fx.js';
import {createNativeNoiseOwnership} from './native_genesis_noise.js';
import {serializeLogError} from './playground_log.js';
/**
 * @file playground_logic_worker.js
 * 実行環境: Browser（Web Worker）
 * 依存: self.onmessage / postMessage、performance、タイマーとメインスレッドへのメッセージ通信。
 * Worker エントリーポイント。通常の Node.js モジュールとしては実行しない。
 */
import {createNativeNoiseController, controlNativeNoise} from './native_noise.js';
import {createWorkerDac} from './playground_worker_dac.js';
import {createWorkerChip} from './playground_worker_chip.js?v=ps1-mode-1';
import {createMidiApi, createMidiRack} from './playground_midi.js?v=audio-numeric-bindings-1';
import { hzToBlockFnum } from "./pitch.js";
import {createDeadlineScheduler,createBeatClock,createSecondsTimeline,runTween} from './playground_clock.js?v=spc-song-timing-1';

import {createNativeFXController,createLiveFxLifecycle} from "./native_fx.js?v=live-fx-definitions-1";
let nativeFXPort = null;
let chipConnection = null;
let primaryPcmConnection = null;
let nativeConnections = [];
let currentRun = null;
let nextRequestId = 1;
const pendingRequests = new Map();

function tfiToPreset(data) {
  const bytes = data instanceof Uint8Array
    ? data
    : new Uint8Array(data);
  if (bytes.length !== 42) {
    throw new Error("TFI data must be exactly 42 bytes");
  }

  const preset = {
    algorithm: tfiByte(bytes[0], "algorithm", 7),
    feedback: tfiByte(bytes[1], "feedback", 7),
    operators: [],
  };
  const fileOrder = [0, 2, 1, 3];
  const detune = [7, 6, 5, 0, 1, 2, 3];

  for (let block = 0; block < 4; block += 1) {
    const base = 2 + block * 10;
    preset.operators[fileOrder[block]] = {
      multi: tfiByte(bytes[base], "multi", 15),
      dt: detune[tfiByte(bytes[base + 1], "detune", 6)],
      tl: tfiByte(bytes[base + 2], "tl", 127),
      rs: tfiByte(bytes[base + 3], "rs", 3),
      ar: tfiByte(bytes[base + 4], "ar", 31),
      d1r: tfiByte(bytes[base + 5], "d1r", 31),
      d2r: tfiByte(bytes[base + 6], "d2r", 31),
      rr: tfiByte(bytes[base + 7], "rr", 15),
      sl: tfiByte(bytes[base + 8], "sl", 15),
      ssg: tfiByte(bytes[base + 9], "ssg", 15),
    };
  }
  return preset;
}

function tfiByte(value, name, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`Invalid TFI ${name}: ${value}`);
  }
  return value;
}

const NETWORK_DISABLED_MESSAGE =
  "Network access is disabled in Tetorica FM2612 Playground.";

let activeWorkerGuardState = null;

function installWorkerExecutionGuards(realm = self) {
  if (activeWorkerGuardState?.realm === realm) {
    activeWorkerGuardState.count += 1;
    return createWorkerGuardRelease(
      activeWorkerGuardState
    );
  }

  const restoreSteps = [];
  const blocked = () => {
    throw new Error(NETWORK_DISABLED_MESSAGE);
  };

  for (const property of [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
  ]) {
    patchWorkerProperty(
      realm,
      property,
      property === "fetch"
        ? blocked
        : function BlockedNetworkApi() {
            blocked();
          },
      restoreSteps
    );
  }

  if (realm.navigator) {
    patchWorkerProperty(
      realm.navigator,
      "sendBeacon",
      blocked,
      restoreSteps
    );
  }

  activeWorkerGuardState = {
    realm,
    count: 1,
    restoreSteps,
  };
  return createWorkerGuardRelease(
    activeWorkerGuardState
  );
}

function createWorkerGuardRelease(state) {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.count -= 1;
    if (state.count > 0) return;
    for (let index = state.restoreSteps.length - 1; index >= 0; index -= 1) {
      state.restoreSteps[index]();
    }
    if (activeWorkerGuardState === state) {
      activeWorkerGuardState = null;
    }
  };
}

async function executeWithWorkerGuards(callback) {
  const restore = installWorkerExecutionGuards();
  try {
    return await callback();
  } finally {
    restore();
  }
}

function patchWorkerProperty(target, property, replacement, restoreSteps) {
  if (!target) return;
  const hadOwn = Object.prototype.hasOwnProperty.call(target, property);
  const original = target[property];
  try {
    target[property] = replacement;
  } catch (_error) {
    return;
  }
  if (target[property] !== replacement) return;
  restoreSteps.push(() => {
    if (hadOwn) {
      target[property] = original;
    } else if (original === undefined) {
      delete target[property];
    } else {
      target[property] = original;
    }
  });
}

function postCommand(command, args = []) {
  // DOMException details can be lost by structured cloning in browsers.
  if (command === 'log' || command === 'warn' || command === 'error') {
    args = args.map(serializeLogError);
  }
  postMessage({ type: "command", command, args });
}

function request(command, args = [], loopContext = null, performanceInfo, nativeCreation = false) {
  const id = nextRequestId;
  nextRequestId += 1;
  postMessage({ type: "request", id, command, args, ...(performanceInfo?{performance:performanceInfo}:{}) });
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject, loopContext, ...(nativeCreation?{creationRun:currentRun,creationToken:currentRun?.token}:{}) });
  });
}

function createClock(run) {
  const scheduler = createDeadlineScheduler({ now: () => performance.now() / 1000,
    setTimer:(fn,ms)=>setTimeout(fn,ms), clearTimer:id=>clearTimeout(id),
    createTaskChannel:()=>typeof MessageChannel === 'function' ? new MessageChannel() : null,
  });
  const state = {bpm:120,clockStartTime:performance.now()/1000};
  const beatClock = createBeatClock({now:()=>performance.now()/1000,scheduler,state});
  let sampleClockStart = null;
  let dacLookaheadSeconds = 0.25;

  function secondsPerBeat() {
    return 60 / state.bpm;
  }

  function currentBeat() {
    return beatClock.currentBeat();
  }

  async function waitForBeat(target) {
    const token=run.token, context=run.currentLoop;
    const check=()=>{
      if(context?.interruptError && !run.stopped && !context.stopped)throw context.interruptError;
      if(run.stopped || token!==run.token || context?.stopped || (context && !context.keyboard && !run.loops.has(context.name)))throw new Error('Run stopped');
    };
    check();
    await new Promise(resolve=>beatClock.wait(target,()=>{run.currentLoop=context;resolve();},context));
    check();
  }

  async function sleep(seconds) {
    const token = run.token;
    const loopContext = run.currentLoop;
    if (loopContext?.interruptError && !run.stopped && !loopContext.stopped) throw loopContext.interruptError;
    if (run.stopped || loopContext?.stopped) throw new Error("Run stopped");
    await new Promise((resolve) => scheduler.wait(performance.now() / 1000 + Math.max(0, Number(seconds) || 0), () => {
      run.currentLoop = loopContext;
      resolve();
    }, loopContext));
    if (loopContext?.interruptError && !run.stopped && !loopContext.stopped) throw loopContext.interruptError;
    if (run.stopped || token !== run.token || loopContext?.stopped || (loopContext && !loopContext.keyboard && !run.loops.has(loopContext.name))) {
      throw new Error("Run stopped");
    }
  }

  async function sleepUntil(targetSeconds, loopContext) {
    const token = run.token;
    if (loopContext?.interruptError && !run.stopped && !loopContext.stopped) throw loopContext.interruptError;
    if (run.stopped || loopContext?.stopped) throw new Error("Run stopped");
    await new Promise((resolve) => scheduler.wait(targetSeconds, () => {
      run.currentLoop = loopContext;
      resolve();
    }, loopContext));
    if (loopContext?.interruptError && !run.stopped && !loopContext.stopped) throw loopContext.interruptError;
    if (run.stopped || token !== run.token || loopContext?.stopped || (loopContext && !loopContext.keyboard && !run.loops.has(loopContext.name))) {
      throw new Error("Run stopped");
    }
  }

  return {
    cancelWaits: scheduler.cancel,
    cancelLoop(name) {
      // A runner may be awaiting an RPC or user Promise, not a clock wait.
      // Mark its identity stopped before a later Run can reuse the same name.
      for (const [key, loop] of run.runningLoops) {
        if (name === undefined || key === name) {
          run.releaseNoiseOwner?.(loop);
          run.performance.cancelOwner(loop.performanceOwner); loop.stopped = true;
        }
      }
      run.loopTasks?.releaseName(name);
      run.midi?.cancelOwner(name);
      scheduler.cancel((owner) => {
        if (!owner || (name !== undefined && owner.name !== name)) return false;
        owner.stopped = true;
        return true;
      });
    },
    currentBeat,
    // Keep new loop channels aligned without catching up from a previous Run.
    // The Worker sample timeline includes its existing scheduling lookahead.
    currentSampleCursor: () => sampleClockStart === null ? 0 :
      Math.max(0, performance.now() / 1000 + dacLookaheadSeconds - sampleClockStart),
    getBpm: () => state.bpm,
    waitForBeat,
    waitBeats: beats => waitForBeat(currentBeat()+beats),
    sleep,
    async sleepSamples(samples, sampleRate = 44100) {
      const duration = Math.max(0, Number(samples) || 0) / Math.max(1, Number(sampleRate) || 44100);
      const loopContext = run.currentLoop;
      if (!loopContext) {
        await sleep(duration);
        return;
      }
      if (sampleClockStart === null) {
        sampleClockStart = performance.now() / 1000 + dacLookaheadSeconds;
      }
      loopContext.sampleCursorSeconds = (loopContext.sampleCursorSeconds ?? 0) + duration;
      await sleepUntil(sampleClockStart + loopContext.sampleCursorSeconds, loopContext);
    },
    async beat(beats = 1) {
      if(!Number.isFinite(beats)||beats<0)throw new RangeError('Beats must be finite and nonnegative');
      const context = run.currentLoop;
      if (!context) {
        await waitForBeat(currentBeat()+beats);
        return;
      }
      context.cursorBeat = Math.max(context.cursorBeat ?? currentBeat(), currentBeat()) + beats;
      await waitForBeat(context.cursorBeat);
    },
    async nextBeat() {
      const context = run.currentLoop;
      const next = Math.floor(Math.max(context?.cursorBeat ?? 0, currentBeat()) + 0.000001) + 1;
      if (context) context.cursorBeat = next;
      await waitForBeat(next);
    },
    setBpm(value) {
      beatClock.setBpm(value);
      run.syncFXTempo?.();
      postMessage({type:'tempo',bpm:state.bpm});
    },
    beginSampleSchedule() {
      if (sampleClockStart === null) {
        sampleClockStart = performance.now() / 1000 + dacLookaheadSeconds;
      }
      return Math.round((run.currentLoop?.sampleCursorSeconds ?? 0) * 44100);
    },
    setDacLookahead(value) {
      dacLookaheadSeconds = Math.max(0, Number(value) || 0);
    },
    resetSampleClock() {
      sampleClockStart = null;
    },
  };
}

function createRun(sourceCode, presets, scaleIntervals, capabilities = {}, timing = {}) {
  const supportsNativeExtra=name=>capabilities.backend==='native-genesis'&&capabilities.dynamicSoundChipKinds?.includes(name)===true;
  const run = {
    token: 1,
    generation: 1,
    stopped: false,
    context: {},
    loops: new Map(),
    runningLoops: new Map(),
    collectingLoops: null,
    prepared: new Map(),
    liveFxDefinitions: new Map(),
    keyboard: new Map(),
    collectingKeyboard: null,
    cleanups: [],
    collectingCleanups: null,
    currentLoop: null,
    audioHandles: new Set(),
  };
  const performanceTransport = createPerformanceSender({leaseUntimed:capabilities.backend==='native-genesis',getLoop: () => run.currentLoop, restoreLoop: loop => { run.currentLoop = loop; }, onCancelOwner: metadata => {if(capabilities.backend==='native-genesis')for(const client of pcmClients)client._cancelPerformanceOwner?.(metadata.owner);postMessage({type:'performance-cancel-owner',...metadata});}});
  run.performance = performanceTransport;
  const keyboardApi = createKeyboardApiGuard(() => run.currentLoop,value => {run.currentLoop=value;});
  const musicalKeyboard = createMusicalKeyboard({getContext:()=>run.currentLoop,setContext:value=>{run.currentLoop=value;},
    invoke:callback=>executeWithWorkerGuards(callback),onChange:target=>postMessage({type:'musical-keyboard-binding',binding:target?{name:target.name,session:musicalKeyboard.session}:null}),
    onError:error=>postMessage({type:'log',level:'error',message:`[keyboard] ${serializeLogError(error)}`})});
  run.keyboardTarget = () => musicalKeyboard.target;
  run.handleMusicalKeyboard = message => {
    if (message.session !== musicalKeyboard.session || !['noteOn','noteOff','allNotesOff'].includes(message.method)) return;
    void musicalKeyboard.target?.[message.method](message.event).catch(()=>{});
  };
  let nextLoopOwner = 0;
  const clock = createClock(run);
  run.setBpm = clock.setBpm;
  clock.setDacLookahead(timing.lookaheadSeconds ?? 0.25);
  run.resetSampleClock = () => clock.resetSampleClock();
  const commandProxy = (command) => (...args) => postCommand(command, args);
  const requestProxy = (command) => (...args) => request(command, args, run.currentLoop);
  const nativePrimary = ['nes','snes','ps1','x68000','huc6280','pokey','wonderswan','segapsg','dx7','ym3526','ym3812','y8950','ymf262','ym2413','ay8910','msx','msx-audio'].includes(capabilities.chip)
    || capabilities.chip === 'gameboy' && capabilities.backend === 'native-genesis';
  const hasOpn = !nativePrimary && capabilities.chip !== 'gameboy';
  const nativeBase = createNativeWorkerApis(nativeConnections,performanceTransport,(name,state)=>postMessage({type:'native-observer',name,state}),{
    captureContext:()=>({...run.currentLoop,loop:run.currentLoop,token:run.token}),
    restoreContext:scope=>{run.currentLoop=scope?.loop??null;},
    isStopped:scope=>run.stopped||(scope?scope.token!==run.token||scope.loop?.stopped:run.currentLoop?.stopped),
    decodeAudio:source=>request('pcm.decode',[source],run.currentLoop),
  });
  const native = {...nativeBase,apis:Object.fromEntries(Object.entries(nativeBase.apis).map(([name,api])=>[name,keyboardApi(api)]))};
  const primaryPcmClient = primaryPcmConnection ? createRf5c164Client(
    performanceTransport.port(primaryPcmConnection.port, 'independent'), source => request('pcm.decode',[source],run.currentLoop)) : null;
  if (primaryPcmClient) primaryPcmClient._adoptClock(primaryPcmConnection.clock ?? CHIP_CLOCKS.rf5c164);
  const primaryPcm = primaryPcmClient ? keyboardApi(borrowNativeApi(primaryPcmClient, 'rf5c164', () => {
    if (primaryPcmConnection.clock === primaryPcmClient.clock) return;
    primaryPcmConnection.clock = primaryPcmClient.clock;
    postMessage({type:'primary-pcm-clock',clock:primaryPcmClient.clock});
  }, () => (!run.stopped || run.currentLoop?.keyboardCleanup) && !run.currentLoop?.stopped)) : null;
  const chip = !nativePrimary && chipConnection ? createWorkerChip({...chipConnection,port:performanceTransport.port(chipConnection.port,'chip'),capabilities,observe:event=>postMessage({type:"chip-observer",event})}) : null;
  run.adoptNativeState=(name,state,authorEdit)=>native.adopt(name,state,authorEdit);
  run.adoptExtraOplState=(id,state,instance,authorEdit)=>{if(!Number.isSafeInteger(instance)||instance<1)return;for(const client of pcmClients)if(client.id===id&&pcmInstances.get(client)===instance){if(authorEdit&&client._applyAuthorEdit)client._applyAuthorEdit(authorEdit);else client._adoptState?.(state);}};
  run.resumeChip = () => chip?.resume();
  const workerDac = chip && capabilities.dac ? createWorkerDac(chip.send, timing) : null;
  run.resetSampleClock = () => { clock.resetSampleClock(); workerDac?.reset(); };
  let fallbackClock = timing.chipClock ?? CHIP_CLOCKS[capabilities.chip ?? 'ym2612'];
  const fm = keyboardApi(new Proxy({}, {
    get(_target, property) {
      if (Object.hasOwn(sections, property)) return sections[property];
      if (property === 'clock') return chip?.fm.clock ?? fallbackClock;
      if (property === 'setClock' && !chip) return async hz => { await request('fm.setClock', [hz], run.currentLoop); fallbackClock = hz; };
      if (property === "id") return capabilities.chip ?? "ym2612";
      if (property === "then") return undefined;
      if (property === 'dispose' && capabilities.backend === 'native-genesis') return undefined;
      if (property === "dac") {
        if (!capabilities.dac) return undefined;
        if (chip) return chip.fm.dac;
        return Object.fromEntries(['setSample','playFromSample','play','stop','removeSample'].map(method => [method, requestProxy(`fm.dac.${method}`)]));
      }
      if (property === "read" || property === "readStatus" || property === "getIrq") {
        return requestProxy(`fm.${String(property)}`);
      }
      const mainMethods = ["scheduleWrites", "clearScheduledWrites", "loadDacBank", "playDacBank", "clearDacPlayback"];
      if(workerDac && mainMethods.includes(property)) {
        return ({
          scheduleWrites: entries => chip.send({type:'schedule-writes',entries}),
          clearScheduledWrites: () => chip.send({type:'clear-scheduled-writes'}),
          loadDacBank: workerDac.api.load,
          playDacBank: (name,time) => chip.send({type:'play-dac-bank',name,time}),
          clearDacPlayback: () => chip.send({type:'clear-dac-playback'}),
        })[property];
      }
      return chip && !mainMethods.includes(property) ? chip.fm[property] : commandProxy(`fm.${String(property)}`);
    },
  }));
  const isGameboy = capabilities.chip === 'gameboy';
  const gameboy = isGameboy ? native.apis.gameboy ?? keyboardApi(chip?.gameboy ?? new Proxy({}, {
    get(_target, method) {
      if (method === 'then') return undefined;
      if (method === 'id') return 'gameboy';
      if (method === 'clock') return fallbackClock;
      if (method === 'setClock') return async hz => { await request('gameboy.invoke', [['setClock'],[hz]], run.currentLoop); fallbackClock=hz; };
      if (['pulse','wave','noise'].includes(method)) return new Proxy({}, {get:(_target, name)=>(...args)=>request('gameboy.invoke',[[method,String(name)],args],run.currentLoop)});
      return (...args)=>request('gameboy.invoke',[[String(method)],args],run.currentLoop);
    },
  })) : undefined;
  const sectionNames = capabilities.chip === 'ym2203' ? ['ssg']
    : capabilities.chip === 'ym2608' ? ['ssg','rhythm','adpcm']
    : ['ym2610','ym2610b'].includes(capabilities.chip) ? ['ssg','adpcmA','adpcmB'] : [];
  const sections = Object.fromEntries(
    sectionNames.map(section => [section, keyboardApi(chip?.[section] ?? new Proxy({}, {
      get(_target, method) {
        if (method === 'then') return undefined;
        if (method === 'clock' && ['ssg','adpcm','adpcmB'].includes(section)) return section === 'ssg'
          ? fm.clock / (capabilities.chip === 'ym2203' ? 2 : 4) : fm.clock;
        return (...args) => request('chip.section', [section, String(method), args], run.currentLoop);
      },
    }))]));
  if (sections.adpcmB) sections.adpcm = sections.adpcmB;
  const fxPort = nativeFXPort ? performanceTransport.port(nativeFXPort, 'fx') : null;
  const nativeSample=fxPort?createNativeSampleController(data=>fxPort.postMessage(data)):null;
  if(nativeSample){fxPort.onmessage=({data})=>nativeSample.accept(data);fxPort.start?.();}
  const unloadedSamples=new Set();
  const sample = nativeSample ? {
    async load(name,source){const pcm=await request('sample.decode',[name,source],run.currentLoop);if(run.stopped)throw new Error('Run stopped');unloadedSamples.delete(name);return nativeSample.load(name,pcm);},
    async play(name,options){if(unloadedSamples.has(name))throw new Error(`Unknown sample: ${name}`);if(!nativeSample.isLoaded(name)){const pcm=await request('sample.pcm',[name],run.currentLoop);if(run.stopped)throw new Error('Run stopped');await nativeSample.load(name,pcm);}if(run.stopped)throw new Error('Run stopped');return nativeSample.play(name,options);},
    stop:name=>nativeSample.stop(name),stopAll:()=>nativeSample.stopAll(),
    unload:name=>{unloadedSamples.add(name);const result=nativeSample.unload(name);request('sample.unload',[name],run.currentLoop).catch(error=>postCommand('warn',[error.message]));return result;},isLoaded:name=>nativeSample.isLoaded(name),get:name=>nativeSample.get(name),list:()=>nativeSample.list(),
  } : new Proxy({}, {
    get(target, property) {
      if (property in target) return target[property];
      return requestProxy(`sample.${String(property)}`);
    },
  });
  const stream = new Proxy({}, { get: (_target, property) => requestProxy(`stream.${String(property)}`) });
  const msm5205 = new Proxy({}, {get:(_target,property)=>property==='then'?undefined:requestProxy(`msm5205.${String(property)}`)});
  if(capabilities.pcEngineCd)sections.adpcm=msm5205;
  const cdda = new Proxy({}, { get: (_target, property) => property==='then'?undefined:requestProxy(`cdda.${String(property)}`) });
  const unavailable = (name) => () => { throw new Error(`${name} is not available for ${capabilities.chip ?? "this chip"}`); };
  if (chip?.psg && capabilities.backend === 'native-genesis') Object.defineProperty(chip.psg, 'id', {value:'segapsg',enumerable:true});
  const psg = keyboardApi(native.apis.psg ?? chip?.psg ?? (capabilities.psg ? new Proxy({}, {
    get(_target, property) {
      return commandProxy(`psg.${String(property)}`);
    },
  }) : new Proxy({}, { get: () => unavailable("Mega Drive PSG") })));
  const dac = workerDac?.api ?? (capabilities.dac ? {
    load: (...args) => request("dac.load", args, run.currentLoop),
    loadBase64: (...args) => request("dac.loadBase64", args, run.currentLoop),
    playStream: (...args) => postCommand("dac.playStream", args),
    schedule: (...args) => postCommand("dac.schedule", args),
    scheduleBase64: (...args) => postCommand("dac.scheduleBase64", args),
  } : new Proxy({}, { get: () => unavailable("YM2612 DAC") }));
  let nextAudioHandle = 1;
  const createHandle = (kind) => {
    const id = `${kind}-${nextAudioHandle++}`;
    run.audioHandles.add(id);
    return id;
  };
  const handleId = (value) => value?.__playgroundHandle ?? value;
  const control = (id, path) => ({
    get: () => request("audio.get", [id, path], run.currentLoop),
    set: (value) => postCommand("audio.call", [id, path, "set", [value]]),
    rampTo: (value, seconds) => postCommand("audio.call", [id, path, "rampTo", [value, seconds]]),
  });
  const noiseHandle = (id) => ({
    __playgroundHandle: id,
    start: () => postCommand("audio.call", [id, [], "start", []]),
    stop: () => postCommand("audio.call", [id, [], "stop", []]),
    dispose: () => postCommand("audio.call", [id, [], "dispose", []]),
    attack: control(id, ["attack"]),
    release: control(id, ["release"]),
    gain: control(id, ["gain"]),
    pan: control(id, ["pan"]),
    filter: {
      set: (...args) => postCommand("audio.call", [id, ["filter"], "set", args]),
      cutoff: control(id, ["filter", "cutoff"]),
      q: control(id, ["filter", "q"]),
    },
  });
  const fxHandle = (id) => new Proxy(
    { __playgroundHandle: id },
    {
      get(target, property) {
        if (property === "__playgroundHandle") return target.__playgroundHandle;
        return control(id, [String(property)]);
      },
    }
  );
  const liveFxLifecycle = createLiveFxLifecycle();
  const createFX = capabilities.backend === 'native-genesis' ? createNativeGenesisFX : null;
  const fxBase = nativeFXPort ? (createFX
    ? createFX({send:data => fxPort.postMessage(data),getBeatSeconds:() => 60 / clock.getBpm()})
    : createNativeFXController(data => fxPort.postMessage(data), {getBeatSeconds: () => 60 / clock.getBpm()})) : new Proxy({}, {
    get(_target, method) {
      if (method === "setChain") return (effects) => postCommand("fx.setChain", [effects.map(handleId)]);
      if (method === "clear") return () => postCommand("fx.clear");
      if (method === "branch" || method === "parallel") return (...effects) => {
        const id = createHandle("fx");
        postCommand("fx.compose", [id, String(method), effects.map(handleId)]);
        return fxHandle(id);
      };
      return (options = {}) => {
        const id = createHandle("fx");
        postCommand("fx.create", [id, String(method), options]);
        return fxHandle(id);
      };
    },
  });
  const fx = new Proxy(fxBase, {get(target,key){
    if(key!=='liveFx')return Reflect.get(target,key);
    return (...args)=>liveFxLifecycle.track(target, run.collectingLiveFx ?? run.liveFxDefinitions).liveFx(...args);
  }});
  run.syncFXTempo = () => { if (nativeFXPort) fx.syncTempo(); };
  let nativeNoiseCleanup=null,preparingNativeNoise=null;
  const rawNativeNoiseController = nativeFXPort && capabilities.noise !== false ? createNativeNoiseController(data=>{
    if(nativeNoiseCleanup)nativeFXPort.postMessage({nativeNoiseCleanup,commands:[data]});
    else if(preparingNativeNoise&&['create','parameter'].includes(data.action))
      nativeFXPort.postMessage({nativePerformance:{session:preparingNativeNoise.session,owner:'script'},commands:[data]});
    else fxPort.postMessage(data);
  }) : null;
  const nativeNoiseController=capabilities.backend==='native-genesis'&&rawNativeNoiseController?{
    ...rawNativeNoiseController,
    create(options){
      // Construction only prepares silent DSP state. Keep it session-scoped so
      // a new loop can adopt this handle even if its creating loop is cancelled
      // before the bridge drains. AutoStart still uses the timed loop lease.
      const previous=preparingNativeNoise;preparingNativeNoise=performanceTransport.timestamp();
      try{return rawNativeNoiseController.create(options);}finally{preparingNativeNoise=previous;}
    },
  }:rawNativeNoiseController;
  const nativeNoiseOwnership=capabilities.backend==='native-genesis'&&nativeNoiseController
    ? createNativeNoiseOwnership(nativeNoiseController,{getContext:()=>run.currentLoop}) : null;
  const nativeNoise=nativeNoiseOwnership?.api??nativeNoiseController;
  run.noiseOwnership=nativeNoiseOwnership;
  run.releaseNoiseOwner=loop=>{
    const timestamp=performanceTransport.timestamp();
    if(nativeNoiseOwnership&&timestamp)nativeNoiseCleanup={session:timestamp.session,owner:loop.performanceOwner};
    try{nativeNoiseOwnership?.releaseOwner(loop);}finally{nativeNoiseCleanup=null;}
  };
  const noise = nativeNoise ?? {
    create(options = {}) {
      const id = createHandle("noise");
      postCommand("noise.create", [id, options]);
      return { ...noiseHandle(id), type: options.type ?? "white" };
    },
    stopAll: () => postCommand("noise.stopAll"),
  };

  const prepareResource = async (name, fn) => {
    if (run.prepared.has(name)) return run.prepared.get(name);
    const generation = run.generation;
    const prepareApi = { ...native.apis, ...(gameboy ? {gameboy} : {}), fm, ...sections, fx, psg, sample, cdda, msm5205, stream, dac, noise, control: (voice, options) => nativeNoise ? controlNativeNoise(voice,options) : postCommand("noise.control", [handleId(voice), options]), context: run.context, log: (...args) => postCommand("log", args) };
    if (!hasOpn) for (const name of ['fm','dac', ...(capabilities.chip === 'segapsg' ? [] : ['psg'])]) delete prepareApi[name];
    const value = await fn(prepareApi);
    if (run.stopped || generation !== run.generation) throw new Error("Run stopped");
    run.prepared.set(name, value);
    return value;
  };
  const livePrepare = (name,fn) => liveFxLifecycle.prepare(name, run.collectingLiveFx ?? run.liveFxDefinitions, () => prepareResource(name,fn));
  const liveLoop = (name, fn) => {
    if (typeof name !== "string" || !name) throw new Error("liveLoop(name, fn) requires a non-empty name");
    if (typeof fn !== "function") throw new Error("liveLoop(name, fn) requires a callback");
    (run.collectingLoops ?? run.loops).set(name, fn);
  };
  const liveCleanup = (names, fn) => {
    if (!Array.isArray(names) || names.length === 0 || typeof fn !== "function") {
      throw new Error("liveCleanup(names, fn) requires loop names and a callback");
    }
    (run.collectingCleanups ?? run.cleanups).push({ names, fn });
  };
  const pcmClients = new Set();
  const pcmInstances = new WeakMap();
  run.disposeExtraChip=(id,instance)=>{
    if(!Number.isSafeInteger(instance)||instance<1)return;
    for(const client of pcmClients)if(client.id===id&&pcmInstances.get(client)===instance)client.dispose();
  };
  let pcmSequence = 0;
  const soundChips = createSoundChipRegistry();
  const loopTasks = createLoopAsyncTasks({getLoop: () => run.currentLoop,
    cancelWaits: loop => clock.cancelWaits(loop),
    isActive: loop => !run.stopped && !loop.stopped && loop.generation === run.generation && run.loops.has(loop.name)});
  run.loopTasks = loopTasks;
  run.stop = async () => {
    if (run.stopped) return;
    const keyboardCleanup = musicalKeyboard.clear();
    run.stopped = true;
    performanceTransport.stop();
    for (const loop of run.runningLoops.values()) loop.stopped = true;
    soundChips.clear();
    run.token += 1;
    loopTasks.clear();
    clock.cancelWaits();
    run.generation += 1;
    for (const cleanup of run.cleanups) {
      try { await cleanup.fn(); }
      catch (error) {
        // Stop has already retired the performance. A user's awaited setter
        // can reject cancellation; it must not skip the remaining teardown.
        if (error?.name !== 'AbortError' && error?.message !== 'Run stopped') {
          postMessage({type: 'log', level: 'error', message: `[liveCleanup] ${serializeLogError(error)}`});
        }
      }
    }
    await keyboardCleanup;
    run.resetSampleClock();
    const primaryPcmReleases = [];
    run.currentLoop = null;
    // In Worker mode this is the sole source of audio-control commands.
    performanceTransport.immediateCleanup(() => {
      for(const pcm of pcmClients)pcm.dispose();
      pcmClients.clear();
      nativeSample?.stopAll();
      nativeNoiseOwnership?.clear();nativeNoiseController?.disposeAll();
      chip?.stop();
      primaryPcmReleases.push(native.stop().catch(()=>{}));
      primaryPcmClient?._cancelClockRequests('Run stopped');
      if (primaryPcmClient) for (let channel = 0; channel < 8; channel++) primaryPcmReleases.push(Promise.resolve(primaryPcmClient.keyOff(channel)).catch(() => {}));
      localMidiRack?.stop();
    });
    await Promise.all(primaryPcmReleases);
    postCommand("audio.stopAll");
    if (nativeFXPort) performanceTransport.immediateCleanup(() => fx.dispose()); else postCommand("fx.detach");
    postCommand("audio.disposeHandles", [[...run.audioHandles]]);
    run.audioHandles.clear();
    run.prepared.clear();
    liveFxLifecycle.clear();
    run.cleanups = [];
    run.keyboard.clear();
    run.loops.clear();
    for (const key of Object.keys(run.context)) delete run.context[key];
  };
  const registerKeyboard = (eventType, name, fn) => {
    if (typeof name !== "string" || !name || typeof fn !== "function") throw new Error("Keyboard handler requires a name and callback");
    const id = `${eventType}:${name}`;
    (run.collectingKeyboard ?? run.keyboard).set(id, fn);
    postCommand("keyboard.register", [id, eventType]);
  };
  const choose = (values) => values[Math.floor(Math.random() * values.length)];
  const noteToMidi = (noteName) => {
    const match = /^([A-G](?:#|b)?)(-?\d+)$/.exec(String(noteName).trim());
    const semitones = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
    if (!match || semitones[match[1]] === undefined) throw new Error(`Unsupported note name: ${noteName}`);
    return (Number(match[2]) + 1) * 12 + semitones[match[1]];
  };
  const midiToNote = (midi) => {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  };
  const scale = (root, name, octaves = 1) => {
    const intervals = scaleIntervals[name];
    if (!intervals) throw new Error(`Unknown scale: ${name}`);
    const rootMidi = noteToMidi(root);
    return Array.from({ length: Math.max(0, Number(octaves) || 0) }, (_, octave) => intervals.map((interval) => midiToNote(rootMidi + octave * 12 + interval))).flat();
  };
  const chordIntervals = {
    major: [0, 4, 7], minor: [0, 3, 7], major7: [0, 4, 7, 11],
    minor7: [0, 3, 7, 10], dominant7: [0, 4, 7, 10],
  };
  const chord = (root, name) => {
    const intervals = chordIntervals[name];
    if (!intervals) throw new Error(`Unsupported chord: ${name}`);
    const rootMidi = noteToMidi(root);
    return intervals.map((interval) => midiToNote(rootMidi + interval));
  };
  const pitchFromMidi = midi => midiToOpnPitch(midi, fm.clock ?? CHIP_CLOCKS[capabilities.chip ?? 'ym2612'], capabilities.chip === 'ym2203' ? 72 : 144);
  const noteToBlockFnum = (note) => pitchFromMidi(typeof note === "number" ? note : noteToMidi(note));
  const noteLerp = (from, to, amount) => pitchFromMidi(
    noteToMidi(from) + (noteToMidi(to) - noteToMidi(from)) * Number(amount)
  );
  const tween = (duration, onUpdate) => {
    const token=run.token, context=run.currentLoop;
    return runTween(duration,onUpdate,{
      seconds:()=>performance.now()/1000,beats:clock.currentBeat,getBpm:clock.getBpm,sleep:clock.sleep,
      check:()=>{
        if(context?.interruptError && !run.stopped && !context.stopped)throw context.interruptError;
        if(run.stopped || token!==run.token || context?.stopped || (context && !context.keyboard && !run.loops.has(context.name)))throw new Error('Run stopped');
      },
    });
  };
  let localMidiRack=null;
  const midi=createMidiApi((method,args)=> {
    if(method==='playFile')return request('midi.file',args,run.currentLoop);
    if(chip && capabilities.chip==='ym2612'){
      if(chip.raw.dac?.enabled)throw new Error('Disable DAC before using MIDI FM playback');
      localMidiRack ??= createMidiRack({
        getClockScale:() => CHIP_CLOCKS.ym2612 / (fm.clock ?? CHIP_CLOCKS.ym2612),
        preset:Object.values(presets)[0] ?? {},
        write:entry=>chip.write(entry.port,entry.register,entry.value),
        writePsg:entry=>chip.psg.write(entry.value),
      });
      if(method==='release')return localMidiRack.noteOff(args[0],args[1],args[2],undefined,args[3],args[4]);
      return localMidiRack[method](...args);
    }
    return request('midi.invoke',[method,args],run.currentLoop);
  },{sleep:clock.sleep,waitBeats:clock.waitBeats,bpm:clock.getBpm,owner:()=>run.currentLoop?.name??null,check:()=>{if(run.stopped || run.currentLoop?.stopped)throw new DOMException('Run stopped','AbortError');}});
  run.midi=midi;
  run.adoptChipState=state=>chip?.adoptState(state);
  run.adoptChipClock=hz=>{fallbackClock=hz;chip?.raw._adoptClock(hz);};
  const resumeScopedNativeExtra=(context,token,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{if(run.stopped||token!==run.token||context?.stopped)throw new Error('Run stopped');run.currentLoop=context;resolve(callback());}catch(error){reject(error);}},0));
  const localNoteOwners=new Map();
  const globals = {
    encodeBrr,
    encodeAdpcmA,
    encodePs1Adpcm,
    trackAsync: promise => loopTasks.track(promise),
    createSampleInstrument: (audio,options={}) => createSampleInstrumentFactory({pg:globals,audio,chip:capabilities.chip,...options}),
    keyboard: {bind(name,handlers) {
      if (!run.collectingMusicalBinding || run.stopped) throw new Error('keyboard.bind must be called during source evaluation');
      if (run.pendingMusicalBinding) throw new Error('Only one keyboard binding is supported per Run');
      run.pendingMusicalBinding=keyboardBinding(name,handlers);
    }},
    async inputAudio(options) {
      const token = run.token;
      if (run.stopped) throw new Error('Run stopped');
      const result = await request('audio.input', [options], run.currentLoop);
      if (run.stopped || token !== run.token) throw new Error('Run stopped');
      return result;
    },
    async useSoundChip(name, options) {
      const token = run.token,scoped=supportsNativeExtra(name)&&capabilities.chip!==name&&!nativeConnections.some(endpoint=>endpoint.name===name),caller=run.currentLoop;
      const check = () => { if (run.stopped || token !== run.token) throw new Error('Run stopped'); };
      check();
      const chip = await soundChips.use(name, options, chipName => {
        check();
        const endpoint = nativeConnections.find(endpoint => endpoint.name === chipName);
        if (endpoint) return native.apis[endpoint.globalName];
        if (chipName === 'rf5c164' && primaryPcm) return primaryPcm;
        if (chipName === 'gameboy' && isGameboy) return gameboy;
        if (chipName === 'segapsg' && capabilities.psg && capabilities.backend === 'native-genesis') return psg;
        if ((['ym2612', 'ym2203', 'ym2610', 'ym2610b'].includes(chipName) || chipName === 'ym2608' && capabilities.backend === 'native-genesis') && (capabilities.chip ?? 'ym2612') === chipName) return fm;
        if(scoped){const previous=run.currentLoop;run.currentLoop=null;try{return globals.createSoundChip(chipName,{id:`${chipName}:shared`});}finally{run.currentLoop=previous;}}
        return globals.createSoundChip(chipName, {id:`${chipName}:shared`});
      }, {evictOnDispose: !(name === 'rf5c164' && primaryPcm) && !(name === 'segapsg' && capabilities.psg && capabilities.backend === 'native-genesis') && !nativeConnections.some(endpoint => endpoint.name === name) && !((['ym2612', 'ym2203', 'ym2610', 'ym2610b'].includes(name) || name === 'ym2608' && capabilities.backend === 'native-genesis' || name === 'gameboy') && (capabilities.chip ?? 'ym2612') === name)});
      check();
      if(scoped)await resumeScopedNativeExtra(caller,token,()=>{});
      return chip;
    },
    async createSoundChip(name, options = {}){
      if(run.stopped)throw new Error('Run stopped');
      const token=run.token,scoped=supportsNativeExtra(name),caller=run.currentLoop;
      validateSoundChipOptions(name, options);
      options = {...options};
      const response=await request('pcm.create',[name, options],run.currentLoop,scoped?performanceTransport.timestamp():undefined,scoped);
      // Older test/host shims may return a bare port; production returns its allocated ID.
      const mixerId=response.id ?? options.id ?? `${name}:${++pcmSequence}`;
      if(scoped&&(run.stopped||token!==run.token||caller?.stopped)){
        (response.port??response).close?.();
        postMessage({type:'command',command:'pcm.dispose',args:[mixerId,response.instance]});
        throw new DOMException('Run stopped','AbortError');
      }
      const port=performanceTransport.port(response.port ?? response, name === 'spc' ? 'spc' : 'independent');
      const pcm=name === 'spc' ? createSpcClient(port, response, {
        captureContext:()=>run.currentLoop,restoreContext:loop=>{run.currentLoop=loop;},
        invokeEvent:(callback,event)=>executeWithWorkerGuards(()=>callback(event)),isStopped:loop=>run.stopped||token!==run.token||loop?.stopped,
      }) : ['pwm','snes'].includes(name)&&response.native || ['ps1','pokey','wonderswan','huc6280','okim6258','gameboy','nes','dx7','ym3526','ym3812','y8950','ymf262','ym2413','ay8910'].includes(name) ? createNativePrimaryClient(name,port,response,{captureContext:()=>run.currentLoop,restoreContext:loop=>{run.currentLoop=loop;},isStopped:loop=>run.stopped||token!==run.token||loop?.stopped,decodeAudio:source=>request('pcm.decode',[source],run.currentLoop)}) : name === 'snes' ? createSnesClient(port, response) : name === 'dx7' ? createDx7Client(port, response) : name === 'nes' ? createNesClient(port, response) : name === 'pwm' ? createPWM32XClient(port) : ['ym2612', 'ym2203', 'ym2610', 'ym2610b'].includes(name) ? createOpnClient(name, port,response,{captureContext:()=>run.currentLoop,restoreContext:loop=>{run.currentLoop=loop;},isStopped:loop=>run.stopped||token!==run.token||loop?.stopped}) : name === 'ym2151' ? createYm2151Client(port,response,{captureContext:()=>run.currentLoop,restoreContext:loop=>{run.currentLoop=loop;},isStopped:loop=>run.stopped||token!==run.token||loop?.stopped}) : name === 'segapsg' ? createSegaPsgClient(port,response) : name === 'gameboy' ? createGameboyClient(port) : name === 'ym2608' ? createYm2608Client(port,response,{captureContext:()=>run.currentLoop,restoreContext:loop=>{run.currentLoop=loop;},isStopped:loop=>run.stopped||token!==run.token||loop?.stopped,decodeAudio:source=>request('pcm.decode',[source],run.currentLoop)}) : createRf5c164Client(port,source=>request('pcm.decode',[source],run.currentLoop),{...response,captureContext:()=>run.currentLoop,restoreContext:loop=>{run.currentLoop=loop;},isStopped:loop=>run.stopped||token!==run.token||loop?.stopped});
      if(run.stopped || token!==run.token){pcm.dispose();throw new Error('Run stopped');}
      Object.defineProperty(pcm, 'id', {value: mixerId, enumerable: true});
      if(Number.isSafeInteger(response.instance)&&response.instance>0)pcmInstances.set(pcm,response.instance);
      const dispose=pcm.dispose.bind(pcm); let disposed=false;
      const release=immediate=>{if(disposed)return;disposed=true;try{dispose();}finally{pcmClients.delete(pcm);postMessage({type:'command',command:'pcm.dispose',args:[mixerId,response.instance],...(immediate?{}:{performance:performanceTransport.timestamp()})});}};
      pcm.dispose=()=>release(false);
      pcmClients.add(pcm);const api=keyboardApi(pcm);if(scoped)return resumeScopedNativeExtra(caller,token,()=>api).catch(error=>{release(true);throw error;});return api;
    },
    mixer: Object.fromEntries(['set', 'get', 'reset', 'list'].map(method => [method, (...args) => request('mixer.' + method, args, run.currentLoop)])),
    midi,
    console: {
      log: (...args) => postCommand("log", args),
      warn: (...args) => postCommand("warn", args),
      error: (...args) => postCommand("error", args),
    },
    log: (...args) => postCommand("log", args),
    ...native.apis, ...(gameboy ? {gameboy} : {}), fm, ...sections, fx, psg, dac, sample, cdda, msm5205, stream, noise,
    context: run.context,
    FM_PRESETS: presets,
    OPL_PRESETS,
    OPLL_INSTRUMENTS,OPLL_USER_PRESETS,
    tfiToPreset,
    CH1: 0, CH2: 1, CH3: 2, CH4: 3, CH5: 4, CH6: 5,
    CH7: 6, CH8: 7, CH9: 8, CH10: 9, CH11: 10, CH12: 11, CH13: 12, CH14: 13, CH15: 14, CH16: 15,
    PSG1: 0, PSG2: 1, PSG3: 2,
    OP1: 0, OP2: 1, OP3: 2, OP4: 3,
    write: (...args) => chip ? chip.write(...args) : postCommand("write", args),
    play: chip ? async (note,options={})=>{
      resolvePlaySeconds(options,clock.getBpm());
      const length=resolvePlayDuration(options);
      const channel=options.channel??0, owner={};
      if(options.preset){const preset=presets[options.preset];if(!preset)throw new Error('Unknown preset');fm.setPreset(channel,preset);}
      const pitch=noteToBlockFnum(note);fm.noteOn(channel,pitch.block,pitch.fnum);localNoteOwners.set(channel,owner);
      try{if(length.beats!==undefined)await clock.waitBeats(length.beats);else await clock.sleep(length.seconds);}finally{if(localNoteOwners.get(channel)===owner){fm.noteOff(channel);localNoteOwners.delete(channel);}}
    } : (note, options={}) => {
      resolvePlaySeconds(options,clock.getBpm());
      const length=resolvePlayDuration(options);
      return request("play", [note, {channel:options.channel, preset:options.preset, ...length}], run.currentLoop);
    },
    psgTone: chip?.psg ? (channel,period,attenuation=0)=>psg.tone(channel,{period,attenuation}) : capabilities.psg ? (...args)=>postCommand("psgTone",args) : unavailable("Mega Drive PSG"),
    psgNoise: chip?.psg ? (mode,attenuation=0)=>{if(!Number.isInteger(mode)||mode<0||mode>7||!Number.isInteger(attenuation)||attenuation<0||attenuation>15)throw new Error("Invalid PSG noise values");psg.write(0xe0|mode);psg.write(0xf0|attenuation);} : capabilities.psg ? (...args)=>postCommand("psgNoise",args) : unavailable("Mega Drive PSG"),
    setMasterVolume: (...args) => request("setMasterVolume", args, run.currentLoop),
    getMasterVolume: () => request("getMasterVolume", [], run.currentLoop),
    setTiming: async (options) => {
      const timing = await request("setTiming", [options], run.currentLoop);
      clock.setDacLookahead(timing.lookaheadSeconds);
      workerDac?.setLookahead(timing.lookaheadSeconds);
      return timing;
    },
    getTiming: () => request("getTiming"),
    setDacLookahead: async (...args) => {
      const value = await request("setDacLookahead", args, run.currentLoop);
      clock.setDacLookahead(value);
      workerDac?.setLookahead(value);
      return value;
    },
    getDacLookahead: () => request("getDacLookahead"),
    beginSampleSchedule: () => { workerDac?.begin(); return clock.beginSampleSchedule(); },
    scheduleWritesSamples: (start, entries) => workerDac ? workerDac.schedule(start, entries) : postCommand("scheduleWritesSamples", [start, entries]),
    control: (voice, options) => nativeNoise ? controlNativeNoise(voice,options) : postCommand("noise.control", [handleId(voice), options]),
    sleep: clock.sleep,
    createTimeline() {
      const token = run.token;
      return createSecondsTimeline({
        now: () => performance.now() / 1000,
        sleep: clock.sleep,
        check: () => { if (run.stopped || token !== run.token) throw new DOMException('Run stopped', 'AbortError'); },
      });
    },
    sleepSamples: clock.sleepSamples,
    beat: clock.beat,
    nextBeat: clock.nextBeat,
    setBpm: clock.setBpm,
    livePrepare,
    liveFx: (name, options) => fx.liveFx(name, options),
    liveLoop,
    liveCleanup,
    stopLoop: (name) => { run.loops.delete(name); clock.cancelLoop(name); },
    stopAllLoops: () => { run.loops.clear(); clock.cancelLoop(); },
    onKeyboardPressKey: (name, fn) => registerKeyboard("keydown", name, fn),
    onKeyboardReleaseKey: (name, fn) => registerKeyboard("keyup", name, fn),
    stopAll: () => {native.cancelAdpcmLoads();for(const client of pcmClients)client._cancelAdpcmLoads?.();return postCommand("stopAll");},
    choose,
    cycle: createCycle(() => run.currentLoop),
    rand: Math.random,
    rrange: (min, max) => Number(min) + Math.random() * (Number(max) - Number(min)),
    randInt: (min, max) => Math.floor(Number(min) + Math.random() * (Number(max) - Number(min) + 1)),
    lerp: (a, b, amount) => Number(a) + (Number(b) - Number(a)) * Number(amount),
    scale,
    chord,
    tween,
    noteToBlockFnum,
    hzToBlockFnum: (hz, clock) => opnPitchFromHz(hz, clock ?? fm.clock ?? CHIP_CLOCKS[capabilities.chip ?? 'ym2612'], capabilities.chip === 'ym2203' ? 72 : 144, {clamp:true}),
    noteLerp,
    presets,
  };
  if (!hasOpn) {
    const opnNames = ['fm','psg','dac','midi','play','write','psgTone','psgNoise','scheduleWritesSamples',
      'noteToBlockFnum','hzToBlockFnum','noteLerp','FM_PRESETS','presets','tfiToPreset','vgiToPreset','setDacLookahead','getDacLookahead'];
    for (const name of Object.keys(globals)) {
      if (capabilities.chip === 'segapsg' && (name === 'psg' || /^PSG[123]$/.test(name))) continue;
      if (opnNames.includes(name) || /^(?:CH|PSG|OP)\d+$/.test(name)) delete globals[name];
    }
  }
  globals.pg = { ...globals };
  registerKeyboardScope(globals,()=>run.currentLoop,value=>{run.currentLoop=value;});
  registerKeyboardScope(globals.pg,()=>run.currentLoop,value=>{run.currentLoop=value;});

  run.handleKeyboard = (id, event) => {
    const handler = run.keyboard.get(id);
    if (!handler) return;
    void executeWithWorkerGuards(
      () => handler(event)
    ).catch((error) => {
      postMessage({
        type: "log",
        level: "error",
        message: `[keyboard:${id}] ${serializeLogError(error)}`,
      });
    });
  };
  run.execute = async (nextSourceCode = sourceCode) => {
    const generation = run.generation;
    run.currentLoop = null;
    // Global sequences belong to this evaluation; active loop slots survive Run.
    globals.cycle = createCycle(() => run.currentLoop);
    run.collectingLoops = new Map();
    run.collectingLiveFx = new Map();
    run.collectingCleanups = [];
    run.collectingKeyboard = new Map();
    run.collectingMusicalBinding = true;
    run.pendingMusicalBinding = null;
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const userFunction = new AsyncFunction(...Object.keys(globals), `"use strict";\n{\n${nextSourceCode}\n}`);
    try {await executeWithWorkerGuards(() => userFunction(...Object.values(globals)));}
    finally {run.collectingMusicalBinding=false;}
    if (run.stopped || generation !== run.generation) throw new Error("Run stopped");
    await musicalKeyboard.commit(run.pendingMusicalBinding,()=>!run.stopped&&generation===run.generation);
    if (run.stopped || generation !== run.generation) throw new Error('Run stopped');
    const definitions = run.collectingLoops;
    const cleanupDefinitions = run.collectingCleanups;
    run.keyboard = run.collectingKeyboard;
    run.collectingKeyboard = null;
    run.collectingLoops = null;
    run.collectingCleanups = null;
    liveFxLifecycle.commit(run.collectingLiveFx);
    run.liveFxDefinitions = run.collectingLiveFx;
    run.collectingLiveFx = null;
    for (const name of run.loops.keys()) {
      if (!definitions.has(name)) { run.loops.delete(name); clock.cancelLoop(name); }
    }
    for (const [name, fn] of definitions) run.loops.set(name, fn);
    const keyboardNames = new Set([...run.keyboard.keys()].map(id => id.slice(id.indexOf(':') + 1)));
    for (const cleanup of run.cleanups) {
      if (cleanup.keyboardScoped || !cleanup.names.some((name) => run.loops.has(name) || keyboardNames.has(name))) {
        await executeWithWorkerGuards(
          () => cleanup.fn()
        );
      }
    }
    run.cleanups = [];
    for (const cleanup of cleanupDefinitions) {
      cleanup.keyboardScoped = cleanup.names.some(name => keyboardNames.has(name));
      if (cleanup.names.some(name => run.loops.has(name) || keyboardNames.has(name))) run.cleanups.push(cleanup);
      else await executeWithWorkerGuards(() => cleanup.fn());
    }
    const sampleCursorSeconds = clock.currentSampleCursor();
    for (const name of definitions.keys()) {
      const existing = run.runningLoops.get(name);
      if (existing && !existing.stopped) continue;
      const generation = run.generation;
      const loopContext = { name, generation, performanceOwner: `loop:${++nextLoopOwner}`, stopped: false, cursorBeat: clock.currentBeat?.() ?? 0, sampleCursorSeconds,
        cycleState: new Map(), cycleCallIndex: 0 };
      run.runningLoops.set(name, loopContext);
      void (async () => {
        while (!run.stopped && !loopContext.stopped && generation === run.generation && run.loops.has(name)) {
          try {
            run.currentLoop = loopContext;
            loopContext.cycleCallIndex = 0;
            await executeWithWorkerGuards(
              () => run.loops.get(name)()
            );
            await loopTasks.finish(loopContext);
            if (loopContext.interruptError) throw loopContext.interruptError;
          } catch (error) {
            if (error?.message === "Run stopped") break;
            if (!run.stopped) postMessage({ type: "log", level: "error", message: `[liveLoop:${name}] ${serializeLogError(error)}` });
            if (loopContext.interruptError) break;
            await new Promise((resolve) => setTimeout(resolve, 16));
          } finally {
            if (run.currentLoop === loopContext) run.currentLoop = null;
          }
        }
        loopTasks.release(loopContext);
        if (run.runningLoops.get(name) === loopContext) run.runningLoops.delete(name);
      })();
    }
  };
  return run;
}

let lifecycleQueue = Promise.resolve();
let stopping = Promise.resolve();
let lifecycleGeneration = 0;

async function handleLifecycleMessage(message, generation = lifecycleGeneration) {
  if (message.type === "run") {
    await stopping;
    if (generation !== lifecycleGeneration) {
      postMessage({type: 'execution-error', message: 'Run stopped'});
      return;
    }
    const previousRun = currentRun;
    currentRun = previousRun ?? createRun(message.sourceCode, message.presets ?? {}, message.scaleIntervals ?? {}, message.capabilities ?? {}, message.timing ?? {});
    currentRun.performance.configure(message.performance ?? null);
    if (!previousRun && message.bpm !== undefined) currentRun.setBpm(message.bpm);
    if (currentRun.stopped) {
      currentRun.stopped = false;
      currentRun.resumeChip();
      currentRun.generation += 1;
      currentRun.runningLoops.clear();
      currentRun.resetSampleClock();
    }
    try {
      await currentRun.execute(message.sourceCode);
      postMessage({ type: "complete", loopCount: currentRun.loops.size, keyboardHandlerCount: currentRun.keyboard.size + (currentRun.keyboardTarget()?1:0) });
    } catch (error) {
      postMessage({ type: "execution-error", message: error?.message ?? String(error), stack: error?.stack });
    }
    return;
  }
  if (message.type === "stop") {
    await currentRun?.stop();
    postMessage({ type: "stopped" });
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'musical-keyboard') {currentRun?.handleMusicalKeyboard(message);return;}
  if (message.type === 'tempo') { currentRun?.setBpm(message.bpm); return; }
  if (message.type === 'extra-opl-state') {currentRun?.adoptExtraOplState(message.id,message.state,message.instance,message.authorEdit);return;}
  if (message.type === 'extra-chip-disposed') {currentRun?.disposeExtraChip(message.id,message.instance);return;}
  if (message.type === 'native-primary-state') {currentRun?.adoptNativeState(message.name,message.state,message.authorEdit);return;}
  if (message.type === 'chip-clock-state') { currentRun?.adoptChipClock(message.clock); return; }
  if (message.type === "chip-state") { currentRun?.adoptChipState(message.state); return; }
  if (message.type === "chip-port") { chipConnection?.port.close(); chipConnection={port:message.port,state:message.state}; return; }
  if (message.type === 'primary-pcm-port') {primaryPcmConnection?.port.close();primaryPcmConnection={port:message.port,clock:message.clock};return;}
  if (message.type === 'native-primary-ports') {for(const endpoint of nativeConnections)endpoint.port.close();nativeConnections=message.endpoints;return;}
  if (message.type === "native-fx") { nativeFXPort?.close(); nativeFXPort = message.port; return; }
  if (message.type === "stop") {
    lifecycleGeneration += 1;
    // Interrupt waits now: queuing stop behind run.execute would wait for the
    // very evaluation we need to cancel.
    stopping = stopping.then(() => handleLifecycleMessage(message))
      .catch(error => postMessage({ type: "log", level: "error", message: String(error) }));
    return;
  }
  if (message.type === "response") {
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id);
    if (currentRun&&(!pending.creationRun||pending.creationRun===currentRun&&pending.creationToken===currentRun.token&&!pending.loopContext?.stopped)) currentRun.currentLoop = pending.loopContext;
    if(message.error){const error=new Error(message.error);if(pending.creationRun&&message.name)error.name=message.name;pending.reject(error);}else pending.resolve(message.value);
    return;
  }
  if (message.type === "keyboard") {
    currentRun?.handleKeyboard(message.id, message.event);
    return;
  }
  const generation = lifecycleGeneration;
  lifecycleQueue = lifecycleQueue
    .catch(() => undefined)
    .then(() => handleLifecycleMessage(message, generation));
};
