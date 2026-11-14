import test from 'node:test';
import assert from 'node:assert/strict';
import {createHuc6280CodeLive,huc6280CodeLiveView} from './code_live.js';
import {createDefaultPreset} from './preset.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  let running=false,audio=null,serial=0;const timers=new Map(),requests=[],updates=[];
  const live=createHuc6280CodeLive({getAudio:()=>audio,isRunning:()=>running,onUpdate:v=>updates.push(v),schedule(fn,ms){timers.set(++serial,{fn,ms});return serial;},cancel:id=>timers.delete(id)});
  return{live,timers,requests,updates,start(){running=true;audio={command:method=>new Promise((resolve,reject)=>requests.push({method,resolve,reject}))};live.sync();},stop(){running=false;live.sync();},
    async tick(){assert.equal(timers.size,1);const[id,v]=timers.entries().next().value;timers.delete(id);v.fn();await turn();return v.ms;}};
}
test('passive observations are single-flight at 20Hz and Auto Off retains one frozen all-channel snapshot',async()=>{
  const f=fixture();f.start();assert.equal(await f.tick(),0);f.live.sync();assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
  f.requests[0].resolve({marker:'first'});await turn();assert.equal(await f.tick(),50);assert.equal(f.requests.length,2);
  f.requests[1].resolve({marker:'frozen'});await turn();f.live.setEnabled(false);f.live.setVoice(5);
  assert.equal(f.live.read().liveState.marker,'frozen');assert.equal(f.live.read().liveVoice,5);assert.equal(f.timers.size,0);
  const refresh=f.live.refresh();await turn();f.requests[2].resolve({marker:'manual'});await refresh;assert.equal(f.live.read().liveState.marker,'manual');assert.equal(f.timers.size,0);f.live.dispose();
});
test('an old engine response after Stop cannot repaint a later Code run',async()=>{
  const f=fixture();f.start();await f.tick();f.stop();f.start();
  f.requests[0].resolve({marker:'old'});await turn();assert.equal(f.live.read().liveState,null);
  await f.tick();f.requests[1].resolve({marker:'new'});await turn();assert.equal(f.live.read().liveState.marker,'new');
  const state=f.live.read();state.liveState.marker='external';assert.equal(f.live.read().liveState.marker,'new');f.live.dispose();
});
test('existing controls decode sent Wave/Noise/DDA/LFO settings without copying source PCM or inventing phase',()=>{
  const preset=createDefaultPreset(),original=structuredClone(preset),s={globals:Array(10).fill(0),registers:Array.from({length:8},()=>Array(8).fill(0)),waveforms:Array.from({length:8},()=>Array(32).fill(7))};
  s.globals[8]=9;s.globals[9]=2;s.registers[0][3]=255;s.registers[1][2]=67;s.registers[1][4]=13;s.registers[4][4]=128|21;s.registers[4][7]=128|29;s.registers[4][5]=0x6a;
  const noise=huc6280CodeLiveView(s,4,preset);assert.equal(noise.preset.source,'noise');assert.equal(noise.preset.noise.frequency,29);assert.equal(noise.preset.volume,21);assert.deepEqual(noise.preset.pan,{left:6,right:10});assert.equal(noise.preset.lfo.carrierPeriod,3840);
  s.registers[2][4]=128|64|19;s.dda={sampleRate:12000,rootNote:48,loop:true,speed:2};
  const dda=huc6280CodeLiveView(s,2,preset);assert.equal(dda.preset.source,'dda');assert.equal(dda.preset.dda.sampleRate,12000);assert.match(dda.readout,/software sample supply/);
  assert.deepEqual(preset,original);dda.preset.wave[0]=9;assert.equal(s.waveforms[2][0],7);
});

test('normal editor observation stays passive and drops an idle response after Code takes ownership',async()=>{
  let allowed=false,serial=0;const timers=new Map(),requests=[];
  const engine={command:method=>new Promise(resolve=>requests.push({method,resolve}))};
  const live=createHuc6280CodeLive({method:'observeEditor',retainSnapshot:false,getAudio:()=>engine,isRunning:()=>allowed,
    schedule(fn,ms){timers.set(++serial,{fn,ms});return serial;},cancel:id=>timers.delete(id)});
  live.sync();assert.equal(timers.size,0);assert.equal(requests.length,0);
  allowed=true;live.sync();const run=()=>{const[id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();};
  run();assert.equal(requests[0].method,'observeEditor');allowed=false;live.sync();requests[0].resolve({marker:'stale idle'});await turn();assert.equal(live.read().liveState,null);
  allowed=true;live.sync();run();requests[1].resolve({marker:'current idle'});await turn();assert.equal(live.read().liveKind,'editor');assert.equal(live.read().liveSource.name,'Editor');
  assert.equal(live.read().liveState.marker,'current idle');live.setEnabled(false);assert.equal(live.read().liveState,null);assert.equal(timers.size,0);live.dispose();
});
