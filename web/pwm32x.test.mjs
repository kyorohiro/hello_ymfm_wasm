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
test('shared factory creates WASM PCM without an audio device; abort/dispose validate', async () => {
  const p=await createSoundChip('pwm',{clock:1000,sampleRate:1000});p.write(0,5);p.write(1,5);p.write(4,3072);
  assert.equal(p.backend,'wasm');
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

// The previous renderer is an independent reference for the scalar hot path.
// It deliberately retains the public output() pair allocation on every slice.
function renderWithOutputPairs(chip, frames) {
  const left = new Float32Array(frames), right = new Float32Array(frames);
  const cyclesPerFrame = chip.clock / chip.rate;
  for (let frame = 0; frame < frames; frame++) {
    let remaining = cyclesPerFrame, l = 0, r = 0;
    while (remaining > 0) {
      const duration = chip.active() ? Math.min(remaining, chip.untilTick) : remaining;
      const [a, b] = chip.output();
      l += a * duration; r += b * duration; remaining -= duration;
      if (chip.active()) {
        chip.untilTick -= duration;
        if (chip.untilTick <= 0) {chip.tick(); chip.untilTick = chip.cycle - 1;}
      }
    }
    left[frame] = l / cyclesPerFrame; right[frame] = r / cyclesPerFrame;
  }
  return {left, right};
}

for (const outputMode of ['dac', 'duty']) for (const sampleRate of [44100,48000]) {
  test(`scalar ${outputMode} renderer retains exact PCM, FIFO and timer phase at ${sampleRate} Hz`, () => {
    const actual = new PWM32X({outputMode,sampleRate}), reference = new PWM32X({outputMode,sampleRate});
    const both = callback => {callback(actual); callback(reference);};
    const render = frames => {
      assert.deepEqual(actual.generateStereo(frames),renderWithOutputPairs(reference,frames));
      for (const key of ['left','right','untilTick','timerTick','interruptCount','leftFifo','rightFifo']) {
        assert.deepEqual(actual[key],reference[key],key);
      }
      assert.deepEqual(actual.output(),reference.output(),'public output pairs remain unchanged');
    };
    render(128); // An unused Genesis Full endpoint still advances normally.
    both(chip => {chip.write(0,0x305); chip.write(1,700); for (const v of [256,2048,3072,4095]) chip.write(4,v);});
    for (const frames of [0,1,2,127,128,257]) render(frames);
    both(chip => {chip.write(0,0x20a); chip.write(2,4095); chip.write(3,0); chip.write(1,17); chip.write(2,1024); chip.write(3,3584);});
    render(129); // Crossed stereo routes and multiple native ticks per frame.
    both(chip => {chip.muted = true; chip.write(4,2048);});
    render(73); // Muting must consume FIFO entries and advance IRQ cadence.
    both(chip => {chip.muted = false; chip.clock = 12000000; chip.write(0,0); chip.write(4,512);});
    render(91); // Disabled routing holds its last sample without draining FIFO.
    both(chip => {chip.write(0,5); chip.write(1,0); chip.write(4,1536);});
    render(129); // Cycle-zero interpretation and a changed clock preserve phase.
  });
}

test('rendering avoids public output pair allocations while retaining owned output pairs', () => {
  const chip = new PWM32X();
  const output = chip.output.bind(chip);
  let outputCalls = 0;
  chip.output = () => {outputCalls++; return output();};
  chip.generateStereo(48000);
  chip.write(0,5); chip.write(1,700); chip.write(4,3072);
  chip.generateStereo(48000);
  assert.equal(outputCalls,0,'idle and active rendering never allocate an output() pair');
  const first = chip.output(), second = chip.output();
  assert.notEqual(first,second,'public output() still returns independently owned arrays');
  assert.deepEqual(first,second);
});
