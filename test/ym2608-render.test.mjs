import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {Ym2608AudioEngine} from '../docs/js/ym2608audioengine.js';
import {createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
const fixture=name=>new URL(`./fixtures/ym2608-${name}.vgz`,import.meta.url);
// Authored test pattern; not a copy of the hardware rhythm ROM.
const rom=Uint8Array.from({length:8192},(_,i)=>i%2?0x99:0x11);
test('YM2608 FM, SSG, embedded ADPCM-B and external rhythm render through shared engine',async()=>{
  for(const name of ['fm','ssg','adpcm','rhythm']) {
    const source=await readSource(fixture(name));
    const roms=name==='rhythm'?{ym2608AdpcmA:rom}:{};
    const result=await renderSource(source,{maxSeconds:.1,roms});
    assert.deepEqual(result.warnings,[]);
    assert(result.bytes.subarray(44).some(v=>v!==0),name);
    const engine=await Ym2608AudioEngine.create({ym2608ModuleFactory:await getNodePlaybackFactory('ym2608'),ym2608Clock:8000000});
    try {
      if(name==='rhythm')engine.loadAdpcmARom(rom);
      const player=createPlaybackPlayer(engine,source);player.play();
      assert.deepEqual(result.bytes,(await renderVgmToWav(player,{maxSeconds:.1})).bytes);
    }finally{engine.dispose();}
  }
});
test('YM2608 requires rhythm ROM only for key-on and rejects invalid ROM inputs',async()=>{
  const source=await readSource(fixture('rhythm'));
  await assert.rejects(renderSource(source),e=>e.code==='MISSING_RESOURCE'&&e.details.resource==='ym2608AdpcmA');
  for(const invalid of [new Uint8Array(),new Uint8Array(8191),new Uint8Array(8193),new ArrayBuffer(8192)])
    await assert.rejects(renderSource(source,{roms:{ym2608AdpcmA:invalid}}),/8192 bytes/);
  const keyOff=source.slice();keyOff[264]=0x81;
  await renderSource(keyOff,{maxSeconds:.01});
  for(const [offset,value] of [[0x48,0x40000000+8000000],[0x0c,3579545],[0x44,4000000]]) {
    const bad=source.slice();new DataView(bad.buffer).setUint32(offset,value,true);
    await assert.rejects(renderSource(bad,{roms:{ym2608AdpcmA:rom}}),e=>e.code==='UNSUPPORTED_CONFIGURATION');
  }
});
