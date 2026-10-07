import test from 'node:test';
import assert from 'node:assert/strict';
import {PWM32X} from './pwm32x.js';
import {createSoundChip} from './soundchip.js';
import {SimplePwm} from './genesisaudioengine.js';
const make = () => {const p = new PWM32X({clock:1000,sampleRate:1000,gain:1}); p.write(0,5); p.write(1,5); return p;};
test('FIFO consumes on timer ticks, discards oldest on overflow, and holds on underrun', () => {
  const p = make(); for (const v of [2048,2560,3072,3584]) p.write(4,v);
  assert.equal(p.read(4),0x8000); assert.deepEqual(p.output(),[0,0]);
  assert.deepEqual([...p.generateStereo(4).left],[0,0,0,0]); assert.deepEqual(p.output(),[.25,.25]);
  assert.equal(p.read(4),0); p.generateStereo(8); assert.equal(p.read(4),0x4000); assert.deepEqual(p.output(),[.75,.75]);
  assert.ok([...p.generateStereo(20).left].every(v=>v===.75));
});
test('routing is strict, timer reconfiguration clears FIFOs, and cycle zero means 4095', () => {
  const p = make(); p.write(0,10);p.write(2,3072);p.write(3,1024);p.generateStereo(4);assert.deepEqual(p.output(),[-.5,.5]);
  p.write(4,2048);p.write(1,7);assert.equal(p.read(4),0x4000);
  p.write(1,0);assert.equal(p.read(1),0);assert.equal(p.cycle,4095);
  p.write(0,0);p.write(4,4095);p.generateStereo(20);assert.deepEqual(p.output(),[-.5,.5]);assert.equal(p.leftFifo.length,1);
});
test('render partitioning, fractional timer phase and state restoration are reproducible', () => {
  const setup=()=>{const p=new PWM32X({clock:23011361,sampleRate:48000});p.write(0,0x305);p.write(1,700);for(const v of [1024,2048,3072])p.write(4,v);return p;};
  const all=setup().generateStereo(20), p=setup(),parts=[p.generateStereo(3),p.generateStereo(7),p.generateStereo(10)];
  assert.deepEqual(Float32Array.from(parts.flatMap(v=>Array.from(v.left))),all.left);
  p.reset();p.write(0,5);p.write(1,500);p.write(4,3072);p.generateStereo(1);const state=p.saveState();const expected=p.generateStereo(12);p.loadState(state);assert.deepEqual(p.generateStereo(12),expected);
  assert.throws(()=>p.loadState(setup().saveState()),/Incompatible/);
});
test('mute preserves time and FIFO consumption; IRQ cadence counts native ticks', () => {
  const p=make();p.write(0,0x205);p.write(4,3072);p.muted=true;assert.ok(p.generateStereo(8).left.every(v=>v===0));
  assert.equal(p.interruptCount,1);assert.equal(p.read(4),0x4000);p.muted=false;assert.deepEqual(p.output(),[.5,.5]);
});
test('shared factory creates PCM without WASM or an audio device; abort/dispose validate', async () => {
  const p=await createSoundChip('pwm',{clock:1000,sampleRate:1000});p.write(0,5);p.write(1,5);p.write(4,3072);
  assert.ok(p.generateStereo(8).left.some(v=>v>0));p.dispose();assert.throws(()=>p.generateStereo(1),/disposed/);
  await assert.rejects(createSoundChip('pwm',{signal:AbortSignal.abort()}),/abort/i);
  assert.throws(()=>new PWM32X({clock:0}),/clock/);assert.throws(()=>make().generateStereo(-1),/frame/);
});

test('duty output matches VGM cycle normalization while raw MAME DAC output is preserved', () => {
  const duty = new PWM32X({clock:1000,sampleRate:1000,gain:1,outputMode:'duty'});
  const dac = new PWM32X({clock:1000,sampleRate:1000});
  const legacy = new SimplePwm();
  for (const p of [duty,dac,legacy]) {p.writeRegister(0,0x205);p.writeRegister(1,1047);}
  const levels=[];
  for (const value of [205,383,520]) {
    for (const p of [duty,dac,legacy]) {p.writeRegister(4,value);p.generateStereo?.(1046);}
    assert.ok(Math.abs(duty.output()[0]-legacy.output()[0])<1e-12);
    levels.push([duty.output()[0],dac.output()[0]]);
  }
  assert.ok((levels[2][1]-levels[0][1])/(levels[2][0]-levels[0][0]) < .11, 'raw DAC playback uses a much smaller PWM amplitude at this cycle');
  assert.throws(()=>new PWM32X({outputMode:'bad'}),/output mode/);
});
