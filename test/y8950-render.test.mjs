import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {Y8950AudioEngine} from '../docs/js/y8950audioengine.js';
import {createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
const fixture=name=>new URL(`./fixtures/y8950-${name}.vgz`,import.meta.url);
test('Y8950 FM, embedded ADPCM and optional PSG match the Browser engine',async()=>{
  const results=[];
  for(const name of ['fm','adpcm','mix','psg']) {
    const source=await readSource(fixture(name));
    const result=await renderSource(source,{maxSeconds:.05});results.push(result.bytes);
    assert.deepEqual(result.warnings,[]);assert(result.bytes.subarray(44).some(v=>v!==0),name);
    const engine=await Y8950AudioEngine.create({y8950ModuleFactory:await getNodePlaybackFactory('y8950'),y8950Clock:3579545,segaPsgModuleFactory:await getNodePlaybackFactory('segapsg'),psgClock:name==='psg'?3579545:0});
    try {
      const player=createPlaybackPlayer(engine,source);player.play();
      assert.deepEqual(result.bytes,(await renderVgmToWav(player,{maxSeconds:.05})).bytes);
      player.reset();player.play();
      assert.deepEqual(result.bytes,(await renderVgmToWav(player,{maxSeconds:.05})).bytes,'reset reloads sample memory');
    }finally{engine.dispose();}
  }
  assert.notDeepEqual(results[2],results[0]);assert.notDeepEqual(results[2],results[1]);assert.notDeepEqual(results[3],results[2]);
});
test('Y8950 rejects unsupported flags, chip mixtures and out-of-range sample blocks',async()=>{
  const original=await readSource(fixture('adpcm'));
  for(const [offset,value] of [[0x58,0x40000000+3579545],[0x58,0x80000000+3579545],[0x2c,7670454]]) {
    const bad=original.slice();new DataView(bad.buffer).setUint32(offset,value,true);
    await assert.rejects(renderSource(bad),e=>e.code==='UNSUPPORTED_CONFIGURATION');
  }
  const bad=original.slice();new DataView(bad.buffer).setUint32(267,256,true);
  await assert.rejects(renderSource(bad),/range/i);
});
