import {createSpcAudio} from './playground_spc_audio.js?v=spc-events-1';
import {createSpcClient} from './playground_spc.js?v=spc-events-1';
import {createSnesAudio} from './playground_snes_audio.js?v=native-modes-3';
import {createSnesClient} from './playground_snes.js?v=native-modes-3';
import {createChipInspector} from './playground_chip_inspector.js?v=chip-tabs-2';
import {createPerformanceHost} from './playground_performance_host.js?v=spc-events-1';
import {DEFAULT_WORKER_LOOKAHEAD_SECONDS, validateWorkerLookahead} from './playground_performance_sender.js?v=opna-primary-1';
import {midiToOpnPitch, opnPitchFromHz} from './soundchip_pitch.js';
import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=audio-stability-2';
import {createNesAudio} from './playground_nes_audio.js?v=audio-stability-2';
import {createNesClient} from './playground_nes.js?v=audio-stability-2';
import {createDx7Audio} from './playground_dx7_audio.js';
import {createDx7Client} from './playground_dx7.js';
import {createPWM32XAudio} from './playground_pwm_audio.js?v=audio-stability-2';
import {createPWM32XClient} from './pwm32x_playback.js?v=audio-stability-2';
import {createYm2151Audio} from './playground_ym2151_audio.js?v=audio-stability-2';
import {createYm2151Client} from './playground_ym2151.js?v=audio-stability-2';
import {createSegaPsgAudio} from './playground_segapsg_audio.js?v=audio-stability-2';
import {createSegaPsgClient} from './playground_segapsg.js?v=audio-stability-2';
import {createLoopAsyncTasks} from './playground_async_tasks.js';
import {createOpnAudio} from './playground_opn_audio.js?v=audio-stability-2';
import {createOpnClient} from './playground_opn.js?v=audio-stability-2';
import {createSoundChipRegistry} from './playground_soundchips.js?v=native-modes-3';
import {createGameboyAudio} from './playground_gameboy_audio.js?v=audio-stability-2';
import {createPrimaryGameboyApi} from './playground_gameboy.js?v=audio-stability-2';
import {createGameboyClient} from './playground_gameboy.js?v=audio-stability-2';
import {borrowNativeApi, createNativePrimaryClient} from './playground_native_primary.js?v=audio-stability-2';
import {createHuc6280Audio} from './playground_huc6280_audio.js?v=audio-stability-2';
import {createOki6258Audio} from './playground_okim6258_audio.js?v=audio-stability-2';
import {createYm2608Audio} from './playground_ym2608_audio.js?v=audio-stability-2';
import {createYm2608Client} from './playground_ym2608.js?v=audio-stability-2';
import {createRf5c164Client} from './playground_rf5c164.js?v=audio-stability-2';
import {createRf5c164Audio} from './playground_rf5c164_audio.js?v=audio-stability-2';
import {samplePCM} from './native_sample.js?v=audio-stability-2';
import {formatLogArgs} from './playground_log.js';
import {createLiveFxLifecycle} from './native_fx.js?v=live-fx-definitions-1';
/**
 * @file playground_runtime.js
 * 実行環境: Browser（メインスレッド）
 * 依存: window のイベント処理、Web Audio 対応 Synth、Worker（Worker モード時）。
 * import とブラウザー上の実行・音声初期化は別。Node.js での実再生用ではない。
 */
import {createMidiRack, createMidiApi, validateBendRange, MIDI_SUPPORTED_CC} from './playground_midi.js?v=audio-stability-2';
import {parseMidiFile} from './midi_file.js?v=audio-stability-2';
import { createAudioScheduler } from "./playground_audio_scheduler.js";
import {
  FM_PRESETS,
} from "./megasynth.js?v=audio-stability-2";
import { createTetoricaSynth } from "./tetorica_synth.js?v=audio-stability-2";
import { createPlaygroundClock, createSecondsTimeline } from "./playground_clock.js?v=spc-song-timing-1";
import { capturePlaygroundNativeIpc, executeWithPlaygroundGuards } from "./playground_execution.js";
import { createPlaygroundLive } from "./playground_live.js?v=run-sample-clock-1";
import { createPlaygroundMusic } from "./playground_music.js?v=audio-stability-2";
import { createPlaygroundNoiseApi } from "./playground_noise.js";
import { createFmProxy } from "./playground_sync.js?v=audio-stability-2";
import { parseTfi } from "./tfi.js";
import { parseVgi } from "./vgi.js?v=audio-stability-2";

const NOTE_TO_SEMITONE = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};
const SCALE_INTERVALS = {
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/**
 * Create a reusable browser runtime with clocks, music helpers and execution lifecycle.
 * @param {{
 *   synth?: object | null,
 *   megaDrive?: object | null,
 *   chip?: "ym2612" | "ym2203" | "ym2608" | "ym2610" | "ym2610b" | "gameboy",
 *   workletUrl?: string,
 *   audioWorkletUrl?: string,
 *   ym2612WasmUrl?: string,
 *   segaPsgWasmUrl?: string,
 *   gameboyWasmUrl?: string,
 *   presets?: Record<string, object>,
 *   logicWorkerUrl?: string | null,
 *   execution?: "main" | "worker",
 *   dacLookaheadSeconds?: number,
 *   workerLookaheadSeconds?: number,
 *   guardExecution?: boolean,
 *   onStatus?: ((message: string) => void) | null,
 *   onRuntimeState?: ((state: string) => void) | null,
 *   onLog?: ((line: string) => void) | null,
 *   onReady?: ((context: { synth: object, megaDrive: object }) => void) | null,
 *   onMegaDriveEvent?: ((event: object) => void) | null,
 *   onAuditionReset?: (() => void) | null,
 * }} [options]
 * @returns Runtime controls and accessors; initialize audio before using the synth.
 */
export function createPlaygroundRuntime(
  options = {}
) {
  const megaDrive =
    options.synth ??
    options.megaDrive ??
    createTetoricaSynth({
      chip: options.chip,
      workletUrl:
        options.audioWorkletUrl ??
        options.workletUrl ??
        (['nes','snes','x68000','huc6280'].includes(options.chip) ? undefined : options.chip === 'gameboy' ? new URL('./playground_gameboy_worklet.js?v=audio-stability-2', import.meta.url).href
          : options.chip === 'ym2203' ? './ym2203-worklet.js?v=audio-stability-2'
          : options.chip === 'ym2608' ? './ym2608-worklet.js?v=audio-stability-2'
          : ['ym2610','ym2610b'].includes(options.chip)
            ? "./ym2610b-worklet.js?v=audio-stability-2" : "./ym2612-worklet.js?v=audio-stability-2"),
      ym2612WasmUrl:
        options.ym2612WasmUrl ??
        "./generated/ym2612_wasm.wasm",
      wasmUrl:
        options.wasmUrl ??
        (options.chip === "gameboy"
          ? options.gameboyWasmUrl ?? new URL("../generated/gameboy_apu_wasm.wasm", import.meta.url).href
          : options.chip === "ym2203"
          ? options.ym2203WasmUrl ?? "./generated/ym2203_wasm.wasm"
          : options.chip === "ym2608"
            ? options.ym2608WasmUrl ?? "./generated/ym2608_wasm.wasm"
            : ['ym2610','ym2610b'].includes(options.chip)
              ? options.ym2610bWasmUrl ?? "./generated/ym2610b_wasm.wasm"
            : undefined),
      segaPsgWasmUrl:
        options.segaPsgWasmUrl ??
        "./generated/segapsg_wasm.wasm",
    });
  const presets = {
    ...FM_PRESETS,
    ...(options.presets ?? {}),
  };
  const noiseApi =
    createPlaygroundNoiseApi(
      megaDrive
    );
  const capabilities =
    megaDrive.capabilities ?? {
      chip: "ym2612",
      fmChannels: 6,
      psg: Boolean(megaDrive.psg),
      dac: true,
    };
  const primarySectionNames = capabilities.chip === 'ym2203' ? ['ssg']
    : capabilities.chip === 'ym2608' ? ['ssg','rhythm','adpcm']
    : ['ym2610','ym2610b'].includes(capabilities.chip) ? ['ssg','adpcmA','adpcmB'] : [];
  const nativePrimary = ['nes','snes','x68000','huc6280'].includes(capabilities.chip);
  const hasOpn = !nativePrimary && capabilities.chip !== 'gameboy';
  const sourceMap =
    new Map();
  const liveFxLifecycle = createLiveFxLifecycle();
  const runtime = {
    bpm: 120,
    clockStartTime: null,
    liveLoops: new Map(),
    liveCleanupHooks:
      new Map(),
    livePrepared: new Map(),
    context: {},
    sampleClockStartTime: null,
    dacLookaheadSeconds: Math.max(
      0,
      Number(options.dacLookaheadSeconds) || 0.25
    ),
  };
  const audioScheduler = createAudioScheduler({
    now: () => megaDrive.audioContext?.currentTime ?? 0,
    send: (entries) => synth.scheduleWrites(entries),
  });
  audioScheduler.setTiming({ lookaheadSeconds: runtime.dacLookaheadSeconds, schedulerIntervalMs: Math.min(10, Math.max(1, runtime.dacLookaheadSeconds * 1000)) });
  let workerLookaheadSeconds = validateWorkerLookahead(options.workerLookaheadSeconds ?? DEFAULT_WORKER_LOOKAHEAD_SECONDS);
  /** Configure explicit scheduling and the next Worker performance's transport lead.
   * @param {{lookaheadSeconds?: number, schedulerIntervalMs?: number, workerLookaheadSeconds?: number}} options
   */
  function setTiming(options) {
    const nextLead = validateWorkerLookahead(options.workerLookaheadSeconds ?? workerLookaheadSeconds);
    const timing = audioScheduler.setTiming(options);
    workerLookaheadSeconds = nextLead;
    runtime.dacLookaheadSeconds = timing.lookaheadSeconds;
    return {...timing, workerLookaheadSeconds};
  }
  function getTiming() { return {...audioScheduler.getTiming(), workerLookaheadSeconds}; }
  const preparedFxUnits =
    new WeakSet();
  const activeNotes =
    new Set();
  const guardExecution =
    options.guardExecution !== false;
  // Tauri's invoke transport calls fetch dynamically. Keep only its native IPC
  // endpoint available while Main scripts/live callbacks block network access.
  const nativeIpc = capturePlaygroundNativeIpc(window);
  const defaultExecution =
    options.execution ?? "main";
  const defaultLogicWorkerUrl =
    new URL(
      "./playground_logic_worker.js?v=audio-stability-2",
      import.meta.url
    );
  const logicWorkerUrl =
    options.logicWorkerUrl ??
    defaultLogicWorkerUrl.href;

  const midiApis = new Set();
  let midiRack = null;
  let midiFilePlaying = false;
  let midiWriteBatch = null;
  let synth = null;
  let prepareAudioPromise = null;
  let stopFadeNode = null;
  let previousOutputNode = null;
  let pendingFadeStop = null;
  function resumeStopFade() {
    const context = megaDrive.audioContext;
    const audio = megaDrive.audio;
    if (!stopFadeNode && context?.createGain && audio?.connectOutput) {
      previousOutputNode = audio.outputNode ?? null;
      stopFadeNode = context.createGain();
      stopFadeNode.connect(previousOutputNode ?? context.destination);
      audio.connectOutput(stopFadeNode);
    }
    if (stopFadeNode && stopFadeNode.gain.value !== 1) {
      const now = context.currentTime;
      stopFadeNode.gain.cancelScheduledValues(now);
      stopFadeNode.gain.setValueAtTime(stopFadeNode.gain.value, now);
      stopFadeNode.gain.linearRampToValueAtTime(1, now + 0.008);
    }
  }
  let currentRunToken = 0;
  let currentLoopContext = null;
  const keyboardHandlers = new Map();
  let removeMegaDriveListener =
    null;
  let currentSourceName = null;
  let playbackState = "stopped";
  let logicWorker = null;
  let workerGlobals = null;
  const performanceHost = createPerformanceHost({getContext: () => megaDrive.audioContext,
    onSuspended: () => { stop(); emitStatus('Audio suspended. Press Run to start again.'); }});
  const pcmDevices = new Set();
  const spcLoopOwners = new WeakMap();
  let spcOwnerSequence = 0;
  function spcOwner(loop, token) {
    if (token !== currentRunToken || loop?.stopped) throw new DOMException('Run stopped', 'AbortError');
    if (!loop) return {session:token,owner:'script'};
    if (!spcLoopOwners.has(loop)) spcLoopOwners.set(loop, {session:token,owner:`spc-loop:${++spcOwnerSequence}`});
    return spcLoopOwners.get(loop);
  }
  const pendingPcmIds = new Set();
  const pendingPcmDisposals = new Map();
  let pcmSequence = 0;
  const soundChips = createSoundChipRegistry();
  const chipInspector = createChipInspector({decode:decodePcm,endpoints:()=>{
    const entries=[];
    if(megaDrive.psg&&megaDrive.node?.port)entries.push({id:'segapsg',kind:'segapsg',label:'Sega PSG (primary)',port:megaDrive.node.port});
    if(megaDrive.pcm&&megaDrive.pcmDevice?.node?.port)entries.push({id:'rf5c164',kind:'rf5c164',label:'RF5C164 (primary)',port:megaDrive.pcmDevice.node.port});
    if(megaDrive.pwm&&megaDrive.pwmDevice?.node?.port)entries.push({id:'pwm',kind:'pwm',label:'32X PWM (primary)',port:megaDrive.pwmDevice.node.port});
    for(const device of pcmDevices)if(['segapsg','rf5c164','pwm'].includes(device.chipName))entries.push({id:device.mixerId,kind:device.chipName,label:device.mixerId,port:device.node.port});
    return entries;
  }});
  let releaseInspectorMixerSubscription=null;
  function watchInspectorMixer() {
    releaseInspectorMixerSubscription??=megaDrive.mixer?.subscribe?.(()=>queueMicrotask(()=>chipInspector.notify()));
  }
  watchInspectorMixer();
  const gameboyOwners = new Map();
  let releasingGameboy = false;
  let sharedGameboy;
  let sharedGameboySynth;
  let sharedFm;
  let sharedFmSynth;
  let sharedSections = {};
  let sharedSectionSynth;
  const nativeOwners = new Map(), nativeApiCache = new WeakMap();
  function nativeVoice(name, path, args) {
    const method = path.at(-1);
    if (['allNotesOff','reset'].includes(method)) return {allOff:true};
    if (name === 'adpcm' && ['play','stop','keyOff'].includes(method)) return {key:0,on:method==='play'};
    if (name === 'nes' && path.length > 1) {
      const voice = path[0];
      const key = voice === 'pulse' ? args[0] : ({triangle:2,noise:3,dmc:4,fds:5})[voice];
      if (['noteOn','keyOn','play','noteOff','keyOff','stop'].includes(method)) return {key,on:['noteOn','keyOn','play'].includes(method)};
    }
    if (['noteOn','keyOn','noteOff','keyOff'].includes(method)) return {key:args[0],on:method==='noteOn'||method==='keyOn'};
    if (name === 'opm' && method === 'writeRegister' && args[0] === 8) return {key:args[1]&7,on:!!(args[1]&0x78)};
    return null;
  }
  function releaseNativeVoice(name, key) {
    const raw = megaDrive.primaryEndpoints?.find(endpoint => endpoint.globalName === name)?.client;
    if (!raw) return;
    if (name === 'adpcm') raw.stop(); else if (raw._forceKeyOff) raw._forceKeyOff(key); else raw.keyOff(key);
  }
  function nativePrimaryApis() {
    return Object.fromEntries((megaDrive.primaryEndpoints ?? []).map(endpoint => {
      const {globalName:name, client:raw} = endpoint;
      if (!nativeApiCache.has(raw)) nativeApiCache.set(raw, borrowNativeApi(raw, endpoint.name, () => {}, (path,args) => {
        const event = nativeVoice(name,path,args), loop = currentLoopContext;
        if (loop?.stopped) return false;
        if (!event) return true;
        if (event.allOff) {for (const key of nativeOwners.keys()) if(key.startsWith(name+':'))nativeOwners.delete(key);return true;}
        const key = name + ':' + event.key;
        if (event.on) nativeOwners.set(key,{name,key:event.key,owner:loop});
        else {
          if (loop && nativeOwners.has(key) && nativeOwners.get(key).owner !== loop) return false;
          nativeOwners.delete(key);
        }
        return true;
      }));
      return [name,nativeApiCache.get(raw)];
    }));
  }
  let sectionLoads = new AbortController();
  function primaryChipSections() {
    if (!primarySectionNames.length) return {};
    if (sharedSectionSynth === synth) return sharedSections;
    const core = synth?.fm ?? synth;
    sharedSections = {};
    for (const section of primarySectionNames) {
      const target = core?.[section];
      if (!target) continue;
      sharedSections[section] = Object.fromEntries(Object.getOwnPropertyNames(Object.getPrototypeOf(target))
        .filter(method => !method.startsWith('_') && !['constructor','resetState','observeWrite'].includes(method))
        .map(method => [method, (...args) => {
          if (section === 'rhythm' && method === 'loadRom' && args[0] instanceof ArrayBuffer) args[0] = new Uint8Array(args[0]);
          if (section === 'adpcm' && method === 'loadSample') {
            const [source, options = {}] = args;
            const signal = options.signal ? AbortSignal.any([sectionLoads.signal, options.signal]) : sectionLoads.signal;
            return target.loadSample(source, {...options, signal});
          }
          return target[method](...args);
        }]));
    }
    if (sharedSections.adpcmB) sharedSections.adpcm = sharedSections.adpcmB;
    sharedSectionSynth = synth;
    return sharedSections;
  }
  function primaryChipState() {
    if (capabilities.chip === 'gameboy') return synth?._getState?.();
    const core = synth?.fm ?? synth;
    const sections = {};
    if (primarySectionNames.length) {
      if (core?.ssg?._getState) sections.ssg = core.ssg._getState();
      if (core?.rhythm?.levels) sections.rhythm = {levels:Array.from(core.rhythm.levels)};
      if (core?.adpcm?.registers) sections.adpcm = {registers:Array.from(core.adpcm.registers)};
      if (core?.adpcmA?.levels) sections.adpcmA = {levels:Array.from(core.adpcmA.levels)};
      if (core?.adpcmB?.registers) sections.adpcmB = {registers:Array.from(core.adpcmB.registers)};
    }
    return {...core?.getState?.(), clock:sharedFm?.clock ?? core?.clock, ...sections};
  }
  // UI notes share the chip and its output gain, but own their channel until
  // released. The worklet arbitrates against Main and direct Worker writes.
  const auditionTokens = new Map();
  let auditionSequence = 0;
  function auditionChannel(channel) {
    if (!Number.isInteger(channel) || channel < 0 || channel >= capabilities.fmChannels) {
      throw new RangeError('Invalid audition channel');
    }
    return capabilities.chip === 'ym2610' ? [1, 2, 4, 5][channel] : channel;
  }
  function clearAuditions() {
    auditionTokens.clear();
    if (hasOpn) megaDrive.node?.port?.postMessage({type: 'clear-auditions'});
    options.onAuditionReset?.();
  }
  const auditionSynth = {
    get clock() {
      return sharedFm?.clock ?? (synth?.fm ?? synth)?.clock ?? CHIP_CLOCKS[capabilities.chip === 'ym2610b' ? 'ym2610' : capabilities.chip] ?? CHIP_CLOCKS.ym2612;
    },
    noteOn(channel, block, fnum) {
      const physicalChannel = auditionChannel(channel);
      if (!Number.isInteger(block) || block < 0 || block > 7 ||
          !Number.isInteger(fnum) || fnum < 0 || fnum > 2047) {
        throw new RangeError('Invalid audition pitch');
      }
      const port = megaDrive.node?.port;
      if (!port) throw new Error('Audition audio is not ready');
      if (auditionSequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Audition token limit reached');
      const token = ++auditionSequence;
      auditionTokens.set(channel, token);
      port.postMessage({type: 'audition-note-on', channel: physicalChannel, block, fnum, token});
    },
    noteOff(channel) {
      const physicalChannel = auditionChannel(channel);
      const token = auditionTokens.get(channel);
      if (token === undefined) return;
      auditionTokens.delete(channel);
      megaDrive.node?.port?.postMessage({type: 'audition-note-off', channel: physicalChannel, token});
    },
  };
  async function openPcm(name, token = currentRunToken, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['id', ...(name === 'nes' ? ['fds', 'clock'] : [])].includes(k))) throw new TypeError('createSoundChip supports {id}, and {fds, clock} for NES');
    if (name === 'nes' && options.fds !== undefined && typeof options.fds !== 'boolean') throw new TypeError('fds must be boolean');
    if(!['ym2612', 'ym2203', 'ym2610', 'rf5c164', 'ym2608', 'gameboy', 'segapsg', 'ym2151', 'pwm', 'nes', 'dx7', 'snes', 'spc', 'huc6280', 'okim6258'].includes(name)) throw new Error('Unsupported Playground sound chip: ' + name);
    // A Worker can retire a logical source at its future lookahead position,
    // then immediately request that same cached source again. Reconnect only
    // after the old endpoint is actually released, never into a different chip.
    if(options.id!==undefined)await pendingPcmDisposals.get(options.id);
    if(token!==currentRunToken)throw new Error('Run stopped');
    const occupied = id => pendingPcmIds.has(id) || [...pcmDevices].some(device=>device.mixerId===id) || megaDrive.mixer?.list().some(s => s.id === id && s.connected);
    const reservation = megaDrive.mixer?.reserveId?.(name, options.id);
    let mixerId = reservation?.id ?? options.id;
    if (mixerId === undefined) do {mixerId = `${name}:${++pcmSequence}`;} while (occupied(mixerId));
    if (typeof mixerId !== 'string' || !mixerId.trim()) throw new TypeError('Mixer id must be a nonempty string');
    if (occupied(mixerId)) {reservation?.release(); throw new Error(`Mixer id is already connected: ${mixerId}`);}
    const createAudio = name === 'huc6280' ? createHuc6280Audio : name === 'okim6258' ? createOki6258Audio : name === 'spc' ? createSpcAudio : name === 'snes' ? createSnesAudio : name === 'dx7' ? createDx7Audio : name === 'nes' ? (context, destination) => createNesAudio(context, destination, options) : name === 'pwm' ? createPWM32XAudio : ['ym2612', 'ym2203', 'ym2610'].includes(name) ? (context, destination) => createOpnAudio(context, destination, name) : name === 'ym2151' ? createYm2151Audio : name === 'segapsg' ? createSegaPsgAudio : name === 'gameboy' ? createGameboyAudio : name === 'ym2608' ? createYm2608Audio : createRf5c164Audio;
    pendingPcmIds.add(mixerId);
    let device;
    try {device = await createAudio(megaDrive.audioContext, megaDrive.audio.masterInputNode);}
    catch (error) {pendingPcmIds.delete(mixerId); reservation?.release(); throw error;}
    if(token !== currentRunToken){pendingPcmIds.delete(mixerId);reservation?.release();device.dispose();throw new Error('Run stopped');}
    let release = () => {};
    try {
      if (megaDrive.mixer) {
        device.node.disconnect(megaDrive.audio.masterInputNode);
        release = megaDrive.mixer.connect(mixerId, name, device.node, megaDrive.audio.masterInputNode, megaDrive.audioContext);
      }
    } catch (error) {device.dispose(); throw error;}
    finally {pendingPcmIds.delete(mixerId);reservation?.release();}
    const dispose = device.dispose; let disposed = false;
    device.dispose = () => {
      if (disposed) return; disposed = true;
      try {release();} finally {
        pcmDevices.delete(device);
        try {dispose();} finally {chipInspector.notify();}
      }
    };
    device.mixerId = mixerId; device.chipName = name;
    pcmDevices.add(device); chipInspector.notify(); return device;
  }
  async function decodePcm(source){
    if(source instanceof Uint8Array)source=source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength);
    if(typeof Blob !== 'undefined' && source instanceof Blob)source=await source.arrayBuffer();
    // Reuse the existing local-file URL policy and browser decoder, then release the cache.
    const name='__rf5c164_decode_'+(++pcmDecodeId);
    try{return samplePCM(await megaDrive.sample.load(name,source));}
    finally{megaDrive.sample.unload(name);}
  }
  let pcmDecodeId=0;

  let workerCommandQueue = Promise.resolve();
  let resolveLogicWorkerStop = null;
  let logicWorkerStopPromise = null;
  let workerLevelsMuted = false;
  const workerRunRequests = [];
  // Test doubles may not expose an audio runtime; production handles live there.
  const fallbackAudioHandles = new Map();
  const workerKeyboardHandlers =
    new Map();

  function setWorkerAudioHandle(id, value) {
    if (megaDrive.audio?.setAudioHandle) {
      return megaDrive.audio.setAudioHandle(id, value);
    }
    fallbackAudioHandles.get(id)?.dispose?.();
    fallbackAudioHandles.set(id, value);
    return value;
  }

  function getWorkerAudioHandle(id) {
    return megaDrive.audio?.getAudioHandle?.(id) ??
      fallbackAudioHandles.get(id);
  }

  function disposeWorkerAudioHandles(ids) {
    if (megaDrive.audio?.disposeAudioHandles) {
      megaDrive.audio.disposeAudioHandles(ids);
      return;
    }
    for (const id of ids ?? [...fallbackAudioHandles.keys()]) {
      fallbackAudioHandles.get(id)?.dispose?.();
      fallbackAudioHandles.delete(id);
    }
  }

  function emitStatus(message) {
    options.onStatus?.(message);
  }

  function emitRuntimeState(state) {
    options.onRuntimeState?.(state);
  }

  function emitLog(line) {
    options.onLog?.(line);
  }

  function setPlaybackState(state) {
    playbackState = state;
  }

  let applyingChipObserver=false;
  let pendingChipStateWorker=null;
  function installMegaDriveListener() {
    if (
      removeMegaDriveListener ||
      typeof megaDrive.addListener !==
        "function"
    ) {
      return;
    }

    removeMegaDriveListener =
      megaDrive.addListener(
        (event) => {
          if(logicWorker && !applyingChipObserver && pendingChipStateWorker !== logicWorker) {
            const worker = logicWorker;
            pendingChipStateWorker = worker;
            // Section helpers finish updating their register shadows after the
            // parent emits its write event. One snapshot at the end of this
            // turn also coalesces preset/register bursts without deep copies
            // for every setter, independently of an optional UI listener.
            queueMicrotask(() => {
              if (pendingChipStateWorker !== worker) return;
              pendingChipStateWorker = null;
              if (logicWorker === worker) worker.postMessage({type:"chip-state",state:primaryChipState()});
            });
          }
          options.onMegaDriveEvent?.(event);
        }
      );
  }

  function setMasterVolume(volume) {
    megaDrive.setMasterVolume(
      Number(volume)
    );
    return megaDrive.getMasterVolume();
  }

  function getMasterVolume() {
    return megaDrive.getMasterVolume();
  }

  function setDacLookahead(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        "DAC lookahead must be a non-negative number"
      );
    }
    setTiming({ lookaheadSeconds: value, schedulerIntervalMs: Math.min(getTiming().schedulerIntervalMs, Math.max(1, value * 1000)) });
    return value;
  }

  function getDacLookahead() {
    return runtime.dacLookaheadSeconds;
  }

  function controlNoiseVoice(
    voice,
    options = {}
  ) {
    if (
      !voice ||
      typeof voice !== "object" ||
      typeof voice.gain?.set !==
        "function" ||
      typeof voice.gain?.rampTo !==
        "function" ||
      typeof voice.pan?.set !==
        "function" ||
      typeof voice.pan?.rampTo !==
        "function" ||
      typeof voice.filter?.cutoff?.set !==
        "function" ||
      typeof voice.filter?.cutoff
        ?.rampTo !== "function" ||
      typeof voice.filter?.q?.set !==
        "function" ||
      typeof voice.filter?.q?.rampTo !==
        "function"
    ) {
      throw new Error(
        "control(voice, options) currently supports noise voices only"
      );
    }

    const slide =
      Math.max(
        0,
        Number(options.slide) || 0
      );
    const apply = (
      controlParam,
      value
    ) => {
      if (value == null) {
        return;
      }
      if (slide > 0) {
        controlParam.rampTo(
          value,
          slide
        );
        return;
      }
      controlParam.set(value);
    };

    apply(voice.gain, options.gain);
    apply(voice.pan, options.pan);
    apply(
      voice.filter.cutoff,
      options.cutoff
    );
    apply(voice.filter.q, options.q);
  }

  async function ensureMediaReady() {
    const token = currentRunToken, loop = currentLoopContext;
    if (pendingFadeStop || logicWorkerStopPromise || loop?.stopped) throw new Error('Run stopped');
    // Media preparation must never reopen the output gate after Stop.
    await ensureReady({resumeOutput: false});
    if (token !== currentRunToken || pendingFadeStop || logicWorkerStopPromise || loop?.stopped) throw new Error('Run stopped');
  }

  async function loadSample(
    name,
    source
  ) {
    await ensureMediaReady();
    return megaDrive.sample.load(
      name,
      source
    );
  }

  async function playSample(
    name,
    sampleOptions = {}
  ) {
    await ensureMediaReady();
    return megaDrive.sample.play(
      name,
      sampleOptions
    );
  }

  function stopSample(name) {
    megaDrive.sample.stop(name);
  }

  function unloadSample(name) {
    return megaDrive.sample.unload(name);
  }

  async function loadStream(
    name,
    url
  ) {
    await ensureMediaReady();
    return megaDrive.stream.load(
      name,
      url
    );
  }

  async function playStream(
    name,
    streamOptions = {}
  ) {
    await ensureMediaReady();
    return megaDrive.stream.play(
      name,
      streamOptions
    );
  }

  function pauseStream(name) {
    megaDrive.stream.pause(name);
  }

  function stopStream(name) {
    megaDrive.stream.stop(name);
  }

  function unloadStream(name) {
    return megaDrive.stream.unload(name);
  }

  function stopAllNotes() {
    clearAuditions();
    if (!synth) {
      return;
    }

    for (
      let channel = 0;
      channel < capabilities.fmChannels;
      channel += 1
    ) {
      synth.noteOff(channel);
    }

    activeNotes.clear();
  }

  function stopAllAudio() {
    soundChips.clear();
    for(const device of pcmDevices)device.dispose();
    pcmDevices.clear();
    midiApis.clear();
    midiRack?.stop();
    midiRack = null;
    midiFilePlaying = false;
    audioScheduler.clear();
    if (capabilities.dac) {
      synth?.clearScheduledWrites?.();
      synth?.clearDacPlayback?.();
      synth?.write?.(0, 0x2b, 0x00);
    }
    stopAllNotes();
    if (nativePrimary) {megaDrive.stopAllNative();nativeOwners.clear();}
    if (capabilities.chip === 'gameboy') {
      synth?._cancelClockRequests?.('Run stopped');
      megaDrive.node?.port?.postMessage({type:'clear-scheduled-writes'});
      releasingGameboy = true;
      try { if (synth?._getState?.().initialized) for (let channel = 0; channel < 4; channel++) synth.keyOff(channel); }
      finally { releasingGameboy = false; gameboyOwners.clear(); }
    }
    if (primarySectionNames.length) {
      sectionLoads.abort(new Error('Run stopped'));
      sectionLoads = new AbortController();
      const core = synth?.fm ?? synth;
      core?.transport?.cancelPending?.('Run stopped');
      for (let channel = 0; channel < 3; channel++) core?.ssg?.keyOff(channel);
      core?.rhythm?.keyOff([0,1,2,3,4,5]);
      core?.adpcmA?.keyOff([0,1,2,3,4,5]);
      core?.adpcm?.keyOff();
    }
    megaDrive.psg?.reset?.();
    megaDrive.sample.stopAll();
    megaDrive.stream.stop();
    noiseApi.stopAll();
  }

  const clockApi =
    createPlaygroundClock({
      runtime,
      getAudioContext: () =>
        megaDrive.audioContext,
      getCurrentRunToken: () =>
        currentRunToken,
      getCurrentLoopContext: () =>
        currentLoopContext,
      setCurrentLoopContext: (
        value
      ) => {
        currentLoopContext = value;
      },
    });

  function executeUserCallback(callback) {
    return executeWithPlaygroundGuards(
      callback,
      window,
      {
        enabled: guardExecution,
        nativeIpc,
      }
    );
  }

  const loopTasks = createLoopAsyncTasks({getLoop: () => currentLoopContext,
    cancelWaits: loop => clockApi.cancelWaits(loop)});
  const liveApi =
    createPlaygroundLive({
      runtime,
      megaDrive,
      preparedFxUnits,
      currentBeat:
        clockApi.currentBeat,
      currentSampleCursor: clockApi.currentSampleCursor,
      getCurrentLoopContext: () =>
        currentLoopContext,
      setCurrentLoopContext: (
        value
      ) => {
        currentLoopContext = value;
      },
      logLine: emitLog,
      setStatus: emitStatus,
      executeCallback: executeUserCallback,
      finishTasks: loop => loopTasks.finish(loop),
      releaseTasks: loop => loopTasks.release(loop),
      cancelWaits: state => {
        for (const [key, voice] of nativeOwners) if (voice.owner === state) {
          nativeOwners.delete(key); releaseNativeVoice(voice.name,voice.key);
        }
        if (capabilities.chip === 'gameboy') {
          releasingGameboy = true;
          try { for (const [channel, owner] of gameboyOwners) if (owner === state) {
            gameboyOwners.delete(channel); synth?.keyOff(channel);
          }} finally { releasingGameboy = false; }
        }
        const owner = spcLoopOwners.get(state);
        if (owner) for (const device of pcmDevices) if (device.chipName === 'spc') {
          device.node.port.postMessage({type:'performance-cancel-owner',...owner});
        }
        loopTasks.release(state);for (const api of midiApis) api.cancelOwner(state.name);clockApi.cancelWaits(state);
      },
    });

  function psgTone(
    channel,
    period,
    attenuation = 0
  ) {
    const normalizedChannel =
      Number(channel);
    const normalizedPeriod =
      Number(period);
    const normalizedAttenuation =
      Number(attenuation);

    if (
      !Number.isInteger(
        normalizedChannel
      ) ||
      normalizedChannel < 0 ||
      normalizedChannel > 2
    ) {
      throw new Error(
        "psgTone channel must be 0..2"
      );
    }
    if (
      !Number.isInteger(
        normalizedPeriod
      ) ||
      normalizedPeriod < 0 ||
      normalizedPeriod > 0x3ff
    ) {
      throw new Error(
        "psgTone period must be an integer in range 0..1023"
      );
    }
    if (
      !Number.isInteger(
        normalizedAttenuation
      ) ||
      normalizedAttenuation < 0 ||
      normalizedAttenuation > 15
    ) {
      throw new Error(
        "psgTone attenuation must be 0..15"
      );
    }
    if (!capabilities.psg || !megaDrive.psg) {
      throw new Error(
        "Mega Drive PSG is only available when ?chip=ym2612"
      );
    }

    const latchBase =
      0x80 |
      (normalizedChannel << 5);
    megaDrive.psg.write(
      latchBase |
        (normalizedPeriod & 0x0f)
    );
    megaDrive.psg.write(
      (normalizedPeriod >> 4) &
        0x3f
    );
    megaDrive.psg.write(
      0x90 |
        (normalizedChannel << 5) |
        normalizedAttenuation
    );
  }

  function psgNoise(
    mode,
    attenuation = 0
  ) {
    const normalizedMode =
      Number(mode);
    const normalizedAttenuation =
      Number(attenuation);

    if (
      !Number.isInteger(
        normalizedMode
      ) ||
      normalizedMode < 0 ||
      normalizedMode > 7
    ) {
      throw new Error(
        "psgNoise mode must be 0..7"
      );
    }
    if (
      !Number.isInteger(
        normalizedAttenuation
      ) ||
      normalizedAttenuation < 0 ||
      normalizedAttenuation > 15
    ) {
      throw new Error(
        "psgNoise attenuation must be 0..15"
      );
    }
    if (!capabilities.psg || !megaDrive.psg) {
      throw new Error(
        "Mega Drive PSG is only available when ?chip=ym2612"
      );
    }

    megaDrive.psg.write(
      0xe0 | normalizedMode
    );
    megaDrive.psg.write(
      0xf0 | normalizedAttenuation
    );
  }

  function requireDac() {
    if (!capabilities.dac) {
      throw new Error(
        "YM2612 DAC is only available when ?chip=ym2612"
      );
    }
  }

  function createFxApi() {
    if (megaDrive.audio?.createFXApi) {
      return megaDrive.audio.createFXApi({
        getBeatSeconds: () =>
          clockApi.beatsToSeconds(1),
      });
    }

    // Defer this error so non-FX scripts work with lightweight test doubles.
    return new Proxy({}, {
      get() {
        return () => {
          throw new Error("FX requires TetoricaAudioRuntime");
        };
      },
    });
  }

  async function ensureReady({resumeOutput = true} = {}) {
    watchInspectorMixer();
    const token = currentRunToken;
    const resumeOutputIfCurrent = () => {
      if (resumeOutput && token === currentRunToken && !pendingFadeStop) resumeStopFade();
    };
    if (pendingFadeStop) await pendingFadeStop;
    if (prepareAudioPromise) {
      await prepareAudioPromise;
      resumeOutputIfCurrent();
      return synth;
    }

    if (synth) {
      if (logicWorkerStopPromise) await logicWorkerStopPromise;
      await megaDrive.resume();
      // Worker Stop silences hardware TL registers without changing saved patches.
      // Restore them before a main-thread keyboard audition or the next Run.
      if (workerLevelsMuted) {
        const core = synth.fm ?? synth;
        const channels = core.getState?.()?.channels;
        if (channels && typeof core.setOperator === 'function') {
          channels.forEach((channel, index) => channel.operators.forEach((operator, slot) => {
            core.setOperator(index, slot, {tl: operator.tl});
          }));
        }
        workerLevelsMuted = false;
      }
      resumeOutputIfCurrent();
      emitRuntimeState(
        "Audio ready"
      );
      return synth;
    }

    emitStatus(
      "Loading audio..."
    );
    emitRuntimeState(
      "Preparing..."
    );

    prepareAudioPromise =
      (async () => {
        await megaDrive.start();
        await megaDrive.audio?.prepareNativeFX?.();
        resumeOutputIfCurrent();
        if (megaDrive.audio?.nativeFX) {
          megaDrive.audio.nativeFX.onError = (message) => {
            options.onLog?.(`[FX] ${message}`);
            emitStatus(`FX error: ${message.split('\n')[0]} (see Console)`);
          };
        }
        synth = nativePrimary ? megaDrive : capabilities.chip === 'gameboy' ? megaDrive.gameboy : megaDrive.fm;
        if (capabilities.chip === 'gameboy') synth._beforeWrite = (register,value) => {
          const loop = currentLoopContext;
          if (!releasingGameboy && loop?.stopped) return false;
          const trigger = [4,9,14,19].indexOf(register);
          const released = ({2:0,7:1,17:3})[register];
          const channel = trigger >= 0 && (value & 128) ? trigger
            : released !== undefined && value === 0 ? released : register === 10 && !(value & 128) ? 2 : undefined;
          if (channel !== undefined) {
            if (trigger >= 0) gameboyOwners.set(channel,loop ?? null);
            else {
              if (!releasingGameboy && loop && gameboyOwners.has(channel) && gameboyOwners.get(channel) !== loop) return false;
              gameboyOwners.delete(channel);
            }
          }
          return true;
        };
        chipInspector.notify();
        installMegaDriveListener();
        if (hasOpn) synth.setPreset?.(
          0,
          presets["one-op-basic"]
        );
        emitRuntimeState(
          "Audio ready"
        );
        emitStatus("Audio ready.");
        options.onReady?.({
          synth,
          megaDrive,
        });
      })();

    try {
      await prepareAudioPromise;
    } finally {
      prepareAudioPromise = null;
    }

    return synth;
  }

  async function initialize() {
    await ensureReady();
  }

  /** An explicit keyboard audition starts after the preceding Stop has finished. */
  async function prepareAudition() {
    if (pendingFadeStop) await pendingFadeStop;
    return ensureReady();
  }

  function registerKeyboardHandler(
    eventType,
    name,
    fn,
    evaluationState
  ) {
    if (
      typeof name !== "string" ||
      name.length === 0
    ) {
      throw new Error(
        "Keyboard handler name must be a non-empty string"
      );
    }

    if (typeof fn !== "function") {
      throw new Error(
        "Keyboard handler callback must be a function"
      );
    }

    evaluationState.keyboardDefinitions.set(
      `${eventType}:${name}`,
      { eventType, name, fn }
    );
  }

  function clearKeyboardHandlers() {
    for (const handler of keyboardHandlers.values()) {
      window.removeEventListener(
        handler.eventType,
        handler.listener
      );
    }
    keyboardHandlers.clear();
    for (const handler of workerKeyboardHandlers.values()) {
      window.removeEventListener(
        handler.eventType,
        handler.listener
      );
    }
    workerKeyboardHandlers.clear();
  }

  function stopLogicWorker() {
    if (!logicWorker) {
      return Promise.resolve();
    }
    performanceHost.stop();
    if (logicWorkerStopPromise) return logicWorkerStopPromise;
    const worker = logicWorker;
    workerLevelsMuted = true;
    let timer;
    let finish;
    const stopped = new Promise((resolve) => {
      finish = () => {
        clearTimeout(timer);
        if (resolveLogicWorkerStop === finish) {
          resolveLogicWorkerStop = null;
          logicWorkerStopPromise = null;
        }
        resolve();
      };
    });
    logicWorkerStopPromise = stopped;
    resolveLogicWorkerStop = finish;
    // A timeout is not a stop acknowledgement: old cleanup commands can still
    // arrive and mute the next Run. Retire an unresponsive Worker instead.
    timer = setTimeout(() => {
      if (logicWorker === worker) {
        terminateLogicWorker();
        stopAllAudio();
      }
      finish();
    }, 2000);
    worker.postMessage({ type: "stop" });
    return stopped;
  }

  function terminateLogicWorker() {
    performanceHost.stop();
    const error = new DOMException("Playground Worker was terminated", "AbortError");
    while (workerRunRequests.length > 0) workerRunRequests.shift().reject(error);
    resolveLogicWorkerStop?.();
    megaDrive.audio?.nativeFX?.stop();
    if(nativePrimary)for(const endpoint of megaDrive.primaryEndpoints)endpoint.node.port.postMessage({type:'detach-chip-port',primaryWorker:true});
    else megaDrive.node?.port.postMessage({type:"detach-chip-port"});
    logicWorker?.terminate();
    logicWorker = null;
    megaDrive.audio?.nativeFX?.useMain();
    workerGlobals = null;
    workerCommandQueue = Promise.resolve();
    resolveLogicWorkerStop = null;
    disposeWorkerAudioHandles();
  }

  function serializeKeyboardEvent(event) {
    return {
      type: event.type,
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
  }

  function registerWorkerKeyboardHandler(
    id,
    eventType
  ) {
    const listener = (event) => {
      logicWorker?.postMessage({
        type: "keyboard",
        id,
        event: serializeKeyboardEvent(event),
      });
    };
    workerKeyboardHandlers.set(id, {
      eventType,
      listener,
    });
    window.addEventListener(eventType, listener);
  }

  async function invokeWorkerCommand(
    command,
    args,
    performance = null
  ) {
    const globals = workerGlobals;
    if (!globals) {
      throw new Error("Playground Worker is not running");
    }

    if(command==='pcm.create'){const device=await openPcm(args[0], currentRunToken, args[1]);
      try { await performanceHost.attach(device.node?.port); } catch(error) {device.dispose();throw error;}
      if(!performanceHost.clock && playbackState !== 'running'){device.dispose();throw new Error('Run stopped');}
      return {port:device.port,id:device.mixerId,clock:device.clock,fdsEnabled:device.fdsEnabled,sampleRate:device.sampleRate,internalSampleRate:device.internalSampleRate,voices:device.voices,selectedVoice:device.selectedVoice};}
    if(command==='pcm.dispose') {
      const devices=[...pcmDevices].filter(device=>device.mixerId===args[0]);
      if(!devices.length)return;
      let finish;
      const pending=new Promise(resolve=>{finish=resolve;});
      pendingPcmDisposals.set(args[0],pending);
      const cleanup=()=>{
        if(performance && performanceHost.clock?.session===performance.session &&
            megaDrive.audioContext.currentTime < performance.time) {setTimeout(cleanup,10);return;}
        try {for(const device of devices){performanceHost.detach(device.node?.port);device.dispose();}}
        catch(error){emitLog(formatLogArgs([error]));}
        finally {if(pendingPcmDisposals.get(args[0])===pending)pendingPcmDisposals.delete(args[0]);finish();}
      };
      cleanup(); return;
    }
    if(command.startsWith('mixer.')) {const method=command.slice(6);if(!['set','get','reset','list'].includes(method)) throw new Error('Unknown mixer method');return megaDrive.mixer[method](...args);}
    if(command==='pcm.decode')return decodePcm(args[0]);
    if (command === "midi.file") return globals.midi.playFile(...args);
    if (command === "midi.invoke") {
      const [method,values]=args;
      if (!["enableSoundChip","setVoice","noteOn","noteOff","pitchBend","setPitchBendRange","cc","release"].includes(method)) throw new Error("Unsupported MIDI method");
      if(midiFilePlaying)throw new Error('Manual MIDI operations are unavailable during MIDI file playback');
      const rack=getMidiRack();
      if(method==='release')return rack.noteOff(values[0],values[1],values[2],undefined,values[3],values[4]);
      return rack[method](...values);
    }
    if (command === "fx.create") {
      const [id, method, options] = args;
      const factory = globals.fx[method];
      if (typeof factory !== "function") throw new Error(`Unsupported FX: ${method}`);
      setWorkerAudioHandle(id, factory(options));
      return;
    }
    if (command === "fx.setChain") {
      return globals.fx.setChain(args[0].map((id) => getWorkerAudioHandle(id)));
    }
    if (command === "fx.compose") {
      const [id, method, handleIds] = args;
      const factory = globals.fx[method];
      if (typeof factory !== "function") throw new Error(`Unsupported FX composition: ${method}`);
      setWorkerAudioHandle(id, factory(...handleIds.map((handleId) => getWorkerAudioHandle(handleId))));
      return;
    }
    if (command === "fx.clear") return globals.fx.clear();
    if (command === "fx.detach") return megaDrive.clearFXChain();
    if (command === "audio.stopAll") return stopAllAudio();
    if (command === "audio.disposeHandles") {
      disposeWorkerAudioHandles(args[0]);
      return;
    }
    if (command === "noise.create") {
      const [id, options] = args;
      setWorkerAudioHandle(id, globals.noise.create(options));
      return;
    }
    if (command === "noise.stopAll") return globals.noise.stopAll();
    if (command === "noise.control") {
      return globals.control(getWorkerAudioHandle(args[0]), args[1]);
    }
    if (command === "audio.call" || command === "audio.get") {
      const [id, path] = args;
      let target = getWorkerAudioHandle(id);
      for (const segment of path) target = target?.[segment];
      if (!target) throw new Error(`Unknown audio handle: ${id}`);
      if (command === "audio.get") return target.get();
      const [, , method, methodArgs] = args;
      return target[method](...methodArgs);
    }

    if (command === 'gameboy.invoke') {
      const [path, values] = args;
      if (capabilities.chip !== 'gameboy' || !Array.isArray(path) || path.length < 1 || path.length > 2 || path.some(key=>typeof key !== 'string' || key.startsWith('_') || key === 'constructor')) throw new Error('Unsupported Game Boy method');
      const owner = path.length === 2 ? globals.gameboy[path[0]] : globals.gameboy;
      const method = path.at(-1);
      if (typeof owner?.[method] !== 'function') throw new Error('Unsupported Game Boy method');
      return owner[method](...values);
    }
    if (command.startsWith("fm.dac.")) {
      const method = command.slice(7);
      if (!['setSample', 'playFromSample', 'play', 'stop', 'removeSample'].includes(method) || !globals.fm.dac) {
        throw new Error(`Unsupported DAC method: ${method}`);
      }
      return globals.fm.dac[method](...args);
    }
    if (command.startsWith("fm.")) {
      const method = command.slice(3);
      if (typeof globals.fm[method] !== "function") {
        throw new Error(`Unsupported fm method: ${method}`);
      }
      return globals.fm[method](...args);
    }
    if (command.startsWith("psg.")) {
      const method = command.slice(4);
      if (typeof globals.psg[method] !== "function") {
        throw new Error(`Unsupported psg method: ${method}`);
      }
      return globals.psg[method](...args);
    }
    if (command === 'chip.section') {
      const [section, method, methodArgs] = args;
      const available = primarySectionNames.includes(section) || (section === 'adpcm' && primarySectionNames.includes('adpcmB'));
      const target = available ? globals[section] : null;
      if (!target || typeof method !== 'string' || method.startsWith('_') ||
          method === 'constructor' || typeof target[method] !== 'function') {
        throw new Error(`Unsupported chip section method: ${section}.${method}`);
      }
      return target[method](...methodArgs);
    }
    if(command==='sample.decode'){
      const buffer=await globals.sample.load(...args);
      return samplePCM(buffer);
    }
    if(command==='sample.pcm'){
      const buffer=megaDrive.sample.get(args[0]);
      if(!buffer)throw new Error(`Unknown sample: ${args[0]}`);
      return samplePCM(buffer);
    }
    if (command.startsWith("sample.")) {
      const method = command.slice(7);
      if (typeof globals.sample[method] !== "function") {
        throw new Error(`Unsupported sample method: ${method}`);
      }
      const value = await globals.sample[method](...args);
      if (method === "isLoaded" || method === "list") {
        return value;
      }
      // AudioBuffer and voice objects contain AudioNodes and cannot cross the
      // Worker boundary. Worker callers use these operations for their side
      // effects, so resolve after the main-thread operation completes.
      return undefined;
    }
    if (command.startsWith("stream.")) {
      const method = command.slice(7);
      if (typeof globals.stream[method] !== "function") {
        throw new Error(`Unsupported stream method: ${method}`);
      }
      const value = await globals.stream[method](...args);
      if (method === "isLoaded" || method === "list") {
        return value;
      }
      return undefined;
    }
    if (command.startsWith("dac.")) {
      const method = command.slice(4);
      if (typeof globals.dac[method] !== "function") {
        throw new Error(`Unsupported dac method: ${method}`);
      }
      return globals.dac[method](...args);
    }

    switch (command) {
      case "write":
      case "play":
      case "psgTone":
      case "psgNoise":
      case "setMasterVolume":
      case "getMasterVolume":
      case "setTiming":
      case "getTiming":
      case "setDacLookahead":
      case "getDacLookahead":
      case "hzToBlockFnum":
      case "noteToBlockFnum":
      case "noteLerp":
      case "scheduleWritesSamples":
        return globals[command](...args);
      case "stopAll":
        return globals.stopAll();
      default:
        throw new Error(`Unsupported Worker command: ${command}`);
    }
  }

  function handleWorkerMessage(event) {
    const message = event.data ?? {};
    if (message.type === 'performance-cancel-owner') { performanceHost.cancelOwner(message); return; }
    if (message.type === 'native-observer') {
      megaDrive.primaryEndpoints?.find(endpoint => endpoint.globalName === message.name)?.client._adoptState?.(message.state);
      return;
    }
    // Tempo bypasses the command queue: a queued play may still be waiting.
    if (message.type === 'tempo') {
      clockApi.setBpm(message.bpm);
      megaDrive.audio?.nativeFX?.controller.syncTempo();
      return;
    }
    if (message.type === "command" || message.type === "request") {
      if (message.command === "keyboard.register") {
        registerWorkerKeyboardHandler(
          message.args[0],
          message.args[1]
        );
        return;
      }
      if (message.command === "log" || message.command === "warn" || message.command === "error") {
        const prefix = message.command === "log" ? "" : `[${message.command}] `;
        emitLog(`${prefix}${formatLogArgs(message.args)}`);
        return;
      }
      const worker = logicWorker;
      const respond = (value, error) => {
        if (logicWorker !== worker) return;
        if (message.type === "request") {
          worker.postMessage(error
            ? { type: "response", id: message.id, error: error?.message ?? String(error) }
            : { type: "response", id: message.id, value }, !error && message.command === "pcm.create" ? [value.port] : []);
        } else if (error) emitLog(formatLogArgs([error]));
      };
      workerCommandQueue = workerCommandQueue
        .catch(() => undefined)
        .then(() => {
          if (logicWorker !== worker) return;
          const result = invokeWorkerCommand(message.command, message.args ?? [], message.performance);
          if (message.command === "play" || message.command === "midi.file" || message.command === 'pcm.create') {
            // Start notes in FIFO order, but their durations must not block other
            // loops, register writes or Stop. Chip creation may also wait for a
            // retired same-ID node; unrelated RPC must keep flowing meanwhile.
            void result.then(value => respond(value), error => respond(undefined, error));
            return;
          }
          return result.then(value => respond(value), error => respond(undefined, error));
        });
    }
  }

  function installLogicWorkerHandlers(worker) {
    worker.onmessage = (event) => {
      if (logicWorker !== worker) return;
      const message = event.data ?? {};
      if (message.type === "chip-observer") {
        // Notification only: sound has already gone Worker -> AudioWorklet.
        // Keep UI/recording state, but never send a second copy to the chip.
        const core=synth?.fm??synth;
        const transport=core?.transport;
        try {
          applyingChipObserver=true;
          if(core && capabilities.chip !== 'gameboy') core.transport={write(port,register,value){},reset(){}};
          const {method,args}=message.event;
          if (method === 'gameboyState') { core?._adoptState(args[0]); return; }
          if (method === 'ssgState') core?.ssg?._adoptState(args[0]);
          if (method === 'setClock') sharedFm?._adoptClock(args[0]);
          if(typeof synth?.[method]==="function" && !method.startsWith("_")) synth[method](...args);
        } catch(error){emitLog(`Observer: ${error.message}`);}
        finally {if(core && capabilities.chip !== 'gameboy')core.transport=transport;applyingChipObserver=false;}
        return;
      }
      if (message.type === "complete") {
        const request = workerRunRequests.shift();
        request?.resolve();
        if (!request || request.runToken !== currentRunToken) return;
        const loopCount = message.loopCount ?? 0;
        const keyboardHandlerCount = message.keyboardHandlerCount ?? 0;
        emitStatus(
          loopCount > 0
            ? `Running ${loopCount} live loop(s) in Worker.`
            : keyboardHandlerCount > 0
              ? `Running ${keyboardHandlerCount} keyboard handler(s) in Worker.`
              : "Done."
        );
        if (loopCount === 0 && keyboardHandlerCount === 0) {
          setPlaybackState("stopped");
        }
        emitRuntimeState("Audio ready");
        return;
      }
      if (message.type === "execution-error") {
        const error = new Error(message.message);
        error.stack = message.stack ?? error.stack;
        workerRunRequests.shift()?.reject(error);
        return;
      }
      if (message.type === "stopped") {
        const finish = resolveLogicWorkerStop;
        void workerCommandQueue.then(() => finish?.(), () => finish?.());
        return;
      }
      if (message.type === "log") {
        emitLog(message.message);
        return;
      }
      handleWorkerMessage(event);
    };
    worker.onerror = (event) => {
      if (logicWorker !== worker) return;
      const location = event.filename
        ? ` (${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0})`
        : "";
      const error = new Error(
        `${event.message || "Playground Worker failed"}${location}`
      );
      emitLog(error.message);
      while (workerRunRequests.length > 0) {
        workerRunRequests.shift().reject(error);
      }
      if (resolveLogicWorkerStop) {
        terminateLogicWorker();
        stopAllAudio();
      }
    };
  }

  function commitKeyboardHandlers(definitions) {
    clearKeyboardHandlers();

    for (const [id, definition] of definitions) {
      const listener = (event) => {
        void executeUserCallback(
          () => definition.fn(event)
        ).catch((error) => {
          emitLog(
            `[keyboard:${definition.name}] ${formatLogArgs([error])}`
          );
          emitStatus("Keyboard handler error");
        });
      };
      keyboardHandlers.set(
        id,
        {
          eventType: definition.eventType,
          listener,
        }
      );
      window.addEventListener(
        definition.eventType,
        listener
      );
    }
  }

  function getMidiRack() {
    if (synth?.dac?.enabled) throw new Error('Disable DAC before using MIDI FM playback');
    if (capabilities.chip !== "ym2612") throw new Error("MIDI outputs currently require YM2612 mode");
    return midiRack ??= createMidiRack({getClockScale:() => CHIP_CLOCKS.ym2612 / (sharedFm?.clock ?? CHIP_CLOCKS.ym2612),preset: Object.values(presets)[0],
      write: entry => entry.time === undefined ? synth.write(entry.port,entry.register,entry.value) : midiWriteBatch ? midiWriteBatch.push(entry) : audioScheduler.enqueue([entry]),
      writePsg: entry => entry.time === undefined ? megaDrive.psg.write(entry.value) : (midiWriteBatch ? midiWriteBatch.push({...entry,type:"psg-write"}) : audioScheduler.enqueue([{...entry,type:"psg-write"}])),
    });
  }

  async function playMidiFile(data, routes, runToken) {
    if (options.midiFileSupported === false) throw new Error("MIDI file playback requires the ymfm engine");
    if (midiFilePlaying) throw new Error("A MIDI file is already playing");
    const song = parseMidiFile(data), rack = getMidiRack();
    const mapping = new Map();
    const targets = new Set();
    for (const route of routes) {
      if (!song.parts.some(p=>p.key===route.part)) throw new Error("Unknown MIDI part");
      if (!["tetorica-ym2612","tetorica-sega-psg"].includes(route.destination) || !Number.isInteger(route.channel) || route.channel<0 || route.channel>15) throw new Error("Invalid MIDI route");
      validateBendRange(route.bendRange ?? 2);
      const key=JSON.stringify([route.destination,route.channel]);
      if (targets.has(key) || mapping.has(route.part)) throw new Error("Assign each imported part to a separate output / MIDI channel");
      targets.add(key);mapping.set(route.part,route);
      if (route.destination === 'tetorica-ym2612') {
        const patch=presets[route.preset];if(!patch)throw new Error(`Unknown preset: ${route.preset}`);
        rack.setVoice(route.channel,patch);
      }
    }
    rack.stop(); // Begin each file with clean pedal/controller state.
    for(const route of routes) {
      rack.pitchBend(route.destination,route.channel,0);
      rack.setPitchBendRange(route.destination,route.channel,route.bendRange ?? 2);
    }
    midiFilePlaying = true;
    for (const warning of song.warnings) emitLog(warning);
    const origin=megaDrive.audioContext.currentTime+runtime.dacLookaheadSeconds;
    let cursor=0;
    try {
      while(cursor<song.events.length) {
        if(runToken!==currentRunToken)throw new DOMException('Run stopped','AbortError');
        const horizon=megaDrive.audioContext.currentTime+runtime.dacLookaheadSeconds;
        let count=0;
        midiWriteBatch=[];
        while(cursor<song.events.length && origin+song.events[cursor].seconds<=horizon && count++<4096) {
          const event=song.events[cursor++],route=mapping.get(event.part);
          if(event.type!=='channel')continue;
          const time=origin+event.seconds;
          if(event.kind===14 || event.kind===11&&MIDI_SUPPORTED_CC.includes(event.a)) {
            const raw=event.a+(event.b<<7),value=(raw-8192)/(raw<8192?8192:8191);
            // Channel controls can be in a different SMF track from the notes.
            for(const part of song.parts)if(part.port===event.port&&part.device===event.device&&part.channel===event.channel) {
              const target=mapping.get(part.key);
              if(target) {
                if(event.kind===14)rack.pitchBend(target.destination,target.channel,value,time);
                else rack.cc(target.destination,target.channel,event.a,event.b,time);
              }
            }
            continue;
          }
          if(!route)continue;
          if(event.kind===9&&event.b>0)rack.noteOn(route.destination,route.channel,event.a,event.b,time);
          else if(event.kind===8||event.kind===9)rack.noteOff(route.destination,route.channel,event.a,time);
        }
        audioScheduler.enqueue(midiWriteBatch);midiWriteBatch=null;
        await clockApi.sleep(.01,runToken);
      }
      rack.stop(origin+song.seconds);
      await clockApi.sleep(Math.max(0,origin+song.seconds-megaDrive.audioContext.currentTime),runToken);
    } finally {midiWriteBatch=null;if(runToken===currentRunToken)midiFilePlaying=false;}
  }

  function createExecutionGlobals(
    runToken
  ) {
    const evaluationState = {
      loopDefinitions: new Map(),
      liveFxDefinitions: new Map(),
      cleanupDefinitions: [],
      cleanupCallIndex: 0,
      keyboardDefinitions: new Map(),
      cleanupScope:
        currentSourceName ??
        "__anonymous__",
    };
    const fx = liveFxLifecycle.track(createFxApi(), evaluationState.liveFxDefinitions);
    const isGameboy = capabilities.chip === 'gameboy';
    if (!hasOpn) currentLoopContext = null;
    if (isGameboy && sharedGameboySynth !== synth) {
      sharedGameboy = createPrimaryGameboyApi(synth);
      sharedGameboySynth = synth;
    }
    if (hasOpn && sharedFmSynth !== synth) {
      sharedFm = createFmProxy(synth);
      if (megaDrive.node?.port) attachChipClock(sharedFm, megaDrive.node.port, CHIP_CLOCKS[capabilities.chip ?? 'ym2612'], {
        primary:true,
        onApplied: hz => {
          const core = synth.fm ?? synth;
          core.clock = hz;
          if (core.ssg) core.ssg.clock = hz / (capabilities.chip === 'ym2203' ? 2 : 4);
          if (core.adpcmB) core.adpcmB.clock = hz;
          if (core.adpcm) core.adpcm.clock = hz;
          logicWorker?.postMessage({type:'chip-clock-state',clock:hz});
        },
      });
      Object.defineProperty(sharedFm, 'id', {value: capabilities.chip ?? 'ym2612', enumerable: true});
      sharedFmSynth = synth;
    }
    const fm = sharedFm;
    const gameboy = isGameboy ? sharedGameboy : undefined;
    const nativeApis = nativePrimaryApis();
    const psg = megaDrive.psg;
    const sections = primaryChipSections();
    const musicApi =
      createPlaygroundMusic({
        noteToSemitone:
          NOTE_TO_SEMITONE,
        scaleIntervals:
          SCALE_INTERVALS,
        getPitch: midi => midiToOpnPitch(midi, fm?.clock ?? CHIP_CLOCKS[capabilities.chip ?? 'ym2612'], capabilities.chip === 'ym2203' ? 72 : 144),
        getFrequencyPitch: (hz, clock) => opnPitchFromHz(hz, clock ?? fm?.clock ?? CHIP_CLOCKS[capabilities.chip ?? 'ym2612'], capabilities.chip === 'ym2203' ? 72 : 144, {clamp:true}),
        synth: () => synth,
        presets,
        activeNotes,
        getBpm: () => runtime.bpm,
        waitBeats: beats => clockApi.waitForBeat(clockApi.currentBeat() + beats, runToken),
        sleep: (seconds) =>
          clockApi.sleep(
            seconds,
            runToken
          ),
        getCurrentLoopContext: () =>
          currentLoopContext,
      });
    const sampleApi = {
      load: loadSample,
      play: playSample,
      stop: stopSample,
      stopAll: () =>
        megaDrive.sample.stopAll(),
      unload: unloadSample,
      isLoaded: (name) =>
        megaDrive.sample.isLoaded(name),
      get: (name) =>
        megaDrive.sample.get(name),
      list: () =>
        megaDrive.sample.list(),
    };
    const streamApi = {
      load: loadStream,
      play: playStream,
      pause: pauseStream,
      stop: stopStream,
      unload: unloadStream,
      isLoaded: (name) =>
        megaDrive.stream.isLoaded(name),
      get: (name) =>
        megaDrive.stream.get(name),
      list: () =>
        megaDrive.stream.list(),
    };
    const dacApi = {
      load: async (name, data) => {
        requireDac();
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (bytes.byteLength % 5 !== 0) throw new Error("Invalid DAC data length");
        fm.loadDacBank(name, bytes);
      },
      loadBase64: async (name, encoded) => {
        requireDac();
        fm.loadDacBank(
          name,
          decodeDacBase64Bytes(encoded)
        );
      },
      playStream: (name, { atSamples = 0 } = {}) => {
        requireDac();
        const origin = runtime.sampleClockStartTime ??
          (megaDrive.audioContext.currentTime +
            runtime.dacLookaheadSeconds);
        runtime.sampleClockStartTime = origin;
        fm.playDacBank(
          name,
          origin + Math.max(0, Number(atSamples) || 0) / 44100
        );
      },
      schedule: (start, entries) => {
        requireDac();
        return scheduleWritesSamples(fm, start, entries.map(([offset, value]) => [offset, 0, 0x2a, value]));
      },
      scheduleBase64: (start, encoded) => {
        requireDac();
        return scheduleDacBase64(fm, start, encoded);
      },
    };
    const livePrepareApi = {
      ...nativeApis,
      ...(gameboy ? {gameboy} : {}),
      fm,
      ...sections,
      fx,
      psg,
      sample: sampleApi,
      stream: streamApi,
      dac: dacApi,
      noise: noiseApi,
      control: controlNoiseVoice,
      context: runtime.context,
      log: (...args) => {
        emitLog(
          formatLogArgs(args)
        );
      },
    };
    if (!hasOpn) for (const name of ['fm','psg','dac']) delete livePrepareApi[name];
    const playgroundConsole = {
      log: (...args) => {
        emitLog(
          formatLogArgs(args)
        );
      },
      warn: (...args) => {
        emitLog(
          `[warn] ${formatLogArgs(args)}`
        );
      },
      error: (...args) => {
        emitLog(
          `[error] ${formatLogArgs(args)}`
        );
      },
    };
    const midi = createMidiApi((method,args) => {
      if(runToken!==currentRunToken)throw new DOMException("Run stopped","AbortError");
      if (method === 'playFile') return playMidiFile(...args,runToken);
      if (midiFilePlaying) throw new Error('Manual MIDI operations are unavailable during MIDI file playback');
      const rack=getMidiRack();
      if(method==='release')return rack.noteOff(args[0],args[1],args[2],undefined,args[3],args[4]);
      return rack[method](...args);
    }, {now:clockApi.nowSeconds,sleep:seconds=>clockApi.sleep(seconds,runToken),waitBeats:beats=>clockApi.waitForBeat(clockApi.currentBeat()+beats,runToken),bpm:()=>runtime.bpm,owner:()=>currentLoopContext?.name??null,
      check:()=>{if(runToken!==currentRunToken)throw new DOMException('Run stopped','AbortError');}});
    midiApis.add(midi);
    const pg = {
      mixer: megaDrive.mixer,
      trackAsync: promise => loopTasks.track(promise),
      useSoundChip: async (name, options) => {
        const check = () => { if (runToken !== currentRunToken) throw new DOMException('Run stopped', 'AbortError'); };
        check();
        const chip = await soundChips.use(name, options, chipName => {
          check();
          const endpoint = megaDrive.primaryEndpoints?.find(endpoint => endpoint.name === chipName);
          if (endpoint) return nativeApis[endpoint.globalName];
          if (chipName === 'gameboy' && isGameboy) return gameboy;
          if (['ym2612', 'ym2203', 'ym2610'].includes(chipName) && capabilities.chip === chipName) return fm;
          return pg.createSoundChip(chipName, {id:`${chipName}:shared`});
        }, {evictOnDispose: !megaDrive.primaryEndpoints?.some(endpoint => endpoint.name === name) && !((['ym2612', 'ym2203', 'ym2610'].includes(name) || name === 'gameboy') && capabilities.chip === name)});
        check();
        return chip;
      },
      createSoundChip: async (name, options = {}) => {
        const device=await openPcm(name,runToken,options);
        const client=name === 'spc' ? createSpcClient(device.port, device, {
          getOwner:()=>spcOwner(currentLoopContext,currentRunToken), captureContext:()=>currentLoopContext,
          restoreContext:loop=>{currentLoopContext=loop;},
          invokeEvent:(callback,event)=>executeUserCallback(()=>callback(event)),
        }) : ['huc6280','okim6258'].includes(name) ? createNativePrimaryClient(name,device.port,device) : name === 'snes' ? createSnesClient(device.port, device) : name === 'dx7' ? createDx7Client(device.port, device) : name === 'nes' ? createNesClient(device.port, device) : name === 'pwm' ? createPWM32XClient(device.port) : ['ym2612', 'ym2203', 'ym2610'].includes(name) ? createOpnClient(name, device.port) : name === 'ym2151' ? createYm2151Client(device.port) : name === 'segapsg' ? createSegaPsgClient(device.port) : name === 'gameboy' ? createGameboyClient(device.port) : name === 'ym2608' ? createYm2608Client(device.port) : createRf5c164Client(device.port,decodePcm);
        Object.defineProperty(client, 'id', {value: device.mixerId, enumerable: true});
        const dispose=device.dispose, disposeClient=client.dispose.bind(client); let disposed=false;
        client.dispose=()=>{if(disposed)return;disposed=true;try{disposeClient();}finally{dispose();}};
        // Keep the current method visible: useSoundChip wraps it to evict the
        // cached endpoint, including when a device fails asynchronously.
        device.dispose=()=>client.dispose();
        return client;
      },
      midi,
      ...nativeApis,
      ...(gameboy ? {gameboy} : {}),
      fm,
      ...sections,
      dac: dacApi,
      fx,
      psg,
      context: runtime.context,
      sample: sampleApi,
      stream: streamApi,
      noise: noiseApi,
      control: controlNoiseVoice,
      psgTone,
      psgNoise,
      setMasterVolume,
      getMasterVolume,
      setTiming,
      getTiming,
      setDacLookahead,
      getDacLookahead,
      CH1: 0,
      CH2: 1,
      CH3: 2,
      ...(capabilities.fmChannels >= 4 ? { CH4: 3 } : {}),
      ...(capabilities.fmChannels >= 5 ? { CH5: 4 } : {}),
      ...(capabilities.fmChannels >= 6 ? { CH6: 5 } : {}),
      ...(capabilities.chip === "ym2612" ? { CH7: 6, CH8: 7, CH9: 8, CH10: 9, CH11: 10, CH12: 11, CH13: 12, CH14: 13, CH15: 14, CH16: 15 } : {}),
      PSG1: 0,
      PSG2: 1,
      PSG3: 2,
      OP1: 0,
      OP2: 1,
      OP3: 2,
      OP4: 3,
      presets,
      FM_PRESETS: presets,
      tfiToPreset: parseTfi,
      vgiToPreset: parseVgi,
      livePrepare: (name, fn) =>
        liveFxLifecycle.prepare(name, evaluationState.liveFxDefinitions, () => liveApi.livePrepare(
          name,
          fn,
          livePrepareApi
        )),
      play: (note, playOptions) =>
        musicApi.play(
          note,
          playOptions
        ),
      write: (...args) =>
        writeYm2612(
          fm,
          ...args
        ),
      beginSampleSchedule: () =>
        beginSampleSchedule(),
      scheduleWritesSamples: (start, entries) =>
        scheduleWritesSamples(fm, start, entries),
      sleep: (seconds) =>
        clockApi.sleep(
          seconds,
          runToken
        ),
      createTimeline() {
        const loop = currentLoopContext;
        const token = loop?.runToken ?? runToken;
        return createSecondsTimeline({
          now: clockApi.nowSeconds,
          sleep: seconds => clockApi.sleep(seconds, runToken),
          check: () => {
            if (loop?.interruptError && !loop.stopped) throw loop.interruptError;
            if (loop?.stopped || token !== (loop?.runToken ?? currentRunToken)) throw new Error('Run stopped');
          },
        });
      },
      sleepSamples: (
        samples,
        sampleRate = 44100
      ) =>
        sleepSamples(
          samples,
          sampleRate,
          runToken
        ),
      beat: clockApi.beat,
      nextBeat:
        clockApi.nextBeat,
      setBpm: (value) => { const result = clockApi.setBpm(value); megaDrive.audio?.nativeFX?.controller.syncTempo(); return result; },
      tween:
        clockApi.tween,
      liveFx: (name, options) => fx.liveFx(name, options),
      liveLoop: (name, fn) =>
        liveApi.liveLoop(
          name,
          fn,
          evaluationState
        ),
      liveCleanup: (
        names,
        fn
      ) =>
        liveApi.liveCleanup(
          names,
          fn,
          evaluationState
        ),
      onKeyboardPressKey: (name, fn) =>
        registerKeyboardHandler(
          "keydown",
          name,
          fn,
          evaluationState
        ),
      onKeyboardReleaseKey: (name, fn) =>
        registerKeyboardHandler(
          "keyup",
          name,
          fn,
          evaluationState
        ),
      stopLoop:
        liveApi.stopLoop,
      stopAllLoops:
        liveApi.stopAllLoops,
      stopAll: stopAllAudio,
      choose:
        musicApi.choose,
      cycle:
        musicApi.cycle,
      rand: musicApi.rand,
      rrange:
        musicApi.rrange,
      randInt:
        musicApi.randInt,
      lerp: musicApi.lerp,
      scale:
        musicApi.scale,
      chord:
        musicApi.chord,
      hzToBlockFnum: musicApi.hzToBlockFnum,
      noteToBlockFnum:
        musicApi.noteToBlockFnum,
      noteLerp:
        musicApi.noteLerp,
      log: (...args) => {
        emitLog(
          formatLogArgs(args)
        );
      },
    };

    const globals = {
        console:
          playgroundConsole,
        pg,
        mixer: pg.mixer,
        createSoundChip: pg.createSoundChip,
        useSoundChip: pg.useSoundChip,
        midi,
        ...nativeApis,
        ...(gameboy ? {gameboy} : {}),
        fm,
        ...sections,
        dac: pg.dac,
        fx,
        psg,
        sample: pg.sample,
        stream: pg.stream,
        noise: pg.noise,
        control: pg.control,
        psgTone,
        psgNoise,
        setMasterVolume:
          pg.setMasterVolume,
        getMasterVolume:
          pg.getMasterVolume,
        setTiming,
        getTiming,
        setDacLookahead:
          pg.setDacLookahead,
        getDacLookahead:
          pg.getDacLookahead,
        livePrepare: (name, fn) =>
          pg.livePrepare(name, fn),
        play: (note, playOptions) =>
          pg.play(
            note,
            playOptions
          ),
        write: (...args) =>
          pg.write(...args),
        beginSampleSchedule: () =>
          pg.beginSampleSchedule(),
        scheduleWritesSamples: (start, entries) =>
          pg.scheduleWritesSamples(start, entries),
        sleep: (seconds) =>
          pg.sleep(seconds),
        createTimeline: pg.createTimeline,
        sleepSamples: (
          samples,
          sampleRate
        ) =>
          pg.sleepSamples(
            samples,
            sampleRate
          ),
        beat: pg.beat,
        nextBeat: pg.nextBeat,
        setBpm: pg.setBpm,
        tween: pg.tween,
        context:
          pg.context,
        liveFx: pg.liveFx,
        liveLoop: (name, fn) =>
          pg.liveLoop(name, fn),
        liveCleanup: (
          names,
          fn
        ) =>
          pg.liveCleanup(
            names,
            fn
          ),
        onKeyboardPressKey: (name, fn) =>
          pg.onKeyboardPressKey(name, fn),
        onKeyboardReleaseKey: (name, fn) =>
          pg.onKeyboardReleaseKey(name, fn),
        stopLoop:
          pg.stopLoop,
        stopAllLoops:
          pg.stopAllLoops,
        stopAll:
          pg.stopAll,
        choose: pg.choose,
        cycle: pg.cycle,
        rand: pg.rand,
        rrange: pg.rrange,
        randInt: pg.randInt,
        lerp: pg.lerp,
        scale: pg.scale,
        chord: pg.chord,
        hzToBlockFnum: pg.hzToBlockFnum,
        noteToBlockFnum:
          pg.noteToBlockFnum,
        noteLerp:
          pg.noteLerp,
        CH1: pg.CH1,
        CH2: pg.CH2,
        CH3: pg.CH3,
        ...(capabilities.fmChannels >= 4 ? { CH4: pg.CH4 } : {}),
        ...(capabilities.fmChannels >= 5 ? { CH5: pg.CH5 } : {}),
        ...(capabilities.fmChannels >= 6 ? { CH6: pg.CH6 } : {}),
        ...(capabilities.chip === "ym2612" ? { CH7: 6, CH8: 7, CH9: 8, CH10: 9, CH11: 10, CH12: 11, CH13: 12, CH14: 13, CH15: 14, CH16: 15 } : {}),
        PSG1: pg.PSG1,
        PSG2: pg.PSG2,
        PSG3: pg.PSG3,
        OP1: pg.OP1,
        OP2: pg.OP2,
        OP3: pg.OP3,
        OP4: pg.OP4,
        FM_PRESETS: presets,
        tfiToPreset: pg.tfiToPreset,
        vgiToPreset: pg.vgiToPreset,
        presets: pg.presets,
        sample: pg.sample,
        stream: pg.stream,
        control: pg.control,
        log: pg.log,
    };
    if (!hasOpn) {
      const opnNames = ['fm','psg','dac','midi','play','write','psgTone','psgNoise','scheduleWritesSamples',
        'noteToBlockFnum','hzToBlockFnum','noteLerp','FM_PRESETS','presets','tfiToPreset','vgiToPreset','setDacLookahead','getDacLookahead'];
      for (const api of [pg,globals]) for (const name of Object.keys(api)) {
        if (opnNames.includes(name) || /^(?:CH|PSG|OP)\d+$/.test(name)) delete api[name];
      }
    }
    return {evaluationState,globals};
  }

  function writeYm2612(
    fm,
    ...args
  ) {
    if (args.length === 2) {
      fm.write(
        0,
        Number(args[0]),
        Number(args[1])
      );
      return;
    }
    if (args.length === 3) {
      fm.write(
        Number(args[0]),
        Number(args[1]),
        Number(args[2])
      );
      return;
    }
    throw new Error(
      "write(register, value) or write(port, register, value) is required"
    );
  }

  function beginSampleSchedule() {
    if (runtime.sampleClockStartTime === null) {
      runtime.sampleClockStartTime =
        megaDrive.audioContext.currentTime +
        runtime.dacLookaheadSeconds;
    }
    return Math.round(
      (currentLoopContext?.sampleCursorSeconds ?? 0) * 44100
    );
  }

  function scheduleWritesSamples(fm, startSamples, entries) {
    const start = Math.max(0, Number(startSamples) || 0);
    const origin = runtime.sampleClockStartTime ??
      (megaDrive.audioContext.currentTime +
        runtime.dacLookaheadSeconds);
    runtime.sampleClockStartTime = origin;
    audioScheduler.enqueue(entries.map(([offset, port, register, value]) => {
      const time = origin + (start + Number(offset)) / 44100;
      if (port === 'psg') {
        if (!Number.isInteger(register) || register < 0 || register > 255) throw new Error('Invalid PSG byte');
        return {time, type: 'psg-write', value: register};
      }
      return {time, port: Number(port), register: Number(register), value: Number(value)};
    }));
  }

  function scheduleDacBase64(fm, startSamples, encoded) {
    scheduleWritesSamples(fm, startSamples, decodeDacBase64(encoded));
  }

  function decodeDacBase64(encoded) {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const entries = [];
    for (let offset = 0; offset < bytes.length; offset += 5) {
      entries.push([view.getUint32(offset, true), 0, 0x2a, bytes[offset + 4]]);
    }
    return entries;
  }

  function decodeDacBase64Bytes(encoded) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }


  function sleepSamples(
    samples,
    sampleRate = 44100,
    runToken
  ) {
    const validSamples = Math.max(
      0,
      Number(samples) || 0
    );
    const validRate = Math.max(
      1,
      Number(sampleRate) || 44100
    );
    return clockApi.sleepSamples(
      validSamples,
      validRate,
      runToken
    );
  }

  async function playSourceInWorker(sourceCode) {
    if (typeof Worker !== "function") {
      throw new Error(
        "Worker execution is not available in this environment"
      );
    }

    currentRunToken += 1;
    const runToken = currentRunToken;
    if (logicWorkerStopPromise) await logicWorkerStopPromise;
    if (runToken !== currentRunToken) return;
    await ensureReady();
    if (runToken !== currentRunToken) return;
    clearKeyboardHandlers();
    liveApi.stopAllLoops();
    if (!logicWorker) {
      liveFxLifecycle.clear();
      liveApi.clearRunFxChain();
      liveApi.clearPrepared();
    }
    setPlaybackState("running");
    emitStatus("Starting Playground Worker...");
    emitRuntimeState("Running");

    const { globals } =
      createExecutionGlobals(runToken);
    workerGlobals = globals;
    const isNewWorker = !logicWorker;
    const worker = logicWorker ?? new Worker(logicWorkerUrl, {
      type: "module",
    });
    logicWorker = worker;
    if (isNewWorker) {
      installLogicWorkerHandlers(worker);
      if(nativePrimary && typeof MessageChannel === 'function') {
        const endpoints = [], transfer = [];
        for (const endpoint of megaDrive.primaryEndpoints) {
          const channel = new MessageChannel();
          endpoint.node.port.postMessage({port:channel.port1,primaryWorker:true},[channel.port1]);
          endpoints.push({name:endpoint.name,globalName:endpoint.globalName,clock:endpoint.client.clock,
            fdsEnabled:endpoint.client.fdsEnabled,sampleRate:endpoint.client.sampleRate,state:endpoint.client._getState?.(),port:channel.port2});
          transfer.push(channel.port2);
        }
        worker.postMessage({type:'native-primary-ports',endpoints},transfer);
      } else if(megaDrive.node?.port && typeof MessageChannel==="function") {
        const channel=new MessageChannel();
        megaDrive.node.port.postMessage({type:"attach-chip-port",port:channel.port1},[channel.port1]);
        worker.postMessage({type:"chip-port",port:channel.port2,state:primaryChipState()},[channel.port2]);
      }
      const port = megaDrive.audio?.nativeFX?.workerPort();
      if (port) worker.postMessage({type: "native-fx", port}, [port]);
    }

    const performanceClock = await performanceHost.start(
      [...(nativePrimary ? megaDrive.primaryEndpoints.map(endpoint=>endpoint.node.port) : [megaDrive.node?.port]), megaDrive.audio?.nativeFX?.node?.port].filter(Boolean), workerLookaheadSeconds);
    if (runToken !== currentRunToken) return;
    await new Promise((resolve, reject) => {
      workerRunRequests.push({ resolve, reject, runToken });
      worker.postMessage({
        type: "run",
        performance: performanceClock,
        sourceCode,
        bpm: runtime.bpm,
        presets,
        scaleIntervals: SCALE_INTERVALS,
        capabilities,
        timing: {...getTiming(),chipClock:sharedGameboy?.clock ?? sharedFm?.clock ?? CHIP_CLOCKS[capabilities.chip ?? 'ym2612']},
      });
    });
  }

  /** @param {string} sourceCode @param {{execution?: "main" | "worker"}} [playOptions] */
  async function playSource(
    sourceCode,
    playOptions = {}
  ) {
    if (pendingFadeStop) await pendingFadeStop;
    const execution =
      playOptions.execution ??
      defaultExecution;
    if (execution === "worker") {
      const pending = playSourceInWorker(sourceCode);
      const runToken = currentRunToken;
      try {
        return await pending;
      } catch (error) {
        if (error.name === "AbortError" || runToken !== currentRunToken) throw error;
        setPlaybackState("stopped");
        emitStatus(`Error: ${error.message}`);
        emitRuntimeState("Error");
        emitLog(formatLogArgs([error]));
        throw error;
      }
    }
    if (execution !== "main") {
      throw new Error(
        `Unknown execution mode: ${execution}`
      );
    }
    currentRunToken += 1;
    const runToken = currentRunToken;
    await stopLogicWorker();
    if (runToken !== currentRunToken) return;
    if (logicWorker) {
      loopTasks.clear();
      clockApi.cancelWaits();
      terminateLogicWorker();
    }

    await ensureReady();
    if (runToken !== currentRunToken) return;
    clearKeyboardHandlers();
    liveApi.clearRunFxChain({preservePrepared: true});
    setPlaybackState("running");
    emitStatus("Running...");
    emitRuntimeState("Running");

    const {
      evaluationState,
      globals,
    } =
      createExecutionGlobals(
        runToken
      );
    const AsyncFunction =
      Object.getPrototypeOf(
        async function () {}
      ).constructor;
    try {
      const userFunction = new AsyncFunction(
        ...Object.keys(globals),
        `"use strict";\n{\n${sourceCode}\n}`
      );
      await executeWithPlaygroundGuards(
        () =>
          userFunction(
            ...Object.values(
              globals
            )
          ),
        window,
        {
          enabled: guardExecution,
          nativeIpc,
        }
      );

      if (runToken !== currentRunToken) return;
      liveFxLifecycle.commit(evaluationState.liveFxDefinitions);
      liveApi.commitLiveLoops(
        evaluationState.loopDefinitions
      );
      liveApi.commitLiveCleanups(
        evaluationState.cleanupDefinitions,
        evaluationState.cleanupScope
      );
      commitKeyboardHandlers(
        evaluationState.keyboardDefinitions
      );

      if (runToken === currentRunToken) {
        const loopCount =
          evaluationState.loopDefinitions.size;
        const keyboardHandlerCount =
          evaluationState.keyboardDefinitions.size;
        emitStatus(
          loopCount > 0
            ? `Running ${loopCount} live loop(s).`
            : keyboardHandlerCount > 0
              ? `Running ${keyboardHandlerCount} keyboard handler(s).`
              : "Done."
        );
        if (
          loopCount === 0 &&
          keyboardHandlerCount === 0
        ) {
          setPlaybackState(
            "stopped"
          );
        }
        emitRuntimeState(
          "Audio ready"
        );
      }
    } catch (error) {
      if (runToken !== currentRunToken) {
        if (error?.message === "Run stopped") return;
        throw error;
      }
      setPlaybackState("stopped");
      if (
        error instanceof Error &&
        error.message ===
          "Run stopped"
      ) {
        setPlaybackState(
          "stopped"
        );
        emitStatus("Stopped.");
        emitRuntimeState(
          "Audio ready"
        );
        return;
      }

      emitStatus(
        `Error: ${error.message}`
      );
      emitRuntimeState("Error");
      emitLog(formatLogArgs([error]));
      throw error;
    }
  }

  function put(name, sourceCode) {
    if (
      typeof name !== "string" ||
      name.length === 0
    ) {
      throw new Error(
        "put(name, sourceCode) requires a non-empty name"
      );
    }

    sourceMap.set(
      name,
      String(sourceCode ?? "")
    );
  }

  function load(name, sourceCode) {
    put(name, sourceCode);
  }

  function get(name) {
    return sourceMap.get(name) ?? null;
  }

  async function play(
    name,
    playOptions = {}
  ) {
    const sourceCode =
      sourceMap.get(name);

    if (sourceCode === undefined) {
      throw new Error(
        `Unknown source: ${name}`
      );
    }

    currentSourceName = name;
    await playSource(sourceCode, playOptions);
  }

  function stop() {
    performanceHost.stop();
    clearAuditions();
    currentRunToken += 1;
    loopTasks.clear();
    clockApi.cancelWaits();
    runtime.sampleClockStartTime = null;
    const workerMode = Boolean(logicWorker);
    if (workerMode) void stopLogicWorker();
    clearKeyboardHandlers();
    // Worker mode stops through its FIFO audio.stopAll/fx.detach commands.
    if (!workerMode) {
      liveApi.stopAllLoops();
      stopAllAudio();
      liveApi.flushLiveCleanups(
        new Set()
      );
      liveApi.clearRunFxChain();
      liveApi.clearPrepared();
      liveFxLifecycle.clear();
      megaDrive.audio?.nativeFX?.controller.dispose();
      runtime.context = {};
      megaDrive.stopRecordingPlayback?.();
    }
    setPlaybackState("stopped");
    emitStatus("Stopped.");
    emitRuntimeState(
      "Audio ready"
    );
  }

  /** Fade the complete output (including FX tails) before destructive audio cleanup. */
  function stopWithFade() {
    if (pendingFadeStop) return pendingFadeStop;
    const context = megaDrive.audioContext;
    if (!stopFadeNode || context?.state !== 'running') {
      stop();
      return Promise.resolve();
    }
    const runToken = currentRunToken;
    const now = context.currentTime, duration = 0.12, end = now + duration;
    const gain = stopFadeNode.gain;
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
    else {gain.cancelScheduledValues(now);gain.setValueAtTime(gain.value, now);}
    // Zero slope at both ends avoids a sharp envelope change on sustained
    // samples and reverb tails. The gate sits after the entire FX chain.
    const startGain = gain.value;
    if (typeof gain.setValueCurveAtTime === 'function') {
      const curve = Float32Array.from({length: 65}, (_, i) =>
        startGain * (1 + Math.cos(Math.PI * i / 64)) / 2);
      gain.setValueCurveAtTime(curve, now, duration);
    } else {
      gain.linearRampToValueAtTime(0, end);
    }
    pendingFadeStop = (async () => {
      // Follow the audio clock: a wall timer alone may fire before the ramp is rendered.
      while (runToken === currentRunToken && context.state === 'running' && context.currentTime < end) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      gain.cancelScheduledValues(context.currentTime);
      gain.setValueAtTime(0, context.currentTime);
      if (runToken !== currentRunToken) return;
      stop();
      if (logicWorkerStopPromise) await logicWorkerStopPromise;
    })().finally(() => {pendingFadeStop = null;});
    return pendingFadeStop;
  }

  function clear() {
    stop();
    sourceMap.clear();
    currentSourceName = null;
  }

  async function finalize() {
    stop();
    terminateLogicWorker();
    // Termination can discard the Worker stop command; release MIDI tails before closing the synth.
    stopAllAudio();
    sourceMap.clear();
    currentSourceName = null;
    synth = null;
    removeMegaDriveListener?.();
    removeMegaDriveListener =
      null;
    releaseInspectorMixerSubscription?.();
    releaseInspectorMixerSubscription=null;
    await megaDrive.close();
    // finalize() can be followed by initialize() on the same Runtime. Drop dead
    // port listeners while retaining the UI subscriptions for that next audio session.
    chipInspector.notify();
    stopFadeNode?.disconnect();
    if (stopFadeNode && megaDrive.audio) megaDrive.audio.outputNode = previousOutputNode;
    stopFadeNode = null;
    emitStatus("Finalized.");
    emitRuntimeState("Audio idle");
  }

  function getState() {
    let audio = "idle";

    if (prepareAudioPromise) {
      audio = "preparing";
    } else if (megaDrive.state === "error") {
      audio = "error";
    } else if (
      megaDrive.state === "ready" &&
      synth
    ) {
      audio = "ready";
    } else if (
      megaDrive.state === "starting"
    ) {
      audio = "preparing";
    }

    return {
      chip: capabilities.chip,
      capabilities,
      audio,
      playback: playbackState,
      currentSourceName,
      loadedSourceNames:
        Array.from(
          sourceMap.keys()
        ),
    };
  }

  return {
    mixer: megaDrive.mixer,
    chipInspector,
    logicWorkerUrl,
    initialize,
    ensureReady,
    prepareAudition,
    /** Host keyboard facade. Held notes take priority until release. */
    getAuditionSynth: () => auditionSynth,
    load,
    put,
    get,
    play,
    playSource,
    stop,
    stopWithFade,
    clear,
    finalize,
    getState,
    setMasterVolume,
    getMasterVolume,
    setTiming,
    getTiming,
    setBpm(value) {
      clockApi.setBpm(value);
      if (logicWorker) logicWorker.postMessage({type:'tempo',bpm:value});
      else megaDrive.audio?.nativeFX?.controller.syncTempo();
    },
    getBpm: () => runtime.bpm,
    get presets() {
      return presets;
    },
    get megaDrive() {
      return megaDrive;
    },
    get capabilities() {
      return capabilities;
    },
    get fm() {
      return capabilities.fmChannels > 0 ? synth : null;
    },
    get gameboy() {
      return capabilities.chip === 'gameboy' ? synth : null;
    },
    get psg() {
      return megaDrive.psg;
    },
    get sample() {
      return megaDrive.sample;
    },
    get stream() {
      return megaDrive.stream;
    },
    get noise() {
      return noiseApi;
    },
    get context() {
      return runtime.context;
    },
  };
}

/**
 * Compatibility factory for createPlaygroundRuntime.
 * @param {Parameters<typeof createPlaygroundRuntime>[0]} [options]
 * @returns {ReturnType<typeof createPlaygroundRuntime>} Playground runtime.
 */
export function Playground(
  options = {}
) {
  return createPlaygroundRuntime(
    options
  );
}
