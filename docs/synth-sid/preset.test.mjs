// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createDefaultPreset,readPreset,presetToCode,filterModeBits,filterModeFromBits} from './preset.js';
import {SidCore} from '../js/sid.js';
import {Sid8580Core} from '../js/sid8580.js';
import {SidInstrument} from './instrument.js';

const filterModes=['off','lowpass','bandpass','lowpass+bandpass','highpass','notch','bandpass+highpass','lowpass+bandpass+highpass'];

test('SID v2 default is portable, detached and keeps dormant filter settings',()=>{
  const preset=createDefaultPreset(),copy=readPreset(JSON.stringify(preset));assert.deepEqual(copy,preset);
  assert.equal(copy.format,'tetorica-sid-voice');assert.equal(copy.version,2);assert.equal(copy.model,'6581');assert.equal(copy.name,'Saw');
  assert.deepEqual(copy.modulation,{sync:false,ring:false,ratio:1});assert.equal(copy.filter.enabled,false);assert.equal(copy.filter.mode,'lowpass');
  copy.voice.attack=15;copy.modulation.ratio=8;copy.filter.cutoff=0;
  assert.equal(preset.voice.attack,2);assert.equal(preset.modulation.ratio,1);assert.equal(preset.filter.cutoff,600);
  assert.deepEqual(createDefaultPreset(),preset);
});

test('SID preset fields reject unknown keys, coercions, unsafe names and unsupported versions',()=>{
  const mutations=[p=>p.extra=1,p=>delete p.voice,p=>p.format='sid',p=>p.version=3,p=>p.version='2',p=>p.model='8581',p=>p.model=8580,p=>delete p.model,
    p=>p.name=1,p=>p.name='a'.repeat(81),p=>p.name='bad\nname',p=>p.name='bad\u2028name',p=>p.name='bad\u0085name',
    p=>p.voice.extra=true,p=>delete p.voice.test,p=>p.voice.waveform='combined',p=>p.voice.waveform='off',
    p=>p.voice.pulseWidth=-1,p=>p.voice.pulseWidth=4096,p=>p.voice.pulseWidth=1.5,p=>p.voice.pulseWidth='2048',
    p=>p.voice.attack=16,p=>p.voice.decay=-1,p=>p.voice.sustain=NaN,p=>p.voice.release=Infinity,p=>p.voice.test=1,
    p=>p.modulation.sync='true',p=>p.modulation.ring=0,p=>p.modulation.ratio=.124,p=>p.modulation.ratio=8.001,
    p=>p.modulation.ratio=NaN,p=>p.modulation.ratio=Infinity,p=>p.modulation.ratio='1',p=>p.modulation.extra=0,
    p=>p.filter.enabled=1,p=>p.filter.mode='combined',p=>p.filter.mode='LP',p=>p.filter.mode=3,p=>p.filter.mode=['lowpass','bandpass'],p=>p.filter.cutoff=2048,p=>p.filter.cutoff=-1,
    p=>p.filter.resonance=16,p=>p.filter.volume=16,p=>p.filter.routing=7,p=>p.filter.volume=.5];
  for(const mutate of mutations){const preset=createDefaultPreset();mutate(preset);assert.throws(()=>readPreset(preset));assert.throws(()=>presetToCode(preset));}
  for(const value of [null,[],true,5,'{broken',new Date()])assert.throws(()=>readPreset(value));
  const inherited=Object.create(createDefaultPreset());assert.throws(()=>readPreset(inherited));
  const symbol=createDefaultPreset();symbol[Symbol('extra')]=1;assert.throws(()=>readPreset(symbol));
  let read=0;const accessor=createDefaultPreset();Object.defineProperty(accessor,'name',{enumerable:true,get(){read++;return 'side effect';}});
  assert.throws(()=>readPreset(accessor),/accessors/);assert.equal(read,0);
  Object.defineProperty(accessor,'version',{enumerable:true,get(){read++;return 2;}});
  assert.throws(()=>readPreset(accessor),/accessors/);assert.equal(read,0);
});

test('strict v1 presets migrate to model6581 while v2 preserves the chosen model',()=>{
  for(const mode of filterModes){
    const legacy=createDefaultPreset();delete legacy.model;legacy.version=1;
    Object.assign(legacy.filter,{enabled:mode!=='off',mode,cutoff:1001,resonance:9,volume:15});
    legacy.modulation={sync:true,ring:true,ratio:1.75};
    const migrated=readPreset(legacy);assert.equal(migrated.version,2);assert.equal(migrated.model,'6581');
    assert.deepEqual(migrated.voice,legacy.voice);assert.deepEqual(migrated.filter,legacy.filter);assert.deepEqual(migrated.modulation,legacy.modulation);
    assert.equal(legacy.version,1);assert.equal(Object.hasOwn(legacy,'model'),false);
    for(const model of ['6581','8580']){
      const preset={...migrated,model};assert.deepEqual(readPreset(JSON.stringify(preset)),preset);
      assert.equal(createDefaultPreset({model}).model,model);
    }
    legacy.model='8580';assert.throws(()=>readPreset(legacy),/unexpected/,'v1 cannot smuggle a new model field');
  }
});

test('8580 copied JavaScript creates a dedicated model instance and never edits the injected6581 primary',async()=>{
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  for(const pair of [false,true]){
    const preset=createDefaultPreset({model:'8580'});preset.modulation={sync:pair,ring:pair,ratio:1.75};
    Object.assign(preset.filter,{enabled:true,mode:'lowpass+bandpass+highpass',cutoff:907,resonance:12});
    const calls=[],created=[],target={initialize(){calls.push(['initialize']);},setVoice(...v){calls.push(['setVoice',...v]);},setFilter(v){calls.push(['setFilter',v]);},setFrequency(...v){calls.push(['setFrequency',...v]);},keyOn(...v){calls.push(['keyOn',...v]);},noteOn(...v){calls.push(['noteOn',...v]);}};
    const primary=new Proxy({}, {get(){throw new Error('Copied8580 code touched the primary6581');}}),code=presetToCode(preset);
    await new AsyncFunction('createSoundChip','sid',code)(async(...args)=>{created.push(args);return target;},primary);
    assert.deepEqual(created,[['sid',{id:'sid:8580-voice',model:'8580'}]]);
    assert.equal(calls[0][0],'initialize');assert.equal(calls.filter(c=>c[0]==='setVoice').length,3);
    assert.equal(calls.find(c=>c[0]==='setFilter')[1].mode,'lowpass+bandpass+highpass');
    assert.equal(calls.at(-1)[0],pair?'keyOn':'noteOn');assert.match(code,/8580 Preview/);assert.doesNotMatch(code,/const sid =/);
  }
});

test('all four waveforms and eight filter output masks retain exact register parameter boundaries',()=>{
  for(const waveform of ['triangle','saw','pulse','noise'])for(const mode of filterModes){
    const preset=createDefaultPreset();Object.assign(preset.voice,{waveform,pulseWidth:4095,attack:15,decay:15,sustain:15,release:15,test:true});
    Object.assign(preset.modulation,{sync:true,ring:true,ratio:8});Object.assign(preset.filter,{enabled:mode!=='off',mode,cutoff:2047,resonance:15,volume:15});
    assert.deepEqual(readPreset(preset),preset);
    Object.assign(preset.voice,{pulseWidth:0,attack:0,decay:0,sustain:0,release:0});preset.modulation.ratio=.125;
    Object.assign(preset.filter,{cutoff:0,resonance:0,volume:0});assert.deepEqual(readPreset(preset),preset);
  }
});

test('filter output helpers preserve LP/BP/HP masks and reject unsupported values',()=>{
  for(let bits=0;bits<8;bits++){
    assert.equal(filterModeFromBits(bits),filterModes[bits]);
    assert.equal(filterModeBits(filterModes[bits]),bits);
  }
  for(const bits of [-1,8,1.5,NaN,Infinity,'3',null])assert.throws(()=>filterModeFromBits(bits));
  for(const mode of [undefined,null,0,3,[],['lowpass'],'combined','LP','highpass+bandpass'])assert.throws(()=>filterModeBits(mode));
});

test('all filter output combinations round-trip and copied JavaScript applies the same shared filter',()=>{
  for(let bits=0;bits<8;bits++){
    const preset=createDefaultPreset();Object.assign(preset.filter,{enabled:bits!==0,mode:filterModes[bits],cutoff:841,resonance:11,volume:9});
    assert.deepEqual(readPreset(JSON.stringify(preset)),preset);
    const filters=[],sid={initialize(){},setVoice(){},setFilter(value){filters.push(value);},noteOn(){}};
    new Function('sid',presetToCode(preset))(sid);
    assert.deepEqual(filters,[{mode:filterModes[bits],cutoff:841,resonance:11,routing:bits?7:0,volume:9,voice3off:false}]);
  }
  const notch=createDefaultPreset();Object.assign(notch.filter,{enabled:true,mode:'notch'});
  assert.deepEqual(readPreset(notch),notch,'existing v1 Notch authoring data is unchanged');
  assert.equal(filterModeBits(readPreset(notch).filter.mode),5,'legacy Notch remains LP + HP');
});

test('all outputs off canonicalizes to Synth bypass without mutating or coercing imported data',()=>{
  const input=createDefaultPreset();Object.assign(input.filter,{enabled:true,mode:'off',cutoff:2047,resonance:15});
  const result=readPreset(input);
  assert.equal(result.filter.enabled,false);assert.equal(result.filter.mode,'off');
  assert.equal(input.filter.enabled,true);assert.equal(input.filter.mode,'off');
  assert.equal(result.filter.cutoff,2047);assert.equal(result.filter.resonance,15);
  assert.match(presetToCode(input),/"mode":"off".*"routing":0/);
  input.filter.enabled=1;assert.throws(()=>readPreset(input),/boolean/);
});

test('readable JavaScript identifies software allocation/ratio and uses the physical silent source',()=>{
  const preset=createDefaultPreset();let code=presetToCode(preset);
  assert(code.includes('sid.initialize();'));assert(code.includes("sid.noteOn(0, 'C4');"));assert(!code.includes('liveLoop('));
  assert(code.includes('Software:'));assert(code.includes('"routing":0'));assert(code.includes('"mode":"off"'));
  preset.modulation={sync:true,ring:true,ratio:1.75};preset.filter.enabled=true;code=presetToCode(preset);
  assert(code.includes('oscillator 3 -> carrier 1'));assert(code.includes('carrierHz * 1.75'));
  assert(code.includes('"routing":1'));assert(code.includes('"voice3off":true'));assert(code.includes('sid.keyOn(0);'));
  assert(!code.includes('sid.keyOn(2)'));assert(!code.includes('sid.noteOn(2'));
  assert(code.includes('sid.setVoice(2, {"waveform":"triangle"'));assert(code.includes('Gate OFF'));
});

test('fractional and boundary ratios survive v1/v2 JSON and exact JavaScript export in either model and modulation combination',async()=>{
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  for(const ratio of [4/3,12139/9113,.125,8])for(const model of ['6581','8580'])for(const [sync,ring]of [[false,false],[true,false],[false,true],[true,true]]){
    const preset=createDefaultPreset({model});preset.modulation={sync,ring,ratio};
    const restored=readPreset(JSON.stringify(preset));assert.equal(restored.modulation.ratio,ratio);assert.deepEqual(restored,preset);
    const legacy={...preset,version:1};delete legacy.model;assert.equal(readPreset(JSON.stringify(legacy)).modulation.ratio,ratio);
    const frequencies=[],created=[],target={initialize(){},setVoice(){},setFilter(){},setFrequency(...args){frequencies.push(args);},keyOn(){},noteOn(){}};
    const code=presetToCode(restored);
    await new AsyncFunction('sid','createSoundChip',code)(target,async(...args)=>{created.push(args);return target;});
    assert.equal(created.length,model==='8580'?1:0);
    if(sync||ring){
      const carrier=440*2**((60-69)/12);
      assert(code.includes('carrierHz * '+String(ratio)), 'export retains the exact imported Number literal');
      assert.deepEqual(frequencies,[[0,carrier],[2,carrier*ratio]]);
    }else assert.deepEqual(frequencies,[],'dormant ratios remain data while independent voices use normal note tuning');
  }
});

function rawPair(core,preset){
  const write=(reg,value)=>core.writeRegister(reg,value),frequency=(channel,hz)=>{
    const value=Math.round(hz*16777216/985248);write(channel*7,value&255);write(channel*7+1,value>>8);
  };
  const voice=(channel,value,sync=false,ring=false)=>{
    const base=channel*7;
    write(base+2,value.pulseWidth&255);write(base+3,value.pulseWidth>>8);
    write(base+5,value.attack<<4|value.decay);write(base+6,value.sustain<<4|value.release);
    write(base+4,({triangle:16,saw:32,pulse:64,noise:128})[value.waveform]|(value.test?8:0)|(sync?2:0)|(ring?4:0));
  };
  // An independent bus sequence: each register access clocks one chip cycle.
  // Follow the documented reset/write order so phase and queued samples can
  // be compared, rather than merely comparing the final authored parameters.
  core.reset();const initial=createDefaultPreset();
  for(let channel=0;channel<3;channel++){voice(channel,initial.voice);frequency(channel,440);}
  write(21,0);write(22,0);write(23,0);write(24,8);
  for(let channel=0;channel<3;channel++)voice(channel,channel===2
    ?{waveform:'triangle',pulseWidth:2048,attack:0,decay:0,sustain:0,release:0,test:false}:preset.voice,
    channel===0&&preset.modulation.sync,channel===0&&preset.modulation.ring);
  write(21,preset.filter.cutoff&7);write(22,preset.filter.cutoff>>3);write(23,preset.filter.resonance<<4|1);write(24,128|16|preset.filter.volume);
  const note=midi=>{const hz=440*2**((midi-69)/12);frequency(0,hz);frequency(2,hz*preset.modulation.ratio);write(4,core.registers[4]|1);};
  note(60);return {note,release(){write(4,core.registers[4]&254);}};
}

test('real 6581/8580 arbitrary-ratio pairs, releases and mono retriggers match independent raw register PCM',async()=>{
  const binaries=await Promise.all(['../generated/sid/sid.wasm','../generated/sid8580-machine/sid8580-endpoint.wasm'].map(path=>readFile(new URL(path,import.meta.url))));
  for(const [index,Core]of [SidCore,Sid8580Core].entries())for(const ratio of [12139/9113,.125,8])for(const [sync,ring]of [[true,false],[false,true],[true,true]]){
    const options={sampleRate:48000,wasmBinary:binaries[index]},core=await Core.create(options),reference=await Core.create(options),instrument=new SidInstrument(core);
    try{
      const preset=createDefaultPreset({model:index?'8580':'6581'});preset.modulation={sync,ring,ratio};
      Object.assign(preset.voice,{waveform:'triangle',attack:0,sustain:15,release:15});preset.filter.enabled=true;
      instrument.loadPreset(preset);instrument.noteOn('first',60);const manual=rawPair(reference,preset);
      const compare=()=>{
        const actual=instrument.renderInto(new Float32Array(4096)),expected=reference.render(4096);
        assert(actual.every(Number.isFinite));assert.deepEqual(actual,expected,'full PCM retains exact fraction, phase and access timing');assert.deepEqual(Array.from(core.registers),Array.from(reference.registers));
      };
      assert.equal(instrument.read().preset.modulation.ratio,ratio);assert.equal(instrument.read().capacity,1);compare();
      assert.equal(instrument.noteOff('first'),true);manual.release();compare();
      instrument.noteOn('second',62);manual.note(62);const before=core.getState();
      assert.equal(instrument.noteOff('first'),false);assert.deepEqual(core.getState(),before,'stale release never changes the new pair');compare();
    }finally{instrument.dispose();reference.dispose();}
  }
});
