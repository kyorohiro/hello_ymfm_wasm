import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {Ymf278bAudioEngine} from '../docs/js/ymf278baudioengine.js';
import {createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
const fixture=name=>new URL(`./fixtures/ymf278b-${name}.vgz`,import.meta.url);
function testRom(){const rom=new Uint8Array(2097152);rom.set([0,1,0,0,0,255,0,0,0xf0,0,0x0f,0]);for(let i=256;i<512;i++)rom[i]=Math.round(Math.sin(i*Math.PI/16)*100)&255;return rom;}
test('YMF278B FM/PCM, embedded/external wave data and PSG match Browser engine',async()=>{
  const outputs={};
  for(const name of ['fm','external','embedded','mix','psg']) {
    const source=await readSource(fixture(name)),roms=name==='external'?{ymf278bWave:testRom()}:{};
    const result=await renderSource(source,{maxSeconds:.05,roms});outputs[name]=result.bytes;
    assert.deepEqual(result.warnings,[]);assert(result.bytes.subarray(44).some(v=>v!==0),name);
    const e=await Ymf278bAudioEngine.create({ymf278bModuleFactory:await getNodePlaybackFactory('ymf278b'),ymf278bClock:33868800,segaPsgModuleFactory:await getNodePlaybackFactory('segapsg'),psgClock:name==='psg'?3579545:0});
    try {
      if(roms.ymf278bWave)e.loadWaveRom(roms.ymf278bWave);
      const p=createPlaybackPlayer(e,source);
      for(let run=0;run<2;run++){p.reset();p.play();assert.deepEqual(result.bytes,(await renderVgmToWav(p,{maxSeconds:.05})).bytes);}
    }finally{e.dispose();}
  }
  assert.deepEqual(outputs.external,outputs.embedded);
  assert.notDeepEqual(outputs.mix,outputs.fm);assert.notDeepEqual(outputs.mix,outputs.embedded);assert.notDeepEqual(outputs.psg,outputs.mix);
});
test('YMF278B diagnoses missing/bad ROM and rejects unsupported configurations',async()=>{
  const source=await readSource(fixture('external'));
  await assert.rejects(renderSource(source),e=>e.code==='MISSING_RESOURCE'&&e.details.resource==='ymf278bWave');
  for(const bad of [new Uint8Array(),new Uint8Array(2097151),new Uint8Array(2097153),new ArrayBuffer(2097152)])await assert.rejects(renderSource(source,{roms:{ymf278bWave:bad}}),/2097152/);
  for(const [offset,value] of [[0x60,0x40000000+33868800],[0x60,0x80000000+33868800],[0x2c,7670454]]) {
    const bad=source.slice();new DataView(bad.buffer).setUint32(offset,value,true);
    await assert.rejects(renderSource(bad),e=>e.code==='UNSUPPORTED_CONFIGURATION');
  }
  const bad=await readSource(fixture('embedded'));new DataView(bad.buffer).setUint32(267,512,true);
  await assert.rejects(renderSource(bad),/range/i);
});
