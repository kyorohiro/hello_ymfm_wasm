import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {selectPlaybackConfiguration} from '../docs/vgm_analyzer/playback_core.js';
const fixture=new URL('./fixtures/huc6280-tone.vgz',import.meta.url);
test('HuC6280 VGZ renders audible WAV and supports channel mute through shared playback',async()=>{
  const source=await readSource(fixture);
  assert.equal(selectPlaybackConfiguration(new Ym2612VGM(source)).kind,'huc6280');
  const wav=await renderSource(source,{maxSeconds:.1});
  assert.deepEqual(wav.warnings,[]);assert(wav.bytes.subarray(44).some(v=>v!==0));
  assert.deepEqual((await renderSource(source,{maxSeconds:.1})).bytes,wav.bytes);
  assert((await renderSource(source,{maxSeconds:.1,mute:['huc6280-ch-1']})).bytes.subarray(44).every(v=>v===0));
  for(const clock of [3579545|0x40000000,(3579545|0x80000000)>>>0]) {
    const b=source.slice();new DataView(b.buffer).setUint32(0xa4,clock,true);
    await assert.rejects(renderSource(b),e=>e.code==='UNSUPPORTED_CONFIGURATION');
  }
  const mixed=source.slice();new DataView(mixed.buffer).setUint32(0x2c,7670454,true);
  await assert.rejects(renderSource(mixed),e=>e.code==='UNSUPPORTED_CONFIGURATION');
});
