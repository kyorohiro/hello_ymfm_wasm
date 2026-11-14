import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import timing from './synth_pcm_reference_timing.cjs';
const {samplePcmReferenceTiming}=timing;

function fixture(){
  const clock={native:1000,consumed:900},player={dataset:{state:'playing'}};
  Object.defineProperty(player.dataset,'consumedFrames',{get:()=>String(clock.consumed)});
  const world={window:{__pcmManualReference:{current:()=>({id:7,frames:clock.native})}},document:{getElementById:id=>id==='synthSongPlayer'?player:null}};
  let tasks=0;
  const evaluate=async callback=>{
    const value=vm.runInNewContext(`(${callback.toString()})()`,world);
    // Any delay between Playwright RPCs can let the pump and audible cursor
    // advance arbitrarily, even though each generation has only 100 ahead.
    tasks++;clock.native+=7000;clock.consumed+=7000;
    return structuredClone(value);
  };
  return{clock,world,evaluate,get tasks(){return tasks;}};
}

test('separate RPCs reproduce a false negative ahead time while a single task keeps the real bound',async()=>{
  const torn=fixture();
  const oldReference=await torn.evaluate(()=>window.__pcmManualReference.current());
  const laterConsumed=await torn.evaluate(()=>Number(document.getElementById('synthSongPlayer').dataset.consumedFrames));
  assert(oldReference.frames-laterConsumed<0,'the previous two-RPC measurement is demonstrably torn');

  const f=fixture(),sample=await f.evaluate(samplePcmReferenceTiming);
  assert.equal(f.tasks,1);assert.equal(sample.reference.id,7);
  assert.equal(sample.reference.frames,1000);assert.equal(sample.consumedFrames,900);
  assert.equal(sample.playback,'playing');
  const aheadSeconds=(sample.reference.frames-sample.consumedFrames)/1000;
  assert(aheadSeconds>=0&&aheadSeconds<.11,'the original 0..0.11s assertion is meaningful for a coherent observation');
  const next=await f.evaluate(samplePcmReferenceTiming);
  assert.equal(next.reference.frames,8000);assert.equal(next.consumedFrames,7900);
  assert.equal(next.reference.frames-next.consumedFrames,100,'the callback observes each new generation without freezing playback');
});

test('missing or malformed observations fail rather than accepting an invalid timing result',()=>{
  for(const [native,consumed]of[[NaN,900],[1000,NaN],[-1,0],[1000,-1]]){
    const f=fixture();f.clock.native=native;f.clock.consumed=consumed;
    assert.throws(()=>vm.runInNewContext(`(${samplePcmReferenceTiming.toString()})()`,f.world),/incomplete/);
  }
  const f=fixture();f.world.window.__pcmManualReference.current=()=>null;
  assert.throws(()=>vm.runInNewContext(`(${samplePcmReferenceTiming.toString()})()`,f.world),/incomplete/);
});
