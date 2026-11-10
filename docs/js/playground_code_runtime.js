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
import {formatLogArgs} from './playground_log.js';

export const CODE_SOUND_CHIPS=Object.freeze(['ym2612','segapsg','rf5c164','pwm']);
const NOTES={C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11};
const SCALES={majorPentatonic:[0,2,4,7,9],minorPentatonic:[0,3,5,7,10],major:[0,2,4,5,7,9,11],minor:[0,2,3,5,7,8,10]};
const stopped=()=>new DOMException('Run stopped','AbortError');

/**
 * Main-thread live code execution, with an injected audio owner. ensureReady
 * prepares providers before user guards run; readFile / prepareSource bridge
 * the host's virtual files using the existing Playground file helpers.
 */
export function createPlaygroundCodeRuntime({ensureReady,now,useSoundChip,getFm=()=>null,fx={},
  readFile=()=>{throw Error('Virtual files are unavailable');},prepareSource=source=>source,
  onLog=()=>{},onState=()=>{},stopSoundChips=()=>{},guardExecution=true,realm=globalThis,
  setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),createTaskChannel,
}={}) {
  for(const fn of [ensureReady,now,useSoundChip,getFm,readFile,prepareSource,onLog,onState,stopSoundChips,setTimer,clearTimer]) {
    if(typeof fn!=='function')throw TypeError('Code runtime needs host callbacks');
  }
  const runtime={bpm:120,clockStartTime:null,sampleClockStartTime:null,
    liveLoops:new Map(),livePrepared:new Map(),liveCleanupHooks:new Map(),context:{}};
  let epoch=0,evaluation=0,currentLoop=null,active=false,cleanupMode=false,cleanupTail=Promise.resolve();
  let sessionAbort=new AbortController(),latestEvaluation=null,state='idle',status='Ready.',path='/index.js',failure=null;
  const clients=new Map(),activeNotes=new Set(),preparedFx=new Set(),loopScopes=new Map(),evaluations=new Set(),ownedNotes=new Map();
  let fxLifecycle=createLiveFxLifecycle(),activeFx=new Map();
  const getState=()=>({state,playback:state,running:active,busy:state==='preparing',status,path,bpm:runtime.bpm,
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
    for(const [target,notes]of ownedNotes)for(const [channel,owner]of notes)if(matches(owner)) {
      notes.delete(channel);
      try {(target.noteOff??target.keyOff)?.call(target,channel);}catch(error){onLog(formatLogArgs([error]));}
    }
  }
  function cancelLoop(loop) {
    loopScopes.get(loop)?.controller.abort(stopped());clock.cancelWaits(loop);
    releaseOwned(owner=>owner.loop===loop);
  }
  const live=createPlaygroundLive({runtime,megaDrive:{getFXChain:()=>[],clearFXChain:()=>[]},preparedFxUnits:preparedFx,
    currentBeat:clock.currentBeat,currentSampleCursor:clock.currentSampleCursor,
    getCurrentLoopContext:()=>currentLoop,setCurrentLoopContext:loop=>{currentLoop=loop;},cancelWaits:cancelLoop,
    finishTasks:loop=>tasks.finish(loop),releaseTasks:loop=>{
      tasks.release(loop);const scope=loopScopes.get(loop);scope?.detach();loopScopes.delete(loop);
    },logLine:onLog,setStatus:report,
    executeCallback:fn=>runUser(loopScope(currentLoop),fn)});

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
    return executeWithPlaygroundGuards(()=>waitForScope(fn(),scope),realm,{enabled:guardExecution});
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
        const member=Reflect.get(target,key,target);
        if(typeof member!=='function')return guarded(member,owner);
        const method=(...args)=>{
          const caller=scopeFor(scope);check(caller);
          const result=Reflect.apply(member,target,args.map(value=>unwrap(value)));
          if(['noteOn','keyOn'].includes(key)&&Number.isInteger(args[0])) {
            if(!ownedNotes.has(target))ownedNotes.set(target,new Map());ownedNotes.get(target).set(args[0],caller);
          } else if(['noteOff','keyOff','releaseNote'].includes(key))ownedNotes.get(target)?.delete(args[0]);
          if(result&&typeof result.then==='function')return waitForScope(result,caller).then(next=>{
            currentLoop=caller.loop??null;check(caller);return guarded(next,caller);
          });
          return guarded(result,caller);
        };
        wrappedValues.set(method,{value:member,scope:owner});return method;
      },
      set(target,key,value){check(scopeFor(scope));return Reflect.set(target,key,value,target);},
    });
    cache.set(value,proxy);wrappedValues.set(proxy,{value,scope});return proxy;
  }
  function cleanup() {
    sessionAbort.abort(stopped());latestEvaluation?.controller.abort(stopped());
    epoch++;evaluation++;active=false;currentLoop=null;
    const cleanupError=error=>{try{onLog(`[cleanup] ${error?.message??String(error)}`);}catch{}};
    const attempt=fn=>{try{fn();}catch(error){cleanupError(error);}};
    attempt(()=>live.stopAllLoops());clock.cancelWaits();tasks.clear();activeNotes.clear();clients.clear();ownedNotes.clear();
    cleanupMode=true;
    try {
      attempt(()=>live.flushLiveCleanups(new Set()));attempt(()=>live.clearPrepared());attempt(()=>fxLifecycle.clear());
      for(const item of evaluations)for(const definition of item.liveFxDefinitions.values())attempt(()=>definition.remove());
    } finally {cleanupMode=false;}
    // A user-created prepared resource or a failed effect endpoint may throw
    // during disposal. Retire their bookkeeping anyway and always reach the
    // host's physical stop; the next Run must not reuse those stale resources.
    fxLifecycle=createLiveFxLifecycle();activeFx=new Map();preparedFx.clear();runtime.livePrepared.clear();
    runtime.context={};runtime.clockStartTime=runtime.sampleClockStartTime=null;
    cleanupTail=cleanupTail.catch(()=>{}).then(async()=>{
      try{await live.settled();}catch(error){cleanupError(error);}
      await stopSoundChips();
    });
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
      PSG1:0,PSG2:1,PSG3:2,OP1:0,OP2:1,OP3:2,OP4:3,
      console:{log,warn:(...args)=>log('[warn]',...args),error:(...args)=>log('[error]',...args)},log,
      async useSoundChip(name) {
        const owner=ensure();
        if(!CODE_SOUND_CHIPS.includes(name))throw RangeError(`Unsupported Code sound chip: ${String(name)}`);
        if(!clients.has(name))clients.set(name,Promise.resolve().then(()=>{check(owner);return useSoundChip(name);}));
        const pending=clients.get(name);
        try {
          const client=await waitForScope(pending,owner);currentLoop=owner.loop??null;check(owner);return guarded(client,owner);
        } catch(error) {if(clients.get(name)===pending)clients.delete(name);throw error;}
      },
      file:(filePath,options={})=>{const owner=ensure();return waitForScope(readFile(filePath,options,{path:scope.path}),owner).then(value=>{
        currentLoop=owner.loop??null;check(owner);return value;
      });},
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
    const scope={epoch,id:++evaluation,path:entry,controller:new AbortController(),completed:false};
    latestEvaluation=scope;active=true;state='preparing';status='Preparing Code…';path=entry;failure=null;notify();
    try {
      await retiring;check(scope);await ensureReady();check(scope);
      const prepared=await prepareSource(source,{path:entry});check(scope);
      currentLoop=null;
      const globals=globalsFor(scope),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
      const fn=new AsyncFunction(...Object.keys(globals),`"use strict";\n${prepared}\n//# sourceURL=tetorica-code:${encodeURIComponent(entry)}`);
      await runUser(scope,()=>fn(...Object.values(globals)));check(scope);
      scope.completed=true;fxLifecycle.commit(scope.liveFxDefinitions);activeFx=scope.liveFxDefinitions;
      live.commitLiveLoops(scope.loopDefinitions);live.commitLiveCleanups(scope.cleanupDefinitions,scope.cleanupScope);
      state='running';status=scope.loopDefinitions.size?`Running ${scope.loopDefinitions.size} live loop(s).`:'Code applied.';notify();
      return getState();
    } catch(error) {
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
