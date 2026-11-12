import test from 'node:test';
import assert from 'node:assert/strict';
import {GameboySynth} from '../js/gameboysynth.js';
import {createDefaultPreset} from './preset.js';
import {gameboyCodeLiveView} from './code_live.js';

test('Live uses configured envelope after keyOff, preserves independent Pulse settings and excludes Sweep from CH2', () => {
  const synth=new GameboySynth({transport:{reset(){},writeRegister(){}}});synth.initialize();
  synth.pulse.setVoice(0,{duty:.125,volume:9,envelope:{direction:'up',period:3}});
  synth.pulse.setVoice(1,{duty:.75,volume:5,envelope:{direction:'down',period:7}});
  synth.pulse.setSweep({direction:'down',period:4,shift:2});
  synth.noteOn(0,'A4');synth.keyOff(0);synth.setPan(0,true,false);
  const original=createDefaultPreset(),before=structuredClone(original),snapshot=synth._getState();
  const first=gameboyCodeLiveView(snapshot,0,original),second=gameboyCodeLiveView(snapshot,1,original);
  assert.equal(snapshot.registers[2],0);assert.equal(first.preset.pulse.volume,9);
  assert.deepEqual(first.preset.pulse.envelope,{direction:'up',period:3});
  assert.equal(first.preset.pulse.duty,.125);assert.equal(first.preset.pulse.sweep.enabled,true);
  assert.equal(second.preset.pulse.duty,.75);assert.equal(second.preset.pulse.volume,5);
  assert.equal(second.preset.pulse.sweep.enabled,false);assert.equal(first.preset.pan.right,false);
  assert(Math.abs(first.frequency-440)<1);assert.match(first.readout,/Sent period/);
  assert.deepEqual(original,before,'observing never adopts the state into the saved preset');
});

test('Live unpacks real Wave RAM bytes and distinguishes Noise clock from musical pitch', () => {
  const synth=new GameboySynth({transport:{reset(){},writeRegister(){}}});synth.initialize();
  const wave=Array.from({length:32},(_,i)=>(i*3)%16);synth.wave.setWaveform(wave);synth.wave.setLevel(.25);
  synth.noise.setVoice({volume:13,divisor:6,shift:9,width:7,envelope:{direction:'down',period:2}});
  const snapshot=synth._getState(),result=gameboyCodeLiveView(snapshot,2);
  assert.deepEqual(result.preset.wave.samples,wave);assert.equal(result.preset.wave.level,.25);
  result.preset.wave.samples[0]=15;assert.equal(snapshot.registers[32],3);
  const noise=gameboyCodeLiveView(snapshot,3);
  assert.deepEqual(noise.preset.noise,{volume:13,divisor:6,shift:9,width:7,envelope:{direction:'down',period:2}});
  assert.equal(noise.frequency,null);assert.match(noise.readout,/Noise clock/);assert.doesNotMatch(noise.readout,/Hz/);
  assert.throws(()=>gameboyCodeLiveView(snapshot,4),RangeError);
  assert.throws(()=>gameboyCodeLiveView({...snapshot,voice:[0]},0),TypeError);
});
