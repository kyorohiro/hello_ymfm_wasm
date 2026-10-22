import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisGameGear} from './native_genesis_game_gear.js';
import {createSegaPsgClient} from './playground_segapsg.js';
const HELD_CLOCK_ERROR='Release the manually held Game Gear voices before changing the clock';
async function until(predicate){const deadline=Date.now()+1000;while(!predicate()){if(Date.now()>deadline)throw new Error('Game Gear command did not start');await new Promise(resolve=>setTimeout(resolve,1));}}

function fixture() {
  const commands = [], requests = [], events = [], future = [], held = new Map(), rejectedClocks = new Set();
  const state = {clock:3579545, periods:[0,0,0], attenuations:[15,15,15,15], lastVolumes:[0,0,0,0], latched:0, mode:0, stereo:255, sourceMuteMask:0};
  let frame = 0, flushHook, statusHook;
  function apply(message, bypass = false) {
    const m = message;
    if (m.method === 'batch') {
      if (m.action === 'off' && held.get(m.channel) !== m.voice) return;
      if (m.action === 'on') held.set(m.channel,m.voice);
      for (const c of m.commands) apply(c,true);
      if (m.action === 'off') held.delete(m.channel);
      return;
    }
    if (m.method === 'write') {
      const v=m.value,r=v&128?v>>4&7:m.psgRegister??state.latched,ch=r>>1;
      if (!bypass && (held.has(ch) || held.has(3) && state.mode%4===3 && ch===2)) return;
      state.latched=r;
      if (r&1) {state.attenuations[ch]=v&15;if((v&15)!==15)state.lastVolumes[ch]=v&15;}
      else if (r===6) state.mode=v&7;
      else state.periods[ch]=v&128?(state.periods[ch]&1008)|(v&15):(state.periods[ch]&15)|((v&63)<<4);
    } else if (m.method === 'stereo') {
      const protectedBits=bypass?0:[...held.keys()].reduce((bits,ch)=>bits|(17<<ch),0);
      state.stereo=(m.mask&~protectedBits)|(state.stereo&protectedBits);
    } else if (m.method === 'key-off') {if(bypass||!held.has(m.channel))state.attenuations[m.channel]=15;}
    else if (m.method === 'clock') {if(held.size)rejectedClocks.add(m.id);else state.clock=m.hz;}
    else if (m.method === 'reset') {held.clear();state.periods.fill(0);state.attenuations.fill(15);state.lastVolumes.fill(0);state.latched=state.mode=0;state.stereo=255;}
    else if (m.method === 'stop-voices') {held.clear();state.attenuations.fill(15);}
  }
  const snapshot=()=>({segapsg:{...structuredClone(state),held:[...held.keys()],pendingCommands:future.flatMap(c=>c.message.id?[c.message.id]:[])},frame,sampleRate:48000,revision:commands.length});
  const synth={session:1,generation:1,clock:{sampleRate:48000},stopping:null,closing:false,isReady:()=>true,frameAt:t=>Math.round(t*48000),
    enqueue(c){assert.equal(c.type,'master-system');assert.equal(c.message.chip,'segapsg');if(c.message.method==='clock'&&held.size)throw new Error(HELD_CLOCK_ERROR);commands.push(c);if(c.frame>frame)future.push(c);else apply(c.message);},
    async flush(){if(flushHook)await flushHook();},async nativeRequest(command,args){requests.push({command,args});if(args?.after)while(future.some(c=>c.message.id===args.after))await new Promise(resolve=>setTimeout(resolve,1));if(rejectedClocks.has(args?.after))throw new Error(HELD_CLOCK_ERROR);return statusHook?statusHook():snapshot();},emit:e=>events.push(e)};
  const endpoints=createNativeGenesisGameGear(synth),endpoint=endpoints.segapsg;
  return {endpoints,endpoint,client:endpoint.client,synth,state,held,commands,requests,events,snapshot,
    setFlushHook:h=>{flushHook=h;},setStatusHook:h=>{statusHook=h;},
    async start(){await endpoint.initialize();commands.length=0;},
    advance(to){frame=to;for(let i=0;i<future.length;)if(future[i].frame<=frame)apply(future.splice(i,1)[0].message);else i++;},
    stop(){future.length=0;apply({method:'stop-voices'});endpoint.adoptStopped(snapshot());}};
}

test('Native Game Gear creates exactly one stereo PSG without audio work',async()=>{
  const f=fixture();assert.deepEqual(Object.keys(f.endpoints),['segapsg']);assert.equal(f.commands.length,0);assert.equal(f.client.id,'segapsg');assert.equal(f.client.stereoEnabled,true);assert.equal(typeof f.client.setStereo,'function');assert.equal(f.client.clock,3579545);
  assert.throws(()=>{f.client.clock=4000000;},TypeError);await f.start();await f.endpoint.initialize();assert.equal(f.commands.length,0);assert.equal((await f.endpoint.read()).stereo,255);assert(f.requests.every(r=>r.command==='native_genesis_game_gear_status'));
});

test('Native Game Gear tone/noise/latch/stereo authoring exactly matches the Web client',async()=>{
  const f=fixture();await f.start();const writes=[],web=createSegaPsgClient({postMessage:m=>writes.push(m),close(){}});
  function program(api){api.setStereo(0xa5);for(let ch=0;ch<3;ch++){api.tone(ch,{note:'A4',attenuation:ch+3});api.keyOff(ch);api.keyOn(ch);}api.noise({type:'white',rate:'tone3',attenuation:9});api.write(0x81);api.write(0x23);api.setStereo(0x18);api.noiseOff();}
  program(web);program(f.client);
  assert.deepEqual(f.commands.map(c=>c.message),writes.map(m=>m.method==='setStereo'?{chip:'segapsg',method:'stereo',mask:m.args[0]}:{chip:'segapsg',method:'write',register:0,value:m.args[0],...(m.psgRegister===undefined?{}:{psgRegister:m.psgRegister})}));assert.deepEqual(f.client._getState(),web._getState());
});

test('Native Game Gear stereo bit ordering includes left/right routes for noise',async()=>{
  const f=fixture();await f.start();for(let ch=0;ch<4;ch++)for(const side of ['left','right']){
    f.client.setStereo(side==='left'?16<<ch:1<<ch);const view=await f.endpoint.read();
    for(let voice=0;voice<4;voice++){const c=voice===3?view.noise:view.channels[voice];assert.deepEqual(c.pan,{left:side==='left'&&voice===ch,right:side==='right'&&voice===ch});}
  }
});

test('Native Game Gear scheduled stereo writes preserve timing/owners and passive reads preserve authored state',async()=>{
  const f=fixture();await f.start();f.client.setStereo(0x81);const before=f.client._getState();
  assert.deepEqual(await f.endpoint.dispatch({method:'setStereo',args:[0x24],id:'pan'},{time:1,owner:4,performance:7}),{id:'pan'});
  assert.deepEqual(f.commands.at(-1),{type:'master-system',frame:48000,owner:4,performance:7,message:{chip:'segapsg',method:'stereo',mask:0x24}});
  assert.equal((await f.endpoint.read()).stereo,0x81);f.advance(48000);assert.equal((await f.endpoint.read()).stereo,0x24);assert.deepEqual(f.client._getState(),before);
});

for(let ch=0;ch<4;ch++)test(`Native Game Gear voice ${ch} preserves stereo during manual replacement and stale release`,async()=>{
  const f=fixture();await f.start();f.client.setStereo(0xf0);await f.endpoint.invoke('setAttenuation',[ch,7]);await f.endpoint.invoke('auditionOn',[ch,69,'old']);const old=f.held.get(ch);
  await f.endpoint.invoke('auditionOn',[ch,72,'new']);assert.notEqual(f.held.get(ch),old);const before=f.commands.length;assert.equal(await f.endpoint.invoke('auditionOff',[ch,'old']),false);assert.equal(f.commands.length,before);
  f.client.setStereo(0x0f);assert(f.state.stereo&(16<<ch));assert.equal(f.state.stereo&(1<<ch),0);
  await f.endpoint.invoke('setStereo',[0x18]);assert.equal(f.state.stereo,0x18);assert.equal(f.client._getState().stereo,0x18);
  await f.endpoint.invoke('auditionOff',[ch,'new']);assert.equal(f.state.attenuations[ch],15);assert.equal(f.state.stereo,0x18);assert.equal(f.held.size,0);
});

test('Native Game Gear noise audition at Tone3 rate protects its tone clock and keeps authored noise type',async()=>{
  const f=fixture();await f.start();f.client.tone(2,{period:369,attenuation:7});f.client.noise({type:'white',rate:'tone3',attenuation:8});await f.endpoint.invoke('auditionOn',[3,69,'noise']);f.client.setPeriod(2,123);assert.equal(f.state.periods[2],369);assert.equal(f.state.mode,7);await f.endpoint.invoke('auditionOff',[3,'noise']);assert.equal(f.state.mode,7);assert.equal(f.state.attenuations[3],15);
});

test('Native Game Gear Stop keeps the applied stereo mask, periods and retained levels',async()=>{
  const f=fixture();await f.start();f.client.setStereo(0xa5);f.client.tone(2,{period:369,attenuation:5});f.client.noise({type:'white',rate:'tone3',attenuation:7});await f.client.setClock(3000000);
  await f.endpoint.dispatch({method:'setStereo',args:[0x18]},{time:1});f.stop();assert.equal(f.client._getState().stereo,0xa5);assert.equal(f.state.stereo,0xa5);assert.equal(f.state.periods[2],369);assert.equal(f.state.mode,7);assert.deepEqual(f.state.attenuations,[15,15,15,15]);assert.equal(f.client.clock,3000000);assert.deepEqual(f.client._getState().attenuations,[0,0,5,7]);
});

for(const method of ['reset','resetAll'])test(`Native Game Gear inspector ${method} restores stereo255 and retires all leases`,async()=>{
  const f=fixture();await f.start();f.client.setStereo(0x18);for(let ch=0;ch<4;ch++)await f.endpoint.invoke('auditionOn',[ch,69,'held'+ch]);await f.endpoint.invoke(method);assert.equal(f.state.stereo,255);assert.equal(f.client._getState().stereo,255);assert.equal(f.held.size,0);assert.deepEqual(f.state.periods,[0,0,0]);assert.deepEqual(f.state.attenuations,[15,15,15,15]);
});

test('Native Game Gear rejects malformed stereo edits and snapshots before replaying audio',async()=>{
  const f=fixture();await f.start();for(const mask of [-1,256,1.5,NaN]){assert.throws(()=>f.client.setStereo(mask));await assert.rejects(f.endpoint.dispatch({method:'setStereo',args:[mask]}));await assert.rejects(f.endpoint.invoke('setStereo',[mask]));}assert.equal(f.commands.length,0);
  f.setStatusHook(()=>{const s=f.snapshot();s.segapsg.stereo=256;return s;});await assert.rejects(f.endpoint.read(),/Stereo/);f.setStatusHook(null);await f.endpoint.mix(.4,-.3);assert.equal(f.commands.at(-1).message.method,'mix');
});

for(const cancellation of ['generation','session','owner'])test(`Native Game Gear asynchronous controls fence ${cancellation} cancellation`,async()=>{
  const f=fixture();await f.start();let retired=false;f.setFlushHook(()=>{if(cancellation==='owner')retired=true;else f.synth[cancellation]++;});await assert.rejects(f.endpoint.dispatch({method:'clock',args:[3000000]},{checkCurrent(){if(retired)throw new DOMException('Retired','AbortError');}}),{name:'AbortError'});assert.equal(f.client.clock,3579545);
});

test('Native Game Gear clocks wait for scheduled application without rolling back authored registers',async()=>{
  const f=fixture();await f.start();const pending=f.endpoint.dispatch({method:'clock',args:[3000000],id:'clock'},{time:1,owner:4,performance:7});await until(()=>f.commands.some(c=>c.message.method==='clock'));
  assert.equal(f.client.clock,3579545);assert.equal((await f.endpoint.read()).clock,3579545);f.client.tone(0,{period:369,attenuation:4});const authored=f.client._getState();await f.endpoint.read();assert.deepEqual(f.client._getState(),authored);
  f.advance(48000);assert.deepEqual(await pending,{id:'clock'});assert.equal(f.client.clock,3000000);const c=f.commands.find(c=>c.message.method==='clock');assert.equal(c.frame,48000);assert.equal(c.owner,4);assert.equal(c.performance,7);assert(Number.isSafeInteger(c.message.id));
});

test('Native Game Gear held clocks reject without adopting a requested rate and recover after release',async()=>{
  const f=fixture();await f.start();await f.endpoint.invoke('auditionOn',[0,69,'held']);await assert.rejects(f.client.setClock(3000000),/held/);assert.equal(f.client.clock,3579545);await f.endpoint.invoke('auditionOff',[0,'held']);await f.client.setClock(3000000);assert.equal(f.client.clock,3000000);
});

for(const hz of [3579545,3000000])test(`Native Game Gear clock ${hz} observes manual-hold rejection after admission`,async()=>{
  const f=fixture();await f.start();const pending=f.endpoint.dispatch({method:'clock',args:[hz]},{time:1}),rejected=assert.rejects(pending,/held/);await until(()=>f.commands.some(c=>c.message.method==='clock'));await f.endpoint.invoke('auditionOn',[0,69,'late']);f.advance(48000);await rejected;assert.equal(f.client.clock,3579545);
});
