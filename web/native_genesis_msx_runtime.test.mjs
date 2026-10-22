import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createNativeWorkerApis} from './playground_native_primary.js';
import {createNativeGenesisWorkerBridge} from './native_genesis_worker.js';
import {createPerformanceHost} from './playground_performance_host.js';
import {createPerformanceSender} from './playground_performance_sender.js';

function fixture(){
  const calls=[],commands=[],errors=[];
  const ay={clock:1789773,registers:Array(16).fill(0),levels:[9,9,9],gates:[false,false,false],held:[],pendingCommands:[],sourceMuteMask:7,sampleRate:48000};
  const opll={clock:3579545,registers:Array(64).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000};
  const status=()=>({session:1,mode:'msx',sampleRate:48000,frame:0,ymClock:opll.clock,psgClock:ay.clock,running:true});
  const snapshot=()=>({ym2413:structuredClone(opll),ay8910:structuredClone(ay),sampleRate:48000,frame:0,revision:commands.length});
  function stop(chip){if(chip==='ay8910'){for(let ch=0;ch<3;ch++){ay.registers[8+ch]=0;ay.gates[ch]=false;}}else{for(let ch=0;ch<9;ch++)opll.registers[0x20+ch]&=239;opll.registers[14]&=224;}}
  function apply(m){const state=m.chip==='ay8910'?ay:opll;
    if(m.method==='batch'){for(const c of m.commands)apply({...c,chip:m.chip});return;}
    if(m.method==='write'){state.registers[m.register]=m.value;if(state===ay&&m.register>=8&&m.register<=10){ay.gates[m.register-8]=!!(m.value&31);if(m.value&31)ay.levels[m.register-8]=m.value&31;}}
    else if(m.method==='set-retained-level')ay.levels[m.channel]=m.level;
    else if(m.method==='clock')state.clock=m.hz;
    else if(m.method==='stop-voices')stop(m.chip);
    else if(m.method==='key-off'){if(state===ay){ay.registers[8+m.channel]=0;ay.gates[m.channel]=false;}else if(m.channel<9)opll.registers[0x20+m.channel]&=239;else opll.registers[14]&=~(16>>(m.channel-9));}
    else if(m.method==='audition-key-on'){if(m.channel<9)opll.registers[0x20+m.channel]|=16;else opll.registers[14]|=16>>(m.channel-9);}
    else if(m.method==='reset'){state.registers.fill(0);if(state===ay){ay.levels.fill(9);ay.gates.fill(false);}}
  }
  const invoke=async(command,args)=>{calls.push({command,args});
    if(command==='native_genesis_commands')for(const c of args.commands){commands.push(c);assert(!['write','psg-write','psg-stereo','reset','master-system','ym2608','ym2610b','x68000'].includes(c.type),'MSX has no hidden Genesis or Sega PSG');if(c.type==='msx')apply(c.message);}
    if(command==='native_genesis_stop'){stop('ay8910');stop('ym2413');}
    if(command==='native_genesis_msx_status')return snapshot();return status();
  };
  return {synth:new NativeGenesisSynth({mode:'msx',invoke,now:()=>0,onError:e=>errors.push(e)}),calls,commands,errors,ay,opll,snapshot};
}

test('Native MSX Main borrows OPLL / AY endpoints and has no Genesis audio graph',async t=>{
  const previous=globalThis.window;globalThis.window={};const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.msxNativeResult;});
  await runtime.playSource(`
    if(await useSoundChip('ym2413')!==opll||await useSoundChip('ay8910')!==ay)throw Error('MSX primary was not reused');
    ay.tone(0,{note:'A4',volume:6});ay.noise(1,{period:13,volume:7,envelope:true});ay.setVolume(2,0);ay.setEnvelope({period:333,shape:10});
    opll.setPreset(0,{userPatch:{feedback:3,operators:[{mul:2,tl:24},{mul:1}]},attenuation:6});opll.noteOn(0,'E4');opll.setVoice(8,{instrument:7,attenuation:4});opll.noteOn(8,'A4');
    await ay.setClock(2000000);await opll.setClock(4000000);
    await mixer.set(ay.id,{volume:.3,pan:-.2});await mixer.set(opll.id,{volume:.7,pan:.1});
    globalThis.msxNativeResult={ayClock:ay.clock,opllClock:opll.clock,fmType:typeof fm,psgType:typeof psg};
  `);
  await f.synth.flush();assert.deepEqual(globalThis.msxNativeResult,{ayClock:2000000,opllClock:4000000,fmType:'undefined',psgType:'undefined'});assert.equal(f.ay.registers[6],13);assert.equal(f.ay.registers[9],23);assert.equal(f.opll.registers[0]&15,2);assert.equal(f.opll.registers[0x38],0x74);assert(f.opll.registers[0x28]&16);
  assert.equal(f.synth.fm,null);assert.equal(f.synth.psg,null);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);assert.equal(f.synth.ay,f.synth.ay8910);assert.equal(f.synth.opll,f.synth.ym2413);
  assert.deepEqual(f.synth.mixer.list().filter(c=>c.connected).map(c=>c.id),['ym2413','ay8910']);assert.deepEqual(f.synth.chipInspector.list().map(c=>c.id),['ym2413','ay8910']);
  await runtime.stopWithFade();assert.deepEqual(f.ay.registers.slice(8,11),[0,0,0]);assert.equal(f.ay.registers[6],13);assert.deepEqual(f.ay.registers.slice(11,14),[77,1,10]);assert.deepEqual(f.synth.ay._getState().levels,[6,23,0]);assert.equal(f.opll.registers[0]&15,2);assert.equal(f.opll.registers[0x38],0x74);assert.equal(f.opll.registers[0x28]&16,0);assert.deepEqual(f.errors,[]);
});

test('Native MSX real Worker bridge preserves register metadata, timing, shared envelope and Stop',async()=>{
  const f=fixture();await f.synth.start();f.commands.length=0;const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);assert(bridge.ay8910Port);assert(bridge.ym2413Port);assert.equal(bridge.segapsgPort,null);
    const observed=[],endpoints=[{name:'ym2413',globalName:'opll',port:bridge.ym2413Port,state:f.synth.opll._getState()},{name:'ay8910',globalName:'ay',port:bridge.ay8910Port,state:f.synth.ay._getState()}],worker=createNativeWorkerApis(endpoints,sender,(name,state)=>{observed.push({name,state});(name==='ay'?f.synth.ay:f.synth.opll)._adoptState(state);});
    worker.apis.ay.noise(0,{period:12,volume:7,envelope:true});worker.apis.ay.setEnvelope({period:100,shape:10});worker.apis.ay.setEnvelope({shape:10});worker.apis.ay.keyOff(0);worker.apis.ay.setVolume(1,0);worker.apis.opll.setVoice(8,{instrument:7,attenuation:4});worker.apis.opll.noteOn(8,'A4');
    await worker.apis.ay.setClock(2000000);await worker.apis.opll.setClock(4000000);assert.equal(f.ay.registers[6],12);assert.equal(f.ay.registers[8],0);assert.equal(f.ay.levels[0],23);assert.equal(f.ay.levels[1],0);assert.equal(f.opll.registers[0x38],0x74);assert(f.opll.registers[0x28]&16);
    const writes=f.commands.filter(c=>c.type==='msx'&&['write','set-retained-level'].includes(c.message.method));assert(writes.every(c=>c.frame===12000&&c.performance===clock.session&&c.owner>0));assert.equal(writes.filter(c=>c.message.chip==='ay8910'&&c.message.register===13).length,2);assert(observed.some(e=>e.name==='ay'&&e.state.levels[1]===0));
    await worker.stop();assert.deepEqual(f.ay.registers.slice(8,11),[0,0,0]);assert.equal(f.opll.registers[0x28]&16,0);assert.equal(f.ay.registers[6],12);assert.equal(f.opll.registers[0x38],0x74);assert.deepEqual(f.errors,[]);
  }finally{host.stop();await bridge.dispose();await f.synth.close();}
});
