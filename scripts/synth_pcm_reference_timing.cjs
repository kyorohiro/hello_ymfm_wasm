// Test-only Playwright callback. The native renderer and the consumed-frame
// UI are updated by the same main-thread pump. Read them in one browser task;
// separate Playwright evaluations can observe two different pump generations.
function samplePcmReferenceTiming() {
  const reference=window.__pcmManualReference.current();
  const player=document.getElementById('synthSongPlayer');
  const consumedFrames=Number(player?.dataset.consumedFrames);
  if(!reference||!Number.isSafeInteger(reference.frames)||reference.frames<0||
    !Number.isSafeInteger(consumedFrames)||consumedFrames<0)throw Error('PCM reference timing observation is incomplete');
  return{reference,consumedFrames,playback:player.dataset.state};
}
module.exports={samplePcmReferenceTiming};
