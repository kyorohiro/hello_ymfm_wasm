import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as immediate} from 'node:timers/promises';
import {YM2203RuntimeSynth} from './ym2203synth.js';
import {YM2608RuntimeSynth} from './ym2608synth.js';
import {YM2610BRuntimeSynth,NeoGeoSynth} from './ym2610bsynth.js';
import {createPlaygroundRuntime} from './playground_runtime.js';
import {createWorkerChip} from './playground_worker_chip.js';
import {FM_PRESETS} from './megasynth-fm-presets.js';

async function fixture(t,Synth,onMegaDriveEvent) {
  const previous = Object.fromEntries(['window','Worker','AudioWorkletNode','fetch'].map(name=>[name,globalThis[name]]));
  const nodes=[],workers=[],ports=[];
  const node=()=>({gain:{value:1,cancelScheduledValues() {},setValueAtTime(value) {this.value=value;},linearRampToValueAtTime(value) {this.value=value;}},connect() {},disconnect() {}});
  const context={state:'running',currentTime:0,destination:{},async resume() {},async close() {},
    addEventListener() {},removeEventListener() {},audioWorklet:{async addModule() {}},
    createGain:node,createChannelSplitter:node,createChannelMerger:node,
  };
  globalThis.window={addEventListener() {},removeEventListener() {},setTimeout};
  globalThis.fetch=async()=>({ok:true,async arrayBuffer() {return new ArrayBuffer(1);}});
  globalThis.AudioWorkletNode=class {
    constructor() {
      nodes.push(this);this.messages=[];this.workerWrites=[];
      const handlers=new Set();
      const reply=data=>queueMicrotask(()=>{for(const listener of handlers)listener({data});});
      this.port={start() {},close() {handlers.clear();},
        addEventListener(_type,listener) {handlers.add(listener);},removeEventListener(_type,listener) {handlers.delete(listener);},
        postMessage:message=>{
          this.messages.push(message);
          if(message.type==='initialize')reply({type:'ready'});
          if(message.type==='performance-start')reply({type:'performance-result',id:message.id});
          if(message.type==='attach-chip-port') {
            ports.push(message.port);message.port.onmessage=({data})=>this.workerWrites.push(...data);
            message.port.start();
          }
        },
      };
    }
    connect() {}disconnect() {}
  };
  const synth=new Synth({audioContext:context,rhythmRom:new Uint8Array(8192)});
  synth.audio.prepareNativeFX=async()=>null;
  globalThis.Worker=class {
    constructor() {this.messages=[];workers.push(this);}
    postMessage(message) {
      this.messages.push(message);
      if(message.type==='chip-port') {
        ports.push(message.port);
        this.primary=createWorkerChip({port:message.port,state:message.state,capabilities:synth.capabilities,
          observe:event=>this.onmessage?.({data:{type:'chip-observer',event}})});
      }
      if(message.type==='chip-state')this.primary.adoptState(message.state);
      if(message.type==='run')queueMicrotask(()=>this.onmessage?.({data:{type:'complete',loopCount:1}}));
      if(message.type==='stop')queueMicrotask(()=>this.onmessage?.({data:{type:'stopped'}}));
    }
    terminate() {}
  };
  const runtime=createPlaygroundRuntime({synth,guardExecution:false,onMegaDriveEvent});
  t.after(async()=>{
    await runtime.finalize();for(const port of ports)port.close();
    for(const [name,value] of Object.entries(previous)) {
      if(value===undefined)delete globalThis[name];else globalThis[name]=value;
    }
  });
  await runtime.playSource('',{execution:'worker'});
  await immediate();
  return {runtime,synth,node:nodes[0],worker:workers[0]};
}

for(const [name,Synth,physical] of [['ym2203',YM2203RuntimeSynth,0],['ym2608',YM2608RuntimeSynth,0],
  ['ym2610b',YM2610BRuntimeSynth,0],['ym2610',NeoGeoSynth,1]]) {
  test(`${name} UI edits update the running Worker once per turn without a UI callback or duplicated audio`,async t=>{
    const {synth,node,worker}=await fixture(t,Synth);
    worker.messages.length=0;node.messages.length=0;node.workerWrites.length=0;
    synth.fm.setPreset(0,FM_PRESETS['one-op-basic']);
    synth.fm.setAlgo(0,7,2);
    if(name!=='ym2203')synth.fm.setPan(0,true,false,2,4);
    synth.fm.setOperator(0,3,{tl:32});
    const raw=synth.fm.fm??synth.fm;
    raw.ssg.setMixer(0,{tone:true,noise:false});raw.ssg.setVolume(0,12);raw.ssg.keyOff(0);
    if(raw.rhythm)raw.rhythm.setVoice(0,{volume:19,left:true,right:false});
    if(raw.adpcmA)raw.adpcmA.setVoice(0,{volume:17,left:false,right:true});
    if(raw.adpcmB)raw.adpcmB.setVolume(180);else raw.adpcm?.setVolume(180);
    assert.equal(worker.messages.filter(message=>message.type==='chip-state').length,0,'snapshot waits for completed section shadows');
    await Promise.resolve();
    const snapshots=worker.messages.filter(message=>message.type==='chip-state');
    assert.equal(snapshots.length,1,'one completed snapshot coalesces the entire edit/preset burst');
    assert.equal(worker.primary.raw.channels[physical].feedback,2);
    assert.equal(worker.primary.raw.channels[physical].operators[3].tl,32);
    if(name!=='ym2203')assert.equal(worker.primary.raw.channels[physical].pms,4);
    assert.deepEqual(worker.primary.raw.ssg._getState(),raw.ssg._getState());
    if(raw.rhythm)assert.deepEqual(worker.primary.raw.rhythm.levels,raw.rhythm.levels);
    if(raw.adpcmA)assert.deepEqual(worker.primary.raw.adpcmA.levels,raw.adpcmA.levels);
    if(raw.adpcmB)assert.deepEqual(worker.primary.raw.adpcmB.registers,raw.adpcmB.registers);
    else if(raw.adpcm)assert.deepEqual(worker.primary.raw.adpcm.registers,raw.adpcm.registers);
    await immediate();
    assert.equal(node.workerWrites.length,0,'state adoption emits no extra chip writes');
    assert(node.messages.some(message=>message.type==='write'),'UI still sends its original audio writes');

    worker.messages.length=0;node.messages.length=0;node.workerWrites.length=0;
    worker.primary.fm.setAlgo(0,4,6);
    await immediate();
    assert.equal(raw.channels[physical].feedback,6,'Worker observations update the Main shadow');
    assert.equal(node.messages.filter(message=>message.type==='write').length,0,'observations never replay Worker audio through Main');
    assert.equal(node.workerWrites.filter(message=>message.type==='write').length,1,'the Worker emits only its own one register write');
    assert.equal(worker.messages.filter(message=>message.type==='chip-state').length,0,'observation does not echo a snapshot back to its Worker');
  });

  test(`${name} high-level listeners use completed Genesis event shapes and valid logical channels`,async t=>{
    const events=[];
    const {synth}=await fixture(t,Synth,event=>events.push(event));
    const raw=synth.fm.fm??synth.fm;
    let observed;
    const remove=synth.addListener(event=>{if(event.type==='setAlgo')observed=raw.getState();});
    events.length=0;synth.fm.setAlgo(0,5,3);
    assert.deepEqual(events,[{type:'setAlgo',channel:0,algorithm:5,feedback:3}]);
    assert.equal(observed.channels[physical].feedback,3,'callbacks observe committed shadow values');
    assert.throws(()=>synth.fm.setOperator(0,3,{tl:999}));
    assert.equal(events.length,1,'failed setters publish no completion event');
    remove();
  });
}
