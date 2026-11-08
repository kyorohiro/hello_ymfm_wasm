// SPDX-License-Identifier: BSD-3-Clause
// Main-thread ownership for the Synth's local SID preview and voice capture.
// A selected program is private and stays separate from the authored preset.
import {PSID_MAX_FILE_BYTES} from '../js/sid_psid.js';
import {validatePlayerSid,createPlayerCore} from '../sid-player/models.js';
import {createAudio as createPlayerAudio} from '../sid-player/audio.js';
import {createVoiceCapture} from '../sid-player/voice_capture.js';
import {readPreset} from './preset.js';

const aborted=()=>new DOMException('SID import was cancelled','AbortError');
const isAbort=error=>error?.name==='AbortError';
const clone=value=>value==null?value:structuredClone(value);
const volume=value=>{if(!Number.isFinite(value)||value<0||value>3.8)throw new RangeError('SID preview Master must be 0 to 3.8');return value;};
const filename=file=>typeof file?.name==='string'?file.name.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,1024)||'SID file':'SID file';
const backendFor=parsed=>parsed.selectedModel==='8580'?'8580':parsed.format==='RSID'?'rsid':parsed.timing==='cia'?'psid-cia':'psid-vbi';

/** Execute a bounded, silent disposable C64 candidate. Native init/play cycle
 * limits remain authoritative; yielding lets Stop retire a slow initialization.
 * This proves only the initial window, not whole-song or ROM compatibility.
 */
export async function preflightSidImport(core,signal){
  let state=core.getState(),blocks=0;
  while(state.initPending){
    signal?.throwIfAborted();core.render(2048);state=core.getState();
    if(++blocks>8192)throw new Error('SID initialization exceeded the bounded import preflight');
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  signal?.throwIfAborted();
  const pcm=core.render(12000);
  if(pcm?.some?.(value=>!Number.isFinite(value)))throw new Error('SID preflight produced nonfinite audio');
  signal?.throwIfAborted();
}

/** Direct import reuses the ordinary Player's PAL/single-SID policy and C64
 * backends, with its limited built-in environment and no supplied ROMs.
 * File selection and preflight never allocate audio. Only play() does so.
 * Dependencies are injectable for transactional lifecycle tests.
 */
export function createSidImport({onUpdate=()=>{},onPreviewStart=()=>{},onPreviewStop=()=>{},
  onUsePreset=()=>{},getInstrumentRevision=()=>0,getVolume,
  validate=validatePlayerSid,createCore=createPlayerCore,createAudio=createPlayerAudio,
  preflight=preflightSidImport,createCapture=createVoiceCapture,
  schedule=(callback,delay)=>setTimeout(callback,delay),unschedule=timer=>clearTimeout(timer)}={}){
  let dead=false,selection=null,modelChoice='auto',loading=null,starting=null,audio=null,playing=false,paused=false,transport=null,transportSerial=0;
  let choosingFile=false,applying=false,loadSerial=0,playSerial=0,useSerial=0,captureSerial=0,master=.7;
  let message='Open a SID, play the song, then capture its voices.',error=false,captureControl=null;
  let captureState={busy:false,voice:0,snapshot:null,selected:null,message:'',error:false};
  let liveEnabled=true,liveVoice=0,liveState=null,liveSource=null,liveMessage='Play a SID to follow its live channel settings.',liveError=false;
  let liveSerial=0,liveTimer=null,livePending=null,liveFresh=false;
  const closing=new Set(),disposals=new WeakMap(),reads=new WeakMap();
  const canObserve=()=>!dead&&liveEnabled&&!!audio&&playing&&!transport&&!loading&&!starting&&!choosingFile&&!applying;
  const publicSelection=()=>selection?{
    name:selection.name,title:selection.parsed.metadata?.name||selection.name,
    author:selection.parsed.metadata?.author||'',released:selection.parsed.metadata?.released||'',
    model:selection.parsed.selectedModel,modelSelection:selection.options.modelSelection,
    declaredModel:selection.parsed.model,declaredClock:selection.parsed.clock,
    format:selection.parsed.format,timing:selection.parsed.timing,subtune:selection.parsed.subtune,
    songs:selection.parsed.songs,fileSize:selection.bytes.length,
  }:null;
  function read(){
    const busy=!!loading||!!starting||!!transport||choosingFile||captureState.busy||applying;
    return clone({selection:publicSelection(),modelSelection:modelChoice,busy,loading:!!loading,
      starting:!!starting,playing,paused,pausing:transport?.kind==='pause',resuming:transport?.kind==='resume',choosingFile,applying,capturing:captureState.busy,voice:captureState.voice,
      snapshot:captureState.snapshot,selected:captureState.selected,message,error,
      liveEnabled,liveVoice,liveState,liveSource,liveActive:canObserve()&&liveFresh&&!liveError,
      liveWaiting:canObserve()&&!liveFresh&&!liveError,liveMessage,liveError,
      captureMessage:captureState.message,canPlay:!!selection&&!busy&&!playing&&!paused,
      canPause:!!audio&&playing&&!busy,canResume:!!audio&&paused&&!busy,
      canCapture:!!audio&&(playing||paused)&&!busy,canUse:!!captureState.selected?.preset&&!busy,
      canStop:!!loading||!!starting||playing||paused||!!transport||choosingFile||captureState.busy||applying});
  }
  const emit=()=>{if(!dead)onUpdate(read());};
  const say=(text,bad=false)=>{message=text;error=bad;emit();};
  const currentVolume=()=>volume(getVolume?getVolume():master);
  const cancelUse=()=>{useSerial++;applying=false;};
  // Capture and display reads share one queue for each actual Worklet. A slow
  // observation cannot build an interval backlog or overlap an explicit read.
  function readApplied(engine,isCurrent){
    const previous=reads.get(engine)??Promise.resolve();
    const result=previous.catch(()=>{}).then(()=>{if(!isCurrent())throw aborted();return engine.read();});
    reads.set(engine,result);
    void result.then(()=>{if(reads.get(engine)===result)reads.delete(engine);},()=>{if(reads.get(engine)===result)reads.delete(engine);});
    return result;
  }
  function invalidateLive(text='Live view paused. Last observed state kept.'){
    liveSerial++;liveFresh=false;if(liveTimer!==null){unschedule(liveTimer);liveTimer=null;}
    liveMessage=text;liveError=false;
  }
  function scheduleLive(){
    if(!canObserve()||liveError||liveTimer!==null||livePending)return;
    liveTimer=schedule(()=>{
      liveTimer=null;if(!canObserve()||liveError)return;
      const engine=audio,tune=selection,serial=liveSerial,play=playSerial;
      const current=()=>canObserve()&&liveSerial===serial&&audio===engine&&selection===tune&&playSerial===play;
      const task=(async()=>{
        try{
          const state=await readApplied(engine,current);if(!current())return;
          liveState=clone(state);liveSource={name:tune.parsed.metadata?.name||tune.name,subtune:tune.parsed.subtune,model:tune.parsed.selectedModel};
          liveFresh=true;liveMessage='Following the selected channel · sampled at up to 20 updates per second.';liveError=false;emit();
        }catch(cause){
          if(!current()||isAbort(cause))return;
          liveFresh=false;liveMessage=`Live view paused: ${cause.message}. Last observed state kept; song playback is unchanged.`;liveError=true;emit();
        }
      })();
      livePending=task;
      void task.finally(()=>{if(livePending===task)livePending=null;scheduleLive();});
    },50);
    // Browser timers are numeric; a Node timer should not keep a test alive.
    liveTimer?.unref?.();
  }
  function setLiveEnabled(value){
    if(typeof value!=='boolean')throw new TypeError('SID live display mode must be a boolean');
    if(dead)return;
    const frozen=paused&&!!audio&&!!liveState;
    liveEnabled=value;invalidateLive(value?(frozen?'Paused channel state kept.':'Waiting for the next live channel observation…'):'Live view frozen. Last observed state kept.');
    if(frozen)liveFresh=true;
    emit();scheduleLive();
  }
  function setLiveVoice(value){
    if(!Number.isInteger(value)||value<0||value>2)throw new RangeError('SID live channel must be 0, 1 or 2');
    if(dead)return;liveVoice=value;emit();
  }
  function invalidateCapture(){captureSerial++;captureControl?.invalidate();}
  function cancelLoading(){loadSerial++;const previous=loading;loading=null;previous?.controller.abort();}
  function closeEngine(engine){
    if(!engine)return Promise.resolve();
    if(disposals.has(engine))return disposals.get(engine);
    let result;
    try{result=engine.dispose();}catch(cause){result=Promise.reject(cause);}
    const done=Promise.resolve(result).finally(()=>onPreviewStop(engine));
    disposals.set(engine,done);closing.add(done);
    void done.then(()=>closing.delete(done),()=>closing.delete(done));
    return done;
  }
  function retirePreview(){
    playSerial++;transportSerial++;transport=null;invalidateCapture();invalidateLive();playing=false;paused=false;
    const pending=starting,previous=audio;starting=null;audio=null;pending?.controller.abort();
    const tasks=[...closing];
    if(previous)tasks.push(closeEngine(previous));
    if(pending?.engine&&pending.engine!==previous)tasks.push(closeEngine(pending.engine));
    return Promise.all(tasks).then(()=>undefined);
  }
  function stop({cancelLoad=true}={}){
    const active=!!starting||!!audio||playing||captureState.busy||applying||cancelLoad&&(!!loading||choosingFile);
    if(cancelLoad){cancelLoading();choosingFile=false;}cancelUse();
    const serial=++useSerial,done=retirePreview();
    if(active)say(selection?'Stopped. Selected SID and captured voices kept.':'Stopped. Open a SID to preview it.');
    return done.catch(cause=>{if(!dead&&useSerial===serial)say(`Preview could not close: ${cause.message}. Current instrument kept.`,true);});
  }
  function beginFileSelection(){
    if(dead)return null;cancelLoading();cancelUse();invalidateCapture();invalidateLive();choosingFile=true;
    say('Choose a SID file. Current instrument and accepted preview kept.');return loadSerial;
  }
  function cancelFileSelection(token){
    if(dead||token!==undefined&&token!==loadSerial)return false;
    cancelLoading();choosingFile=false;say('SID selection cancelled. Current instrument, file and captured voices kept.');scheduleLive();return true;
  }
  async function loadSource(getBytes,name,options){
    cancelLoading();cancelUse();choosingFile=false;invalidateCapture();invalidateLive();
    // An already playing accepted preview remains audible until commit. A
    // startup is retired so a speculative candidate cannot acquire its sound.
    if(starting){const done=retirePreview();void done.catch(()=>{});}
    const owner={serial:loadSerial,controller:new AbortController()};loading=owner;
    const current=()=>!dead&&loading===owner&&loadSerial===owner.serial;
    say(`Checking ${name} in the C64 player…`);let candidate;
    try{
      const bytes=await getBytes(owner.controller.signal);owner.controller.signal.throwIfAborted();
      const requested={...options};delete requested.model;delete requested.clock;
      const parsed=validate(bytes,{...requested,assumeUnknown:true,vbiBackend:'c64',environment:'minimal'});
      const loadOptions={...requested,...parsed.playerOptions,subtune:parsed.subtune,environment:'minimal',vbiBackend:'c64'};
      candidate=await createCore({model:parsed.selectedModel,backend:backendFor(parsed),sampleRate:48000,signal:owner.controller.signal});
      owner.controller.signal.throwIfAborted();candidate.load(parsed.originalBytes,loadOptions);
      await preflight(candidate,owner.controller.signal);owner.controller.signal.throwIfAborted();
      if(!current())return false;
      const done=retirePreview();
      selection={bytes:Uint8Array.from(parsed.originalBytes),parsed,name,options:loadOptions};modelChoice=loadOptions.modelSelection;
      loading=null;say(`SID ready · ${parsed.selectedModel} · subtune ${parsed.subtune} / ${parsed.songs}. Play, then capture voices.`);
      void done.catch(cause=>{if(!dead&&selection?.parsed===parsed)say(`SID loaded; previous preview close failed: ${cause.message}`,true);});
      return true;
    }catch(cause){
      if(current()&&!isAbort(cause))say(`SID load failed: ${cause.message}. Current instrument, accepted file and snapshot kept. Use SID Player for ROM or other playback options.`,true);
      return false;
    }finally{try{candidate?.dispose();}finally{if(loading===owner){loading=null;emit();scheduleLive();}}}
  }
  function loadFile(file,{selectionToken}={}){
    if(dead||selectionToken!==undefined&&selectionToken!==loadSerial)return Promise.resolve(false);
    if(!file){cancelFileSelection(selectionToken);return Promise.resolve(false);}
    return loadSource(async signal=>{
      if(typeof file.arrayBuffer!=='function'||!Number.isSafeInteger(file.size)||file.size<1)throw new TypeError('Choose a nonempty SID file');
      if(file.size>PSID_MAX_FILE_BYTES)throw new RangeError(`SID file exceeds ${PSID_MAX_FILE_BYTES.toLocaleString('en-US')} bytes`);
      const buffer=await file.arrayBuffer();signal.throwIfAborted();
      if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==file.size)throw new Error('SID file size changed while reading');
      return new Uint8Array(buffer).slice();
    },filename(file),{modelSelection:modelChoice});
  }
  function setSubtune(value){
    if(!Number.isInteger(value)||value<1||value>65535)throw new RangeError('SID subtune must be a positive integer');
    if(dead)return Promise.resolve(false);
    if(!selection){say('Open a SID before choosing a subtune.',true);return Promise.resolve(false);}
    if(value>selection.parsed.songs)throw new RangeError('SID subtune is outside this file');
    if(value===selection.parsed.subtune&&!loading)return Promise.resolve(true);
    const accepted=selection;
    return loadSource(()=>accepted.bytes.slice(),accepted.name,{...accepted.options,subtune:value});
  }
  function setModel(value){
    if(!['auto','6581','8580'].includes(value))throw new RangeError('SID model selection must be auto, 6581 or 8580');
    if(dead)return Promise.resolve(false);
    if(!selection){cancelLoading();modelChoice=value;say('Model selected. Open a SID to preview it.');return Promise.resolve(true);}
    if(value===modelChoice&&!loading)return Promise.resolve(true);
    const accepted=selection;
    return loadSource(()=>accepted.bytes.slice(),accepted.name,{...accepted.options,modelSelection:value});
  }
  function audioFailed(cause,owner){
    if(dead||starting!==owner&&(!owner.engine||audio!==owner.engine))return;
    const done=retirePreview();void done.catch(()=>{});
    say(`SID preview stopped: ${cause.message}. Selected file and current instrument kept.`,true);
  }
  function play(){
    if(dead||!selection||loading||starting||playing||paused||transport||choosingFile||applying||captureState.busy)return Promise.resolve(false);
    cancelUse();const tune=selection,owner={serial:++playSerial,controller:new AbortController(),engine:null};starting=owner;
    const current=()=>!dead&&starting===owner&&playSerial===owner.serial&&selection===tune;
    const previousClosing=Promise.all([...closing]);void previousClosing.catch(()=>{});
    say('Preparing SID song preview…');let prepared;
    try{
      // Invoke the gesture-resuming factory before the first await.
      prepared=createAudio({volume:currentVolume(),backend:backendFor(tune.parsed),signal:owner.controller.signal,onError:cause=>audioFailed(cause,owner)});
    }catch(cause){prepared=Promise.reject(cause);}
    return (async()=>{
      try{
        const engine=await prepared;owner.engine=engine;
        if(!current())throw aborted();
        // Preserve activation by preparing above, but never start a replacement
        // while a previous preview still owns an unfinished close operation.
        await previousClosing;if(!current())throw aborted();
        await onPreviewStart(engine,{isCurrent:current,signal:owner.controller.signal});
        if(!current())throw aborted();
        await engine.command('load',[tune.bytes.slice(),{...tune.options}]);
        if(!current())throw aborted();engine.setVolume(currentVolume());
        await engine.command('start');if(!current())throw aborted();
        audio=engine;starting=null;playing=true;paused=false;
        invalidateLive('Waiting for the first live channel observation…');
        say(`Playing ${tune.parsed.selectedModel} · subtune ${tune.parsed.subtune} / ${tune.parsed.songs}. Capture voices when you hear the sound you want.`);
        scheduleLive();
        return true;
      }catch(cause){
        if(owner.engine)void closeEngine(owner.engine).catch(()=>{});
        if(current()){starting=null;playing=false;if(!isAbort(cause))say(`SID preview failed: ${cause.message}. Selected file and current instrument kept.`,true);else emit();}
        return false;
      }
    })();
  }
  // Transport commands own the accepted engine without replacing or reloading
  // it. Their ACK is the fixed observation boundary, not a preceding UI poll.
  function changeTransport(kind){
    if(dead||!audio||loading||starting||transport||choosingFile||applying||captureState.busy||
      (kind==='pause'?!playing:!paused))return Promise.resolve(false);
    invalidateCapture();invalidateLive(kind==='pause'?'Waiting for the paused channel state…':'Waiting for playback to resume…');
    const owner={kind,engine:audio,tune:selection,play:playSerial,serial:++transportSerial};transport=owner;
    const current=()=>!dead&&transport===owner&&audio===owner.engine&&selection===owner.tune&&playSerial===owner.play&&transportSerial===owner.serial;
    say(kind==='pause'?'Pausing the SID preview…':'Resuming the SID preview…');
    let prepared;
    try{
      // Context activation must occur in Resume's original user gesture.
      prepared=kind==='resume'?owner.engine.resume():owner.engine.command('pause');
    }catch(cause){prepared=Promise.reject(cause);}
    return (async()=>{
      try{
        let state=await prepared;if(!current())return false;
        if(kind==='resume'){
          owner.engine.setVolume(currentVolume());
          state=await owner.engine.command('resume');if(!current())return false;
        }
        transport=null;paused=kind==='pause';playing=!paused;
        if(paused){
          liveState=clone(state);liveSource={name:owner.tune.parsed.metadata?.name||owner.tune.name,subtune:owner.tune.parsed.subtune,model:owner.tune.parsed.selectedModel};
          liveFresh=true;liveError=false;liveMessage='Paused · the channel state is fixed. Inspect another CH or capture it before resuming.';
        }else invalidateLive('Waiting for the next resumed channel observation…');
        // A file dialog/candidate may coexist with an already dispatched
        // transport. Complete its actual state without overwriting load status.
        if(loading||choosingFile)emit();
        else say(paused?'Paused. Inspect a CH, Capture voices, or Resume from this position.':'Playing from the paused position. Capture voices when you hear the sound you want.');
        scheduleLive();return true;
      }catch(cause){
        if(!current())return false;
        const done=retirePreview();void done.catch(()=>{});
        say(`SID ${kind} failed: ${cause.message}. Preview closed; selected file, snapshot and current instrument kept.`,true);
        return false;
      }
    })();
  }
  const pause=()=>changeTransport('pause'),resume=()=>changeTransport('resume');
  captureControl=createCapture({
    getSource:()=>{
      if(dead||!audio||!(playing||paused)||transport||loading||starting||choosingFile||applying)return null;
      const ownerEngine=audio,tune=selection,serial=playSerial,transportAtRead=transportSerial;
      const current=()=>!dead&&audio===ownerEngine&&selection===tune&&(playing||paused)&&!transport&&playSerial===serial&&transportSerial===transportAtRead&&!loading&&!starting&&!choosingFile;
      return {engine:{read:()=>readApplied(ownerEngine,current)},ownerEngine,tune,serial,transportAtRead,name:tune.parsed.metadata?.name||tune.name,subtune:tune.parsed.subtune};
    },
    isCurrent:source=>!dead&&audio===source.ownerEngine&&selection===source.tune&&(playing||paused)&&!transport&&playSerial===source.serial&&transportSerial===source.transportAtRead&&!loading&&!starting&&!choosingFile,
    onUpdate:state=>{captureState=state;emit();},
  });
  async function capture(){
    if(dead||loading||starting||transport||choosingFile||applying||captureState.busy)return false;
    const request=++captureSerial;
    message='Reading the current SID voice settings…';error=false;
    const ok=await captureControl.capture();if(dead||captureSerial!==request)return false;
    if(ok)captureControl.notify('Snapshot captured. Select a voice to load it immediately.');
    if(!captureState.busy)say(captureState.message,captureState.error);
    return ok;
  }
  function selectVoice(value){if(dead)return Promise.resolve(false);cancelUse();captureControl.selectVoice(value);return useVoice();}
  async function useVoice(){
    if(dead||loading||starting||transport||choosingFile||applying||captureState.busy)return false;
    const row=captureState.selected;
    if(!row?.preset){say(row?.reason||'Capture a supported voice before using it.',true);return false;}
    const next=readPreset(row.preset),request=++useSerial,instrument=getInstrumentRevision();applying=true;
    const done=retirePreview();say('Stopping the song preview and loading this voice…');
    try{
      await done;
      if(dead||useSerial!==request)return false;
      if(getInstrumentRevision()!==instrument){say('Voice load cancelled because the instrument changed. Current preset kept.');return false;}
      await onUsePreset(clone(next));
      if(dead||useSerial!==request)return false;
      say('SID voice loaded. Play the keyboard to audition, edit or save it.');return true;
    }catch(cause){if(!dead&&useSerial===request)say(`Voice could not load: ${cause.message}. Current preset kept.`,true);return false;}
    finally{if(!dead&&useSerial===request){applying=false;emit();}}
  }
  function setVolume(value){master=volume(value);audio?.setVolume(master);if(starting?.engine&&starting.engine!==audio)starting.engine.setVolume(master);}
  function dispose(){
    if(dead)return Promise.all([...closing]).then(()=>undefined);
    dead=true;cancelLoading();cancelUse();choosingFile=false;captureControl.dispose();return retirePreview();
  }
  const control={read,loadFile,setSubtune,setModel,play,pause,resume,stop,capture,selectVoice,useVoice,setLiveEnabled,setLiveVoice,setVolume,beginFileSelection,cancelFileSelection,dispose};
  emit();return control;
}
