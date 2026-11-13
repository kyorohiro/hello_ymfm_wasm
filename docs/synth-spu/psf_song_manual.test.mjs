// Transport-only tests. Fake audio time schedules numeric arrays; no device,
// browser, AudioContext or external PSF program is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPsfSongPreview} from './psf_song_preview.js';

const RATE=44100;
const source=()=>({records:new Map([['song.psf',{tags:new Map()}],['other.psf',{tags:new Map()}]])});
const settle=async check=>{for(let i=0;i<100;i++){if(check())return;await Promise.resolve();}throw Error('Pending transport did not settle');};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
function machine({manual=true}={}) {
  let frame=0,disposals=0;
  const channels=Array.from({length:24},(_,channel)=>({channel,volumeLeft:1,volumeRight:.5,pitch:4096,gate:true}));
  const actions=[],renders=[],observations=[],ramCopies=[],writes=[],leases=new Map();
  const core={sampleRate:RATE,channels,actions,renders,observations,ramCopies,writes,leases,
    get frame(){return frame;},get disposals(){return disposals;},
    render(frames){const start=frame,pcm=new Float32Array(frames*2),voice=channels[7];
      for(let i=0;i<frames;i++){pcm[i*2]=voice.gate?voice.volumeLeft:0;pcm[i*2+1]=voice.gate?voice.volumeRight:0;}
      frame+=frames;renders.push({start,frames});return pcm;},
    observe(){observations.push(frame);return {nativeFrames:frame,observation:{kind:'psf',nativeFrames:frame},channels:structuredClone(channels)};},
    copySpuRam(){ramCopies.push(frame);return new Uint8Array(524288);},
    dispose(){disposals++;},
    cpuGate(channel,value){channels[channel].gate=value;for(const [id,lease]of leases)if(lease.channel===channel)leases.delete(id);},
  };
  if(manual)core.manual={
    edit(channel,patch){
      if(!Number.isInteger(channel)||channel<0||channel>=24)throw new RangeError('channel');
      if(!patch||typeof patch!=='object'||Object.keys(patch).some(key=>!['volumeLeft','volumeRight','pitch','envelope'].includes(key)))throw new TypeError('patch');
      if(Object.values(patch).some(value=>typeof value==='number'&&!Number.isFinite(value)))throw new RangeError('value');
      actions.push(['edit',channel,structuredClone(patch)]);Object.assign(channels[channel],patch);writes.push(['edit',channel]);return patch;
    },
    noteOn(id,channel,midi,options={}){
      actions.push(['on',id,channel,midi,structuredClone(options)]);
      const stolen=[...leases].find(([,value])=>value.channel===channel)?.[0]??null;if(stolen)leases.delete(stolen);
      channels[channel].gate=true;leases.set(id,{channel});writes.push(['on',channel]);
      return {id,channel,stolenId:stolen,pitch:channels[channel].pitch,noise:false};
    },
    noteOff(id){actions.push(['off',id]);const lease=leases.get(id);if(!lease)return false;
      leases.delete(id);channels[lease.channel].gate=false;writes.push(['off',lease.channel]);return true;},
    setPitchBend(value){actions.push(['bend',value]);return leases.size>0;},
    releaseAll(){actions.push(['release']);const had=leases.size>0;
      for(const {channel}of leases.values()){channels[channel].gate=false;writes.push(['off',channel]);}leases.clear();return had;},
    describe(channel){actions.push(['describe',channel]);return {playable:true,reason:'',channel,pitch:channels[channel].pitch,noise:false,hardwarePmon:false};},
  };
  return core;
}
function harness(options={}) {
  const timers=new Map(),starts=[],machines=[],updates=[];let serial=0;
  const context={currentTime:0,state:'running',
    createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),
    createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return {length,sampleRate,getChannelData:ch=>data[ch]};},
    createBufferSource(){const node={buffer:null,stopped:false,connect(){},disconnect(){},stop(){this.stopped=true;},start(at,offset,duration){starts.push({node,at,offset,duration});}};return node;},
  },audio={context,gain:{authored:true},resume:async()=>{}};
  const controller=createPsfSongPreview({getAudio:()=>audio,createCore:async()=>{const core=machine();machines.push(core);return core;},
    schedule:callback=>{timers.set(++serial,callback);return serial;},cancel:id=>timers.delete(id),onUpdate:value=>updates.push(value),
    createOutput:()=>({fadeOut:async()=>true,open(){},dispose(){}}),chunkFrames:4,lookaheadSeconds:4/RATE,startDelaySeconds:0,yieldSeek:async()=>{},...options});
  controller.setSource(source(),'song.psf');
  return {controller,context,audio,machines,timers,starts,updates,
    advance:frames=>{context.currentTime+=frames/RATE;},
    pump(){const first=timers.entries().next().value;assert(first,'scheduled refill');timers.delete(first[0]);first[1]();}};
}
const pcm=start=>Array.from(start.node.buffer.getChannelData(0).slice(Math.round(start.offset*RATE),Math.round((start.offset+start.duration)*RATE)));

test('manual capability has no native calls or PCM changes until actual input',async()=>{
  const h=harness();try{
    assert.equal(h.controller.read().manualAvailable,false);
    await h.controller.play();const core=h.machines[0];
    assert.equal(h.controller.read().manualAvailable,true);assert.equal(h.controller.read().manualHeldCount,0);
    assert.deepEqual(core.actions,[]);assert.deepEqual(h.starts.flatMap(pcm),[1,1,1,1]);
    h.advance(2);h.controller.pause();await h.controller.resume();await h.controller.stop();
    assert.deepEqual(core.actions,[],'ordinary transport never invokes an idle manual adapter');
    assert.deepEqual(h.starts.slice(1).flatMap(pcm),[1,1,1,1,1,1]);
  }finally{await h.controller.dispose();}
});

test('manual edits take effect after scheduled PCM and their snapshot waits for its actual audible frame',async()=>{
  const h=harness({chunkFrames:2205,lookaheadSeconds:2205/RATE});try{
    await h.controller.play();const core=h.machines[0],first=h.starts[0],original=first.node.buffer.getChannelData(0).slice();
    const rendered=core.frame,renders=core.renders.length,copies=core.ramCopies.length;
    assert.deepEqual(h.controller.editVoice(7,{volumeLeft:.25}),{volumeLeft:.25});
    assert.equal(core.frame,rendered);assert.equal(core.renders.length,renders);assert.equal(core.ramCopies.length,copies);
    assert.equal(first.node.stopped,false);assert.deepEqual(first.node.buffer.getChannelData(0),original);
    assert.equal(h.controller.read().liveState.channels[7].volumeLeft,1,'future edited state is not shown as audible');
    for(let i=0;i<100;i++)h.controller.editVoice(7,{volumeLeft:.25});
    assert.equal(core.observations.length,1);assert.equal(core.ramCopies.length,1,'pointer traffic does not copy RAM per event');
    h.advance(2205);h.pump();
    assert.deepEqual(pcm(h.starts[1]),Array(2205).fill(.25));
    assert.deepEqual(core.observations,[0,2205]);assert.deepEqual(core.ramCopies,[0,2205]);
    assert.equal(h.controller.read().liveFrame,2205);assert.equal(h.controller.read().liveState.channels[7].volumeLeft,.25);
    assert.equal(h.controller.read().playing,true);assert.deepEqual(core.channels.filter((_,ch)=>ch!==7).map(v=>v.volumeLeft),Array(23).fill(1));
  }finally{await h.controller.dispose();}
});

test('frequent manual pointer changes retain the original 20 Hz observation and bounded RAM budget',async()=>{
  const h=harness({chunkFrames:2048,lookaheadSeconds:8192/RATE});try{
    await h.controller.play();const core=h.machines[0];
    for(let i=0;i<80;i++) {
      h.controller.editVoice(7,{volumeLeft:(i%10)/10});h.advance(1102);h.pump();
      assert(h.controller.read().liveBufferedSnapshots<=7,'lookahead retains its original bounded history');
    }
    assert.deepEqual(core.observations,Array.from({length:core.observations.length},(_,i)=>i*2205));
    assert.equal(core.observations.length,Math.ceil(core.frame/2205));
    assert.deepEqual(core.ramCopies,core.observations,'manual input does not add extra RAM snapshots');
    assert.equal(h.controller.read().playing,true);
  }finally{await h.controller.dispose();}
});

test('keyboard dispatch retains options, retires stolen IDs and never sends old key-up into a replacement core',async()=>{
  const h=harness();try{
    await h.controller.play();const core=h.machines[0],session=h.controller.read().manualSession;
    const options={referenceMidi:48,referencePitch:3072,bend:2},a=h.controller.noteOn('a',7,60,options);
    assert.equal(a.channel,7);assert.equal(a.manualSession,session);assert.equal(a.manualFrame,4);
    assert.deepEqual(core.actions.at(-1),['on','a',7,60,options]);
    assert.equal(h.controller.setPitchBend(3),true);assert.deepEqual(core.actions.at(-1),['bend',3]);
    const b=h.controller.noteOn('b',7,62);assert.equal(b.stolenId,'a');assert.equal(h.controller.read().manualHeldCount,1);
    const count=core.actions.length;assert.equal(h.controller.noteOff('a'),false);assert.equal(core.actions.length,count);
    assert.equal(h.controller.noteOff('b'),true);assert.equal(h.controller.read().manualHeldCount,0);
    h.controller.noteOn('old',7,60);h.controller.setSource(source(),'other.psf');await h.controller.play();
    const replacement=h.machines[1];assert.notEqual(h.controller.read().manualSession,session);
    assert.equal(h.controller.noteOff('old'),false);assert.deepEqual(replacement.actions,[]);
    assert.equal(core.disposals,1);
  }finally{await h.controller.dispose();}
});

test('Pause releases only the remaining hand owner at render head and resumes the exact retained PCM',async()=>{
  const h=harness();try{
    await h.controller.play();const core=h.machines[0];
    h.controller.noteOn('hand',7,60);h.advance(2);const before=h.controller.read(),renders=core.renders.slice();
    assert.equal(h.controller.pause(),true);const frozen=h.controller.capturePaused();
    assert.equal(h.controller.read().positionSeconds,before.positionSeconds);assert.equal(h.controller.read().manualAvailable,false);
    assert.deepEqual(core.actions.at(-1),['release']);assert.equal(core.channels[7].gate,false);
    assert.deepEqual(core.renders,renders);assert.equal(h.controller.read().manualHeldCount,0);
    assert.equal(h.controller.noteOff('hand'),false);assert.equal(h.controller.setPitchBend(0),false);
    assert.deepEqual(h.controller.capturePaused(),frozen);
    await h.controller.resume();assert.deepEqual(h.starts.slice(1).flatMap(pcm),[1,1,0,0,0,0]);
    assert.equal(h.controller.read().playing,true);
    h.controller.noteOn('new-hand',7,60);core.cpuGate(7,true);const writes=core.writes.length;
    h.controller.releaseManual();assert.equal(core.writes.length,writes,'CPU replacement survives releaseAll');assert.equal(core.channels[7].gate,true);
  }finally{await h.controller.dispose();}
});

test('channel and Live changes release manual ownership without stopping CPU playback or touching unrelated gates',async()=>{
  const h=harness();try{
    await h.controller.play();const core=h.machines[0];
    h.controller.noteOn('a',7,60);h.controller.setLiveVoice(10);
    assert.equal(h.controller.noteOff('a'),false);assert.equal(core.channels[7].gate,false);assert.equal(core.channels[10].gate,true);
    h.controller.noteOn('b',10,60);h.controller.setLiveEnabled(false);
    assert.equal(h.controller.noteOff('b'),false);assert.equal(h.controller.read().playing,true);
    assert.equal(h.controller.read().liveState,null);assert.equal(core.channels[10].gate,false);
    assert(core.channels.filter((_,ch)=>![7,10].includes(ch)).every(v=>v.gate));
    assert.equal(core.disposals,0);assert(h.starts.every(item=>!item.node.stopped));
  }finally{await h.controller.dispose();}
});

test('unsupported engines and rejected edits leave the song, scheduled audio and accepted source intact',async()=>{
  const unsupported=machine({manual:false}),h=harness({createCore:async()=>unsupported});
  try{
    await h.controller.play();assert.equal(h.controller.read().manualAvailable,false);
    assert.match(h.controller.read().manualReason,/does not expose manual/);assert.equal(h.controller.describeVoice(7).playable,false);
    assert.throws(()=>h.controller.editVoice(7,{volumeLeft:.5}),/manual SPU controls/);
    assert.equal(h.controller.read().playing,true);assert.equal(h.controller.read().error,false);assert.equal(unsupported.disposals,0);
    assert(h.starts.every(item=>!item.node.stopped));
  }finally{await h.controller.dispose();}
  const valid=harness();try{
    await valid.controller.play();const core=valid.machines[0],before=core.channels.map(v=>({...v})),renders=core.renders.length;
    assert.throws(()=>valid.controller.editVoice(7,{startAddress:0x4000}),/patch/);
    assert.deepEqual(core.channels,before);assert.equal(core.renders.length,renders);assert.equal(valid.controller.read().error,false);
    valid.controller.pause();assert.throws(()=>valid.controller.noteOn('old',7,60),{name:'AbortError'});
    assert.throws(()=>valid.controller.describeVoice(24),RangeError);
  }finally{await valid.controller.dispose();}
});

test('seek cancellation retains the old route but retires its old manual lease before fresh input',async()=>{
  const gate=deferred(),h=harness({yieldSeek:()=>gate.promise});try{
    await h.controller.play();const original=h.machines[0];h.controller.noteOn('old',7,60);h.advance(2);
    const pending=h.controller.seek(100/RATE);await settle(()=>h.machines.length===2&&h.machines[1].renders.length>0);
    assert.equal(h.controller.read().manualAvailable,false);assert.equal(h.controller.read().manualHeldCount,0);
    assert.equal(h.controller.noteOff('old'),false);assert.deepEqual(original.actions.at(-1),['release']);
    await h.controller.cancelSeek();assert.equal(await pending,false);assert.equal(h.controller.read().playing,true);
    assert.equal(h.machines[0].disposals,0);assert.equal(h.machines[1].disposals,1);
    assert.equal(h.controller.noteOff('old'),false);assert.equal(h.controller.noteOn('new',7,61).channel,7);
    gate.resolve();
  }finally{gate.resolve();await h.controller.dispose();}
});
