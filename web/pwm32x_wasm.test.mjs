import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PWM32X} from './pwm32x.js';
import {PWM32XPlayback,PWM_METHODS,createPWM32XClient} from './pwm32x_playback.js';
import {createSoundChip} from './soundchip.js';
import pwmFactory from './generated/pwm32x_wasm.js';
import {createProcessorPerformance} from './playground_performance_processor.js';
import {validateChipClock} from './playground_chip_clock.js';
import {receiveChipInspector,readPwmInspector} from './playground_chip_inspector_state.js';
import {createSoundChipFactory} from './soundchip_factory.js';
import {ChipPCMRenderer} from './chip_pcm_renderer.js';

const observed=['clock','rate','gain','outputMode','muted','control','cycle','cycleRegister','left','right','leftFifo','rightFifo','timerTick','interruptCount','untilTick'];
function compare(a,b) {for(const name of observed)assert.deepEqual(a[name],b[name],name);assert.deepEqual(a.output(),b.output());}

for(const outputMode of ['dac','duty'])for(const sampleRate of [32000,44100,48000,96000]) {
  test(`shared C++ PWM retains exact JS PCM, FIFO, IRQ and phase: ${outputMode} ${sampleRate}`,async()=>{
    const options={outputMode,sampleRate,gain:outputMode==='dac'?.4:1};
    const js=new PWM32X(options),wasm=await PWM32X.create(options);
    try {
      assert.equal(wasm.backend,'wasm');
      const both=fn=>{fn(js);fn(wasm);};
      const render=count=>{assert.deepEqual(wasm.generateStereo(count),js.generateStereo(count));compare(wasm,js);};
      render(128);
      for(const cycle of [0,1,2,17,700,4095])for(const routing of [0,5,10,15]) {
        both(chip=>{chip.write(0,0x300|routing);chip.write(1,cycle);for(const value of [0,2048,4095,65535])chip.write(4,value);});
        for(const frames of [0,1,2,31,128])render(frames);
      }
      both(chip=>{chip.clock=12000000;chip.gain=.35;chip.write(0,0x205);chip.write(1,1000);chip.write(2,8191);chip.write(3,-1);chip.muted=true;});
      render(101);both(chip=>{chip.muted=false;});render(129);
      both(chip=>{chip.leftFifo=[2000,3000];chip.rightFifo=[1000];chip.tick();chip.configureTimer();});compare(wasm,js);render(27);
      both(chip=>{chip.reset();chip.write(0,5);chip.write(1,700);const fifo=chip.leftFifo;fifo.push(3000);chip.write(2,2000);assert.equal(fifo.length,2);chip.tick();assert.equal(fifo.length,1);});compare(wasm,js);
      const jsState=js.saveState(),wasmState=wasm.saveState();
      render(73);js.loadState(jsState);wasm.loadState(wasmState);render(73);
      // Configuration is intentionally outside opaque chip/timer snapshots.
      both(chip=>{chip.clock=8000000;chip.gain=.5;chip.muted=true;});
      js.loadState(jsState);wasm.loadState(wasmState);compare(wasm,js);render(71);
    } finally {js.dispose();wasm.dispose();}
  });
}

test('PWM async factories report loading errors and JS must be explicitly selected',async()=>{
  const chip=await createSoundChip('pwm'),js=await createSoundChip('pwm',{implementation:'js'});
  try {assert.equal(chip.backend,'wasm');assert.equal(js.backend,'javascript');}
  finally {chip.dispose();js.dispose();}
  const failure=new Error('PWM fixture loader failure');
  await assert.rejects(PWM32X.create({moduleFactory:()=>{throw failure;}}),error=>error===failure);
  await assert.rejects(createSoundChip('pwm',{implementation:'other'}),/implementation/);
  await assert.rejects(PWM32X.create({signal:AbortSignal.abort()}),/abort/i);
  await assert.rejects(PWM32X.create({clock:0}),/clock/);
  await assert.rejects(PWM32X.create({sampleRate:0}),/sample rate/);
  await assert.rejects(PWM32X.create({gain:5}),/gain/);
});

test('only Native PWM clients expose a stop-voices RPC',async()=>{
  const makePort=()=>({messages:[],start(){},close(){},postMessage(message){this.messages.push(message);if(message.id!==undefined)queueMicrotask(()=>this.onmessage({data:{id:message.id}}));}});
  const nativePort=makePort(),browserPort=makePort(),native=createPWM32XClient(nativePort,{native:true}),browser=createPWM32XClient(browserPort);
  try {
    assert.equal(browser.stopVoices,undefined);await native.stopVoices();
    assert.equal(nativePort.messages.at(-1).method,'stopVoices');
  } finally {native.dispose();browser.dispose();}
});

test('WASM PWM scratch renders reuse allocations and snapshots remain owned and instance-bound',async()=>{
  const a=await PWM32X.create(),b=await PWM32X.create();
  try {
    a.write(0,5);a.write(1,700);a.write(4,3072);
    const state=a.saveState(),owned=a.generateStereo(128),savedOwned=owned.left.slice(),expected=a.generateStereo(128);
    a.loadState(state);assert.deepEqual(a.generateStereo(128),owned);assert.deepEqual(a.generateStereo(128),expected);
    assert.throws(()=>b.loadState(state),/Incompatible/);
    let allocations=0;const malloc=a.module._malloc;a.module._malloc=bytes=>{allocations++;return malloc(bytes);};
    const left=new Float32Array(128),right=new Float32Array(128);
    a.generateStereo=()=>{throw Error('owned PCM is forbidden on the audio path');};
    const views=a.views.size;
    for(let frames=1;frames<=128;frames++)a.renderInto(left,right,0,frames);
    assert.equal(allocations,0);assert.equal(a.views.size,views);
    a.reserveStereoFrames(1024);a.generateStereoView(1024);assert.deepEqual(owned.left,savedOwned,'owned PCM survives scratch buffer growth and later generation');
    assert.throws(()=>a.generateStereoView(-1),/frame/);
  } finally {a.dispose();a.dispose();b.dispose();}
  assert.throws(()=>a.renderInto(new Float32Array(1),new Float32Array(1)),/disposed/);
});

async function processorFixture(file) {
  let Processor,resolveReady,rejectReady;const messages=[],ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const Dummy={create:async()=>{throw Error('Unexpected non-PWM factory');}};
  const scope={sampleRate:48000,currentFrame:0,PWM32XPlayback,PWM_METHODS,pwmFactory,validateChipClock,
    receiveChipInspector,readPwmInspector,createSoundChipFactory,ChipPCMRenderer,
    AudioWorkletProcessor:class{constructor(){this.port={postMessage(data){messages.push(data);if(data.ready||data.type==='ready')resolveReady(data);if(data.error)rejectReady(Error(data.error));}};}},
    registerProcessor(_name,Type){Processor=Type;}};
  for(const name of ['Ym2612','Ym2608','Ay8910','Ym2413','Ym3526','Ym3812','Y8950','Ymf262','Ym2151','GameboyApu','SegaPSG','NesApuWasm','WonderSwan','Pokey','WonderSwanAudioEngine','PokeyAudioEngine','YM2612DirectTransport','YM2612DacPlayer'])scope[name]=Dummy;
  for(const name of ['ay8910Factory','ym2413Factory','ym3526Factory','ym3812Factory','y8950Factory','ymf262Factory','ym2612Factory','ym2608Factory','ym2151Factory','gameboyFactory','psgFactory','nesFactory','wonderswanFactory','pokeyFactory'])scope[name]=undefined;
  scope.createProcessorPerformance=options=>createProcessorPerformance({...options,rate:scope.sampleRate,nowFrame:()=>scope.currentFrame});
  const source=fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import .*;\n/gm,'');vm.runInNewContext(source,scope);
  const wasmBinary=fs.readFileSync(new URL('./generated/pwm32x_wasm.wasm',import.meta.url));
  const processor=new Processor({processorOptions:{name:'pwm',chipOptions:{},wasmBinary}});
  const state=await ready;assert.equal(state.backend,'wasm');
  return {processor,messages,scope,port:{postMessage:message=>messages.push(message)}};
}

for(const file of ['./playground_pwm_worklet.js','./soundchip-output-worklet.js']) {
  test(`${file}: actual WASM PWM preserves scheduled PCM without owned render buffers`,async()=>{
    const {processor,scope,port}=await processorFixture(file),reference=new PWM32XPlayback();
    const entries=[{frame:0,register:0,value:5},{frame:0,register:1,value:1047},
      {frame:7,register:2,value:700},{frame:7,register:3,value:350},{frame:151,register:4,value:600}];
    reference.scheduleWrites(entries);const expected=reference.generateStereo(512);
    const playback=processor.pwm??processor.chip;
    try {
      assert.equal(playback.backend,'wasm');
      let allocations=0;const malloc=playback.chip.module._malloc;playback.chip.module._malloc=bytes=>{allocations++;return malloc(bytes);};
      playback.generateStereo=playback.chip.generateStereo=()=>{throw Error('owned PCM is forbidden on the audio path');};
      processor.receive({method:'scheduleWrites',args:[entries]},port);
      if(file.includes('soundchip-output'))processor.receive({method:'start'},port);
      const left=new Float32Array(512),right=new Float32Array(512);
      for(let offset=0;offset<512;offset+=128){processor.process([],[[left.subarray(offset,offset+128),right.subarray(offset,offset+128)]]);scope.currentFrame+=128;}
      assert.deepEqual(left,expected.left);assert.deepEqual(right,expected.right);assert.equal(allocations,0);
      if(!file.includes('soundchip-output'))assert.equal(readPwmInspector(playback).currentFrame,512);
    } finally {processor.receive({method:'dispose'},port);reference.dispose();}
  });
}
