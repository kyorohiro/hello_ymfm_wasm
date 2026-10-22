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
  const psg={clock:3579545,periods:[0,0,0],attenuations:[15,15,15,15],lastVolumes:[0,0,0,0],latched:0,mode:0,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000};
  const opll={clock:3579545,registers:Array(64).fill(0),status:0,irq:false,held:[],pendingCommands:[],sourceMuteMask:0,sampleRate:48000};
  const status=()=>({session:1,mode:'master-system',sampleRate:48000,frame:0,ymClock:opll.clock,psgClock:psg.clock,running:true});
  const snapshot=()=>({segapsg:structuredClone(psg),ym2413:structuredClone(opll),sampleRate:48000,frame:0,revision:commands.length});
  function stop(chip){if(chip==='segapsg')psg.attenuations.fill(15);else{for(let ch=0;ch<9;ch++)opll.registers[0x20+ch]&=239;opll.registers[14]&=224;}}
  function apply(m){const state=m.chip==='segapsg'?psg:opll;
    if(m.method==='batch'){for(const c of m.commands)apply({...c,chip:m.chip});return;}
    if(m.method==='write'){
      if(state===psg){const v=m.value,r=v&128?v>>4&7:m.psgRegister??psg.latched,ch=r>>1;psg.latched=r;if(r&1){psg.attenuations[ch]=v&15;if((v&15)!==15)psg.lastVolumes[ch]=v&15;}else if(r===6)psg.mode=v&7;else psg.periods[ch]=v&128?(psg.periods[ch]&1008)|(v&15):(psg.periods[ch]&15)|((v&63)<<4);}
      else opll.registers[m.register]=m.value;
    }else if(m.method==='clock')state.clock=m.hz;
    else if(m.method==='stop-voices')stop(m.chip);
    else if(m.method==='key-off'){if(state===psg)psg.attenuations[m.channel]=15;else if(m.channel<9)opll.registers[0x20+m.channel]&=239;else opll.registers[14]&=~(16>>(m.channel-9));}
    else if(m.method==='audition-key-on'){if(m.channel<9)opll.registers[0x20+m.channel]|=16;else opll.registers[14]|=16>>(m.channel-9);}
    else if(m.method==='reset'){if(state===psg){psg.periods.fill(0);psg.attenuations.fill(15);psg.lastVolumes.fill(0);psg.latched=psg.mode=0;}else opll.registers.fill(0);}
  }
  const invoke=async(command,args)=>{calls.push({command,args});
    if(command==='native_genesis_commands')for(const c of args.commands){commands.push(c);assert(!['write','psg-write','psg-stereo','reset','ym2608','ym2610b','x68000'].includes(c.type),'Master System has no hidden Genesis or unrelated chips');if(c.type==='master-system')apply(c.message);}
    if(command==='native_genesis_stop'){stop('segapsg');stop('ym2413');}
    if(command==='native_genesis_master_system_status')return snapshot();return status();
  };
  return {synth:new NativeGenesisSynth({mode:'master-system',invoke,now:()=>0,onError:e=>errors.push(e)}),calls,commands,errors,psg,opll,snapshot};
}

test('Native Master System Main borrows PSG/OPLL, supports all voices and retains patches on Stop',async t=>{
  const previous=globalThis.window;globalThis.window={};const f=fixture(),runtime=createPlaygroundRuntime({synth:f.synth,guardExecution:false});
  t.after(async()=>{await runtime.finalize();globalThis.window=previous;delete globalThis.smsNativeResult;});
  await runtime.playSource(`
    if(await useSoundChip('segapsg')!==psg||await useSoundChip('ym2413')!==opll)throw Error('Master System primary was not reused');
    psg.tone(PSG1,{note:'A4',attenuation:5});psg.tone(PSG3,{period:369,attenuation:7});psg.noise({type:'white',rate:'tone3',attenuation:9});
    opll.setPreset(0,{userPatch:{feedback:3,operators:[{mul:2,tl:24},{mul:1}]},attenuation:6});opll.noteOn(0,'E4');opll.setVoice(8,{instrument:7,attenuation:4});opll.noteOn(8,'A4');
    await psg.setClock(3000000);await opll.setClock(4000000);
    await mixer.set(psg.id,{volume:.3,pan:-.2});await mixer.set(opll.id,{volume:.7,pan:.1});
    globalThis.smsNativeResult={psgClock:psg.clock,opllClock:opll.clock,fmType:typeof fm,stereoEnabled:psg.stereoEnabled,stereoType:typeof psg.setStereo};
  `);
  await f.synth.flush();assert.deepEqual(globalThis.smsNativeResult,{psgClock:3000000,opllClock:4000000,fmType:'undefined',stereoEnabled:false,stereoType:'undefined'});assert.equal(f.psg.periods[2],369);assert.equal(f.psg.mode,7);assert.equal(f.opll.registers[0]&15,2);assert.equal(f.opll.registers[0x38],0x74);assert(f.opll.registers[0x28]&16);
  assert.equal(f.synth.fm,null);assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);assert.equal(f.synth.psg,f.synth.segapsg);assert.equal(f.synth.opll,f.synth.ym2413);
  assert.deepEqual(f.synth.mixer.list().filter(c=>c.connected).map(c=>c.id),['segapsg','ym2413']);assert.deepEqual(f.synth.chipInspector.list().map(c=>c.id),['segapsg','ym2413']);
  await runtime.stopWithFade();assert.equal(f.psg.mode,7);assert.equal(f.psg.periods[2],369);assert(f.psg.attenuations.every(v=>v===15));assert.equal(f.opll.registers[0]&15,2);assert.equal(f.opll.registers[0x38],0x74);assert.equal(f.opll.registers[0x28]&16,0);assert.equal(f.synth.psg._getState().attenuations[2],7);assert.deepEqual(f.errors,[]);
});

test('Native Master System real Worker ports preserve mono metadata, PSG latches, timing and Stop',async()=>{
  const f=fixture();await f.synth.start();f.commands.length=0;const bridge=createNativeGenesisWorkerBridge({synth:f.synth,MessageChannelClass:MessageChannel,onError:e=>f.errors.push(e)}),host=createPerformanceHost({getContext:()=>({currentTime:0,state:'running'})});
  try{
    const clock=await host.start([bridge.port],.25),sender=createPerformanceSender({leaseUntimed:true,now:()=>clock.performanceEpochMs});sender.configure(clock);assert(bridge.segapsgPort);assert(bridge.ym2413Port);
    const observed=[],endpoints=[{name:'segapsg',globalName:'psg',port:bridge.segapsgPort,stereoEnabled:f.synth.psg.stereoEnabled,state:f.synth.psg._getState()},{name:'ym2413',globalName:'opll',port:bridge.ym2413Port,state:f.synth.opll._getState()}],worker=createNativeWorkerApis(endpoints,sender,(name,state)=>{observed.push({name,state});(name==='psg'?f.synth.psg:f.synth.opll)._adoptState(state);});
    assert.equal(worker.apis.psg.stereoEnabled,false);assert.equal(worker.apis.psg.setStereo,undefined);
    worker.apis.psg.write(0x81);worker.apis.psg.write(0x25);worker.apis.psg.setAttenuation(0,6);worker.apis.psg.noise({type:'white',rate:'tone3',attenuation:8});worker.apis.opll.setVoice(8,{instrument:7,attenuation:4});worker.apis.opll.noteOn(8,'A4');
    await worker.apis.psg.setClock(3000000);await worker.apis.opll.setClock(4000000);assert.equal(f.psg.periods[0],0x251);assert.equal(f.psg.mode,7);assert.equal(f.opll.registers[0x38],0x74);assert(f.opll.registers[0x28]&16);
    const writes=f.commands.filter(c=>c.type==='master-system'&&c.message.method==='write');assert(writes.every(c=>c.frame===12000&&c.performance===clock.session&&c.owner>0));assert(writes.some(c=>c.message.chip==='segapsg'&&c.message.value===0x25&&c.message.psgRegister===0));assert(observed.some(e=>e.name==='psg'&&e.state.stereoEnabled===false));
    await worker.stop();assert(f.psg.attenuations.every(v=>v===15));assert.equal(f.opll.registers[0x28]&16,0);assert.equal(f.psg.periods[0],0x251);assert.equal(f.opll.registers[0x38],0x74);assert.deepEqual(f.errors,[]);
  }finally{host.stop();await bridge.dispose();await f.synth.close();}
});
