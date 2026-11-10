import test from 'node:test';
import assert from 'node:assert/strict';
import {createSynthPsgLoopPlayer,normalizeSynthPsgLoopConfig,normalizeSynthPsgLoopUnit,prepareSynthPsgLoopUnit,PSG_LOOP_MAX_UNITS} from './synth_psg_loop_player.js';

const RATE=8000,LENGTH=.05,FRAMES=400;
const unit=(id='layer',length=600,value=1,offsetSeconds=0)=>({id,left:new Float32Array(length).fill(value),right:new Float32Array(length).fill(-value/4),offsetSeconds});
function render(player,count,start=0,block=128) {
  const left=new Float32Array(count),right=new Float32Array(count);
  for(let offset=0;offset<count;offset+=block)player.render(left.subarray(offset,Math.min(count,offset+block)),right.subarray(offset,Math.min(count,offset+block)),start+offset);
  return {left,right};
}

test('PCM layers begin on the requested future phase and keep finite release history across loop boundaries',()=>{
  const player=createSynthPsgLoopPlayer({sampleRate:RATE}),source=unit('tail',1200);
  player.start({loopLength:LENGTH,startTime:.1},{session:1});player.add(1,source);
  const pcm=render(player,2400);
  assert(pcm.left.subarray(0,800).every(x=>x===0));
  assert(pcm.left.subarray(800,1200).every(x=>x===1),'first pass has no invented release from an earlier cycle');
  assert(pcm.left.subarray(1200,1600).every(x=>x===2));
  assert(pcm.left.subarray(1600).every(x=>x===3),'three real occurrences overlap after startup');
  assert(pcm.right.subarray(1600).every(x=>x===-.75));
  assert(source.left.every(x=>x===1),'the retained main-side unit remains raw');
  assert.equal(player.snapshot().byteLength,source.left.byteLength+source.right.byteLength);
});

test('cooperative Main preparation produces the same finite-history PCM and cancels without changing source arrays',async()=>{
  const raw=unit('long',1200,.25),a=createSynthPsgLoopPlayer({sampleRate:RATE}),b=createSynthPsgLoopPlayer({sampleRate:RATE});
  let yields=0;
  const prepared=await prepareSynthPsgLoopUnit(raw,{sampleRate:RATE,loopLength:LENGTH,chunkFrames:128,yieldControl:async()=>{yields++;}});
  assert(yields>1);assert.equal(prepared.frameCount,1200);assert.equal(prepared.prefixCount,3);assert(raw.left.every(x=>x===.25));
  for(const player of[a,b])player.start({loopLength:LENGTH,startTime:.1},{session:1});
  a.add(1,raw);b.addPrepared(1,prepared);assert.deepEqual(render(a,3000,0,71),render(b,3000,0,128));
  const controller=new AbortController();
  await assert.rejects(prepareSynthPsgLoopUnit(raw,{sampleRate:RATE,loopLength:LENGTH,signal:controller.signal,chunkFrames:128,
    yieldControl:async()=>controller.abort(new DOMException('cancelled','AbortError'))}),{name:'AbortError'});
  assert(raw.left.every(x=>x===.25));
  const malformed={...prepared,frameCount:1};assert.throws(()=>b.addPrepared(1,malformed));
  const guarded=createSynthPsgLoopPlayer({sampleRate:RATE});guarded.start({loopLength:LENGTH,startTime:0},{session:1});
  guarded.addPrepared(1,{...prepared,left:new Float32Array(prepared.left).fill(NaN)});
  assert.throws(()=>render(guarded,128),/prepared PSG loop sample/);
});

test('render block boundaries do not alter PCM; late overdubs start at their next phase without restarting existing layers',()=>{
  const a=createSynthPsgLoopPlayer({sampleRate:RATE}),b=createSynthPsgLoopPlayer({sampleRate:RATE});
  for(const player of[a,b]){player.start({loopLength:LENGTH,startTime:0},{session:1});player.add(1,unit('a',600,.5));}
  assert.deepEqual(render(a,625,0,128),render(b,625,0,71));
  for(const player of[a,b])player.add(1,unit('b',1200,1,.0125),{currentFrame:625});
  assert.equal(a.snapshot().units[1].firstStartFrame,900);
  const actual=render(a,1400,625,127),expected=render(b,1400,625,71);assert.deepEqual(actual,expected);
  // 900 is the first occurrence of b, so at 900 its contribution is 1, not 3.
  assert.equal(actual.left[900-625],2,'existing a has two .5 tails and newly added b has one occurrence');
  assert(a.remove(1,'b'));assert(b.remove(1,'b'));
  assert.deepEqual(render(a,1000,2025),render(b,1000,2025,37));
  const reference=createSynthPsgLoopPlayer({sampleRate:RATE});reference.start({loopLength:LENGTH,startTime:0},{session:1});reference.add(1,unit('a',600,.5));
  assert.deepEqual(render(a,800,3025),render(reference,800,3025),'Undo does not reset the surviving layer phase/history');
});

test('stop barriers refuse stale start/add/remove and restart begins with a clean history',()=>{
  const player=createSynthPsgLoopPlayer({sampleRate:RATE});
  player.start({loopLength:LENGTH,startTime:0},{session:1});player.add(1,unit('a'));
  assert(render(player,1000).left.some(x=>x!==0));player.stop(2);
  assert.equal(player.start({loopLength:LENGTH,startTime:0},{session:1}),false);
  assert.equal(player.add(1,unit('stale')),false);assert.equal(player.remove(1,'a'),false);
  assert(render(player,800,1000).left.every(x=>x===0));
  player.start({loopLength:LENGTH,startTime:.25},{session:3,currentFrame:1800});player.add(3,unit('a'),{currentFrame:1800});
  const restarted=render(player,800,1800);
  assert(restarted.left.subarray(0,200).every(x=>x===0));assert(restarted.left.subarray(200,600).every(x=>x===1));
  assert.equal(player.snapshot().units.length,1);player.stop();assert.equal(player.snapshot().byteLength,0);
});

test('invalid PCM/configuration is rejected before replacing layers and finite normalized samples are detached',()=>{
  const player=createSynthPsgLoopPlayer({sampleRate:RATE}),config={loopLength:LENGTH,startTime:0};
  player.start(config,{session:1});player.add(1,unit('a'));
  const before=player.snapshot();
  for(const bad of[{loopLength:0,startTime:0},{loopLength:121,startTime:0},{loopLength:LENGTH,startTime:-1},{...config,unknown:true}]) {
    assert.throws(()=>player.start(bad,{session:2}));assert.deepEqual(player.snapshot(),before);
  }
  for(const bad of[{...unit('bad'),right:new Float32Array(3)},{...unit('bad'),offsetSeconds:LENGTH},{...unit('bad'),id:''},
    {...unit('bad'),left:Float32Array.of(NaN),right:Float32Array.of(0)},unit('oversize',Math.ceil((LENGTH+5.01)*RATE)+1)]) {
    assert.throws(()=>player.add(1,bad));assert.deepEqual(player.snapshot(),before);
  }
  assert.throws(()=>player.add(1,unit('a')));assert.deepEqual(player.snapshot(),before);
  const raw=unit('detached'),normalized=normalizeSynthPsgLoopUnit(raw,{sampleRate:RATE,loopLength:LENGTH});raw.left[0]=0;
  assert.equal(normalized.left[0],1);assert.deepEqual(normalizeSynthPsgLoopConfig(config,{sampleRate:RATE}),config);
  assert.throws(()=>createSynthPsgLoopPlayer({sampleRate:7999}));assert.throws(()=>player.render(new Float32Array(1),new Float32Array(2),0));
  for(let index=1;index<PSG_LOOP_MAX_UNITS;index++)player.add(1,unit('extra'+index,1,.1));
  const full=player.snapshot();assert.throws(()=>player.add(1,unit('tooMany',1)));assert.deepEqual(player.snapshot(),full);
});
