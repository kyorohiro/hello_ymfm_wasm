import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {NativeGenesisSynth} from './native_genesis_synth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {PWM32XPlayback} from './pwm32x_playback.js';

const logicWorkerUrl=new URL('./playground_logic_worker.js',import.meta.url).href;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

// Execute the actual browser logic-worker module in an isolated Node Worker.
// Only its outer WorkerGlobalScope/message plumbing is adapted; the runtime,
// authoring APIs, performance sender and Native MessagePorts are production.
function installRealWorkers(t){
  const previous={Worker:globalThis.Worker,window:globalThis.window},workers=[];
  globalThis.window={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){}};
  globalThis.Worker=class {
    constructor(){
      this.messages=[];this.pending=[];this.ready=false;workers.push(this);
      this.worker=new NodeWorker(`
        const {parentPort}=require('node:worker_threads');
        globalThis.self=globalThis;
        globalThis.postMessage=(message,transfer)=>parentPort.postMessage(message,transfer);
        import(${JSON.stringify(logicWorkerUrl)}).then(()=>{
          parentPort.on('message',data=>self.onmessage({data}));
          parentPort.postMessage({testWorkerReady:true});
        }).catch(error=>{throw error;});
      `,{eval:true});
      this.worker.on('message',data=>{
        if(data.testWorkerReady){this.ready=true;for(const [message,transfer]of this.pending)this.worker.postMessage(message,transfer);this.pending=[];return;}
        this.messages.push(data);this.onmessage?.({data});
      });
      this.worker.on('error',error=>this.onerror?.({message:error.message}));
    }
    postMessage(message,transfer){if(this.ready)this.worker.postMessage(message,transfer);else this.pending.push([message,transfer]);}
    terminate(){this.terminated??=this.worker.terminate();return this.terminated;}
  };
  t.after(async()=>{for(const worker of workers)await worker.terminate();Object.assign(globalThis,previous);});
  return workers;
}

function fixture(mode){
  let session=0;const calls=[],errors=[],pwm=new PWM32XPlayback({sampleRate:48000});
  const canonical=mode==='genesis-full'?'32x':mode;
  const status=()=>({session,mode:canonical,engine:canonical.includes('nuked')?'nuked':'ymfm',sampleRate:48000,frame:0,ymClock:7670454,psgClock:3579545,rf5c164Clock:12500000,pwmClock:23011361,running:true});
  const invoke=async(command,args={})=>{calls.push({command,args});if(command==='native_genesis_start'){session++;return status();}
    if(command==='native_genesis_pwm_status')return {...pwm.getState(),registers:Array.from({length:5},(_,i)=>pwm.read(i)),lastSchedule:null};
    if(command==='native_genesis_commands')for(const c of args.commands)if(c.type==='pwm'){const m=c.message;if(m.method==='write')pwm.write(m.register,m.value);else if(m.method==='clock')pwm.setClock(m.hz);else if(m.method==='reset')pwm.reset();else if(m.method==='clear-schedule'||m.method==='stop-voices')pwm.clearSchedule();}
    return status();};
  const synth=new NativeGenesisSynth({mode,invoke,now:()=>0,onError:error=>errors.push(error)});
  const runtime=createPlaygroundRuntime({synth,guardExecution:false});
  return {runtime,synth,calls,errors,commands:()=>calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[])};
}

const source=`
  const [sharedFm,sharedPsg,againFm,againPsg]=await Promise.all([
    useSoundChip('ym2612'),useSoundChip('segapsg'),useSoundChip('ym2612',{}),useSoundChip('segapsg',{})
  ]);
  if(sharedFm!==fm||againFm!==fm||sharedPsg!==psg||againPsg!==psg)throw Error('Primary chip identity changed');
  if(sharedFm.id!=='ym2612'||sharedPsg.id!=='segapsg')throw Error('Primary mixer identity changed');
  if(sharedFm.dispose!==undefined||sharedPsg.dispose!==undefined)throw Error('Borrowed primary exposes dispose');
  if(context.fm&&context.fm!==sharedFm||context.psg&&context.psg!==sharedPsg)throw Error('Lookup recreated a primary on Run');
  context.fm=sharedFm;context.psg=sharedPsg;context.runs=(context.runs??0)+1;
  await mixer.set(sharedFm.id,{volume:.6,pan:-.25});await mixer.set(sharedPsg.id,{volume:.4,pan:.25});
  sharedPsg.setStereo(0x91);
  let rejected=false;try{sharedPsg.setStereo(256);}catch(error){rejected=true;}if(!rejected)throw Error('Invalid stereo mask was accepted');
  sharedFm.setPreset(CH1,FM_PRESETS['one-op-basic']);sharedFm.noteOn(CH1,'A4');sharedPsg.tone(PSG1,{note:'C4',attenuation:8});
`;

for(const mode of ['genesis','mega-cd','genesis-full','genesis-full-nuked','genesis-nuked'])test(`Native ${mode} Main and actual Worker borrow FM/PSG, preserve mixer IDs and reuse after Stop`,async t=>{
  const workers=installRealWorkers(t),f=fixture(mode);t.after(()=>f.runtime.finalize());
  for(const execution of ['main','worker']){
    const first=f.calls.length;
    await f.runtime.playSource(source,{execution});await f.synth.flush();
    for(let i=0;i<200&&!f.calls.slice(first).some(call=>call.command==='native_genesis_commands'&&call.args.commands.some(c=>c.type==='psg-write'&&c.value===0x98));i++)await tick();
    assert(f.calls.slice(first).some(call=>call.command==='native_genesis_commands'&&call.args.commands.some(c=>c.type==='psg-write'&&c.value===0x98)),execution+' borrowed PSG writes');
    assert(f.calls.slice(first).some(call=>call.command==='native_genesis_commands'&&call.args.commands.some(c=>c.type==='write'&&c.register===0x28&&(c.value&240))),execution+' borrowed FM writes');
    assert(f.calls.slice(first).some(call=>call.command==='native_genesis_commands'&&call.args.commands.some(c=>c.type==='psg-stereo'&&c.value===0x91)),execution+' borrowed PSG stereo');
    if(execution==='worker')assert(f.calls.slice(first).some(call=>call.command==='native_genesis_commands'&&call.args.commands.some(c=>c.type==='psg-stereo'&&c.value===0x91&&c.performance&&c.owner&&c.frame>0)),'Worker stereo must use the shared performance clock and owner');
    assert(!f.calls.slice(first).some(call=>call.command==='native_genesis_commands'&&call.args.commands.some(c=>c.type==='psg-stereo'&&c.value===256)),execution+' invalid stereo must not send');
    const session=f.synth.session;
    await f.runtime.playSource(source,{execution});await f.runtime.stopWithFade();
    await f.runtime.playSource(source,{execution});await f.runtime.stopWithFade();
    assert.equal(f.synth.session,session,'Run/Stop must keep the owning Native core');
    assert.equal(f.calls.filter(call=>call.command==='native_genesis_start').length,1,'Lookups must not create another Native core');
    assert.equal(f.calls.filter(call=>call.command==='native_genesis_shutdown').length,0,'Borrowed handles must not close their owner');
    assert.deepEqual(f.synth.mixer.get('ym2612'),{volume:.6,pan:-.25,muted:false,solo:false});
    assert.deepEqual(f.synth.mixer.get('segapsg'),{volume:.4,pan:.25,muted:false,solo:false});
    assert.equal(f.synth.audioContext,null);assert.equal(f.synth.node,null);
  }
  assert.equal(workers.length,1,'Stop/Run should reuse the actual logic Worker');
  assert(!workers[0].messages.some(message=>message.command==='pcm.create'||message.command==='pcm.dispose'),'Borrowed lookup must never allocate or retire an independent chip');
  assert(!workers[0].messages.some(message=>message.type==='execution-error'||message.type==='log'&&message.level==='error'));
  assert.deepEqual(f.errors,[]);
  await f.runtime.finalize();assert.equal(f.synth.session,null);assert.equal(f.calls.filter(call=>call.command==='native_genesis_shutdown').length,1);assert(workers[0].terminated,'Runtime finalization must terminate the actual Worker');
});
