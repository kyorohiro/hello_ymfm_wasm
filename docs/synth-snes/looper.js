// SPDX-License-Identifier: BSD-3-Clause
export const LOOP_MAX_LAYERS=16,LOOP_MAX_SECONDS=120,LOOP_MAX_BYTES=128*1024*1024;
const cancelled=()=>new DOMException('Looper operation cancelled','AbortError');

// Fold the release/Echo tail over the next cycle, while preserving overdub phase.
export function makeLoopBuffer(context,take,period,offset=0) {
  const frames=Math.max(1,Math.round(period*take.sampleRate));
  const buffer=context.createBuffer(2,frames,take.sampleRate),shift=Math.round(offset*take.sampleRate);
  for(let channel=0;channel<2;channel++) {
    const target=buffer.getChannelData(channel),source=channel?take.right:take.left;
    for(let i=0;i<source.length;i++)target[((shift+i)%frames+frames)%frames]+=source[i];
  }
  return buffer;
}

/** Session-only PCM layers. One context, one existing Master, no event recording. */
export function createSnesLooper({ensureAudio,releaseNotes=async()=>{},beforeStart=async()=>{},onChange=()=>{},
  createNode=(context)=>new AudioWorkletNode(context,'tetorica-snes-loop-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]})}={}) {
  let engine=null,node=null,preparing=null,disposed=false,epoch=0,nextId=0,pending=null;
  let running=false,recording=false,busy=false,error='',period=0,loopStart=0,layers=[],sources=new Map();
  const state=()=>({running,recording,busy,error,unitCount:layers.length,loopLength:period,pcmBytes:layers.reduce((n,l)=>n+l.buffer.length*8,0),canUndo:recording||layers.length>0});
  const notify=()=>onChange(state());
  function stopSources(){for(const source of sources.values()){try{source.stop();}catch{}source.disconnect();}sources.clear();}
  function abortCapture(){if(pending){clearTimeout(pending.timer);pending.reject?.(cancelled());pending=null;}node?.port.postMessage({method:'cancel'});recording=false;}
  function detach(){abortCapture();if(node){node.port.onmessage=null;engine?.codeOutputNode.disconnect(node);node.disconnect();node.port.close();node=null;}engine=null;}
  function failure(cause){error=cause?.message??String(cause);stop();detach();notify();}
  function playLayer(layer,start) {
    const source=engine.context.createBufferSource();source.buffer=layer.buffer;source.loop=true;source.connect(engine.songInputNode);
    source.start(start,Math.max(0,start-loopStart)%period);sources.set(layer.id,source);
  }
  async function prepare(owner,token) {
    if(engine===owner&&node)return;
    detach();await owner.context.audioWorklet.addModule(new URL('./looper-processor.js',import.meta.url));
    if(token!==epoch||disposed)throw cancelled();
    engine=owner;node=createNode(owner.context);const endpoint=node;
    endpoint.addEventListener('processorerror',()=>{if(node===endpoint)failure(new Error('Looper capture failed. Start Looper to retry.'));});
    node.port.onmessage=({data})=>{
      if(!pending||pending.id!==data.id)return;
      if(data.ending){recording=false;busy=true;notify();void releaseNotes().catch(failure);return;}
      if(data.started){pending.startFrame=data.startFrame;clearTimeout(pending.timer);pending.timer=setTimeout(()=>failure(new Error('Looper capture timed out. Start Looper to retry.')),(pending.maxSeconds+5)*1000);pending.resolveStart();return;}
      if(data.done){const request=pending;pending=null;clearTimeout(request.timer);void commitTake(data,request).catch(failure);}
    };
    owner.codeOutputNode.connect(node);node.connect(owner.songInputNode); // capture output is always silence
  }
  async function commitTake(data,request) {
    if(request.epoch!==epoch||!running)return;
    recording=false;busy=true;notify();
    try {
      if(!(data.left instanceof Float32Array)||!(data.right instanceof Float32Array)||data.left.length!==data.right.length||!data.left.every(Number.isFinite)||!data.right.every(Number.isFinite))throw new Error('Invalid Looper audio');
      if(data.bodyFrames<engine.context.sampleRate*.05){error='Take too short · record at least 0.05 seconds.';return;}
      const length=period||data.bodyFrames/engine.context.sampleRate;
      if(state().pcmBytes+Math.round(length*engine.context.sampleRate)*8>LOOP_MAX_BYTES)throw new Error('Looper memory limit reached. Undo or Clear a layer.');
      const offset=period?((data.startFrame/engine.context.sampleRate-loopStart)%period+period)%period:0;
      const buffer=makeLoopBuffer(engine.context,{...data,sampleRate:engine.context.sampleRate},length,offset);
      // A silent take is still a valid performed interval, as in a hardware looper.
      const layer={id:request.id,buffer};
      if(!period){period=length;loopStart=engine.context.currentTime+.04;}
      layers.push(layer);playLayer(layer,Math.max(loopStart,engine.context.currentTime+.02));error='';
    } finally {busy=false;notify();}
  }
  async function start() {
    if(disposed)throw new Error('Looper is closed');
    if(running)return preparing;
    const token=++epoch;running=true;busy=true;error='';notify();
    const task=(async()=>{
      try {
        await beforeStart();if(token!==epoch)throw cancelled();
        const owner=await ensureAudio();if(token!==epoch)throw cancelled();
        await prepare(owner,token);if(token!==epoch)throw cancelled();
        loopStart=owner.context.currentTime+.04;for(const layer of layers)playLayer(layer,loopStart);
      }catch(cause){if(token===epoch){stop();if(cause.name!=='AbortError')error=cause.message;}if(cause.name!=='AbortError')throw cause;}
      finally{if(token===epoch){busy=false;notify();}}
    })();preparing=task;try{await task;}finally{if(preparing===task)preparing=null;}
  }
  function stop(){++epoch;running=false;busy=false;abortCapture();stopSources();notify();}
  async function record() {
    if(!running||busy||disposed)return;
    if(recording) {
      recording=false;busy=true;notify();const request=pending;
      try{await releaseNotes();if(pending===request&&request)node.port.postMessage({method:'finish',id:request.id});}
      catch(cause){failure(cause);}return;
    }
    if(layers.length>=LOOP_MAX_LAYERS){error='16 layer limit reached. Undo or Clear a layer.';notify();return;}
    const rate=engine.context.sampleRate,remaining=LOOP_MAX_BYTES-state().pcmBytes;
    const maxSeconds=Math.min(LOOP_MAX_SECONDS,period||LOOP_MAX_SECONDS,remaining/(rate*8)-.25);
    if(maxSeconds<.05){error='Looper memory limit reached. Undo or Clear a layer.';notify();return;}
    error='';busy=true;notify();
    const id=++nextId,token=epoch;
    try {
      await releaseNotes();if(token!==epoch||!running)return;
      await new Promise((resolve,reject)=>{
        pending={id,epoch:token,maxSeconds,resolveStart:resolve,reject,timer:setTimeout(()=>failure(new Error('Looper capture timed out. Start Looper to retry.')),5000)};
        node.port.postMessage({method:'start',id,maxFrames:Math.floor(maxSeconds*rate)});
      });
      if(token!==epoch)return;recording=true;
    }finally{if(token===epoch){busy=false;notify();}}
  }
  function undo(){if(preparing)stop();if(recording||pending||busy){++epoch;abortCapture();busy=false;void releaseNotes().catch(failure);}else{const layer=layers.pop();if(layer){const source=sources.get(layer.id);if(source){source.stop();source.disconnect();sources.delete(layer.id);}}}if(!layers.length)period=0;error='';notify();}
  function clear(){stop();layers=[];period=0;error='';notify();}
  return{start,stop,record,undo,clear,read:state,audioClosed(){stop();detach();},dispose(){if(disposed)return;clear();detach();disposed=true;}};
}
