import {PsgInspectorState,RfInspectorState,receiveChipInspector,rfSampleMetadata,readPwmInspector} from './playground_chip_inspector_state.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createProcessorPerformance,performanceNoteRelease} from './playground_performance_processor.js';
import {ChipClockResampler,CHIP_CLOCKS,validateChipClock} from './playground_chip_clock.js';
import {Ym2608Timeline} from './playground_ym2608_timeline.js';
import {RF5C164Synth} from './rf5c164synth.js';
import {PWM_METHODS} from './pwm32x_playback.js';
import {GameboyVoiceInspector,NesVoiceInspector} from './playground_native_voice_inspector.js';
import {Ym2151VoiceInspector} from './playground_ym2151_inspector.js';

async function setup(file) {
  let Type;const messages=[],rate=48000;
  const chip={value:0,clock:4000000,frame:0,sampleRate:()=>rate,
    reset(){this.value=0;},dispose(){this.disposed=true;},
    writeRegister(_register,value){this.value=value;},
    write(address,value){if(arguments.length===1)this.value=address;else if(address&1)this.value=value;},
    reserveStereoFrames(){},generateStereoView(frames){return this.generateStereo(frames);},
    generateStereo(frames){this.frame+=frames;return {left:new Float32Array(frames).fill(this.value),right:new Float32Array(frames).fill(this.value)};},
    getState(){return {currentFrame:this.frame};},loadMemory(){},loadAdpcmARom(){},
  };
  const engine={ym2608:chip,dispose(){chip.dispose();},writeYm2608(_p,_r,value){chip.value=value;},loadAdpcmARom(){},
    process(left,right){left.fill(chip.value);right.fill(chip.value);}};
  class SyncChip {constructor(){return chip;}static async create(){return chip;}}
  class Playback {constructor(){return Object.assign(chip,{write(_reg,value){this.value=value;}});}}
  const scope={Ym2151VoiceInspector,GameboyVoiceInspector,NesVoiceInspector,PsgInspectorState,RfInspectorState,receiveChipInspector,rfSampleMetadata,readPwmInspector,currentFrame:0,sampleRate:rate,ChipClockResampler,CHIP_CLOCKS,validateChipClock,Ym2608Timeline,RF5C164Synth,PWM_METHODS,
    NesApu:SyncChip,GameboyApu:SyncChip,SegaPSG:SyncChip,Ym2151:SyncChip,Ym2612:SyncChip,Ym2203:SyncChip,Ym2610B:SyncChip,Ym2608:SyncChip,Rf5c164:SyncChip,
    Ym2608AudioEngine:{create:async()=>engine},PWM32XPlayback:Playback,factory:{},ym2612Factory:{},ym2203Factory:{},ym2610Factory:{},ym2608Factory:{},ym2151Factory:{},gameboyFactory:{},psgFactory:{},
    createRf5c164Control:()=>({reset:()=>chip.reset(),writeRegister:(reg,value)=>chip.writeRegister(reg,value),dispose:()=>chip.dispose()}),
    createSoundChipFactory:()=>async()=>chip,ChipPCMRenderer:class{render(n){return chip.generateStereo(n);}renderInto(left,right,offset=0,frames=left.length-offset){const pcm=chip.generateStereo(frames);left.set(pcm.left,offset);right.set(pcm.right,offset);}resetHistory(){}},
    YM2612DirectTransport:class{},YM2612DacPlayer:class{},performanceNoteRelease,
    AudioWorkletProcessor:class{constructor(){this.port={postMessage:message=>messages.push(message)};}},registerProcessor(_name,Value){Type=Value;},
  };
  scope.createProcessorPerformance=options=>createProcessorPerformance({...options,rate,nowFrame:()=>scope.currentFrame});
  vm.runInNewContext(fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import .*;\n/gm,''),scope);
  const processor=new Type({processorOptions:{name:file.includes('soundchip-output')?'nes':'ym2612',rom:new Uint8Array(8192),wasmBinary:new ArrayBuffer(0)}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(chip.disposed,undefined,'initialization must succeed');
  const port={postMessage:message=>messages.push(message)};
  if(file.includes('soundchip-output'))processor.receive({method:'start'},port);
  processor.receive({type:'performance-start',session:1},port);
  return {processor,chip,messages,port,enqueue(command,at){processor.receive({performance:{session:1,owner:'loop',time:at/rate},commands:[command]},port);},
    render(frames){const output=[new Float32Array(frames),new Float32Array(frames)];const active=processor.process([],[output]);scope.currentFrame+=frames;return {output,active};}};
}

for(const[file,command]of[
  ['./playground_nes_worklet.js',{method:'writeRegister',args:[0x4000,1]}],
  ['./playground_gameboy_worklet.js',{method:'writeRegister',args:[0,1]}],
  ['./playground_segapsg_worklet.js',{method:'write',args:[1]}],
  ['./playground_ym2151_worklet.js',{method:'writeRegister',args:[0x40,1]}],
  ['./playground_opn_worklet.js',{method:'write',args:[0,0x40,1]}],
  ['./playground_ym2608_worklet.js',{method:'write',args:[0,0x40,1]}],
  ['./rf5c164-worklet.js',{method:'writeRegister',args:[0,1]}],
  ['./playground_pwm_worklet.js',{method:'write',args:[2,1]}],
  ['./soundchip-output-worklet.js',{method:'writeRegister',args:[0x4000,1]}],
]) {
  test(`${file}: accepted setter becomes audible at the exact future frame`,async()=>{
    const p=await setup(file);p.enqueue({...command,id:20},3);
    assert.equal(p.chip.value,0);assert(p.messages.some(message=>message.id===20&&!message.error));
    const{output}=p.render(8);assert.deepEqual([...output[0]],[0,0,0,1,1,1,1,1]);assert.deepEqual(output[1],output[0]);
    p.processor.receive({method:'dispose'},p.port);
  });
  test(`${file}: future disposal silences the remaining render segment`,async()=>{
    const p=await setup(file);p.enqueue(command,0);p.enqueue({method:'dispose'},4);
    assert.deepEqual([...p.render(8).output[0]],[1,1,1,1,0,0,0,0]);assert.equal(p.render(8).active,false);
  });
}

for(const [file,command,readValue,expected]of[
  ['./playground_segapsg_worklet.js',{method:'write',args:[0x96]},state=>state.channels[0].attenuation,6],
  ['./rf5c164-worklet.js',{method:'writeRegister',args:[0,77]},state=>state.channels[0].volume,77],
])test(`${file}: inspector reads applied values without flushing future lookahead writes`,async()=>{
  const p=await setup(file);
  const read=()=>{p.processor.receive({type:'chip-inspector',id:'inspect',action:'read'},p.port);return p.messages.at(-1).value;};
  const before=readValue(read());p.enqueue(command,5);
  assert.equal(readValue(read()),before,'scheduled values must not masquerade as applied register state');
  p.render(4);assert.equal(readValue(read()),before,'reading must not drain the performance queue');
  p.render(2);assert.equal(readValue(read()),expected);
  p.processor.receive({method:'dispose'},p.port);
});

test('generic PCM DAC starts at the actual intraquantum performance frame',async()=>{
  const p=await setup('./soundchip-output-worklet.js'),commands=[];
  p.processor.pcmDac={command:(command,frame)=>commands.push({command,frame}),advance(){},nextFrame:()=>Infinity};
  p.enqueue({type:'pcm-dac',command:{action:'play',name:'phrase'},id:30},3);
  assert.equal(commands.length,0);
  p.render(8);
  assert.deepEqual(commands,[{command:{action:'play',name:'phrase'},frame:3}]);
});

test('generic PCM DAC prepares resources and absolute schedules without a second lead',async()=>{
  const p=await setup('./soundchip-output-worklet.js'),commands=[];
  p.processor.pcmDac={command:(command,frame)=>commands.push({command,frame}),advance(){},nextFrame:()=>Infinity};
  for(const command of [{action:'load',name:'phrase'},{action:'remove',name:'old'},{action:'play',name:'phrase',when:2}])
    p.enqueue({type:'pcm-dac',command,id:40+commands.length},7200);
  assert.equal(commands.length,3);
  assert(commands.every(entry=>entry.frame===0));
  assert.equal(p.processor.performance.getStats().queuedCommands,0);
  assert.equal(p.messages.filter(message=>message.type==='pcm-dac-result').length,3);
});
