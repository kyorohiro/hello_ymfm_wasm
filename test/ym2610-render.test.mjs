import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {Ym2610BAudioEngine} from '../docs/js/ym2610baudioengine.js';
import {createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
const fixture=(chip,name)=>new URL(`./fixtures/${chip}-${name}.vgz`,import.meta.url);
for(const chip of ['ym2610','ym2610b'])test(`${chip} FM/SSG/ADPCM-A/B and mix match the Browser engine`,async()=>{
  const outputs=[];
  for(const name of ['fm','ssg','adpcm-a','adpcm-b','mix']) {
    const source=await readSource(fixture(chip,name));
    const result=await renderSource(source,{maxSeconds:.05});
    assert.deepEqual(result.warnings,[]);
    assert(result.bytes.subarray(44).some(v=>v!==0),name);
    outputs.push(result.bytes);
    const engine=await Ym2610BAudioEngine.create({moduleFactory:await getNodePlaybackFactory('ym2610b'),clock:8000000,variant:chip==='ym2610b'});
    try {
      const player=createPlaybackPlayer(engine,source);player.play();
      assert.deepEqual(result.bytes,(await renderVgmToWav(player,{maxSeconds:.05})).bytes);
    }finally{engine.dispose();}
  }
  for(const output of outputs.slice(0,-1))assert.notDeepEqual(outputs.at(-1),output);
});
test('YM2610B enables extra FM channels while YM2610 does not',async()=>{
  for(const chip of ['ym2610','ym2610b']) for(const name of ['extra-fm','extra-fm4']) {
    const result=await renderSource(await readSource(fixture(chip,name)),{maxSeconds:.05});
    assert.equal(result.bytes.subarray(44).some(v=>v!==0),chip==='ym2610b');
  }
});
test('YM2610 variants reject dual chips, unsupported mixtures and invalid embedded ROM ranges',async()=>{
  for(const chip of ['ym2610','ym2610b']) {
    const original=await readSource(fixture(chip,'adpcm-a'));
    for(const [offset,value] of [[0x4c,(chip==='ym2610b'?0xc0000000:0x40000000)+8000000],[0x0c,3579545],[0x48,8000000]]) {
      const bad=original.slice();new DataView(bad.buffer).setUint32(offset,value,true);
      await assert.rejects(renderSource(bad),e=>e.code==='UNSUPPORTED_CONFIGURATION');
    }
    const bad=original.slice();new DataView(bad.buffer).setUint32(267,256,true);
    await assert.rejects(renderSource(bad),/Invalid YM2610 ROM range/);
  }
});
