// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SidCore,SID_PAL_CLOCK} from '../js/sid.js';
import {SidSynth} from '../js/sidsynth.js';
import {SidInstrument} from './instrument.js';
import {createDefaultPreset,presetToCode} from './preset.js';
import {Sid8580Core} from '../../tetorica_src/runtime/sid8580.js';

const wasmBinary=await readFile(new URL('../generated/sid/sid.wasm',import.meta.url));
const wasm8580Binary=await readFile(new URL('../generated/sid8580-machine/sid8580-endpoint.wasm',import.meta.url));
const make=sampleRate=>SidCore.create({wasmBinary,sampleRate:sampleRate??48000,clockHz:SID_PAL_CLOCK});
const hz=midi=>440*2**((midi-69)/12),frequency=value=>Math.round(value*16777216/SID_PAL_CLOCK);
const peak=pcm=>pcm.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
const exact=(actual,expected,label)=>assert.equal(actual.findIndex((value,index)=>value!==expected[index]),-1,label);
async function setup(t,rate=48000){
  const core=await make(rate),writes=[],write=core.writeRegister.bind(core);core.writeRegister=(reg,value)=>{writes.push([reg,value]);write(reg,value);};
  const instrument=new SidInstrument(core);t.after(()=>instrument.dispose());return {core,instrument,writes};
}
async function setup8580(t,rate=48000){
  const core=await Sid8580Core.create({sampleRate:rate,wasmBinary:wasm8580Binary}),instrument=new SidInstrument(core);
  t.after(()=>instrument.dispose());return {core,instrument};
}
const render=(instrument,frames=4096)=>instrument.renderInto(new Float32Array(frames));

// Independent raw-register reference. It follows the documented initialization
// and fixture write order because each physical access advances one SID cycle.
// No SidSynth or Synth allocator is used on this side of the PCM comparison.
function manual(core,preset,midi=60){
  const write=(reg,value)=>core.writeRegister(reg,value),pitch=(channel,value)=>{const n=frequency(value);write(channel*7,n&255);write(channel*7+1,n>>8);};
  const voice=(channel,v,sync=false,ring=false)=>{const base=channel*7;
    write(base+2,v.pulseWidth&255);write(base+3,v.pulseWidth>>8);write(base+5,v.attack<<4|v.decay);write(base+6,v.sustain<<4|v.release);
    write(base+4,({triangle:16,saw:32,pulse:64,noise:128})[v.waveform]|(v.test?8:0)|(sync?2:0)|(ring?4:0));};
  core.reset();const initial=createDefaultPreset();
  for(let ch=0;ch<3;ch++){voice(ch,initial.voice);pitch(ch,440);}write(21,0);write(22,0);write(23,0);write(24,8);
  const pair=preset.modulation.sync||preset.modulation.ring;
  for(let ch=0;ch<3;ch++)voice(ch,pair&&ch===2?{waveform:'triangle',pulseWidth:2048,attack:0,decay:0,sustain:0,release:0,test:false}:preset.voice,
    pair&&ch===0&&preset.modulation.sync,pair&&ch===0&&preset.modulation.ring);
  write(21,preset.filter.cutoff&7);write(22,preset.filter.cutoff>>3);write(23,preset.filter.resonance<<4|(preset.filter.enabled?(pair?1:7):0));
  write(24,(pair?128:0)|(preset.filter.enabled?({lowpass:16,bandpass:32,highpass:64,notch:80})[preset.filter.mode]:0)|preset.filter.volume);
  pitch(0,hz(midi));if(pair)pitch(2,hz(midi)*preset.modulation.ratio);
  write(4,core.registers[4]|1);
}

function profiles(){
  const dry=createDefaultPreset(),pulse=createDefaultPreset(),sync=createDefaultPreset(),ring=createDefaultPreset();
  Object.assign(pulse.voice,{waveform:'pulse',pulseWidth:777,attack:0,decay:4,sustain:10,release:9});Object.assign(pulse.filter,{enabled:true,mode:'lowpass',cutoff:1100,resonance:11,volume:13});
  sync.modulation={sync:true,ring:false,ratio:1.75};sync.filter.enabled=true;
  Object.assign(ring.voice,{waveform:'triangle',attack:0});ring.modulation={sync:false,ring:true,ratio:2.125};Object.assign(ring.filter,{enabled:true,mode:'bandpass',cutoff:900});
  return [dry,pulse,sync,ring];
}

test('real SID PCM matches independent manual register fixtures at 44.1/48/96 kHz',async t=>{
  for(const rate of [44100,48000,96000])for(const preset of profiles()){
    const {core,instrument}=await setup(t,rate),reference=await make(rate);t.after(()=>reference.dispose());
    instrument.loadPreset(preset);instrument.noteOn('fixture',60);manual(reference,preset);
    exact(render(instrument,6000),reference.render(6000),`${rate}/${preset.voice.waveform}/${preset.modulation.sync}/${preset.modulation.ring}`);
    assert.deepEqual(core.getState(),reference.getState());
  }
});

test('copied Playground JavaScript produces exactly the same real PCM and hardware state',async t=>{
  for(const preset of profiles()){
    const {core,instrument}=await setup(t),reference=await make(),sid=new SidSynth({core:reference});t.after(()=>{sid.dispose();reference.dispose();});
    instrument.loadPreset(preset);instrument.noteOn('export',60);
    const context=vm.createContext({sid});vm.runInContext(presetToCode(preset),context);
    exact(render(instrument,6000),reference.render(6000),'self-contained exported setup');assert.deepEqual(core.getState(),reference.getState());
  }
});

test('three real voices rotate, steal oldest held ownership and ignore stale note-off',async t=>{
  const {instrument,core}=await setup(t);assert.equal(peak(render(instrument,128)),0);
  for(let ch=0;ch<3;ch++)assert.deepEqual(instrument.noteOn(`note${ch}`,60+ch*4),{channel:ch,stolenId:null});
  assert(peak(render(instrument,8192))>.005);assert.equal(instrument.read().capacity,3);
  assert.deepEqual(instrument.noteOn('replacement',72),{channel:0,stolenId:'note0'});
  const before=core.getState();assert.equal(instrument.noteOff('note0'),false);assert.deepEqual(core.getState(),before);
  assert.deepEqual(instrument.read().voices.map(voice=>voice.id),['note1','note2','replacement']);
  assert.throws(()=>instrument.noteOn('replacement',70),/already active/);
  const detached=instrument.read();detached.voices[0].id='changed';detached.preset.voice.attack=15;detached.registers[4]=0;
  assert.equal(instrument.read().voices[0].id,'note1');assert.equal(instrument.read().preset.voice.attack,2);assert(core.registers[4]&1);
});

test('allocation prefers unused or envelope-zero slots, then hardware release tails before held keys',async t=>{
  const {instrument,core}=await setup(t),preset=createDefaultPreset();preset.voice.attack=0;preset.voice.release=15;instrument.loadPreset(preset);
  instrument.noteOn('a',60);instrument.noteOn('b',64);render(instrument,6000);instrument.noteOff('a');
  assert(core.getState().voices[0].envelope>0);assert.deepEqual(instrument.noteOn('c',67),{channel:2,stolenId:null});
  assert.deepEqual(instrument.noteOn('reuse-tail',69),{channel:0,stolenId:null});assert.equal(instrument.noteOff('a'),false);
  preset.voice.release=0;instrument.loadPreset(preset);for(let ch=0;ch<3;ch++)instrument.noteOn(`held${ch}`,60+ch);render(instrument,6000);
  instrument.noteOff('held0');render(instrument,48000);assert.equal(core.getState().voices[0].envelope,0);
  instrument.noteOff('held1');assert(core.getState().voices[1].envelope>0);
  assert.deepEqual(instrument.noteOn('reuse-silent',66),{channel:0,stolenId:null});
});

test('Sync/Ring allocate one physical source2-to-carrier0 pair and keep the source silent/unrouted',async t=>{
  for(const modulation of [{sync:true,ring:false,ratio:1.5},{sync:false,ring:true,ratio:2},{sync:true,ring:true,ratio:.5}]){
    const {instrument,core}=await setup(t),preset=createDefaultPreset();preset.voice.waveform='triangle';preset.modulation=modulation;preset.filter.enabled=true;instrument.loadPreset(preset);
    assert.equal(instrument.read().capacity,1);instrument.noteOn('a',60);const r=instrument.read().registers;
    assert.equal(r[18],16,'source oscillator runs Triangle before its silent envelope');assert.equal(r[11]&1,0);assert.equal(r[23]&7,1);assert.equal(r[24]&128,128);
    assert.equal(r[14]|r[15]<<8,frequency(hz(60)*modulation.ratio));assert.equal(r[4]&6,(modulation.sync?2:0)|(modulation.ring?4:0));
    render(instrument,6000);assert.equal(core.getState().voices[2].envelope,0);assert.deepEqual(instrument.noteOn('b',64),{channel:0,stolenId:'a'});
    assert.equal(instrument.noteOff('a'),false);assert.equal(instrument.noteOff('b'),true);
  }
});

test('live voice/filter and source ratio edits retain owners, Gate, phase and carrier tuning',async t=>{
  const {instrument,core,writes}=await setup(t),preset=createDefaultPreset();preset.voice.attack=0;preset.modulation.sync=true;instrument.loadPreset(preset);instrument.noteOn('held',60);render(instrument,4096);
  const owners=instrument.read().voices,before=core.getState(),carrier=instrument.read().registers.slice(0,2);writes.length=0;
  preset.modulation.ratio=1.5;instrument.setPreset(preset);
  assert.deepEqual(writes.map(write=>write[0]),[14,15]);assert.deepEqual(instrument.read().registers.slice(0,2),carrier);assert.deepEqual(instrument.read().voices,owners);
  assert.equal(core.getState().cycles,before.cycles+2);assert(core.getState().voices[0].phase!==0);assert(instrument.read().registers[4]&1);
  const live=instrument.read().preset;Object.assign(live.voice,{waveform:'pulse',pulseWidth:777,decay:9,sustain:10,release:8});Object.assign(live.filter,{enabled:true,mode:'highpass',cutoff:1200,resonance:12,volume:9});
  const cycles=core.getState().cycles;instrument.setPreset(live);assert(core.getState().cycles>cycles);assert.deepEqual(instrument.read().voices,owners);
  assert.equal(instrument.read().registers[4]&1,1);assert(core.getState().voices[0].envelope>0);assert.equal(instrument.read().registers[23]&7,1);assert.equal(instrument.read().registers[24],0xc9);
  const named=instrument.read().preset;named.name='Renamed';writes.length=0;const phase=core.getState();instrument.setPreset(named);assert.deepEqual(writes,[]);assert.deepEqual(core.getState(),phase);
});

test('rapid retrigger at envelope 255 retains the chip wrap/freeze behavior without a software envelope fix',async t=>{
  const {instrument,core}=await setup(t),reference=await make();t.after(()=>reference.dispose());
  const preset=createDefaultPreset();Object.assign(preset.voice,{attack:0,decay:0,sustain:15,release:15});preset.modulation.sync=true;
  instrument.loadPreset(preset);instrument.noteOn('old',60);manual(reference,preset);exact(render(instrument,6000),reference.render(6000),'initial sustained note');
  assert.equal(core.getState().voices[0].envelope,255);
  instrument.noteOn('new',64);
  reference.writeRegister(4,reference.registers[4]&254);
  for(const [channel,value]of [[0,hz(64)],[2,hz(64)]]){const n=frequency(value);reference.writeRegister(channel*7,n&255);reference.writeRegister(channel*7+1,n>>8);}
  reference.writeRegister(4,reference.registers[4]|1);
  exact(render(instrument,4096),reference.render(4096),'raw rapid release/retrigger');assert.deepEqual(core.getState(),reference.getState());
  assert.equal(core.getState().voices[0].envelope,0);assert.equal(core.registers[4]&1,1);assert.equal(instrument.read().voices[0].id,'new');
});

test('invalid note, preset and live frequency edits are atomic across held and releasing voices',async t=>{
  const {instrument,core,writes}=await setup(t),preset=createDefaultPreset();preset.voice.attack=0;preset.voice.release=15;instrument.loadPreset(preset);
  instrument.noteOn('high',100);instrument.noteOn('low',60);render(instrument,6000);instrument.noteOff('high');
  assert(core.getState().voices[0].envelope>0);
  const snapshot=instrument.read(),hardware=core.getState(),count=writes.length;
  for(const operation of [()=>instrument.noteOn('overflow',127),()=>instrument.noteOn('',60),()=>instrument.noteOn('bad',60.5),
    ()=>instrument.setPitch(12),()=>instrument.setPitch(25),()=>instrument.setPitch(NaN),
    ()=>instrument.setPreset({...preset,voice:{...preset.voice,attack:16}}),()=>instrument.loadPreset({...preset,filter:{...preset.filter,volume:16}})]){
    assert.throws(operation);assert.deepEqual(instrument.read(),snapshot);assert.deepEqual(core.getState(),hardware);assert.equal(writes.length,count);
  }
  instrument.loadPreset({...preset,modulation:{sync:true,ring:false,ratio:1}});instrument.noteOn('paired-high',100);render(instrument,6000);
  const pairBefore=instrument.read(),pairHardware=core.getState(),invalid=instrument.read().preset;invalid.modulation.ratio=2;
  assert.throws(()=>instrument.setPreset(invalid),/frequency register/);assert.deepEqual(instrument.read(),pairBefore);assert.deepEqual(core.getState(),pairHardware);
});

test('released tails receive valid live pitch while completed inactive metadata does not block future Pitch',async t=>{
  const {instrument,core}=await setup(t),preset=createDefaultPreset();preset.voice.attack=0;preset.voice.release=0;instrument.loadPreset(preset);
  instrument.noteOn('tail',100);render(instrument,6000);instrument.noteOff('tail');assert.equal(instrument.read().voices.length,0);
  instrument.setPitch(-12);assert.equal(instrument.read().registers[0]|instrument.read().registers[1]<<8,frequency(hz(88)));
  render(instrument,48000);assert.equal(core.getState().voices[0].envelope,0);const oldFrequency=instrument.read().registers.slice(0,2);
  instrument.setPitch(24);assert.equal(instrument.read().pitch,24);assert.deepEqual(instrument.read().registers.slice(0,2),oldFrequency);
});

test('topology, TEST, load and Stop clear held keys/Pitch and flush hardware and software tails',async t=>{
  const {instrument,core}=await setup(t);instrument.noteOn('a',60);instrument.setPitch(3);render(instrument,6000);
  let preset=instrument.read().preset;preset.modulation.sync=true;instrument.setPreset(preset);assert.equal(instrument.read().pitch,0);assert.deepEqual(instrument.read().voices,[]);assert.equal(instrument.read().capacity,1);assert.equal(peak(render(instrument,512)),0);
  instrument.noteOn('b',60);instrument.setPitch(2);render(instrument,3000);preset=instrument.read().preset;preset.modulation.ring=true;instrument.setPreset(preset);assert.equal(instrument.read().pitch,0);assert.equal(instrument.noteOff('b'),false);
  instrument.noteOn('c',60);preset=instrument.read().preset;preset.voice.test=true;instrument.setPreset(preset);assert.deepEqual(instrument.read().voices,[]);assert.equal(instrument.read().pitch,0);assert(core.registers[4]&8);
  preset.voice.test=false;preset.modulation={sync:false,ring:false,ratio:1};instrument.loadPreset(preset);instrument.noteOn('high',100);instrument.setPitch(-12);
  const extreme={...preset,modulation:{sync:true,ring:true,ratio:8}};instrument.loadPreset(extreme);assert.equal(instrument.read().preset.modulation.ratio,8);assert.equal(instrument.read().pitch,0);assert.deepEqual(instrument.read().voices,[]);
  instrument.noteOn('audible',48);render(instrument,6000);instrument.setPitch(-2);const keep=instrument.read().preset;
  instrument.stop();assert.deepEqual(instrument.read().preset,keep);assert.equal(instrument.read().pitch,0);assert.deepEqual(instrument.read().voices,[]);assert.equal(peak(render(instrument,6000)),0);assert(core.getState().voices.every(voice=>voice.envelope===0));
  assert.equal(instrument.noteOff('audible'),false);
});

test('render partitioning preserves real PCM and disposal owns exactly one core',async t=>{
  const a=await setup(t),b=await setup(t);a.instrument.noteOn('a',60);b.instrument.noteOn('b',60);
  const expected=render(a.instrument,5000),actual=new Float32Array(5000);
  for(let offset=0;offset<actual.length;){const count=Math.min(actual.length-offset,offset%19+1);b.instrument.renderInto(actual.subarray(offset,offset+count));offset+=count;}
  exact(actual,expected,'render block invariance');assert.deepEqual(a.core.getState(),b.core.getState());
  const before=a.core.getState();assert.throws(()=>a.instrument.renderInto(new Float64Array(16)),/Float32Array/);assert.deepEqual(a.core.getState(),before);
  let disposed=0;const dispose=a.core.dispose.bind(a.core);a.core.dispose=()=>{disposed++;dispose();};a.instrument.dispose();a.instrument.dispose();assert.equal(disposed,1);assert.equal(a.core.handle,0);
  for(const invoke of [()=>a.instrument.read(),()=>a.instrument.noteOn('x',60),()=>a.instrument.noteOff('x'),()=>a.instrument.setPitch(0),()=>a.instrument.stop(),()=>render(a.instrument)])assert.throws(invoke,/disposed/);
  assert.throws(()=>new SidInstrument({}),/SidCore/);
});

test('8580 instruments use their own model and reuse unknown released slots conservatively',async t=>{
  const {core,instrument}=await setup8580(t),preset=instrument.read().preset;
  assert.equal(preset.version,2);assert.equal(preset.model,'8580');assert.equal(instrument.read().model,'8580');
  Object.assign(preset.voice,{attack:0,decay:0,sustain:15,release:15});instrument.loadPreset(preset);
  assert.equal(instrument.noteOn('a',60).channel,0);render(instrument,6000);instrument.noteOff('a');
  assert(peak(render(instrument,3000))>.001,'release remains in the real core after Gate off');
  assert.equal(core.getState().voices[0].envelope,null);
  assert.equal(instrument.noteOn('b',64).channel,1,'unknown released envelope is not mistaken for an idle zero');
  assert.equal(instrument.noteOn('c',67).channel,2);assert.equal(instrument.noteOn('d',69).channel,0,'old released tail is preferred over held keys');
  assert.equal(instrument.noteOff('a'),false,'stale release cannot take the reused slot');
  assert.equal(instrument.noteOn('e',71).stolenId,'b');assert.equal(instrument.read().voices.length,3);
  for(const {id}of instrument.read().voices)instrument.noteOff(id);
  for(let i=0;i<40;i++){instrument.noteOn('repeat-'+i,60);instrument.noteOff('repeat-'+i);}
  assert.equal(instrument.read().voices.length,0);assert.equal(instrument.slots.filter(Boolean).length,3,'tail metadata is bounded by physical slots');
});

test('unknown 8580 tails follow valid Pitch while out-of-range tails cannot block current held notes',async t=>{
  const {core,instrument}=await setup8580(t),preset=instrument.read().preset;
  Object.assign(preset.voice,{attack:0,decay:0,sustain:15,release:15});instrument.loadPreset(preset);
  instrument.noteOn('high-tail',100);render(instrument,6000);instrument.noteOff('high-tail');instrument.noteOn('held-low',60);
  instrument.setPitch(-12);let registers=instrument.read().registers;
  assert.equal(registers[0]|registers[1]<<8,frequency(hz(88)),'unobserved release follows representable tuning');
  const tailFrequency=registers.slice(0,2);instrument.setPitch(24);registers=instrument.read().registers;
  assert.equal(registers[7]|registers[8]<<8,frequency(hz(84)),'held voice still follows valid requested Pitch');
  assert.deepEqual(registers.slice(0,2),tailFrequency,'unknown unrepresentable tail retains its last valid tuning');
  assert.equal(instrument.read().pitch,24);assert.deepEqual(instrument.read().voices.map(v=>v.id),['held-low']);
  assert(peak(render(instrument,2000))>.001);assert(core.getState().voices.every(v=>v.envelope===null));
  instrument.stop();instrument.noteOn('held-high',100);const before=instrument.read(),hardware=core.getState();
  assert.throws(()=>instrument.setPitch(24),/frequency register/);assert.deepEqual(instrument.read(),before);assert.deepEqual(core.getState(),hardware);
});

test('8580 patch/filter/Sync/Ring and Stop operate on the real CPU-free core at three rates',async t=>{
  const modes=['off','lowpass','bandpass','lowpass+bandpass','highpass','notch','bandpass+highpass','lowpass+bandpass+highpass'];
  for(const rate of [44100,48000,96000]){
    const {core,instrument}=await setup8580(t,rate);let preset=instrument.read().preset;
    Object.assign(preset.voice,{attack:0,decay:0,sustain:15,release:12});instrument.loadPreset(preset);instrument.noteOn('one',60);
    for(const [bits,mode]of modes.entries()){
      preset=instrument.read().preset;Object.assign(preset.filter,{enabled:bits!==0,mode,cutoff:700,resonance:5});
      instrument.setPreset(preset);const state=instrument.read();assert.equal(state.voices[0].id,'one');
      assert.equal(state.registers[24]&0x70,bits<<4);assert.equal(state.registers[23]&7,bits?7:0);
      assert(render(instrument,512).every(Number.isFinite));
    }
    preset=instrument.read().preset;preset.voice.waveform='triangle';preset.modulation={sync:false,ring:true,ratio:1.75};
    instrument.loadPreset(preset);instrument.noteOn('pair',60);const state=instrument.read();assert.equal(state.capacity,1);
    assert.equal(state.registers[18],0x10);assert.equal(state.registers[23]&7,1);assert(state.registers[24]&128);
    assert(peak(render(instrument,4000))>.001);instrument.noteOff('pair');instrument.setPitch(1);
    assert.equal(instrument.read().registers[0]|instrument.read().registers[1]<<8,frequency(hz(61)));
    instrument.stop();assert.equal(instrument.read().preset.model,'8580');assert.equal(peak(render(instrument,512)),0);
    assert.equal(instrument.read().pitch,0);assert.deepEqual(instrument.read().voices,[]);assert.equal(core.getState().model,'8580');
  }
});

test('cross-model preset attempts never mutate an existing 8580 instrument or its next PCM',async t=>{
  const a=await setup8580(t),b=await setup8580(t);a.instrument.noteOn('a',60);b.instrument.noteOn('b',60);
  exact(render(a.instrument,5000),render(b.instrument,5000));const preset=a.instrument.read().preset;
  const snapshot=a.instrument.read(),hardware=a.core.getState();
  for(const method of ['setPreset','loadPreset']){
    assert.throws(()=>a.instrument[method]({...preset,model:'6581'}),/model must match/);
    assert.deepEqual(a.instrument.read(),snapshot);assert.deepEqual(a.core.getState(),hardware);
  }
  exact(render(a.instrument,3000),render(b.instrument,3000),'failed cross-model edits keep future samples');
});
