import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource,applyPlaybackMutes,playbackMuteControls,selectPlaybackConfiguration} from '../cli/index.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
const fixture=n=>new URL('./fixtures/'+n+'.vgz',import.meta.url);
test('Shared mute controls silence supported channel/source while default PCM stays audible',async()=>{
 for(const [name,id] of [['psg-tone','psg'],['opm-audible','ym2151-ch-1'],['ym2203-fm','ym2203-ch-1'],['pwm-direct','pwm']]){
  const source=await readSource(fixture(name));
  const normal=await renderSource(source,{maxSeconds:.05}),muted=await renderSource(source,{maxSeconds:.05,mute:[id]});
  const energy=b=>{const v=new DataView(b.buffer,b.byteOffset);let n=0;for(let i=44;i<b.length;i+=2)n+=Math.abs(v.getInt16(i,true));return n;};
  assert(energy(normal.bytes)>energy(muted.bytes),name);
 }
});
test('Mute validation is atomic and exposes only controls for present sources',async()=>{
 const source=await readSource(fixture('psg-tone')),config=selectPlaybackConfiguration(new Ym2612VGM(source));
 assert.deepEqual(playbackMuteControls(config).map(c=>c.id),['psg']);
 let calls=0;const engine={setPsgMuted(){calls++;}};
 assert.throws(()=>applyPlaybackMutes(engine,config,['psg','bad']),/Unsupported/);assert.equal(calls,0);
 assert.throws(()=>applyPlaybackMutes(engine,config,['psg','psg']),/unique/);
 await assert.rejects(renderSource(source,{maxSeconds:.01,mute:['ym2612-ch-1']}),/Unsupported/);
});
