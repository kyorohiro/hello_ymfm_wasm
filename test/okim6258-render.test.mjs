import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {createPlaybackEngine,createPlaybackPlayer} from '../docs/vgm_analyzer/playback_core.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
const fixture=name=>new URL(`./fixtures/${name}.vgz`,import.meta.url);
async function pcm(source) {
  const e=await createPlaybackEngine(new Ym2612VGM(source),{getFactory:getNodePlaybackFactory});
  try {const p=createPlaybackPlayer(e,source);p.play();const l=new Float32Array(1000),r=new Float32Array(1000);p.process(l,r,1000);return [l,r];}finally{e.dispose();}
}
test('OKI standalone and OPM combination preserve each chip in shared PCM and Node WAV',async()=>{
  const sources=await Promise.all(['okim6258-tone','opm-audible','opm-oki-mix'].map(n=>readSource(fixture(n))));
  const [oki,fm,mix]=await Promise.all(sources.map(pcm));
  for(let ch=0;ch<2;ch++) {
    assert(oki[ch].some(v=>v!==0));assert(fm[ch].some(v=>v!==0));
    for(let i=0;i<1000;i++)assert.equal(mix[ch][i],Math.fround(oki[ch][i]+fm[ch][i]));
  }
  for(const source of sources) {const wav=await renderSource(source,{maxSeconds:.02});assert.deepEqual(wav.warnings,[]);assert(wav.bytes.subarray(44).some(v=>v!==0));}
});
test('OKI clocks, divider/precision flags and pan affect CLI PCM; unsupported headers reject',async()=>{
  const original=await readSource(fixture('okim6258-tone'));
  // Drive the decoder to its clamp so 10/12-bit precision is observable.
  for(let i=259;i<859;i+=6)original[i+2]=0x77;
  const base=await pcm(original);
  for(const [clock,flags] of [[4096000,12],[8192000,14],[8192000,4]]) {
    const source=original.slice();new DataView(source.buffer).setUint32(0x90,clock,true);source[0x94]=flags;
    assert.notDeepEqual(await pcm(source),base);
  }
  for(const [clock,flags] of [[8192000,0],[0x40000000+8192000,12],[0x80000000+8192000,12]]) {
    const source=original.slice();new DataView(source.buffer).setUint32(0x90,clock,true);source[0x94]=flags;
    await assert.rejects(renderSource(source),e=>e.code==='UNSUPPORTED_CONFIGURATION');
  }
  // Insert a pan write before playback; bit 0 disables the right output.
  const pan=new Uint8Array(original.length+3);pan.set(original.subarray(0,256));pan.set([0xb7,2,1],256);pan.set(original.subarray(256),259);
  new DataView(pan.buffer).setUint32(4,pan.length-4,true);
  const [l,r]=await pcm(pan);assert(l.some(v=>v!==0));assert(r.every(v=>v===0));
});
