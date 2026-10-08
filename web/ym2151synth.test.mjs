import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundChip} from './soundchip.js';
import {YM2151Synth, YM2151DirectTransport, YM2151WorkletTransport} from './ym2151synth.js';
import {FM_PRESETS} from './megasynth-fm-presets.js';
import {YM2151AudifyTransport} from '../node/chip_transports.mjs';

function capture() {
  const writes = [];
  const fm = new YM2151Synth({transport: {writeRegister: (r,v) => writes.push([r,v]), reset() {}}});
  writes.length = 0;
  return {fm, writes};
}
test('OPM presets map logical operator slots and key bits consistently', () => {
  const {fm, writes} = capture();
  fm.setPreset(7, {algorithm: 4, feedback: 3, operators: [{multi: 2}, {multi: 3}, {multi: 4}, {multi: 5}]});
  assert.deepEqual(writes, [[0x27,0xc4],[0x27,0xdc],[0x47,2],[0x57,3],[0x4f,4],[0x5f,5]]);
  for (let op=0;op<4;op++) {fm.keyOn(7,1<<op); assert.deepEqual(writes.at(-1),[8,7|(8<<op)]);}
  fm.noteOn(7, 'A4');assert.deepEqual(writes.slice(-3),[[0x2f,0x4a],[0x37,0],[8,0x7f]]);
  fm.noteOff(7);assert.deepEqual(writes.at(-1),[8,7]);
  assert.equal(fm.setNote(0,69),fm.setNote(0,'A4'));
  assert.equal(fm.setNote(0,'Db4'),fm.setNote(0,'C#4'));
  assert.deepEqual(fm.setFrequency(0,440),{keyCode:0x4a,keyFraction:0});
  fm.setPitch(0,0x4a,31);assert.deepEqual(writes.slice(-2),[[0x28,0x4a],[0x30,124]]);
});
test('OPM partial fields, pan, sensitivities and LFO preserve adjacent raw values', () => {
  const {fm,writes}=capture();
  fm.writeRegister(0x40,0x73);fm.setOperator(0,0,{multi:4});assert.deepEqual(writes.at(-1),[0x40,0x74]);
  fm.setOperator(0,0,{dt1:2,mul:3,ks:2,am:true,sr:5,d1l:4});
  assert.deepEqual(writes.slice(-6),[[0x40,0x24],[0x40,0x23],[0x80,0x9f],[0xa0,0x80],[0xc0,5],[0xe0,0x4f]]);
  fm.writeRegister(0x20,0x9c);fm.setPan(0,true,false,2,5);
  assert.deepEqual(writes.slice(-4),[[0x20,0xdc],[0x20,0x5c],[0x38,2],[0x38,0x52]]);
  fm.writeRegister(0x1b,0xc0);fm.setLFO({frequency:200,amDepth:64,pmDepth:32,waveform:2});
  assert.deepEqual(writes.slice(-4),[[0x18,200],[0x19,64],[0x19,160],[0x1b,0xc2]]);
  fm.setNoise(true,12);assert.deepEqual(writes.at(-1),[15,140]);
});
test('OPM validates a whole preset/note/LFO before any write', () => {
  const {fm,writes}=capture();
  for(const run of [
    ()=>fm.setPreset(0,{algorithm:4,operators:[{tl:20},{ar:32}]}),
    ()=>fm.setPreset(0,{operators:[{ssg:1}]}),
    ()=>fm.setOperator(0,0,{dt:1,dt1:2}),
    ()=>fm.setPan(0,true,'right'),()=>fm.setNote(8,'A4'),
    ()=>fm.noteOn(0,'C0'),()=>fm.noteOn(0,109),()=>fm.noteOn(0,'A4',{operatorMask:16}),
    ()=>fm.setPitch(0,1,64),()=>fm.setLFO({frequency:10,pmDepth:128}),
    ()=>fm.setNoise(true,32),()=>fm.setFrequency(0,NaN),()=>fm.setFrequency(0,1),
  ]) assert.throws(run);
  assert.equal(writes.length,0);
});
test('Direct OPM Synth: all channels and individual logical operators sound, pan and release', async () => {
  const chip=await createSoundChip('ym2151');const transport=new YM2151DirectTransport(chip);
  const fm=new YM2151Synth({transport});const rate=transport.sampleRate();
  try {
    for(let ch=0;ch<8;ch++)for(let op=0;op<4;op++){
      fm.reset();fm.setAlgo(ch,7);fm.setPan(ch,true,false);
      fm.setOperator(ch,op,{tl:24});fm.noteOn(ch,'A4',{operatorMask:1<<op});
      const {left,right}=transport.generateStereo(rate);
      assert.ok(left.some(v=>Math.abs(v)>.01),`ch${ch} op${op} silent`);
      assert.ok(right.every(v=>v===0));assert.ok(left.every(Number.isFinite));
      let crossings=0;for(let i=1;i<left.length;i++)if(left[i-1]<0&&left[i]>=0)crossings++;
      assert.ok(Math.abs(crossings-440)<5,`A4 ${crossings}`);
      fm.setPan(ch,false,true);const pan=transport.generateStereo(256);
      assert.ok(pan.left.every(v=>v===0));assert.ok(pan.right.some(v=>v!==0));
      fm.noteOff(ch);transport.generateStereo(rate);assert.ok(transport.generateStereo(128).right.every(v=>Math.abs(v)<.0001));
    }
    for(const preset of Object.values(FM_PRESETS)){
      fm.reset();fm.setPreset(0,preset);fm.noteOn(0,'C4');
      const pcm=transport.generateStereo(12000);assert.ok(pcm.left.every(Number.isFinite));
      assert.ok(pcm.left.some(v=>Math.abs(v)>.0001),preset.label);
    }
    fm.reset();assert.ok(transport.generateStereo(128).left.every(v=>v===0));
  }finally{chip.dispose();}
});
test('Direct and Worklet Synth issue identical commands; Audify shares Direct adapter', async () => {
  const messages=[];const worklet=new YM2151WorkletTransport({postMessage:x=>messages.push(x)});
  const remote=new YM2151Synth({transport:worklet});const {fm,writes}=capture();messages.length=0;
  for(const synth of [fm,remote]){synth.setPreset(0,FM_PRESETS.sine);synth.noteOn(0,'C4');synth.noteOff(0);}
  assert.deepEqual(messages.map(x=>x.args),writes);
  const chip=await createSoundChip('ym2151');const audify=new YM2151AudifyTransport(chip);
  try{assert.ok(audify instanceof YM2151DirectTransport);const synth=new YM2151Synth({transport:audify});synth.setPreset(0,FM_PRESETS.sine);synth.noteOn(0,'C4');assert.ok(audify.generateStereo(1024).left.some(v=>v!==0));}
  finally{await audify.close();chip.dispose();}
});
