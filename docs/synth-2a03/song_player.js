// SPDX-License-Identifier: BSD-3-Clause
import {VgmPlayer} from '../js/vgmplayer.js';
import {prepareNesSongSource} from './song_source.js';
import {createNesSongTimeline} from './song_state.js';
import {createNesSongEngine} from './song_engine.js';

const CHUNK=256, LOOKAHEAD=.05, START_DELAY=.01;
const nativeSchedule=globalThis.setTimeout.bind(globalThis), nativeCancel=globalThis.clearTimeout.bind(globalThis);
const later=() => new Promise(resolve => nativeSchedule(resolve,0));
const aborted=() => new DOMException('NES song operation cancelled','AbortError');

/** Independent one-pass song transport borrowing the Synth's master output.
 * Paused audition uses a separate APU, preserving the song core, parser and
 * exact unconsumed PCM for Resume. Manual playing edits share the song APU. */
export function createNesSongPlayer({getAudio,beforePlay=async()=>{},onState=()=>{},onStatus=()=>{},
  getClickGuard=()=>true,
  createEngine=createNesSongEngine,schedule=nativeSchedule,cancel=nativeCancel,yieldTask=later,
  nowMs=() => performance.now()} = {}) {
  if(typeof getAudio!=='function')throw new TypeError('getAudio is required');
  let source=null,name='',active=null,audition=null,disposed=false,playback='stopped';
  let generation=0,loadGeneration=0,loadController=null,loading=false,pending=Promise.resolve();
  let positionFrames=0,sampleRate=44100,volume=1,errorMessage='',liveEnabled=true;
  let liveState=null,songLiveState=null,seeking=null,preparingAudition=false;
  let clickGuardOverride=null;
  const enabled=Array(6).fill(true);
  const open=() => {if(disposed)throw new Error('NES song player is disposed');};
  const current=ticket => !disposed&&ticket===generation;
  const notify=message => {try{onStatus(message);}catch{}};
  function position(run=active) {
    if(!run)return positionFrames;
    if(playback!=='playing')return run.basePosition;
    let frame=run.basePosition;
    for(const segment of run.segments) {
      if(segment.playAt===null||run.context.currentTime<segment.playAt)break;
      const elapsed=segment.offset+Math.max(0,Math.floor((run.context.currentTime-segment.playAt)*run.sampleRate+1e-7));
      frame=Math.max(frame,segment.firstFrame+Math.min(segment.frames,elapsed));
    }
    return Math.min(run.renderedFrames,frame);
  }
  function publish(force=false) {
    if(!active||seeking)return;
    const frame=position(), next=playback==='paused'&&audition?.edited ? audition.engine.manualSnapshot() : active.timeline.read(frame);
    next.frame=frame;songLiveState=active.timeline.readSong(frame);
    if(force||liveEnabled||!liveState)liveState=next;
  }
  function getState() {
    if(['playing','paused'].includes(playback))publish();
    const frames=position(),busy=loading||playback==='starting'||Boolean(seeking);
    return {playback,state:playback,loaded:Boolean(source),hasSource:Boolean(source),name,errorMessage,loading,busy,
      playing:playback==='playing',running:playback==='playing',isPlaying:playback==='playing',
      paused:playback==='paused',isPaused:playback==='paused',preparingAudition,
      sampleRate,positionFrames:frames,positionSeconds:frames/sampleRate,totalSamples:source?.totalSamples??0,
      durationSeconds:source?source.totalSamples/44100:0,metadata:source?.metadata??null,format:source?.format??'',
      sourceClock:source?.clock??null,sourceChip:'nes',warnings:source?[...source.warnings]:[],
      liveEnabled,liveState,songLiveState,channelEnabled:[...enabled],volume,seeking:Boolean(seeking),
      seekProgress:seeking?.progress??0,seekTargetSeconds:seeking?.targetSeconds??null,
      manualReady:!busy&&(playback==='playing'&&Boolean(active)||playback==='paused'&&Boolean(audition)),
      canPlay:Boolean(source)&&!busy&&playback!=='playing',canPause:playback==='playing',canResume:playback==='paused'&&!busy,
      canStop:busy||Boolean(active)||frames>0,canSeek:Boolean(source)&&!loading&&playback!=='starting'};
  }
  function emit(){try{onState(getState());}catch{}}
  function cancelNodes(run) {
    if(!run)return;
    if(run.timer!==null){cancel(run.timer);run.timer=null;}
    for(const segment of run.segments) {
      const node=segment.node;segment.node=null;segment.playAt=null;
      if(!node)continue;node.onended=null;try{node.stop();}catch{}try{node.disconnect();}catch{}
    }
    run.nextTime=null;
  }
  function release(run) {
    if(!run||run.released)return;
    run.released=true;cancelNodes(run);run.gain?.disconnect();run.timeline?.dispose();run.engine.dispose();run.segments.length=0;
  }
  function releaseAudition(){release(audition);audition=null;preparingAudition=false;}
  function stop() {
    if(disposed)return;
    generation++;seeking?.controller.abort();seeking=null;loadController?.abort();loading=false;
    releaseAudition();release(active);active=null;playback='stopped';positionFrames=0;liveState=songLiveState=null;errorMessage='';emit();
  }
  async function load(bytes,nextName='',{signal}={}) {
    open();const ticket=++loadGeneration;loadController?.abort();const controller=new AbortController();loadController=controller;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();loading=true;emit();
    try {
      const next=await prepareNesSongSource(bytes,{signal:controller.signal,yieldTask});
      if(disposed||ticket!==loadGeneration||controller.signal.aborted)throw aborted();
      stop();source=next;name=String(nextName||'NES song');sampleRate=44100;emit();return getState();
    } finally {
      signal?.removeEventListener('abort',abort);if(ticket===loadGeneration){loadController=null;loading=false;emit();}
    }
  }
  function clear(){open();stop();source=null;name='';emit();}
  function fail(error,run=active) {
    if(run&&active!==run)return;
    positionFrames=position();releaseAudition();release(active);active=null;playback='error';errorMessage=error?.message??String(error);
    notify(`Song playback failed: ${errorMessage}`);emit();
  }
  function applyMix(run){enabled.forEach((value,channel)=>run.engine.setChannelMuted(channel,!value));run.gain.gain.value=volume;}
  function scheduleSegment(run,segment) {
    const offset=Math.max(0,run.basePosition-segment.firstFrame);if(offset>=segment.frames)return;
    const at=Math.max(run.nextTime??0,run.context.currentTime+START_DELAY);
    const node=run.context.createBufferSource();node.buffer=segment.buffer;node.connect(run.gain);
    segment.node=node;segment.offset=offset;segment.playAt=at;
    node.onended=()=>{try{node.disconnect();}catch{}if(segment.node===node)segment.node=null;};
    node.start(at,offset/run.sampleRate);run.nextTime=at+(segment.frames-offset)/run.sampleRate;
  }
  function append(run,left,right,frames) {
    for(let index=0;index<frames;index++)if(!Number.isFinite(left[index])||!Number.isFinite(right[index]))throw new Error('NES renderer produced non-finite PCM');
    const buffer=run.context.createBuffer(2,frames,run.sampleRate);buffer.copyToChannel(left.subarray(0,frames),0);buffer.copyToChannel(right.subarray(0,frames),1);
    const segment={buffer,frames,firstFrame:run.renderedFrames,node:null,offset:0,playAt:null};
    run.renderedFrames+=frames;run.segments.push(segment);scheduleSegment(run,segment);
  }
  function pump(run) {
    if(active!==run||playback!=='playing')return;
    try {
      const consumed=position();positionFrames=consumed;run.basePosition=consumed;run.timeline.read(consumed);
      run.segments=run.segments.filter(segment=>segment.firstFrame+segment.frames>consumed);
      const deadline=nowMs()+8;
      for(let chunks=0;!run.eof&&chunks<12&&nowMs()<deadline;chunks++) {
        if((run.renderedFrames-position())/run.sampleRate>=LOOKAHEAD)break;
        const left=new Float32Array(CHUNK),right=new Float32Array(CHUNK),frames=run.player.process(left,right,CHUNK,{budgetMs:4});
        if(!Number.isInteger(frames)||frames<0||frames>CHUNK)throw new Error('Invalid NES render length');
        if(frames)append(run,left,right,frames);run.eof=!run.player.isPlaying()&&run.player.queuedFrames===0;if(!frames)break;
      }
      if(run.eof&&position()>=run.renderedFrames){positionFrames=run.renderedFrames;publish(true);active=null;playback='ended';release(run);emit();return;}
      if(run.lastEmitTime===null||run.context.currentTime-run.lastEmitTime>=.05){run.lastEmitTime=run.context.currentTime;emit();}
      if(active===run&&playback==='playing')run.timer=schedule(()=>{run.timer=null;pump(run);},8);
    }catch(error){fail(error,run);}
  }
  async function host(ticket,{manualPreparation=false}={}) {
    await beforePlay({manualPreparation});if(!current(ticket))throw aborted();
    const audio=await getAudio();if(!current(ticket))throw aborted();
    const context=audio?.context,output=audio?.songInputNode??audio?.outputNode;
    if(!context||!output||output.context!==context||context.state==='closed')throw new Error('The song requires the Synth AudioContext and master input');
    if(context.state!=='running')await context.resume();if(!current(ticket))throw aborted();return {context,output};
  }
  async function createRun(ticket,selected,output) {
    const engine=await createEngine(selected.header);if(!current(ticket)){engine.dispose();throw aborted();}
    let timeline,gain;
    try {
      timeline=createNesSongTimeline(engine,selected.clock);
      const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.setLoopEnabled(false);
      player.load(selected.bytes,{logger:{warn:message=>{throw new Error(message);}}});player.reset();
      const rate=engine.sampleRate();if(!Number.isInteger(rate)||rate<8000||rate>192000)throw new Error('Invalid NES output rate');
      gain=output.context.createGain();gain.connect(output.output);
      const run={engine,timeline,player,...output,gain,sampleRate:rate,source:selected,basePosition:0,renderedFrames:0,
        segments:[],nextTime:null,timer:null,eof:false,released:false,lastEmitTime:null};applyMix(run);return run;
    }catch(error){gain?.disconnect();timeline?.dispose();engine.dispose();throw error;}
  }
  async function play() {
    open();if(loading||seeking||playback==='starting')return false;if(!source)throw new Error('Choose a VGM or VGZ song first');
    if(playback==='paused')return resume();if(playback==='playing')return true;
    const ticket=++generation;releaseAudition();release(active);active=null;playback='starting';positionFrames=0;liveState=songLiveState=null;errorMessage='';emit();
    try {
      const output=await host(ticket),run=await createRun(ticket,source,output);if(!current(ticket)){release(run);return false;}
      active=run;sampleRate=run.sampleRate;playback='playing';run.player.play();pump(run);return playback==='playing'||playback==='ended';
    }catch(error){if(current(ticket))fail(error);return false;}
  }
  function auditionPump(run) {
    if(audition!==run||playback!=='paused')return;
    try {
      run.engine.setAuditionClickGuard(clickGuardOverride??getClickGuard());
      run.segments=run.segments.filter(segment=>segment.playAt!==null&&segment.playAt+segment.frames/run.sampleRate>run.context.currentTime);
      for(let chunks=0;chunks<12&&(run.nextTime??0)<run.context.currentTime+LOOKAHEAD;chunks++) {
        const pcm=run.engine.processFrames(CHUNK);append(run,pcm.left,pcm.right,CHUNK);
      }
      if(run.lastEmitTime===null||run.context.currentTime-run.lastEmitTime>=.05){run.lastEmitTime=run.context.currentTime;emit();}
      run.timer=schedule(()=>{run.timer=null;auditionPump(run);},8);
    }catch(error){releaseAudition();notify(`Paused audition unavailable: ${error?.message??error}`);emit();}
  }
  async function prepareAudition(ticket,run,snapshot) {
    preparingAudition=true;emit();const engine=await createEngine(run.source.header);
    if(!current(ticket)||active!==run||playback!=='paused'){engine.dispose();return;}
    let next=null;
    try {
      engine.seed(snapshot);engine.setAuditionClickGuard(clickGuardOverride??getClickGuard());const gain=run.context.createGain();gain.connect(run.output);
      next={engine,source:run.source,context:run.context,output:run.output,gain,sampleRate:run.sampleRate,
        basePosition:0,renderedFrames:0,segments:[],nextTime:null,timer:null,released:false,lastEmitTime:null,edited:false};
      engine.onManualWrite=()=>{next.edited=true;};
      applyMix(next);audition=next;preparingAudition=false;auditionPump(next);emit();
    }catch(error){if(next)release(next);else engine.dispose();preparingAudition=false;throw error;}
  }
  async function pause() {
    open();const run=active;if(!run||playback!=='playing')return false;const ticket=++generation;
    run.basePosition=position();positionFrames=run.basePosition;publish(true);const frozen=liveState;cancelNodes(run);
    run.segments=run.segments.filter(segment=>segment.firstFrame+segment.frames>positionFrames);run.player.pause();playback='paused';emit();
    pending=prepareAudition(ticket,run,frozen).catch(error=>{if(current(ticket)){preparingAudition=false;notify(`Paused audition unavailable: ${error?.message??error}`);emit();}});
    await pending;return playback==='paused';
  }
  async function resume() {
    open();const run=active;if(!run||playback!=='paused'||loading||seeking)return false;const ticket=++generation;playback='starting';emit();
    try {
      const output=await host(ticket);if(!current(ticket)||active!==run)return false;
      if(output.context!==run.context||output.output!==run.output)throw new Error('Audio output changed. Stop and Play to restart the song');
      releaseAudition();playback='playing';run.player.resume();run.nextTime=null;for(const segment of run.segments)scheduleSegment(run,segment);pump(run);emit();return playback==='playing'||playback==='ended';
    }catch(error){if(current(ticket))fail(error,run);return false;}
  }
  async function seek(seconds,{manualPreparation=false}={}) {
    open();if(!source||loading||!Number.isFinite(seconds))throw new TypeError('Choose a song and a finite seek time');
    const targetSeconds=Math.max(0,Math.min(source.totalSamples/44100,seconds)),resumePlaying=playback==='playing';
    const previous=active,previousPlayback=playback,previousPosition=position(),ticket=++generation;
    seeking?.controller.abort();const controller=new AbortController();seeking={controller,targetSeconds,progress:0};releaseAudition();
    if(previous){previous.basePosition=previousPosition;cancelNodes(previous);previous.player.pause();}playback='seeking';emit();let next=null;
    try {
      const output=await host(ticket,{manualPreparation});next=await createRun(ticket,source,output);
      const target=Math.min(Math.round(targetSeconds*next.sampleRate),Math.floor(source.totalSamples*next.sampleRate/44100));
      const left=new Float32Array(2048),right=new Float32Array(2048);let frame=0;next.player.play();const deadline=nowMs()+30000;
      while(frame<target) {
        if(!current(ticket)||controller.signal.aborted)throw aborted();if(nowMs()>deadline)throw new Error('NES seek exceeded 30 seconds');
        const frames=next.player.process(left,right,Math.min(2048,target-frame),{budgetMs:4});frame+=frames;next.timeline.read(frame);
        if(!frames&&!next.player.isPlaying())break;seeking.progress=target?frame/target:1;emit();await yieldTask();
      }
      if(!current(ticket)||controller.signal.aborted)throw aborted();next.basePosition=next.renderedFrames=frame;next.eof=!next.player.isPlaying()&&next.player.queuedFrames===0;
      active=next;positionFrames=frame;sampleRate=active.sampleRate;seeking=null;liveState=songLiveState=null;
      if(resumePlaying){playback='playing';pump(active);}else{playback='paused';active.player.pause();publish(true);await prepareAudition(ticket,active,liveState);}
      if(!current(ticket)){release(previous);next=null;return false;}
      release(previous);next=null;emit();return true;
    }catch(error) {
      release(next);if(!current(ticket))return false;seeking=null;active=previous;positionFrames=previousPosition;playback=previous?'paused':'stopped';
      if(previous&&previousPlayback==='playing'){playback='playing';previous.player.resume();for(const segment of previous.segments)scheduleSegment(previous,segment);pump(previous);}
      if(error.name!=='AbortError'){errorMessage=error?.message??String(error);notify(`Seek failed: ${errorMessage}`);}emit();return false;
    }
  }
  function manualEngine() {
    if(seeking||loading)return null;if(playback==='paused')return audition?.engine??null;if(playback==='playing')return active?.engine??null;return null;
  }
  function edit(method,args) {
    open();const engine=manualEngine();if(!engine)throw new Error('Play or pause a song before editing its channels');
    if(audition?.engine===engine)engine.setAuditionClickGuard(clickGuardOverride??getClickGuard());
    const result=engine[method](...args);if(audition?.engine===engine)audition.edited=true;publish(true);emit();return result;
  }
  function setLiveEnabled(value){open();if(typeof value!=='boolean')throw new TypeError('Live enabled must be boolean');liveEnabled=value;if(value)publish(true);emit();return getState();}
  function setChannelEnabled(channel,value){open();if(!Number.isInteger(channel)||channel<0||channel>5)throw new RangeError('NES channel must be 0..5');if(typeof value!=='boolean')throw new TypeError('Channel enabled must be boolean');enabled[channel]=value;active?.engine.setChannelMuted(channel,!value);audition?.engine.setChannelMuted(channel,!value);emit();return getState();}
  function setVolume(value){open();if(!Number.isFinite(value)||value<0||value>3.8)throw new RangeError('Song volume must be 0–3.8');volume=value;if(active)active.gain.gain.value=value;if(audition)audition.gain.gain.value=value;emit();}
  function setClickGuard(value){open();if(typeof value!=='boolean')throw new TypeError('Software click guard must be boolean');clickGuardOverride=value;audition?.engine.setAuditionClickGuard(value);}
  function dispose(){if(disposed)return;stop();disposed=true;source=null;name='';}
  return {load,play,pause,resume,stop,clear,seek,getState,read:getState,getChip:()=>manualEngine()?.getChip()??null,
    applyPreset:(channel,preset)=>edit('applyPreset',[channel,preset]),noteOn:(id,note,channel)=>edit('noteOn',[id,note,channel]),
    noteOff:id=>manualEngine()?edit('noteOff',[id]):false,setPitch:value=>edit('setPitch',[value]),setLiveEnabled,setChannelEnabled,setVolume,setClickGuard,
    whenIdle:()=>pending,dispose};
}
