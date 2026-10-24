import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeGenesisOpl} from './native_genesis_opl.js';
import {createNativeGenesisExtraOplEndpoint} from './native_genesis_extra_opl.js';

// IPC contract fixture. Real channel leases and PCM remain covered by Rust and
// C++/WASM tests; this checks JS selection, author caches and applied metadata.
function fixture(additional) {
  const commands=[],queue=[],held=new Map(),registers=Array(256).fill(0);
  let memorySize=0,revision=0,uploadRevision=0,readGate=null,clock=3579545;
  const state=()=>({chip:'y8950',channels:9,clock,registers:[...registers],status:0,irq:false,
    held:[...held.keys()],pendingCommands:[],layoutRevision:0,layoutPending:false,
    adpcmMemorySize:memorySize,adpcmMemoryRevision:revision,adpcmMemoryUploadRevision:uploadRevision});
  function apply(m) {
    if(m.method==='batch'){
      if(m.action==='off'&&held.get(m.channel)!==m.voice)return;
      for(const command of m.commands)apply(command);
      if(m.action==='on')held.set(m.channel,m.voice);
      if(m.action==='off')held.delete(m.channel);
    }else if(m.method==='write'){
      registers[m.register]=m.value;
      if(m.register===15)revision++;
    }else if(m.method==='adpcm-memory'){
      memorySize=Math.max(memorySize,m.address+m.bytes.length);uploadRevision=++revision;registers[7]=1;
    }else if(m.method==='adpcm-clear'){
      memorySize=0;uploadRevision=++revision;registers[7]=1;
    }else if(m.method==='key-off'){
      if(m.channel===23)registers[7]=(registers[7]&16)|1;
      else registers[0xb0+m.channel]&=223;
    }else if(m.method==='audition-key-on'){
      if(m.channel===23)registers[7]=0xa0|(registers[7]&16);
      else registers[0xb0+m.channel]|=32;
    }else if(m.method==='reset')registers.fill(0);
  }
  const synth={session:1,generation:1,clock:{sampleRate:48000},isReady:()=>true,
    frameAt:()=>0,enqueue(command){commands.push(command);queue.push(command);},
    async flush(){for(const entry of queue.splice(0))apply(entry.message);},
    async nativeRequest(_command,args){if(readGate)await readGate;return {y8950:state(),sampleRate:48000};},
    notifyLayout(){},emit(){},
  };
  const endpoint=additional?createNativeGenesisExtraOplEndpoint(synth,{kind:'y8950'}):createNativeGenesisOpl(synth,{chip:'y8950',msxAudio:true});
  return {endpoint,client:endpoint.client,synth,commands,registers,held,
    setReadGate:gate=>{readGate=gate;},cpuWrite:()=>{revision++;},
    setClock:value=>{clock=value;},state,
  };
}
const pcm=()=>({sampleRate:16000,channels:[Float32Array.from({length:512},(_,i)=>.3*Math.sin(i/8))]});
for(const additional of [false,true]) {
  const label=additional?'additional':'primary';
  test(`Native ${label} Y8950 UI sample loading bypasses script hooks and readback never writes`,async()=>{
    const f=fixture(additional);await f.endpoint.initialize();
    f.client._setAdpcmLifecycle({captureContext(){throw Error('UI borrowed a script owner');}});
    const sample=await f.endpoint.loadSample(pcm(),{address:64,name:'UI tone'});
    await f.endpoint.invoke('adpcm.setVolume',[180]);
    const before=f.commands.length,view=await f.endpoint.read();
    assert.equal(f.commands.length,before);assert.equal(view.adpcm.start,64);assert.equal(view.adpcm.end,sample.end);
    assert.equal(view.adpcm.waveformKnown,true);assert(view.adpcm.waveform.length>0);assert.equal(view.adpcm.sampleName,'UI tone');
    assert.equal(view.adpcm.volume,180);assert.equal(view.adpcm.playing,false);
    assert(f.commands.filter(c=>c.message.method==='batch').every(c=>c.message.channel===23));
    assert(f.commands.every(c=>c.message.group===undefined),'UI upload does not inherit a performance owner');
  });
  test(`Native ${label} Y8950 manual FM and ADPCM use separate channels and stale releases preserve replacements`,async()=>{
    const f=fixture(additional);await f.endpoint.initialize();await f.endpoint.loadSample(pcm());await f.endpoint.invoke('adpcm.setVolume',[160]);
    await f.endpoint.invoke('adpcm.setRepeat',[true]);
    await f.endpoint.invoke('auditionOn',[1,60,'fm']);
    await f.endpoint.invoke('auditionOn',['adpcm',60,'old']);
    assert.deepEqual((await f.endpoint.read()).held,[1,'adpcm']);
    await f.endpoint.invoke('auditionOn',['adpcm',72,'new']);
    const current=f.held.get(23);await f.endpoint.invoke('auditionOff',['adpcm','old']);
    assert.equal(f.held.get(23),current);assert.equal(f.registers[7],0xb0);assert.equal(f.registers[0xb1]&32,32);
    await f.endpoint.invoke('adpcm.setVolume',[70]);
    assert.equal(f.commands.at(-1).message.channel,23);assert.equal(f.commands.at(-1).message.action,'edit');
    await f.endpoint.invoke('auditionOff',['adpcm','new']);
    assert.equal(f.registers[7],17);assert.equal(f.registers[0xb1]&32,32);
    await f.endpoint.invoke('auditionAllOff');assert.deepEqual((await f.endpoint.read()).held,[]);
  });
  test(`Native ${label} Y8950 waveform becomes unknown after range or RAM changes, then refreshes on a new upload`,async()=>{
    const f=fixture(additional);await f.endpoint.initialize();const sample=await f.endpoint.loadSample(pcm());
    assert.equal((await f.endpoint.read()).adpcm.waveformKnown,true);
    await f.endpoint.invoke('adpcm.setSample',[{start:32,end:sample.end}]);assert.equal((await f.endpoint.read()).adpcm.waveformKnown,false);
    await f.endpoint.invoke('adpcm.setSample',[{start:0,end:sample.end}]);assert.equal((await f.endpoint.read()).adpcm.waveformKnown,true);
    f.cpuWrite();assert.equal((await f.endpoint.read()).adpcm.waveformKnown,false);
    await f.endpoint.loadSample(pcm());assert.equal((await f.endpoint.read()).adpcm.waveformKnown,true);
    await f.client.adpcm.clearMemory();assert.equal((await f.endpoint.read()).adpcm.memorySize,0);
  });
  test(`Native ${label} Y8950 UI decode rejects a changed connection and a cancelled selection`,async()=>{
    const f=fixture(additional);await f.endpoint.initialize();
    let release;const gate=new Promise(resolve=>release=resolve);f.setReadGate(gate);
    const abort=new AbortController(),pending=f.endpoint.loadSample(pcm(),{signal:abort.signal});
    const rejected=assert.rejects(pending,{name:'AbortError'});abort.abort();release();await rejected;
    assert(!f.commands.some(c=>c.message.method==='adpcm-memory'));
    f.setReadGate(null);const old=f.synth.generation;
    let resume;f.setReadGate(new Promise(resolve=>resume=resolve));
    const stale=f.endpoint.loadSample(pcm()),staleRejected=assert.rejects(stale,{name:'AbortError'});
    f.synth.generation=old+1;resume();await staleRejected;assert(!f.commands.some(c=>c.message.method==='adpcm-memory'));
  });
  test(`Native ${label} Y8950 upload ACK cannot bless a waveform modified by a subsequent CPU write`,async()=>{
    const f=fixture(additional);await f.endpoint.initialize();const flush=f.synth.flush;
    f.synth.flush=async()=>{const upload=f.commands.at(-1)?.message.method==='adpcm-memory';await flush();if(upload)f.cpuWrite();};
    await f.endpoint.loadSample(pcm());assert.equal((await f.endpoint.read()).adpcm.waveformKnown,false);
  });
  for(const phase of [4,5,6])test(`Native ${label} Y8950 detects a concurrent clock change during sample configuration read ${phase}`,async()=>{
    const f=fixture(additional);await f.endpoint.initialize();const request=f.synth.nativeRequest;let reads=0;
    f.synth.nativeRequest=async(...args)=>{if(++reads===phase)f.setClock(4000000);return request(...args);};
    await assert.rejects(f.endpoint.loadSample(pcm()),/clock changed/);
    assert.equal(f.registers[16]|f.registers[17]<<8,0,'a changed clock cannot install the old Delta-N or report success');
  });
}
