// SPDX-License-Identifier: BSD-3-Clause
// PSF song transport. The disposable player borrows the editor's final bus;
// it never replaces the authored instrument or owns its AudioContext.
import {SPU_SYNTH_MIX_HEADROOM} from './spu_synth_levels.js';

const abortError=()=>new DOMException('PSF playback was cancelled','AbortError');
const isAbort=error=>error?.name==='AbortError';
const nativeSchedule=(callback,delay)=>setTimeout(callback,delay);
const nativeCancel=timer=>clearTimeout(timer);

function selectedSource(set,entry) {
  if(!set||!(set.records instanceof Map)||typeof entry!=='string'||!set.records.has(entry))throw new TypeError('Choose an entry in the opened PSF set');
  const record=set.records.get(entry),title=record.tags?.get?.('title')||entry;
  return {set,entry,title:String(title)};
}

/** createCore receives {set, entry, signal} and returns a disposable PSF1
 * machine with sampleRate:44100 and synchronous render(frames), producing
 * interleaved stereo Float32Array. File selection itself allocates no audio.
 *
 * Already rendered buffers survive Pause. Resume schedules their unconsumed
 * samples before asking the machine for new PCM, retaining the exact machine
 * position without rerunning initialization or dropping lookahead audio.
 */
export function createPsfSongPreview({getAudio,beforePlay=()=>{},onUpdate=()=>{},createCore,
  schedule=nativeSchedule,cancel=nativeCancel,lookaheadSeconds=.2,chunkFrames=2048,
  refillMilliseconds=25,startDelaySeconds=.01}={}) {
  for(const fn of [getAudio,beforePlay,onUpdate,createCore,schedule,cancel])if(typeof fn!=='function')throw new TypeError('PSF preview needs host callbacks');
  if(!Number.isInteger(chunkFrames)||chunkFrames<1||chunkFrames>32768)throw new RangeError('PSF preview chunks must be 1..32768 frames');
  if(!Number.isFinite(lookaheadSeconds)||lookaheadSeconds<=0||lookaheadSeconds>1)throw new RangeError('PSF lookahead must be greater than zero and at most one second');
  if(!Number.isFinite(refillMilliseconds)||refillMilliseconds<1||refillMilliseconds>1000)throw new RangeError('Invalid PSF refill interval');
  if(!Number.isFinite(startDelaySeconds)||startDelaySeconds<0||startDelaySeconds>1)throw new RangeError('Invalid PSF startup delay');
  let source=null,starting=null,run=null,generation=0,disposed=false;
  let message='Open a PSF set and choose an entry to play.',error=false;
  const disposals=new WeakMap(),closing=new Set();
  const current=owner=>!disposed&&owner.generation===generation&&source===owner.source;
  function position(item=run) {
    if(!item)return 0;
    if(item.phase!=='playing')return item.consumed;
    const now=item.context.currentTime;let consumed=item.consumed;
    // Only scheduled PCM can have been consumed. Rendering a slow chunk must
    // not advance the song through samples which have not reached Web Audio.
    for(const segment of item.segments) {
      if(!segment.node)break;
      if(now<segment.at)return Math.max(consumed,segment.first);
      if(now<segment.until)return Math.max(consumed,segment.first+Math.floor((now-segment.at)*item.rate+1e-7));
      consumed=segment.end;
    }
    return consumed;
  }
  function read() {
    const playing=run?.phase==='playing',paused=run?.phase==='paused',resuming=run?.phase==='resuming';
    return {selection:source?{entry:source.entry,title:source.title}:null,name:source?.entry??'',
      playing,paused,resuming,starting:Boolean(starting),busy:Boolean(starting||resuming),
      positionSeconds:run?position()/run.rate:0,message,error,
      canPlay:Boolean(source&&!starting&&!run&&!disposed),canPause:Boolean(playing),canResume:Boolean(paused),
      canStop:Boolean(starting||run)};
  }
  function emit(){if(!disposed)onUpdate(read());}
  function say(text,bad=false){message=text;error=bad;emit();}
  function disposeCore(core) {
    if(!core||typeof core.dispose!=='function')return Promise.resolve();
    if(disposals.has(core))return disposals.get(core);
    let value;try{value=core.dispose();}catch(cause){value=Promise.reject(cause);}
    const done=Promise.resolve(value);disposals.set(core,done);closing.add(done);
    void done.then(()=>closing.delete(done),()=>closing.delete(done));return done;
  }
  function stopNodes(item) {
    for(const segment of item.segments) {
      if(!segment.node)continue;
      segment.node.onended=null;try{segment.node.stop();}catch{}
      try{segment.node.disconnect();}catch{}segment.node=null;
    }
    item.nextTime=null;
  }
  function cancelRefill(item){if(item.timer!==null){cancel(item.timer);item.timer=null;}}
  function retire(item) {
    if(!item)return Promise.resolve();
    cancelRefill(item);stopNodes(item);item.controller.abort();item.phase='stopped';
    item.segments=[];try{item.output.disconnect();}catch{}
    return disposeCore(item.core);
  }
  function stop() {
    generation++;const pending=starting,previous=run;starting=null;run=null;
    pending?.controller.abort();
    const tasks=[...closing];if(pending?.core)tasks.push(disposeCore(pending.core));if(previous)tasks.push(retire(previous));
    say(source?'Stopped. PSF selection and edited instrument kept.':'Stopped. Open a PSF set to play.');
    return Promise.all(tasks).then(()=>undefined);
  }
  function fail(item,cause) {
    if(run!==item||!current(item))return;
    run=null;generation++;void retire(item).catch(()=>{});
    say(`PSF playback failed: ${cause?.message??String(cause)}. Edited instrument and selected entry kept.`,true);
  }
  function trim(item) {
    item.consumed=position(item);
    while(item.segments.length&&item.segments[0].end<=item.consumed) {
      const segment=item.segments.shift();
      if(segment.node){segment.node.onended=null;try{segment.node.disconnect();}catch{}}
    }
  }
  function scheduleSegment(item,segment) {
    const offset=Math.max(0,item.consumed-segment.start),frames=segment.end-segment.start-offset;
    if(frames<=0||segment.node)return;
    const node=item.context.createBufferSource();segment.node=node;node.buffer=segment.buffer;
    node.connect(item.output);
    // This clock is read after generation, not before a potentially expensive
    // first JIT/render. Existing future nodes keep their times; only a newly
    // scheduled chunk can move forward across an underrun gap.
    const at=Math.max(item.nextTime??0,item.context.currentTime+startDelaySeconds);
    segment.first=segment.start+offset;segment.at=at;segment.until=at+frames/item.rate;
    item.nextTime=segment.until;node.start(at,offset/item.rate,frames/item.rate);
  }
  function queue(item) {
    if(run!==item||!current(item)||item.phase!=='playing'||item.timer!==null)return;
    item.timer=schedule(()=>{item.timer=null;refill(item);},refillMilliseconds);item.timer?.unref?.();
  }
  function refill(item) {
    if(run!==item||!current(item)||item.phase!=='playing')return;
    try {
      trim(item);
      const target=item.consumed+Math.ceil(lookaheadSeconds*item.rate);
      while(item.rendered<target) {
        const pcm=item.core.render(chunkFrames);
        if(!(pcm instanceof Float32Array)||pcm.length!==chunkFrames*2||pcm.some(value=>!Number.isFinite(value)))throw new Error('PSF engine returned invalid stereo PCM');
        const buffer=item.context.createBuffer(2,chunkFrames,item.rate),left=buffer.getChannelData(0),right=buffer.getChannelData(1);
        for(let frame=0;frame<chunkFrames;frame++){left[frame]=pcm[frame*2];right[frame]=pcm[frame*2+1];}
        item.segments.push({start:item.rendered,end:item.rendered+chunkFrames,buffer,node:null});item.rendered+=chunkFrames;
      }
      // AudioContext time continues advancing while synchronous emulation is
      // busy. Retire only genuinely played old nodes, retaining every newly
      // rendered, not-yet-scheduled sample for the next source.
      trim(item);
      for(const segment of item.segments)scheduleSegment(item,segment);
      emit();queue(item);
    }catch(cause){fail(item,cause);}
  }
  async function play() {
    if(disposed)throw new Error('PSF preview is disposed');
    if(run?.phase==='paused')return resume();
    if(starting||run)return false;
    if(!source)throw new Error('Choose a PSF entry first');
    const owner={generation:++generation,source,controller:new AbortController(),core:null};starting=owner;
    const check=()=>{if(!current(owner)||starting!==owner)throw abortError();};
    say(`Preparing ${source.title}…`);
    try {
      owner.core=await createCore({set:owner.source.set,entry:owner.source.entry,signal:owner.controller.signal});check();
      if(owner.core?.sampleRate!==44100||typeof owner.core.render!=='function'||typeof owner.core.dispose!=='function')throw new Error('PSF engine must render 44,100 Hz stereo PCM');
      await beforePlay({signal:owner.controller.signal,isCurrent:()=>current(owner)&&starting===owner});check();
      const audio=await getAudio();check();
      const context=audio?.context;
      if(!context||context.state==='closed'||!audio.gain)throw new Error('SPU editor audio is unavailable');
      const output=context.createGain();output.gain.value=1/SPU_SYNTH_MIX_HEADROOM;output.connect(audio.gain);
      const item={...owner,audio,context,output,rate:44100,segments:[],rendered:0,consumed:0,
        nextTime:null,phase:'playing',timer:null};
      run=item;starting=null;say(`Playing ${source.title}.`);refill(item);return run===item;
    }catch(cause) {
      const accepted=current(owner)&&starting===owner;
      if(accepted){starting=null;if(!isAbort(cause))say(`PSF playback failed: ${cause?.message??String(cause)}. Edited instrument and selected entry kept.`,true);}
      await disposeCore(owner.core).catch(()=>{});return false;
    }
  }
  function pause() {
    const item=run;if(!item||item.phase!=='playing')return false;
    trim(item);cancelRefill(item);stopNodes(item);item.phase='paused';
    say(`Paused ${source.title}.`);return true;
  }
  async function resume() {
    const item=run;if(!item||item.phase!=='paused')return false;
    item.phase='resuming';say(`Resuming ${source.title}…`);
    try {
      if(typeof item.audio.resume==='function')await item.audio.resume();
      if(run!==item||!current(item)||item.phase!=='resuming')return false;
      item.phase='playing';
      say(`Playing ${source.title}.`);refill(item);return run===item;
    }catch(cause){fail(item,cause);return false;}
  }
  function setSource(set,entry) {
    if(disposed)throw new Error('PSF preview is disposed');
    // Validate the candidate before retiring any accepted source or playback.
    const next=selectedSource(set,entry);
    if(source?.set===set&&source.entry===entry)return read();
    void stop().catch(()=>{});source=next;say(`PSF ready · ${next.title}. Play to hear the song.`);return read();
  }
  async function dispose() {
    if(disposed)return;
    disposed=true;await stop();source=null;
  }
  return {read,setSource,play,pause,resume,stop,dispose};
}
