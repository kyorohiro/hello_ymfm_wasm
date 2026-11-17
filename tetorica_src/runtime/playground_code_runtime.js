// A small, injectable code host shared with Synth. No chip, audio device,
// editor or filesystem is constructed here. The full Playground uses these
// same clock, music, live-loop and effect lifecycle modules.
import {createPlaygroundClock} from './playground_clock.js';
import {createPlaygroundLive} from './playground_live.js';
import {createPlaygroundMusic} from './playground_music.js';
import {createLoopAsyncTasks} from './playground_async_tasks.js';
import {createLiveFxLifecycle} from './native_fx.js';
import {executeWithPlaygroundGuards} from './playground_execution.js';
import {midiToOpnPitch,opnPitchFromHz} from './soundchip_pitch.js';
import {FM_PRESETS} from './megasynth-fm-presets.js';
import {formatLogArgs,formatLogTable} from './playground_log.js?v=console-table-1';
import {readVab,prepareVabTone,exportVab,MAX_VAB_FILE_BYTES} from './ps1_vab.js';
import {assembleScspDsp, disassembleScspDsp} from './scsp_dsp_assembler.js';

/** @typedef {'ym2612'|'segapsg'|'rf5c164'|'pwm'} DefaultCodeSoundChip */
/** @type {readonly DefaultCodeSoundChip[]} */
export const CODE_SOUND_CHIPS=Object.freeze(['ym2612','segapsg','rf5c164','pwm']);
const NOTES={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
const SCALES={majorPentatonic:[0,2,4,7,9],minorPentatonic:[0,3,5,7,10],major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]};
const stopped=()=>new DOMException('Run stopped','AbortError');
const scheduleModuleId=globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
let nextScheduleRuntime=0;

/**
 * @typedef {Object} PlaygroundCodeRuntimeState
 * @property {string} state
 * @property {string} playback
 * @property {boolean} running
 * @property {boolean} stopping
 * @property {boolean} busy
 * @property {string} status
 * @property {string} path
 * @property {number} bpm
 * @property {string[]} loopNames
 * @property {unknown} [error]
 */
/**
 * @template {string} [ChipName=DefaultCodeSoundChip]
 * @typedef {Object} PlaygroundCodeRuntimeOptions
 * @property {()=>unknown} ensureReady Prepare the injected audio owner before evaluating user code; may return a promise.
 * @property {()=>number} now Audio clock in seconds.
 * @property {(name:ChipName)=>object|Promise<object>} useSoundChip Borrow a supported chip client.
 * @property {readonly ChipName[]} [supportedSoundChips] Host-owned chip IDs; defaults to the four Genesis instruments.
 * @property {(target:object,method:string,args:unknown[])=>{target:object,channel:number}|null} [resolveNoteTarget] Map nested/aliased Gate methods to one physical channel owner.
 * @property {()=>object|null} [getFm] Current FM compatibility client.
 * @property {object} [fx] Effect factories and live-effect controls owned by the host.
 * @property {(path:string,options:object,entry:{path:string})=>unknown} [readFile] Read a virtual file; may return a promise.
 * @property {(source:string,options:{path:string})=>string|Promise<string>} [prepareSource] Resolve virtual modules before execution.
 * @property {(line:string)=>void} [onLog]
 * @property {(state:PlaygroundCodeRuntimeState)=>void} [onState]
 * @property {()=>unknown} [beforeStopSoundChips] Await the host output fade before releasing notes/resources.
 * @property {()=>unknown} [stopSoundChips] Stop the borrowed chips; may return a promise.
 * @property {boolean} [guardExecution]
 * @property {object} [realm] Realm whose user-code network/navigation guards are installed temporarily.
 * @property {typeof globalThis.setTimeout} [setTimer]
 * @property {typeof globalThis.clearTimeout} [clearTimer]
 * @property {()=>MessageChannel|null} [createTaskChannel] Optional task dispatch hook; null uses timer dispatch.
 */
/**
 * Main-thread live code execution, with an injected audio owner. ensureReady
 * prepares providers before user guards run; readFile / prepareSource bridge
 * the host's virtual files using the existing Playground file helpers.
 * Timed clients may expose an internal reservation lifecycle capability.
 * schedule / clearSchedule mutations require an active entry evaluation or an
 * identified liveLoop; detached ambiguous callbacks are rejected. Timed data
 * queries (build / compile / captureState) retain their ordinary scoped access.
 * @template {string} [ChipName=DefaultCodeSoundChip]
 * @param {PlaygroundCodeRuntimeOptions<ChipName>} options
 */
export function createPlaygroundCodeRuntime({ensureReady,now,useSoundChip,supportedSoundChips=CODE_SOUND_CHIPS,getFm=()=>null,fx={},
  resolveNoteTarget=(target,_method,args)=>Number.isInteger(args[0])?{target,channel:args[0]}:null,
  readFile=()=>{throw Error('Virtual files are unavailable');},prepareSource=source=>source,
  onLog=()=>{},onState=()=>{},beforeStopSoundChips=()=>{},stopSoundChips=()=>{},guardExecution=true,realm=globalThis,
  setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),createTaskChannel,
}={}) {
  for(const fn of [ensureReady,now,useSoundChip,getFm,resolveNoteTarget,readFile,prepareSource,onLog,onState,beforeStopSoundChips,stopSoundChips,setTimer,clearTimer]) {
    if(typeof fn!=='function')throw TypeError('Code runtime needs host callbacks');
  }
  const configuredChips=Array.isArray(supportedSoundChips)?Array.from(supportedSoundChips):[];
  if(!configuredChips.length||configuredChips.some(name=>typeof name!=='string'||!/^[a-z][a-z0-9-]*$/.test(name))||
    new Set(configuredChips).size!==configuredChips.length)throw TypeError('Code runtime needs unique supported sound chip IDs');
  const chipNames=new Set(configuredChips);
  const runtime={bpm:120,clockStartTime:null,sampleClockStartTime:null,
    liveLoops:new Map(),livePrepared:new Map(),liveCleanupHooks:new Map(),context:{}};
  let epoch=0,evaluation=0,currentLoop=null,active=false,cleanupMode=false,cleanupTail=Promise.resolve(),pendingStops=0;
  let sessionAbort=new AbortController(),latestEvaluation=null,state='idle',status='Ready.',path='/index.js',failure=null;
  const clients=new Map(),activeNotes=new Set(),preparedFx=new Set(),loopScopes=new Map(),evaluations=new Set(),ownedNotes=new Map();
  // Timed chip reservations share the existing Run / loop scopes. Entry-level
  // changes are staged until Apply succeeds; loop calls update live patterns.
  const scheduleRuntimeId=`code:${scheduleModuleId}:${++nextScheduleRuntime}`;
  const timedLoops=new WeakMap();let nextTimedLoop=0;
  const newTimedState=()=>({epoch,entryOwner:`${scheduleRuntimeId}:run:${epoch}:entry`,entryControllers:new Set(),owners:new Map(),subscriptions:new Map()});
  let timedState=newTimedState();
  let fxLifecycle=createLiveFxLifecycle(),activeFx=new Map();
  const retainedCleanupNames=new Set();
  const getState=()=>({state,playback:state,running:active,stopping:pendingStops>0,busy:state==='preparing'||pendingStops>0,status,path,bpm:runtime.bpm,
    loopNames:live.getActiveLoopNames(),...(failure?{error:failure}:{} )});
  const notify=()=>onState(getState());
  function report(message){status=String(message);notify();}
  const clock=createPlaygroundClock({runtime,getAudioContext:()=>({currentTime:now()}),getCurrentRunToken:()=>epoch,
    getCurrentLoopContext:()=>currentLoop,setCurrentLoopContext:loop=>{currentLoop=loop;},setTimer,clearTimer,createTaskChannel});
  const tasks=createLoopAsyncTasks({getLoop:()=>currentLoop,cancelWaits:loop=>clock.cancelWaits(loop)});
  function loopScope(loop) {
    if(!loopScopes.has(loop)) {
      const controller=new AbortController(),signal=sessionAbort.signal;
      const abort=()=>controller.abort(stopped());signal.addEventListener('abort',abort,{once:true});
      loopScopes.set(loop,{epoch,loop,controller,detach:()=>signal.removeEventListener('abort',abort)});
    }
    return loopScopes.get(loop);
  }
  function releaseOwned(matches) {
    const failed=error=>{
      if(error?.name==='AbortError'||error?.message==='Run stopped')return;
      try{onLog(formatLogArgs([error]));}catch{}
    };
    for(const [target,notes]of ownedNotes)for(const [channel,owner]of notes)if(matches(owner)) {
      notes.delete(channel);
      try {
        const pending=(target.noteOff??target.keyOff)?.call(target,channel);
        // A Worklet RPC can reject after physical Stop invalidates its audio
        // session. Observe that result without letting a hung release prevent
        // the host's unconditional physical-stop fence.
        if(pending&&typeof pending.then==='function')Promise.resolve(pending).catch(failed);
      }catch(error){failed(error);}
    }
  }
  function observeTimedCleanup(invoke) {
    try {
      Promise.resolve(invoke()).catch(error=>{
        if(error?.name==='AbortError'||error?.message==='Run stopped')return;
        try{onLog(`[cleanup] ${error?.message??String(error)}`);}catch{}
      });
    }catch(error){if(error?.name!=='AbortError')try{onLog(`[cleanup] ${error?.message??String(error)}`);}catch{}}
  }
  function rememberTimedOwner(state,controller,owner) {
    if(!state.owners.has(controller))state.owners.set(controller,new Set());
    state.owners.get(controller).add(owner);
    if(typeof controller.onError==='function'&&!state.subscriptions.has(controller)){
      const release=controller.onError(error=>{
        if(state!==timedState||!active||error?.owner&&!state.owners.get(controller)?.has(error.owner))return;
        try{onLog(`[AY schedules] ${error?.message??String(error)}`);}catch{}
      });
      state.subscriptions.set(controller,typeof release==='function'?release:()=>{});
    }
  }
  function abortTimedEvaluation(scope) {
    if(scope.timedAborted)return;
    scope.timedAborted=true;
    for(const controller of scope.timedControllers??[])observeTimedCleanup(()=>controller.abort(scope.timedTransaction,scope.timedState.entryOwner));
  }
  function cancelTimedLoop(loop) {
    const entry=timedLoops.get(loop);if(!entry)return;
    for(const [controller,owners]of entry.state.owners)if(owners.delete(entry.owner))observeTimedCleanup(()=>{
      const release=active&&typeof controller.releaseOwner==='function'?controller.releaseOwner:controller.cancelOwner;
      return release.call(controller,entry.owner);
    });
  }
  function retireTimedState(state) {
    for(const [controller,owners]of state.owners)for(const owner of owners)observeTimedCleanup(()=>controller.cancelOwner(owner));
    for(const release of state.subscriptions.values())observeTimedCleanup(release);state.subscriptions.clear();
    state.owners.clear();state.entryControllers.clear();
  }
  function timedCall(controller,method,args,caller) {
    // cleanupMode permits ordinary release callbacks, not fresh reservations or
    // a retired finally-block cancelling a newer named pattern.
    if(cleanupMode||caller.epoch!==epoch||caller.loop?.stopped||caller.controller?.signal.aborted)throw stopped();
    for(const name of ['schedule','clearSchedule','stage','commit','abort','cancelOwner'])if(typeof controller[name]!=='function')throw TypeError('Incomplete timed-operation lifecycle capability');
    if(caller.loop) {
      let entry=timedLoops.get(caller.loop);
      if(!entry){entry={state:timedState,owner:`${scheduleRuntimeId}:run:${epoch}:loop:${++nextTimedLoop}`};timedLoops.set(caller.loop,entry);}
      rememberTimedOwner(entry.state,controller,entry.owner);
      const result=method==='schedule'?controller.schedule(args[0],args[1],{owner:entry.owner}):controller.clearSchedule(args[0],{owner:entry.owner});
      const previous=currentLoop;currentLoop=caller.loop;
      try{tasks.track(Promise.resolve(result));}finally{currentLoop=previous;}
      return result;
    }
    // A client retained in context can be used by a newer Apply evaluation.
    const scope=latestEvaluation?.epoch===epoch&&!latestEvaluation.completed&&!latestEvaluation.controller.signal.aborted?latestEvaluation:caller;
    // A detached callback after entry completion has no evaluation transaction
    // or loop identity. Never let such an old finally mutate the stable entry
    // owner's newer manifest.
    if(scope.id===undefined||scope.completed)throw new DOMException('Timed reservations require an active entry evaluation or liveLoop','AbortError');
    const state=scope.timedState??timedState;
    rememberTimedOwner(state,controller,state.entryOwner);
    scope.timedControllers.add(controller);
    const result=Promise.resolve(controller.stage(scope.timedTransaction,state.entryOwner,method,args));
    // Unawaited stage calls are still validated before commit. Observe the
    // rejection here and retain it for Promise.all below.
    result.catch(()=>{});scope.timedPending.push(result);
    return result;
  }
  async function commitTimedEvaluation(scope) {
    await waitForScope(Promise.all(scope.timedPending),scope);check(scope);
    for(const controller of scope.timedState.entryControllers)scope.timedControllers.add(controller);
    for(const controller of scope.timedControllers) {
      await waitForScope(controller.commit(scope.timedTransaction,scope.timedState.entryOwner),scope);check(scope);
    }
    for(const controller of scope.timedControllers)scope.timedState.entryControllers.add(controller);
  }
  function cancelLoop(loop) {
    loopScopes.get(loop)?.controller.abort(stopped());clock.cancelWaits(loop);
    cancelTimedLoop(loop);
    releaseOwned(owner=>owner.loop===loop);
  }
  const live=createPlaygroundLive({runtime,megaDrive:{getFXChain:()=>[],clearFXChain:()=>[]},preparedFxUnits:preparedFx,
    currentBeat:clock.currentBeat,currentSampleCursor:clock.currentSampleCursor,
    getCurrentLoopContext:()=>currentLoop,setCurrentLoopContext:loop=>{currentLoop=loop;},cancelWaits:cancelLoop,
    finishTasks:loop=>tasks.finish(loop),releaseTasks:loop=>{
      tasks.release(loop);cancelTimedLoop(loop);const scope=loopScopes.get(loop);scope?.controller.abort(stopped());scope?.detach();loopScopes.delete(loop);
    },logLine:onLog,setStatus:report,getKeyboardNames:()=>[...retainedCleanupNames],
    executeCallback:fn=>{
      if(!cleanupMode)return runUser(loopScope(currentLoop),fn);
      // A cleanup can release its resources synchronously after the host fade,
      // but an arbitrary user promise must not hold the retirement fence open.
      const controller=new AbortController();controller.abort(stopped());
      return runUser({epoch,controller},fn).catch(error=>{
        if(error?.name!=='AbortError'||error.message!=='Run stopped')throw error;
      });
    }});

  function scopeFor(base) {
    if(base.loop||base.controller?.signal.aborted)return base;
    return currentLoop&&base.epoch===epoch?loopScope(currentLoop):base;
  }
  function check(scope) {
    if(cleanupMode)return;
    if(!active||scope.epoch!==epoch||scope.loop?.stopped||scope.controller?.signal.aborted)throw stopped();
    if(scope.id!==undefined&&!scope.completed&&scope.id!==evaluation)throw stopped();
  }
  function waitForScope(value,scope) {
    const signal=scope.controller?.signal;
    if(!signal)return Promise.resolve(value);
    return new Promise((resolve,reject)=>{
      const abort=()=>{signal.removeEventListener('abort',abort);reject(stopped());};signal.addEventListener('abort',abort,{once:true});
      const complete=callback=>result=>{signal.removeEventListener('abort',abort);callback(result);};
      Promise.resolve(value).then(complete(resolve),complete(reject));
      if(signal.aborted){signal.removeEventListener('abort',abort);reject(stopped());}
    });
  }
  function runUser(scope,fn) {
    check(scope);
    let body;
    const execution=executeWithPlaygroundGuards(()=>{
      try{body=Promise.resolve(fn());}catch(error){body=Promise.reject(error);}
      return waitForScope(body,scope);
    },realm,{enabled:guardExecution});
    if(!scope.loop||!body)return execution;
    // Aborting the execution guard must not retire the loop context before its
    // guarded waits reject and user finally blocks run. Stop never waits for
    // loop bodies; their capabilities are already fenced by the aborted scope.
    execution.catch(()=>{});
    return body;
  }
  // Clients retained in context or livePrepare remain usable through Apply,
  // but every operation is checked against its owning Run and loop.
  const proxyCaches=new WeakMap(),wrappedValues=new WeakMap();
  const plain=value=>Array.isArray(value)||value&&typeof value==='object'&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value));
  function containsWrapped(value,seen=new WeakSet()) {
    if(!value||!['object','function'].includes(typeof value))return false;
    if(wrappedValues.has(value))return true;
    if(!plain(value)||seen.has(value))return false;
    seen.add(value);return Object.keys(value).some(key=>containsWrapped(value[key],seen));
  }
  // Capabilities remain guarded in user code, but native APIs need their own
  // original unit identities and cloneable data. Unwrap without mutating the
  // caller's objects; ordinary context/options retain their original identity.
  function unwrap(value,seen=new WeakMap()) {
    let capability=false;
    if(value&&['object','function'].includes(typeof value)&&wrappedValues.has(value)) {
      while(wrappedValues.has(value)) {
        const entry=wrappedValues.get(value);check(scopeFor(entry.scope));value=entry.value;capability=true;
      }
    }
    if(capability)return value;
    if(!plain(value)||!containsWrapped(value))return value;
    if(seen.has(value))return seen.get(value);
    const result=Array.isArray(value)?new Array(value.length):Object.create(Object.getPrototypeOf(value));seen.set(value,result);
    for(const key of Object.keys(value))result[key]=unwrap(value[key],seen);
    return result;
  }
  function guarded(value,scope) {
    if(!value||!['object','function'].includes(typeof value)||ArrayBuffer.isView(value)||value instanceof ArrayBuffer)return value;
    let cache=proxyCaches.get(scope);if(!cache){cache=new WeakMap();proxyCaches.set(scope,cache);}
    if(cache.has(value))return cache.get(value);
    const proxy=new Proxy(value,{
      get(target,key) {
        const owner=scopeFor(scope);check(owner);
        if(key==='_timedOperations')return undefined;
        const member=Reflect.get(target,key,target);
        if(typeof member!=='function')return guarded(member,owner);
        const method=(...args)=>{
          let caller=scopeFor(scope);check(caller);
          // A host may expose one physical voice through both a root API and
          // a monophonic child (for example wave.keyOn()). Canonical ownership
          // keeps Stop Loop from releasing a newer Gate through another alias.
          const noteTarget=['noteOn','keyOn','noteOff','keyOff','releaseNote'].includes(key)?resolveNoteTarget(target,key,args):null;
          if(noteTarget&&(!noteTarget.target||!Number.isInteger(noteTarget.channel)))throw TypeError('Invalid Code note target');
          const timedData=['build','compile','captureState','schedule','clearSchedule'].includes(key)?Reflect.get(target,'_timedOperations',target):null;
          if(timedData&&!caller.loop&&latestEvaluation?.epoch===epoch&&!latestEvaluation.completed&&!latestEvaluation.controller.signal.aborted){caller=latestEvaluation;check(caller);}
          const controller=['schedule','clearSchedule'].includes(key)?timedData:null;
          const parameters=args.map(value=>unwrap(value));
          const result=controller?timedCall(controller,key,parameters,caller):Reflect.apply(member,target,parameters);
          if(noteTarget){
            const {target:physical,channel}=noteTarget;
            if(['noteOn','keyOn'].includes(key)) {
              if(!ownedNotes.has(physical))ownedNotes.set(physical,new Map());ownedNotes.get(physical).set(channel,caller);
            }else ownedNotes.get(physical)?.delete(channel);
          }
          if(result&&typeof result.then==='function'){
            const pending=waitForScope(result,caller).then(next=>{
              currentLoop=caller.loop??null;check(caller);return timedData?next:guarded(next,caller);
            },error=>{currentLoop=caller.loop??null;throw error;});
            if(controller)pending.catch(()=>{});
            return pending;
          }
          // Timed plans, snapshots, traces and admission receipts are detached
          // data, not capabilities. Proxying deeply frozen fields also breaks
          // JavaScript's non-configurable-property invariants.
          return timedData?result:guarded(result,caller);
        };
        wrappedValues.set(method,{value:member,scope:owner});return method;
      },
      set(target,key,value){check(scopeFor(scope));return Reflect.set(target,key,value,target);},
    });
    cache.set(value,proxy);wrappedValues.set(proxy,{value,scope});return proxy;
  }
  function cleanup() {
    // Invalidate user work immediately. Physical note releases and effects
    // belong after the host's output fade, including loop-finally cleanups.
    epoch++;evaluation++;active=false;currentLoop=null;pendingStops++;
    const retiringTimedState=timedState;timedState=newTimedState();
    for(const scope of evaluations)abortTimedEvaluation(scope);
    retireTimedState(retiringTimedState);
    for(const definition of runtime.liveCleanupHooks.values())for(const name of definition.names)retainedCleanupNames.add(name);
    for(const loop of runtime.liveLoops.values()){loop.stopped=true;loop.runToken++;}
    sessionAbort.abort(stopped());latestEvaluation?.controller.abort(stopped());
    clock.cancelWaits();tasks.clear();activeNotes.clear();clients.clear();
    runtime.context={};runtime.clockStartTime=runtime.sampleClockStartTime=null;
    const retiringFx=fxLifecycle,retiringEvaluations=[...evaluations];
    const cleanupError=error=>{try{onLog(`[cleanup] ${error?.message??String(error)}`);}catch{}};
    const attempt=fn=>{try{fn();}catch(error){cleanupError(error);}};
    cleanupTail=cleanupTail.catch(()=>{}).then(async()=>{
      try {
        try{await beforeStopSoundChips();}catch(error){cleanupError(error);}
        cleanupMode=true;
        try {
          attempt(()=>live.stopAllLoops());attempt(()=>releaseOwned(()=>true));ownedNotes.clear();
          attempt(()=>live.flushLiveCleanups(new Set()));attempt(()=>live.clearPrepared());attempt(()=>retiringFx.clear());
          for(const item of retiringEvaluations)for(const definition of item.liveFxDefinitions?.values()??[])attempt(()=>definition.remove());
        } finally {cleanupMode=false;}
        // A user-created resource or failed effect endpoint may throw during
        // disposal. Retire bookkeeping anyway and always reach physical stop.
        fxLifecycle=createLiveFxLifecycle();activeFx=new Map();preparedFx.clear();runtime.livePrepared.clear();
        clock.cancelWaits();tasks.clear();
        try{await live.settled();}catch(error){cleanupError(error);}
        await stopSoundChips();
      } finally {
        pendingStops--;if(!pendingStops)retainedCleanupNames.clear();notify();
      }
    });
    notify();
    return cleanupTail;
  }
  function globalsFor(scope) {
    const definitions={loopDefinitions:new Map(),cleanupDefinitions:[],cleanupScope:'entry',cleanupCallIndex:0,liveFxDefinitions:new Map()};
    Object.assign(scope,definitions);evaluations.add(scope);
    const effectApi=fxLifecycle.track(fx,definitions.liveFxDefinitions);
    const ensure=()=>{const owner=scopeFor(scope);check(owner);return owner;};
    const fm=()=>guarded(getFm(),ensure());
    const music=createPlaygroundMusic({noteToSemitone:NOTES,scaleIntervals:SCALES,
      getPitch:midi=>midiToOpnPitch(midi,getFm()?.clock??7670454),
      getFrequencyPitch:(hz,master)=>opnPitchFromHz(hz,master??getFm()?.clock??7670454,144,{clamp:true}),
      synth:fm,presets:FM_PRESETS,activeNotes,getBpm:()=>runtime.bpm,getCurrentLoopContext:()=>currentLoop,
      sleep:seconds=>{ensure();return clock.sleep(seconds,scope.epoch);},
      waitBeats:beats=>{ensure();return clock.waitForBeat(clock.currentBeat()+beats,scope.epoch);}});
    const log=(...args)=>{ensure();onLog(formatLogArgs(args));};
    const globals={context:runtime.context,fm:fm(),fx:guarded(effectApi,scope),FM_PRESETS,CH1:0,CH2:1,CH3:2,CH4:3,CH5:4,CH6:5,
      readVab,prepareVabTone,exportVab,MAX_VAB_FILE_BYTES,
      assembleScspDsp, disassembleScspDsp,
      PSG1:0,PSG2:1,PSG3:2,OP1:0,OP2:1,OP3:2,OP4:3,
      console:{log,warn:(...args)=>log('[warn]',...args),error:(...args)=>log('[error]',...args),table:(data,columns)=>log(formatLogTable(data,columns))},log,
      async useSoundChip(name) {
        const owner=ensure();
        if(!chipNames.has(name))throw RangeError(`Unsupported Code sound chip: ${String(name)}`);
        if(!clients.has(name))clients.set(name,Promise.resolve().then(()=>{check(owner);return useSoundChip(name);}));
        const pending=clients.get(name);
        try {
          const client=await waitForScope(pending,owner);currentLoop=owner.loop??null;check(owner);return guarded(client,owner);
        } catch(error) {currentLoop=owner.loop??null;if(clients.get(name)===pending)clients.delete(name);throw error;}
      },
      file:(filePath,options={})=>{const owner=ensure();return waitForScope(readFile(filePath,options,{path:scope.path}),owner).then(value=>{
        currentLoop=owner.loop??null;check(owner);return value;
      },error=>{currentLoop=owner.loop??null;throw error;});},
      setBpm(value){ensure();clock.setBpm(value);notify();},
      beat(value=1){ensure();return clock.beat(value);},nextBeat(){ensure();return clock.nextBeat();},
      sleep(seconds){ensure();return clock.sleep(seconds,scope.epoch);},
      sleepSamples(samples,rate=44100){ensure();return clock.sleepSamples(samples,rate,scope.epoch);},
      tween(duration,callback){ensure();return clock.tween(duration,callback,scope.epoch);},
      liveLoop(name,fn){ensure();live.liveLoop(name,fn,definitions);},
      livePrepare(name,fn){ensure();return fxLifecycle.prepare(name,definitions.liveFxDefinitions,
        ()=>live.livePrepare(name,api=>runUser(scopeFor(scope),()=>fn(api)),globals));},
      liveFx(name,options){ensure();if(typeof effectApi.liveFx!=='function')throw Error('Code effects are unavailable');return guarded(effectApi.liveFx(name,unwrap(options)),scopeFor(scope));},
      stopLoop(name){ensure();live.stopLoop(name);notify();},stopAllLoops(){ensure();live.stopAllLoops();notify();},
      liveCleanup(names,fn){ensure();live.liveCleanup(names,fn,definitions);},
      trackAsync(promise){ensure();tasks.track(promise);},
      // Synth Code names its chip explicitly. The full Playground retains its
      // default-FM play() helper; this host shares only the musical utilities.
      ...Object.fromEntries(Object.entries(music).filter(([name])=>name!=='play')
        .map(([name,fn])=>[name,(...args)=>{ensure();return fn(...args);} ])),
    };
    globals.pg=globals;
    return globals;
  }
  async function evaluate(source,options,fresh) {
    if(typeof source!=='string')throw TypeError('Code source must be a string');
    const entry=options.path??'/index.js';if(typeof entry!=='string'||!entry.startsWith('/'))throw TypeError('Code entry path must be absolute');
    const startsFresh=fresh||!active;
    const retiring=startsFresh?cleanup():cleanupTail;
    if(startsFresh)sessionAbort=new AbortController();
    if(latestEvaluation&&!latestEvaluation.completed)latestEvaluation.controller.abort(stopped());
    const scope={epoch,id:++evaluation,path:entry,controller:new AbortController(),completed:false,timedState,
      timedTransaction:`${scheduleRuntimeId}:run:${epoch}:evaluation:${evaluation}`,timedControllers:new Set(),timedPending:[]};
    latestEvaluation=scope;active=true;state='preparing';status='Preparing Code…';path=entry;failure=null;notify();
    try {
      await retiring;check(scope);await ensureReady();check(scope);
      const prepared=await prepareSource(source,{path:entry});check(scope);
      currentLoop=null;
      const globals=globalsFor(scope),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
      const fn=new AsyncFunction(...Object.keys(globals),`"use strict";\n${prepared}\n//# sourceURL=tetorica-code:${encodeURIComponent(entry)}`);
      await runUser(scope,()=>fn(...Object.values(globals)));check(scope);
      await commitTimedEvaluation(scope);check(scope);
      scope.completed=true;fxLifecycle.commit(scope.liveFxDefinitions);activeFx=scope.liveFxDefinitions;
      live.commitLiveLoops(scope.loopDefinitions);live.commitLiveCleanups(scope.cleanupDefinitions,scope.cleanupScope);
      state='running';status=scope.loopDefinitions.size?`Running ${scope.loopDefinitions.size} live loop(s).`:'Code applied.';notify();
      return getState();
    } catch(error) {
      abortTimedEvaluation(scope);
      if(scope.epoch!==epoch||scope.id!==evaluation||scope.controller.signal.aborted)throw stopped();
      const message=error?.message??String(error);
      scope.controller.abort(stopped());
      if(startsFresh) {
        const pending=cleanup(),retiringEpoch=epoch;await pending;
        if(epoch!==retiringEpoch)throw stopped();
      } else {
        for(const [name,definition]of scope.liveFxDefinitions??[]) {
          try {if(activeFx.has(name))activeFx.get(name).restore();else definition.remove();}
          catch(fxError){try{onLog(`[cleanup] ${fxError?.message??String(fxError)}`);}catch{}}
        }
        releaseOwned(owner=>owner===scope);
      }
      failure=message;state='error';status=`Code error: ${failure}`;onLog(status);notify();throw error;
    } finally {evaluations.delete(scope);if(currentLoop?.stopped)currentLoop=null;}
  }
  return {
    run:(source,options={})=>evaluate(source,options,true),
    apply:(source,options={})=>evaluate(source,options,false),
    async stop() {const pending=cleanup();state='stopped';status='Code stopped.';failure=null;notify();await pending;return getState();},
    getState,getContext:()=>runtime.context,
  };
}
