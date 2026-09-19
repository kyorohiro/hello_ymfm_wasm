import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {MsxAudioEngine} from '../docs/js/msxaudioengine.js';
import {createPlaybackEngine,createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
const names=['ay','opll','audio','scc'];
const fixture=parts=>new URL(`./fixtures/msx-${parts.join('-')}.vgz`,import.meta.url);
test('All 15 MSX chip subsets render, match Browser engines and preserve every chip in the PCM sum',async()=>{
  const solos={};
  for(let mask=1;mask<16;mask++){
    const parts=names.filter((_,i)=>mask&(1<<i)),source=await readSource(fixture(parts));
    const result=await renderSource(source,{maxSeconds:.03});
    assert.deepEqual(result.warnings,[]);assert(result.bytes.subarray(44).some(v=>v!==0),parts.join('+'));
    const reference=await MsxAudioEngine.create({
      ayModuleFactory:parts.includes('ay')?await getNodePlaybackFactory('ay8910'):undefined,
      ayClock:parts.includes('ay')?1789773:0,ayType:0,ayFlags:0,
      ym2413ModuleFactory:parts.includes('opll')?await getNodePlaybackFactory('ym2413'):undefined,ym2413Clock:3579545,
      y8950ModuleFactory:parts.includes('audio')?await getNodePlaybackFactory('y8950'):undefined,y8950Clock:3579545,
      k051649ModuleFactory:parts.includes('scc')?await getNodePlaybackFactory('k051649'):undefined,k051649Clock:parts.includes('scc')?1789773:0,
    });
    const engine=await createPlaybackEngine(new Ym2612VGM(source),{getFactory:getNodePlaybackFactory});
    try {
      const rp=createPlaybackPlayer(reference,source);
      for(let run=0;run<2;run++){rp.reset();rp.play();assert.deepEqual(result.bytes,(await renderVgmToWav(rp,{maxSeconds:.03})).bytes);}
      const p=createPlaybackPlayer(engine,source);p.play();
      const left=new Float32Array(1024),right=new Float32Array(1024);p.process(left,right,1024);
      if(parts.length===1)solos[parts[0]]={left,right};
      else for(const [channel,actual] of Object.entries({left,right})){
        const expected=Float32Array.from(actual,(_,i)=>parts.reduce((sum,name)=>sum+solos[name][channel][i],0));
        assert.deepEqual(actual,expected,parts.join('+')+' '+channel);
      }
    }finally{reference.dispose();engine.dispose();}
  }
});
test('MSX rejects dual/variant flags, foreign chips and second SCC writes',async()=>{
  const source=await readSource(fixture(names));
  for(const offset of [0x74,0x10,0x58,0x9c])for(const flag of [0x40000000,0x80000000]){
    const bad=source.slice(),v=new DataView(bad.buffer);v.setUint32(offset,v.getUint32(offset,true)+flag,true);
    await assert.rejects(renderSource(bad),e=>e.code==='UNSUPPORTED_CONFIGURATION');
  }
  for(const offset of [0x0c,0x2c,0x30]){
    const bad=source.slice();new DataView(bad.buffer).setUint32(offset,3579545,true);
    await assert.rejects(renderSource(bad),e=>e.code==='UNSUPPORTED_CONFIGURATION');
  }
  const bad=await readSource(fixture(['scc']));bad[257]|=0x80;
  await assert.rejects(renderSource(bad),/Second K051649/);
});
