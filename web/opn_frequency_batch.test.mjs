import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {YM2612Synth, YM2612DirectTransport, YM2612WorkletTransport} from './ym2612synth.js';
import {YM2203Synth} from './ym2203synth.js';
import {YM2608Synth} from './ym2608synth.js';
import {YM2610BSynth} from './ym2610bsynth.js';
import {OPNWorkletTransport} from './opn_fm_synth.js';
import {createChipPortReceiver} from './playground_chip_port.js';
import {createPerformanceQueue, createPerformanceChipOwnership} from './playground_performance_queue.js';
import {createOpnAuditionGuard, receiveOpnAuditionCommand} from './playground_audition_guard.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {YM2612DacPlayer, receiveDacCommand} from './ym2612_dac.js';

const synths=[['YM2612',YM2612Synth],['YM2203',YM2203Synth],['YM2608',YM2608Synth],['YM2610B',YM2610BSynth]];
for(const [name,Synth] of synths){
  test(`${name}: frequency observers may change another channel after the latch pair commits`,()=>{
    for(const special of [false,true])for(const legacyObjectTransport of [false,true]){
      const writes=[],write=command=>writes.push(command);
      const transport=legacyObjectTransport?{write}:{write(port,register,value){write({port,register,value});}};
      const synth=new Synth({transport});writes.length=0;
      const high=special?0xad:0xa4,low=special?0xa9:0xa0;
      let reentered=false;
      synth.setHooks({onWrite({register}){
        if(register===high&&!reentered){
          assert.equal(writes.length,2,'both hardware writes precede the first notification');
          reentered=true;
          if(special)synth.setChannel3SpecialFrequency(1,6,0x6ab);
          else synth.setBlockFnum(1,6,0x6ab);
        }
      }});
      if(special)synth.setChannel3SpecialFrequency(0,2,0x234);
      else synth.setBlockFnum(0,2,0x234);
      assert.deepEqual(writes.map(({register,value})=>[register,value]),[
        [high,0x12],[low,0x34],[special?0xae:0xa5,0x36],[special?0xaa:0xa1,0xab],
      ]);
    }
  });
  test(`${name}: a throwing observer cannot leave a partial or pending frequency transaction`,()=>{
    const writes=[],synth=new Synth({transport:{write(port,register,value){writes.push({port,register,value});}}});
    writes.length=0;let fail=true;
    synth.setHooks({onWrite(){if(fail){fail=false;throw Error('observer failed');}}});
    assert.throws(()=>synth.setBlockFnum(0,2,0x234),/observer failed/);
    assert.equal(writes.length,2);
    synth.setBlockFnum(1,6,0x6ab);
    assert.deepEqual(writes.map(({register,value})=>[register,value]),[[0xa4,0x12],[0xa0,0x34],[0xa5,0x36],[0xa1,0xab]]);
  });
  test(`${name}: Main frequency pairs use one message, while raw writes and note off stay immediate`,()=>{
    const messages=[],node={port:{postMessage:data=>messages.push(data)}};
    const transport=name==='YM2612'?new YM2612WorkletTransport(node):new OPNWorkletTransport(node,{chipName:name,portCount:name==='YM2203'?1:2});
    const synth=new Synth({transport});messages.length=0;
    synth.setBlockFnum(0,2,0x234);
    assert.deepEqual(messages,[[{type:'write',port:0,register:0xa4,value:0x12},{type:'write',port:0,register:0xa0,value:0x34}]]);
    messages.length=0;synth.rawWrite(0,0x40,17);synth.keyOff(0);
    assert.deepEqual(messages,[{type:'write',port:0,register:0x40,value:17},{type:'write',port:0,register:0x28,value:0}]);
  });
}

for(const [name,Synth] of synths.slice(1))test(`${name}: an invalid operator field leaves all registers and shadow fields intact`,()=>{
  const writes=[],synth=new Synth({transport:{write(port,register,value){writes.push({port,register,value});}}});
  for(const params of [{dt:7,multi:999},{tl:10,ar:32},{rs:3,ar:32},{am:true,d1r:32},{sl:3,rr:16},[]]){
    const before=synth.getState();writes.length=0;
    assert.throws(()=>synth.setOperator(0,0,params));
    assert.deepEqual(writes,[]);assert.deepEqual(synth.getState(),before);
  }
  synth.setOperator(0,0,{multi:1});assert.deepEqual(writes,[{port:0,register:0x30,value:1}]);
});

function makeChip(writes){
  const address=[0,0];
  return {writeRegister(register,value,port=0){writes.push({port,register,value});},
    write(offset,value){const port=offset>>1;if(offset&1)this.writeRegister(address[port],value,port);else address[port]=value;},
    getIrq:()=>false,sampleRate:()=>53267};
}
async function processor(file){
  let Type;
  const scope={sampleRate:48000,currentFrame:0,Float32Array,Uint8Array,Uint32Array,
    createChipPortReceiver,createPerformanceQueue,createPerformanceChipOwnership,createOpnAuditionGuard,receiveOpnAuditionCommand,
    createProcessorPerformance:options=>createProcessorPerformance({...options,rate:48000,nowFrame:()=>scope.currentFrame}),
    YM2612DacPlayer,receiveDacCommand,
    // The common processor's core setup stays pending; the protocol test injects
    // a synchronous register recorder before sending the real transport packet.
    createSoundChipFactory:()=>()=>new Promise(()=>{}),
    Ym2612:{},Ym2608:{},Ay8910:{},Ym2413:{},Ym3526:{},Ym3812:{},Y8950:{},Ymf262:{},
    Ym2151:{},GameboyApu:{},SegaPSG:{},NesApuWasm:{},WonderSwan:{},Pokey:{},
    WonderSwanAudioEngine:{},PokeyAudioEngine:{},
    ym2612Factory:{},ym2608Factory:{},ay8910Factory:{},ym2413Factory:{},
    ym3526Factory:{},ym3812Factory:{},y8950Factory:{},ymf262Factory:{},
    ym2151Factory:{},gameboyFactory:{},psgFactory:{},nesFactory:{},wonderswanFactory:{},pokeyFactory:{},
    AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},
    registerProcessor(_name,value){Type=value;},
  };
  const source=(await readFile(new URL(file,import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  vm.runInNewContext(source,scope);
  const common=file==='soundchip-output-worklet.js';
  const p=common?new Type({processorOptions:{name:'ym2612',chipOptions:{}}}):new Type();
  const writes=[],chip=makeChip(writes);
  if(file.startsWith('ym2612-'))p.ym2612=chip;else p.chip=chip;
  return {p,writes};
}
for(const file of ['ym2612-worklet.js','ym2612-worklet-nuked.js','ym2203-worklet.js','ym2608-worklet.js','ym2610b-worklet.js','soundchip-output-worklet.js']){
  test(`${file}: Main atomic register packets and legacy single messages both apply in order`,async()=>{
    const {p,writes}=await processor(file);
    const node={port:{postMessage:data=>p.port.onmessage({data})}};
    const transport=file.startsWith('ym2612-')||file.startsWith('soundchip-')?new YM2612WorkletTransport(node):new OPNWorkletTransport(node,{chipName:'OPN',portCount:2});
    const pair=[{port:0,register:0xa4,value:0x12},{port:0,register:0xa0,value:0x34}];
    transport.writeBatch(pair);transport.write(0,0x28,0xf0);
    assert.deepEqual(writes,[...pair,{port:0,register:0x28,value:0xf0}]);
  });
}

test('immediate Main pairs do not drain or move timed Worker reservations',()=>{
  let frame=0;const applied=[];
  const apply=command=>applied.push({frame,...command});
  const queue=createPerformanceQueue({apply,nowFrame:()=>frame,sampleRate:48000});
  const receive=createChipPortReceiver(apply,()=>frame/48000,{performanceQueue:queue});
  const port={start(){},close(){},postMessage(){}};
  receive({type:'attach-chip-port',port});queue.receive({type:'performance-start',session:1});
  port.onmessage({data:{performance:{session:1,owner:'loop',time:16/48000},commands:[
    {type:'write',port:0,register:0xa5,value:0x36},{type:'write',port:0,register:0xa1,value:0xab},
  ]}});
  receive([{type:'write',port:0,register:0xa4,value:0x12},{type:'write',port:0,register:0xa0,value:0x34}]);
  assert.deepEqual(applied.map(({frame,register})=>[frame,register]),[[0,0xa4],[0,0xa0]]);
  frame=15;queue.advance();assert.equal(applied.length,2);
  frame=16;queue.advance();
  assert.deepEqual(applied.map(({frame,register})=>[frame,register]),[[0,0xa4],[0,0xa0],[16,0xa5],[16,0xa1]]);
  assert.equal(queue.getStats().lateCommands,0);
});

test('real YM2612 retains identical PCM when a write observer reenters another channel',async t=>{
  const {Ym2612}=await import('./ym2612.js');
  const factory=(await import('../docs/generated/ym2612_wasm.js')).default;
  const wasmBinary=await readFile(new URL('../docs/generated/ym2612_wasm.wasm',import.meta.url));
  const render=async nested=>{
    const chip=await Ym2612.create({moduleFactory:factory,moduleOptions:{wasmBinary}});t.after(()=>chip.dispose());
    const synth=new YM2612Synth({transport:new YM2612DirectTransport(chip)});
    synth.setPreset(0,{algorithm:7,pan:{left:true,right:true},operators:[{tl:127},{tl:127},{tl:127},{multi:1,tl:20,ar:31,d1r:0,d2r:0}]});
    let reentered=false;
    if(nested)synth.setHooks({onWrite({register}){if(register===0xa4&&!reentered){reentered=true;synth.setBlockFnum(1,6,0x6ab);}}});
    synth.setBlockFnum(0,2,0x234);synth.keyOn(0);return chip.generateStereo(4096);
  };
  const baseline=await render(false),nested=await render(true);
  assert.ok(baseline.left.some(sample=>Math.abs(sample)>.02));
  assert.deepEqual(nested,baseline);
});
