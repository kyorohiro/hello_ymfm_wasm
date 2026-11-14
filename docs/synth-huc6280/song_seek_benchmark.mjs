// Native rebuild benchmark. Node PCM into an inert graph; no audio device.
// Run: node docs/synth-huc6280/song_seek_benchmark.mjs
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {createHuc6280SongPreview} from './song_preview.js';
import {fakeAudio} from './song_test_helpers.mjs';
import {createSeekFixture} from './song_seek_fixtures.mjs';
const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
const rows=[];
for(const kind of['wave','lfo','noise','dda'])for(const targetSeconds of[5,30,120]){
  const graph=fakeAudio();let yields=0,liveCores=0,maxLiveCores=0,nativeHeapBytes=0,capacityFrames=0,progressEvents=0;
  const engines=[];
  const preview=createHuc6280SongPreview({getAudio:()=>graph.audio,schedule:graph.schedule,cancel:graph.cancel,
    createEngine:async()=>{
      const engine=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:3579545,outputSampleRate:44100,masterVolume:1});
      const dispose=engine.dispose;liveCores++;maxLiveCores=Math.max(maxLiveCores,liveCores);engines.push(engine);
      engine.dispose=function(){if(this.handle)liveCores--;return dispose.call(this);};return engine;
    },
    yieldTask:async()=>{yields++;await new Promise(resolve=>setTimeout(resolve,0));},
    onState:state=>{if(state.seeking)progressEvents++;for(const engine of engines){nativeHeapBytes=Math.max(nativeHeapBytes,engine.module.HEAPU8.byteLength);capacityFrames=Math.max(capacityFrames,engine.capacity);}},
  });
  try{
    await preview.load(createSeekFixture(kind,targetSeconds+1),kind);await preview.play();preview.pause();
    const started=performance.now(),ok=await preview.seek(targetSeconds),milliseconds=performance.now()-started;
    if(!ok||preview.read().positionFrames!==targetSeconds*44100)throw Error(`${kind} ${targetSeconds}s seek failed: ${preview.read().seekMessage}`);
    rows.push({kind,targetSeconds,milliseconds:Math.round(milliseconds),audioSecondsPerWallSecond:Number((targetSeconds*1000/milliseconds).toFixed(1)),
      yields,progressEvents,maxLiveCores,nativeHeapBytes,largestNativeRenderFrames:capacityFrames});
  }finally{preview.dispose();await preview.whenIdle();}
}
process.stdout.write(JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,
  method:'Actual WASM isolated rebuild, retained old paused run; preloaded WASM binary, Node timer yields, no native state/cache, no audio device',rows},null,2)+'\n');
