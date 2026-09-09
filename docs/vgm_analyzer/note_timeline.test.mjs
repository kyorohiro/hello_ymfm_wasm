import test from 'node:test';
import assert from 'node:assert/strict';
import {packTimeline,timelineWindow,timelineScrollWidth} from './note_timeline.js';
import {seekPlayback} from './seek_playback.js';
import {VgmPlayer} from '../js/vgmplayer.js';
function vgm(commands) {
 const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);
 b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x2c,7670454,true);v.setUint32(0x34,0xcc,true);b.set(commands,256);return b;
}
function engine(rate){
 let frame=0,reg=0;
 return {sampleRate:()=>rate,reset(){frame=0;reg=0;},writeYm2612(p,r,v){reg=v;},
 processFrames(n){const left=Float32Array.from({length:n},()=>((frame++%1000)+reg)/2048);return {left,right:left.slice()};}};
}
test('timeline onset cleanup and interval lookup preserve sustained and later pitches',()=>{
 const d=packTimeline([
 {start:0,end:5,midi:79,key:1,freshOnset:true,endReason:'pitch'},
 {start:5,end:100,midi:76,key:1},
 {start:100,end:200,midi:80,key:1},
 {start:200,end:300,midi:null,key:2},
 ]);
 assert.deepEqual([...d],[0,100,76,1,100,200,80,1]);
 assert.deepEqual(timelineWindow(d,50,75).rows,[[0,100,76,1]]);
 assert.deepEqual(timelineWindow(d,120,150).rows,[[100,200,80,1]]);
});
test('long timeline has bounded scroll width and viewport response size',()=>{
 assert.equal(timelineScrollWidth(44100*3600*10000,600,1000),8000000);
 const d=Float64Array.from({length:400000},(_,i)=>i%4<2?Math.floor(i/4)*10+(i%4)*9:60);
 const result=timelineWindow(d,500000,600000,100);
 assert.equal(result.rows.length,100);assert.equal(result.dense,true);
 assert.equal(result.rows[0][0],500000);
});
test('silent seek matches continuous playback at multiple native sample rates',async()=>{
 const bytes=vgm([0x52,0x40,10,0x61,3,0,0x52,0x40,20,0x61,0x10,0x27,0x52,0x40,30,0x61,0x10,0x27,0x66]);
 for(const rate of [44100,55555,500000]){
  const direct=new VgmPlayer(engine(rate)),seeked=new VgmPlayer(engine(rate));
  direct.load(bytes);seeked.load(bytes);direct.play();
  const frames=Math.floor(4321*rate/44100);
  direct.process(new Float32Array(frames),new Float32Array(frames),frames);
  const reached=await seekPlayback(seeked,4321);
  assert.ok(Math.abs(reached-4321)<44100/rate);
  assert.equal(seeked.isPaused(),true);
  seeked.resume();
  const a=new Float32Array(300),b=new Float32Array(300);
  direct.process(a,new Float32Array(300),300);
  seeked.process(b,new Float32Array(300),300);
  assert.deepEqual(a,b);
 }
});
test('cancelled seek restores playback options and leaves the player paused',async()=>{
 const p=new VgmPlayer(engine(44100));p.load(vgm([0x61,100,0,0x66]));
 p.setLoopEnabled(true);p.setPrefetchFactor(2);
 const abort=new AbortController();abort.abort();
 await assert.rejects(seekPlayback(p,50,{signal:abort.signal}),{name:'AbortError'});
 assert.equal(p.isPaused(),true);assert.equal(p.loopEnabled,true);assert.equal(p.prefetchFactor,2);
});

test('paused worklet pump does not drain retained player audio',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const a=source.indexOf('function pumpWorkletChunks(');
 const c=vm.createContext({
  player:{isPaused:()=>true,process(){assert.fail('paused queue was drained');}},
  currentWorkletTargetFrames:()=>4096,
  activeStream:{mode:'worklet',workletQueuedFrames:0},
 });
 vm.runInContext(source.slice(a,source.indexOf('\n}',a)+2),c);
 c.pumpWorkletChunks();
});

test('Play resumes a paused position but restarts from a newly selected cursor',async()=>{
 const {readFileSync}=await import('node:fs'),vm=await import('node:vm');
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const a=source.indexOf('playButton.addEventListener("click", async () => {');
 let handler;const actions=[];
 const c=vm.createContext({
  playButton:{addEventListener(_type,fn){handler=fn;}},
  player:{isPaused:()=>true},timelineSelectionPending:false,
  songTimeline:{selected:()=>44100},
  resumeTimelinePlayback:async()=>actions.push('resume'),
  playCurrentVgm:async sample=>actions.push(sample),
 });
 vm.runInContext(source.slice(a,source.indexOf('\n});',a)+4),c);
 await handler();c.timelineSelectionPending=true;await handler();
 assert.deepEqual(actions,['resume',44100]);
});

test('timeline cursor wraps into the loop section without losing the intro',async()=>{
 const {timelinePlaybackPosition:at}=await import('./note_timeline.js');
 assert.equal(at(150,200,80,true),150);
 assert.equal(at(200,200,80,true),120);
 assert.equal(at(290,200,80,true),130);
 assert.equal(at(290,200,80,false),200);
});
