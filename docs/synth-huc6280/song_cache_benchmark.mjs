// SPDX-License-Identifier: BSD-3-Clause
// Actual WASM into an inert graph. No AudioContext or audio device is created.
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import factory from '../../tetorica_src/runtime/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../../tetorica_src/runtime/huc6280audioengine.js';
import {createHuc6280SongPreview} from './song_preview.js';
import {createSeekFixture} from './song_seek_fixtures.mjs';
import {fakeAudio} from './song_test_helpers.mjs';
const wasmBinary=await readFile(new URL('../../tetorica_src/runtime/generated/huc6280_wasm.wasm',import.meta.url));
const rows=[];
for(const kind of ['wave','lfo','noise','dda']){
  const graph=fakeAudio();let live=0,maxLive=0;
  const preview=createHuc6280SongPreview({getAudio:()=>graph.audio,schedule:graph.schedule,cancel:graph.cancel,
    createEngine:async()=>{
      const engine=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100,masterVolume:1});
      if(!engine.supportsState())throw Error('The benchmark requires the state-capable SDK');
      const dispose=engine.dispose;live++;maxLive=Math.max(maxLive,live);engine.dispose=function(){if(this.handle)live--;return dispose.call(this);};return engine;
    },yieldTask:()=>new Promise(resolve=>setTimeout(resolve,0)),
  });
  const measured=async seconds=>{const start=performance.now();if(!await preview.seek(seconds))throw Error(preview.read().seekMessage);
    const state=preview.read();if(state.positionFrames!==Math.round(seconds*44100))throw Error('Wrong benchmark destination');return{milliseconds:Number((performance.now()-start).toFixed(2)),...state.seekCache};};
  try{
    await preview.load(createSeekFixture(kind,125),kind);await preview.play();preview.pause();
    const cold=await measured(120),warm=await measured(120),nearby=await measured(120.01);
    if(cold.restoredFrame!==0||warm.restoredFrame!==120*44100||warm.reconstructedFrames!==0||nearby.reconstructedFrames>441)throw Error('The benchmark did not exercise the expected checkpoints');
    rows.push({kind,targetSeconds:120,cold,warm,nearby,maxReferenceCores:maxLive});
  }finally{preview.dispose();await preview.whenIdle();if(live)throw Error('Leaked benchmark core');}
}
process.stdout.write(JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,
  method:'Actual WASM, preloaded binary, Node timer yields, retained old paused reference, first cache-collecting seek versus exact/nearby repeat. No device.',rows},null,2)+'\n');
