import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ymFactory from '../generated/ym2612_wasm.js';
import psgFactory from '../generated/segapsg_wasm.js';
import pcmFactory from '../generated/rf5c164_wasm.js';
import {GenesisAudioEngine} from '../js/genesisaudioengine.js';
import {PWM32X} from '../js/pwm32x.js';
import {installSynthSongOutputMix} from './synth_song_output_mix.js';
import {SYNTH_SONG_MIX_DEFAULTS} from './synth_song_mix_defaults.js?v=mix-source-1';
import {installPlaybackMixer} from '../vgm_analyzer/playback_mixer.js';

const bytes = Object.fromEntries(await Promise.all(['ym2612','segapsg','rf5c164'].map(async id =>
  [id, await readFile(new URL(`../generated/${id}_wasm.wasm`, import.meta.url))])));
const createEngine = (options={}) => GenesisAudioEngine.create({
  ym2612ModuleFactory:ymFactory, ym2612ModuleOptions:{wasmBinary:bytes.ym2612},
  segaPsgModuleFactory:psgFactory, segaPsgModuleOptions:{wasmBinary:bytes.segapsg},
  rf5c164Clock:12500000, rf5c164ModuleFactory:pcmFactory, rf5c164ModuleOptions:{wasmBinary:bytes.rf5c164},
  ...options,
});
const fm = (engine, channel=0, {pan=0xc0, csm=false}={}) => {
  const port = channel >= 3 ? 1 : 0, offset = channel % 3;
  for (const slot of [0,8,4,12]) {
    for (const [register,value] of [[0x30,1],[0x40,slot === 12 ? 24 : 16],[0x50,31],[0x60,3],[0x70,1],[0x80,0x26]]) {
      engine.writeYm2612(port, register+slot+offset, value);
    }
  }
  for (const [register,value] of [[0xb0,0x38],[0xb4,pan],[0xa4,0x22],[0xa0,0x69]]) engine.writeYm2612(port,register+offset,value);
  if (csm) {
    for (const [register,value] of [[0x24,254],[0x25,3],[0x27,0x85]]) engine.writeYm2612(0,register,value);
  } else engine.writeYm2612(0,0x28,0xf0 | (channel >= 3 ? 4 : 0) | offset);
};
const acRms = array => {
  const mean = array.reduce((sum,value)=>sum+value,0)/array.length;
  return Math.sqrt(array.reduce((sum,value)=>sum+(value-mean)**2,0)/array.length);
};
const nearStereo = (actual,expected,start=0) => {
  assert.deepEqual(actual.left.subarray(start),expected.left.subarray(start));
  assert.deepEqual(actual.right.subarray(start),expected.right.subarray(start));
};
const nearSourceStereo = (actual,expected,start=0) => {
  // Cancelling the existing engine trims crosses one Float32 buffer boundary.
  // Compare to an independently summed raw-source reference within rounding.
  for(const side of ['left','right'])for(let frame=start;frame<actual[side].length;frame++) {
    const error=Math.abs(actual[side][frame]-expected[side][frame]);
    assert(error<=1e-7+Math.abs(expected[side][frame])*2e-7,`${side} frame ${frame}: source gain error ${error}`);
  }
};
const volumeGroups = ['ym2612','psg','pcm'];
function psg(engine) {
  // Tone1 plus Tone3-clocked white noise exercise both PSG generators.
  for (const value of [0x85,0x12,0x94,0xc4,0x13,0xd6,0xe7,0xf5]) engine.writePsg(value);
}
function programAll(engine) {fm(engine);fm(engine,4,{pan:0x80});psg(engine);pcm(engine);}
function rawMix(engine, frames, gains=SYNTH_SONG_MIX_DEFAULTS) {
  const ym=engine.ym2612.generateStereo(frames),psg=engine.psg.generateStereo(frames),pcm=engine.pcm.generateStereo(frames);
  const pwm=engine.pwm.generateStereo?.(frames),held=pwm?null:engine.pwm.output();
  const result={left:new Float32Array(frames),right:new Float32Array(frames)};
  for(const side of ['left','right'])for(let frame=0;frame<frames;frame++) {
    // Direct source-domain sum, independent of GenesisAudioEngine's legacy
    // .9/.35 coefficients and of the output adapter's cancellation logic.
    result[side][frame]=(ym[side][frame]*gains.ym2612+
      psg[side][frame]*gains.psg+
      (pwm?pwm[side][frame]:held[side==='left'?0:1])*SYNTH_SONG_MIX_DEFAULTS.pwm+
      pcm[side][frame]*gains.pcm)*engine.getMasterVolume();
  }
  return result;
}

test('each real WASM chip uses absolute raw-source gains at 0/50/100/200/380 percent', async () => {
  for(const group of volumeGroups) {
    const engine=await createEngine(),reference=await createEngine(),mix=installSynthSongOutputMix(engine);
    try {
      for(const e of [engine,reference])({ym2612:fm,psg,pcm}[group])(e);
      const gains={ym2612:0,psg:0,pcm:0};
      for(const id of volumeGroups)mix.setGroupVolume(id,0);
      for(const gain of [0,.5,1,2,3.8]) {
        gains[group]=gain;assert.equal(mix.setGroupVolume(group,gain),gain);
        const actual=engine.processFrames(1153),expected=rawMix(reference,1153,gains);
        nearSourceStereo(actual,expected);
        if(gain===0)assert(actual.left.every(value=>value===0)&&actual.right.every(value=>value===0));
        else assert(acRms(actual.left)+acRms(actual.right)>.0001,`${group} remains audible at ${gain}`);
      }
    } finally {mix.dispose();engine.dispose();reference.dispose();}
  }
});

test('calibrated defaults and mixed-source gains match standalone source sums with fixed PWM calibration', async () => {
  const engine=await createEngine(),reference=await createEngine(),mix=installSynthSongOutputMix(engine);
  try {
    for(const e of [engine,reference]) {
      programAll(e);e.setMasterVolume(.7);
      e.writePwm(1,100);e.writePwm(2,54);e.writePwm(3,47);
    }
    nearSourceStereo(engine.processFrames(271),rawMix(reference,271));
    for(const gains of [
      {ym2612:1,psg:1,pcm:1},{ym2612:0,psg:1,pcm:1},
      {ym2612:.5,psg:1,pcm:1},{ym2612:1,psg:2,pcm:1},
      {ym2612:1,psg:1,pcm:3.8},{ym2612:3.8,psg:.5,pcm:2},
      {ym2612:0,psg:0,pcm:0},{ym2612:1,psg:1,pcm:1},
    ]) {
      for(const group of volumeGroups)mix.setGroupVolume(group,gains[group]);
      const actual=engine.processFrames(997),expected=rawMix(reference,997,gains);
      nearSourceStereo(actual,expected);
      if(volumeGroups.every(group=>gains[group]===0)) {
        assert(actual.left.some(value=>value!==0)&&actual.right.some(value=>value!==0),'PWM output remains independent of all three zero gains');
      }
    }
    mix.dispose();
    nearStereo(engine.processFrames(1709),reference.processFrames(1709));
  } finally {mix.dispose();engine.dispose();reference.dispose();}
});

test('Synth and VGM Analyzer share actual native mixed-source defaults and absolute gain units', async () => {
  const synth=await createEngine({pwmModel:'mame'}),analyzer=await createEngine({pwmModel:'mame'});
  const synthMix=installSynthSongOutputMix(synth),analyzerMix=installPlaybackMixer(analyzer,{
    kind:'ym2612',chips:['ym2612','psg','rf5c164','pwm'].map(id=>({id})),
  });
  const sourceIds={ym2612:'ym2612',psg:'psg',pcm:'rf5c164',pwm:'pwm'};
  try {
    assert.equal(synth.pwm.backend,'wasm');assert.equal(analyzer.pwm.backend,'wasm');
    for(const [group,id] of Object.entries(sourceIds))assert.equal(analyzerMix.get(id).gain,SYNTH_SONG_MIX_DEFAULTS[group]);
    for(const engine of [synth,analyzer]) {
      programAll(engine);engine.setMasterVolume(.8);
      engine.writePwm(0,5);engine.writePwm(1,100);engine.writePwm(2,61);engine.writePwm(3,43);
    }
    nearSourceStereo(synth.processFrames(1057),analyzer.processFrames(1057));
    for(const gains of [
      {ym2612:.5,psg:.5,pcm:.5},{ym2612:1,psg:1,pcm:1},
      {ym2612:2,psg:2,pcm:2},{ym2612:.5,psg:1,pcm:2},
    ]) {
      for(const group of volumeGroups) {
        synthMix.setGroupVolume(group,gains[group]);
        analyzerMix.set(sourceIds[group],{gain:gains[group]});
      }
      // Analyzer ramps its output controls over 5ms; the discarded 10ms
      // clocks both native engines equally before comparing settled units.
      synth.processFrames(533);analyzer.processFrames(533);
      nearSourceStereo(synth.processFrames(1997),analyzer.processFrames(1997));
      assert.equal(analyzerMix.get('pwm').gain,SYNTH_SONG_MIX_DEFAULTS.pwm,'PWM retains the same fixed calibration');
    }
  } finally {synthMix.dispose();synth.dispose();analyzer.dispose();}
});

test('zero output gain keeps every native clock/state advancing and restores raw-source continuation', async () => {
  const engine=await createEngine(),reference=await createEngine(),mix=installSynthSongOutputMix(engine);
  try {
    for(const e of [engine,reference])programAll(e);
    nearSourceStereo(engine.processFrames(701),rawMix(reference,701));
    for(const group of volumeGroups)mix.setGroupVolume(group,0);
    for(const count of [1,317,2003,557]) {
      for(const e of [engine,reference]) {
        e.writeYm2612(0,0xa4,0x24);e.writeYm2612(0,0xa0,0x72);
        e.writePsg(0x8b);e.writePsg(0x17);
        e.writeRf5c164(7,0xc3);e.writeRf5c164(2,0x52);e.writeRf5c164(3,4);
      }
      const silent=engine.processFrames(count);reference.processFrames(count);
      assert(silent.left.every(value=>value===0)&&silent.right.every(value=>value===0));
    }
    for(const group of volumeGroups)mix.setGroupVolume(group,1);
    nearSourceStereo(engine.processFrames(4097),rawMix(reference,4097,{ym2612:1,psg:1,pcm:1}));
    // Reset starts another song pass while retaining the host's gain settings.
    for(const group of volumeGroups)mix.setGroupVolume(group,.5);
    for(const e of [engine,reference]){e.reset();programAll(e);}
    nearSourceStereo(engine.processFrames(881),rawMix(reference,881,{ym2612:.5,psg:.5,pcm:.5}));
    mix.dispose();
    nearStereo(engine.processFrames(1231),reference.processFrames(1231));
  } finally {mix.dispose();engine.dispose();reference.dispose();}
});

test('boosted gains obey per-channel/full mute, retain source writes and unmute without restarting cores', async () => {
  const engine=await createEngine(),reference=await createEngine(),mix=installSynthSongOutputMix(engine),referenceMix=installSynthSongOutputMix(reference);
  try {
    for(const e of [engine,reference])programAll(e);
    // Retain the reference adapter's output masks while exposing its original
    // raw source buffers to the independent source-domain sum below.
    referenceMix.setGroupVolume('ym2612',.9);referenceMix.setGroupVolume('psg',.35);referenceMix.setGroupVolume('pcm',1);
    const gains={ym2612:3.8,psg:2,pcm:.5};
    for(const group of volumeGroups)mix.setGroupVolume(group,gains[group]);
    for(const ids of [
      ['ym2612:0','psg:2','psg:3','pcm:3'],
      [...Array.from({length:6},(_,ch)=>`ym2612:${ch}`),...Array.from({length:4},(_,ch)=>`psg:${ch}`),...Array.from({length:8},(_,ch)=>`pcm:${ch}`)],
      [],
    ]) {
      mix.setMutedChannels(ids);referenceMix.setMutedChannels(ids);
      for(const e of [engine,reference]) {
        e.writeYm2612(0,0xb4,0x47);e.writePsg(0xc7);e.writePsg(0x15);
        e.writeRf5c164(7,0xc3);e.writeRf5c164(1,0x80);e.writeRf5c164Memory(22,0x51);
      }
      const actual=engine.processFrames(2003),expected=rawMix(reference,2003,gains);
      nearSourceStereo(actual,expected);
      if(ids.length===18)assert(actual.left.every(value=>value===0)&&actual.right.every(value=>value===0),'all output mutes remain exact silence with boosts enabled');
    }
    for(const group of volumeGroups)mix.setGroupVolume(group,1);
    nearSourceStereo(engine.processFrames(3001),rawMix(reference,3001,{ym2612:1,psg:1,pcm:1}));
  } finally {mix.dispose();referenceMix.dispose();engine.dispose();reference.dispose();}
});

test('volume validation is atomic, emits no source writes and dispose restores optional wrappers', () => {
  const writes=[],returned={left:new Float32Array([.25,-.5]),right:new Float32Array([-.5,.25])};
  const generate=()=>({left:returned.left.slice(),right:returned.right.slice()});
  const engine={ym2612:{generateStereo:generate},psg:{generateStereo:generate},pcm:{generateStereo:generate},
    writeYm2612:(...args)=>writes.push(args),writeRf5c164:(...args)=>writes.push(args),reset(){}};
  const mix=installSynthSongOutputMix(engine);
  assert.equal(mix.setGroupVolume('ym2612',2),2);
  assert.equal(writes.length,0,'software gain never rewrites source registers');
  for(const [id,gain] of [['pwm',1],['unknown',1],['psg',-.1],['pcm',3.81],['ym2612',NaN],['ym2612',Infinity],['psg','2']]) {
    assert.throws(()=>mix.setGroupVolume(id,gain),/Invalid|range/);
  }
  assert.deepEqual(engine.ym2612.generateStereo(2).left,new Float32Array([.25*2/.9,-.5*2/.9]),'invalid updates leave the accepted absolute gain and trim cancellation in place');
  assert.deepEqual(engine.psg.generateStereo(2).left,returned.left);
  assert.deepEqual(engine.pcm.generateStereo(2).left,Float32Array.from(returned.left,value=>value*SYNTH_SONG_MIX_DEFAULTS.pcm));
  assert.deepEqual(returned.left,new Float32Array([.25,-.5]),'no native/retained source buffer is changed');
  mix.dispose();
  for(const chip of ['ym2612','psg','pcm'])assert.equal(engine[chip].generateStereo,generate);
  assert.throws(()=>mix.setGroupVolume('ym2612',1),/disposed/);
});

test('default output follows calibration; muted FM keeps feedback, EG, pitch and source pan writes advancing', async () => {
  const engine=await createEngine(), reference=await createEngine(), mix=installSynthSongOutputMix(engine);
  try {
    for (const e of [engine,reference]) {fm(e);fm(e,4,{pan:0x80});}
    nearSourceStereo(engine.processFrames(999),rawMix(reference,999));
    mix.setMutedChannels(['ym2612:0']);
    const muted=engine.processFrames(2000), audible=reference.processFrames(2000);
    assert(acRms(muted.right)<1e-7, 'CH1 pan output is suppressed; CH5 is left only');
    assert(acRms(audible.right)>0.001);
    for (const e of [engine,reference]) {
      e.writeYm2612(0,0xb4,0x47); // Changed pan + PMS must survive mute.
      e.writeYm2612(0,0xa4,0x24);e.writeYm2612(0,0xa0,0x69);
      e.processFrames(777);
    }
    mix.setMutedChannels([]);
    nearSourceStereo(engine.processFrames(4000),rawMix(reference,4000));
    const saved=reference.saveState();
    mix.dispose();
    nearStereo(engine.processFrames(111),reference.processFrames(111));
    assert(saved.byteLength>0);
  } finally {mix.dispose();engine.dispose();reference.dispose();}
});

test('CSM timers and manual source gates are not changed by output mute', async () => {
  const engine=await createEngine(), reference=await createEngine(), mix=installSynthSongOutputMix(engine);
  try {
    for (const e of [engine,reference]) fm(e,2,{csm:true});
    nearSourceStereo(engine.processFrames(800),rawMix(reference,800));
    mix.setMutedChannels(['ym2612:2']);
    const muted=engine.processFrames(3000);reference.processFrames(3000);
    assert(acRms(muted.left)<1e-7);
    assert.equal(engine.ym2612.readStatus(),reference.ym2612.readStatus());
    mix.setMutedChannels([]);
    nearSourceStereo(engine.processFrames(4000),rawMix(reference,4000));
  } finally {mix.dispose();engine.dispose();reference.dispose();}
});

test('CH6 DAC writes continue while muted and complete YM mute removes DC without stopping clocks', async () => {
  const engine=await createEngine(), reference=await createEngine(), mix=installSynthSongOutputMix(engine);
  try {
    for (const e of [engine,reference]) {e.writeYm2612(1,0xb6,0xc0);e.writeYm2612(0,0x2b,0x80);}
    mix.setMutedChannels(Array.from({length:6},(_,channel)=>`ym2612:${channel}`));
    for (const value of [4,200,81,240]) {
      for (const e of [engine,reference]) e.writeYm2612(0,0x2a,value);
      const muted=engine.processFrames(200);reference.processFrames(200);
      assert(muted.left.every(value=>value===0));assert(muted.right.every(value=>value===0));
    }
    mix.setMutedChannels([]);
    nearSourceStereo(engine.processFrames(1000),rawMix(reference,1000));
    assert(engine.processFrames(10).left[0]>.1,'latest source DAC value is restored, not silence/midpoint');
  } finally {mix.dispose();engine.dispose();reference.dispose();}
});

function pcm(engine) {
  engine.pcm.loadMemory(Uint8Array.from([0x91,0xb0,0x40,0x65,0xff]),0);
  engine.pcm.loadMemory(Uint8Array.from([0xd0,0x20,0xf0,0x70,0xff]),256);
  for (const [channel,start,pan] of [[0,0,0x0f],[3,1,0xf0]]) {
    for (const [register,value] of [[7,0xc0|channel],[0,160],[1,pan],[2,0x71],[3,3],[4,0],[5,start],[6,start]]) engine.writeRf5c164(register,value);
  }
  engine.writeRf5c164(8,0xf6); // CH1 and CH4 enabled.
  engine.writeRf5c164(7,0x81); // Source leaves memory bank1 and channel4 selected.
}

test('RF channel mute retains sample positions, pan changes, selected channel and independent RAM bank', async () => {
  const engine=await createEngine(), reference=await createEngine(), mix=installSynthSongOutputMix(engine);
  try {
    for (const e of [engine,reference]) pcm(e);
    nearSourceStereo(engine.processFrames(700),rawMix(reference,700));
    mix.setMutedChannels(['pcm:3']);
    assert.equal(engine.pcm.api.bank(engine.pcm.handle),4096);
    for (const e of [engine,reference]) {
      // Both writes must still target channel4, despite the last source control
      // write selecting the independently banked memory window.
      e.writeRf5c164(1,0x80);e.writeRf5c164(0,140);
      e.writeRf5c164Memory(2,0x55);
    }
    const muted=engine.processFrames(2000), audible=reference.processFrames(2000);
    assert(acRms(muted.right.subarray(3))<1e-7);
    assert(acRms(audible.right)>0.001);
    assert.equal(engine.pcm.readMemory(4098),0x55);
    assert.equal(engine.pcm.readMemory(2),0x40);
    for (let address=0;address<16;address++) assert.equal(engine.pcm.read(address),reference.pcm.read(address));
    mix.setMutedChannels([]);
    // RF resampling holds one native output sample until the next chip tick.
    nearSourceStereo(engine.processFrames(3000),rawMix(reference,3000),3);
    mix.dispose();
    nearStereo(engine.processFrames(2000),reference.processFrames(2000));
  } finally {mix.dispose();engine.dispose();reference.dispose();}
});

test('PSG noise keeps Tone3 timing and PWM left/right output is independent; input validation is atomic', async () => {
  const engine=await createEngine(), reference=await createEngine(), mix=installSynthSongOutputMix(engine);
  try {
    for (const e of [engine,reference]) {
      for (const value of [0xc4,0x13,0xd0,0xe7,0xf2]) e.writePsg(value);
      e.writePwm(1,100);e.writePwm(2,75);e.writePwm(3,25);
    }
    nearSourceStereo(engine.processFrames(500),rawMix(reference,500));
    mix.setMutedChannels(['psg:2','psg:3','pwm:0']);
    const output=engine.processFrames(1000);reference.processFrames(1000);
    assert(acRms(output.left)<1e-7);
    assert.equal(engine.pwm.output()[0],0);
    assert.equal(engine.pwm.output()[1],reference.pwm.output()[1]*SYNTH_SONG_MIX_DEFAULTS.pwm);
    assert.throws(()=>mix.setMutedChannels(['pwm:1','ym2612:6']),/Invalid/);
    assert.equal(engine.pwm.output()[0],0,'invalid list does not partially apply');
    assert.notEqual(engine.pwm.output()[1],0);
    mix.setMutedChannels([]);
    nearSourceStereo(engine.processFrames(3000),rawMix(reference,3000));
    assert.throws(()=>mix.setMutedChannels(['pcm:-1']),/Invalid/);
  } finally {mix.dispose();engine.dispose();reference.dispose();}
  assert.throws(()=>mix.setMutedChannels([]),/disposed/);
});

test('fake/optional chip engines and reset retain host masks without source-observation writes', () => {
  const writes=[], engine={writeYm2612:(...args)=>writes.push(args),reset:()=>writes.push(['reset'])};
  const original=engine.writeYm2612,mix=installSynthSongOutputMix(engine);
  mix.setMutedChannels([]);
  mix.setMutedChannels(['ym2612:0']);
  engine.writeYm2612(0,0xb4,0xf7);assert.deepEqual(writes.at(-1),[0,0xb4,0x37]);
  engine.reset();engine.writeYm2612(0,0xb4,0xc0);assert.deepEqual(writes.at(-1),[0,0xb4,0]);
  mix.setMutedChannels([]);assert.deepEqual(writes.findLast(value=>value[0]===0&&value[1]===0xb4),[0,0xb4,0xc0]);
  mix.dispose();assert.equal(engine.writeYm2612,original);
});

test('real WASM PWM stereo output masks preserve FIFO, timer phase and continuation', async () => {
  const pwm=await PWM32X.create({sampleRate:53267,outputMode:'duty',gain:1}),
    reference=await PWM32X.create({sampleRate:53267,outputMode:'duty',gain:1});
  const engine={pwm,reset:()=>pwm.reset()},mix=installSynthSongOutputMix(engine);
  try {
    assert.equal(pwm.backend,'wasm');
    for (const chip of [pwm,reference]) {chip.writeRegister(0,5);chip.writeRegister(1,100);}
    for (let frame=0;frame<600;frame++) {
      if (frame===100) mix.setMutedChannels(['pwm:0']);
      if (frame===300) mix.setMutedChannels(['pwm:1']);
      if (frame===400) mix.setMutedChannels([]);
      for (const chip of [pwm,reference]) {
        chip.writeRegister(2,frame&8 ? 75 : 25);chip.writeRegister(3,frame&16 ? 80 : 20);
      }
      const actual=pwm.generateStereo(3),raw=reference.generateStereo(3),expected={
        left:Float32Array.from(raw.left,value=>value*SYNTH_SONG_MIX_DEFAULTS.pwm),
        right:Float32Array.from(raw.right,value=>value*SYNTH_SONG_MIX_DEFAULTS.pwm),
      };
      if (frame>=100&&frame<300) {
        assert(actual.left.every(value=>value===0));assert.deepEqual(actual.right,expected.right);
      } else if (frame>=300&&frame<400) {
        assert(actual.right.every(value=>value===0));assert.deepEqual(actual.left,expected.left);
      } else nearStereo(actual,expected);
      assert.equal(pwm.timerTick,reference.timerTick);
      assert.equal(pwm.interruptCount,reference.interruptCount);
      assert.equal(pwm.untilTick,reference.untilTick);
    }
    mix.dispose();
    nearStereo(pwm.generateStereo(1000),reference.generateStereo(1000));
  } finally {mix.dispose();pwm.dispose();reference.dispose();}
});
