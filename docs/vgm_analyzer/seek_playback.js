// Replay silently to preserve envelopes, PCM memory and stream state.
// Does not serialize undocumented chip internals; long seeks yield to the UI.
export async function seekPlayback(player, sample, {signal,onProgress=()=>{},yieldTask=()=>new Promise(r=>setTimeout(r,0))}={}) {
  if(!Number.isFinite(sample)||sample<0)throw new RangeError('Invalid seek position');
  const loop=player.loopEnabled, prefetch=player.prefetchFactor;
  player.reset();player.setLoopEnabled(false);player.setPrefetchFactor(1);player.play();
  const target=Math.floor(sample*player.sampleRate()/44100);
  const left=new Float32Array(4096),right=new Float32Array(4096);
  let consumed=0,lastYield=performance.now();
  try{
    while(consumed<target){
      if(signal?.aborted)throw new DOMException('Seek cancelled','AbortError');
      const count=Math.min(left.length,target-consumed);
      const before=player.processedWaitSamples,queued=player.queuedFrames,remainder=player.waitAccumulator;
      player.process(left,right,count);
      // process may exhaust its event budget before filling this block.
      const produced=Math.floor(((player.processedWaitSamples-before)*player.sampleRate()+remainder)/44100);
      const available=queued+produced-player.queuedFrames;
      consumed+=Math.max(0,Math.min(count,available));
      if(!player.playing && !player.queuedFrames)break;
      if(performance.now()-lastYield>12){
        onProgress(consumed/Math.max(1,target));await yieldTask();lastYield=performance.now();
      }
    }
    player.pause();onProgress(1);
    return consumed*44100/player.sampleRate();
  }finally{player.pause();player.setLoopEnabled(loop);player.setPrefetchFactor(prefetch);}
}
