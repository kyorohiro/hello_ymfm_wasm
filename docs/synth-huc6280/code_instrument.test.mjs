import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import factory from '../generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import {HUC6280_CLOCK} from '../js/huc6280synth.js';
import {Huc6280Instrument} from './instrument.js';
import {waveShape} from './preset.js';
import {encodeDdaData} from './dda_pcm.js';

const wasmBinary=await readFile(new URL('../generated/huc6280_wasm.wasm',import.meta.url));
async function setup(t){
  const core=await Huc6280AudioEngine.create({moduleFactory:()=>factory({wasmBinary}),clock:HUC6280_CLOCK,outputSampleRate:48000});
  const instrument=new Huc6280Instrument(core);t.after(()=>instrument.dispose());return instrument;
}
const peak=pcm=>Math.max(...pcm.left.map(Math.abs),...pcm.right.map(Math.abs));
const period=(s,ch)=>(s.registers[ch][2]|(s.registers[ch][3]&15)<<8)||4096;
function plain(i){const p=i.read().preset;p.envelope.enabled=false;i.loadPreset(p);return p;}
function dda(i){const p=plain(i);p.source='dda';Object.assign(p.dda,{data:encodeDdaData(Uint8Array.from({length:128},(_,n)=>n%32)),sampleRate:12000,rootNote:60,loop:true,speed:1});i.loadPreset(p);return p;}

test('Code uses one physical PSG and Stop restores the authored preset without changing its PCM',async t=>{
  const i=await setup(t),preset=plain(i),{session}=i.beginCode();
  i.code(session,'setWaveform',[2,waveShape('square')]);i.code(session,'setPan',[2,15,0]);i.code(session,'noteOn',[2,'A4']);
  assert(peak(i.generateStereo(2048))>.001);assert.deepEqual(i.read().preset,preset);
  assert.equal(i.observeCode().positionFrames,2048);assert.equal(i.observeCode().registers[2][4]&128,128);
  i.stop();assert.equal(i.observeCode(),null);assert.deepEqual(i.read().preset,preset);assert.equal(peak(i.generateStereo(256)),0);
  assert.throws(()=>i.code(session,'noteOn',[0,'C4']),{name:'AbortError'});
  const newer=i.beginCode();assert(newer.session>session);i.code(newer.session,'noteOn',[0,'C4']);assert(peak(i.generateStereo(1024))>.001);
});

test('Code noteOff uses authored software Release; raw keyOff remains an immediate hardware gate',async t=>{
  const i=await setup(t),p=i.read().preset;p.envelope={enabled:true,attack:0,decay:0,sustain:1,release:.025};i.loadPreset(p);
  const {session}=i.beginCode();i.code(session,'noteOn',[0,'A4']);assert(peak(i.generateStereo(1024))>.001);
  i.code(session,'noteOff',[0]);assert(peak(i.generateStereo(128))>.001,'software tail continues');
  i.generateStereo(1600);assert.equal(i.observeCode().registers[0][4]&128,0);assert.equal(peak(i.generateStereo(128)),0);
  i.code(session,'noteOn',[0,'A4']);assert(peak(i.generateStereo(256))>.001,'next note restores its base level');
  i.code(session,'keyOff',[0]);assert.equal(i.observeCode().registers[0][4]&128,0);
});

test('manual CH ownership and Code gates protect each performer from older releases and bend resets',async t=>{
  const i=await setup(t);plain(i);const {session}=i.beginCode();
  i.noteOn('hand',60,2);i.setPitch(2);i.code(session,'setFrequency',[2,880]);const held=period(i.observeCode(),2);
  i.setPitch(0);assert.equal(period(i.observeCode(),2),held,'old hand bend cannot overwrite newer Code pitch');
  i.code(session,'noteOn',[2,'E4']);assert.equal(i.noteOff('hand'),false);assert.equal(i.observeCode().registers[2][4]&128,128);
  i.noteOn('new-hand',72,2);assert.equal(i.code(session,'noteOff',[2]),false);assert.equal(i.code(session,'keyOff',[2]),false);
  assert.equal(i.observeCode().registers[2][4]&128,128);i.noteOff('new-hand');assert.equal(i.observeCode().registers[2][4]&128,0);
  i.code(session,'noteOn',[3,'G4']);i.noteOn('other-hand',65,4);i.releaseKeyboard();
  assert.equal(i.observeCode().registers[3][4]&128,128);assert.equal(i.observeCode().registers[4][4]&128,0);
});

test('sparse physical edits preserve other channels, musical pitch and gate while author settings follow the touched field',async t=>{
  const i=await setup(t);plain(i);const {session}=i.beginCode();i.code(session,'noteOn',[0,'A4']);i.code(session,'noteOn',[3,'E4']);
  i.code(session,'setPan',[3,2,11]);const before=i.observeCode();
  i.applyCodeEdit(session,{channel:3,changes:{'pan.left':7,volume:13}});const after=i.observeCode();
  assert.deepEqual(after.registers[0],before.registers[0]);assert.equal(period(after,3),period(before,3));assert.equal(after.registers[3][4]&128,128);
  assert.equal(after.registers[3][5],7<<4|11);assert.equal(after.registers[3][4]&31,13);
  assert.equal(i.read().preset.pan.left,7);assert.equal(i.read().preset.pan.right,15,'untouched authored fields stay separate');
});

test('editor waveform drawing retains a Code note owner/envelope while the raw waveform API stops its channel',async t=>{
  const i=await setup(t),{session}=i.beginCode();i.code(session,'noteOn',[0,'A4']);i.generateStereo(128);
  const owner=i.slots[0],start=owner.startFrame,frame=i.frame;
  i.applyCodeEdit(session,{channel:0,changes:{wave:waveShape('triangle')}});
  assert.equal(i.slots[0],owner);assert.equal(owner.startFrame,start);assert.equal(i.frame,frame);assert.equal(i.observeCode().registers[0][4]&128,128);
  i.code(session,'setWaveform',[0,waveShape('square')]);assert.equal(i.slots[0],null);assert.equal(i.observeCode().registers[0][4]&128,0);
});

test('Noise and hardware LFO remain physical: noise is CH5/6, LFO CH2 pitch is not an implicit Code follower',async t=>{
  const i=await setup(t);plain(i);const {session}=i.beginCode();
  i.code(session,'setNoise',[4,{enabled:true,frequency:21}]);i.code(session,'noteOn',[4,'C4']);assert(peak(i.generateStereo(2048))>.001);
  assert.throws(()=>i.code(session,'setNoise',[2,{enabled:true}]));
  i.code(session,'allNotesOff',[]);i.code(session,'setWaveform',[1,waveShape('sine')]);i.code(session,'setVolume',[1,0]);
  i.code(session,'setFrequency',[1,110]);i.code(session,'setLfo',[{frequency:8,depth:2,reset:false}]);
  const modulator=period(i.observeCode(),1);i.code(session,'noteOn',[0,'A4']);i.generateStereo(1024);
  assert.equal(period(i.observeCode(),1),modulator);assert.equal(i.observeCode().globals[9]&3,2);
  i.applyCodeEdit(session,{channel:0,changes:{'lfo.depth':3}});assert.equal(i.observeCode().globals[9]&3,3,'live enabled state drives sparse LFO editing');
});

test('native Noise overrides DDA mode and needs no shared PCM for Code or hand notes',async t=>{
  const a=await setup(t),b=await setup(t);plain(a);plain(b);const sa=a.beginCode().session,sb=b.beginCode().session;
  for(const [i,session]of [[a,sa],[b,sb]])i.code(session,'setNoise',[4,{enabled:true,frequency:23}]);
  a.code(sa,'setDda',[4,true]);b.code(sb,'setDda',[4,false]);a.code(sa,'keyOn',[4]);b.code(sb,'keyOn',[4]);
  const both=a.generateStereo(2048),noise=b.generateStereo(2048);assert(peak(both)>.001);assert.deepEqual(both,noise,'the native chip gives Noise priority over the DDA bit');
  a.code(sa,'noteOn',[4,'C4']);assert.equal(a.slots[4].noise,true);assert.equal(a.slots[4].dda,false);
  a.noteOn('hand-noise',72,4);assert.equal(a.slots[4].dda,false);assert(peak(a.generateStereo(512))>.001);assert.equal(a.noteOff('hand-noise'),true);
});

test('DDA Code notes use the existing five-bit sample feeder and match ordinary rendering exactly',async t=>{
  const a=await setup(t),b=await setup(t);const preset=dda(a);b.loadPreset(preset);a.noteOn('ordinary',60);
  const {session}=b.beginCode();b.code(session,'noteOn',[0,'C4']);
  assert.deepEqual(b.generateStereo(2048),a.generateStereo(2048));assert.equal(b.observeCode().ddaVoices[0].position,0);
  assert.equal(Object.hasOwn(b.observeCode().dda,'data'),false);assert.deepEqual(b.read().preset.dda,preset.dda);
  b.code(session,'writeDda',[0,5]);b.generateStereo(128);assert.equal(b.observeCode().ddaVoices[0],null);assert.equal(b.observeCode().registers[0][6],5,'raw DAC write retires the software feeder');
});

test('DDA and wave channels share one render pass and DDA timing edits preserve position',async t=>{
  const i=await setup(t);dda(i);const {session}=i.beginCode();i.code(session,'setDda',[2,false]);i.code(session,'setWaveform',[2,waveShape('triangle')]);
  i.code(session,'setPan',[0,15,0]);i.code(session,'setPan',[2,0,15]);i.code(session,'noteOn',[0,60]);i.code(session,'noteOn',[2,69]);i.generateStereo(111);
  const position=i.slots[0].position;i.applyCodeEdit(session,{channel:0,changes:{'dda.speed':2,'dda.loop':true}});assert.equal(i.slots[0].position,position);
  const mixed=i.generateStereo(512);assert(mixed.left.every(Number.isFinite));assert(mixed.right.every(Number.isFinite));assert.notDeepEqual(mixed.left,mixed.right);
  assert.throws(()=>i.applyCodeEdit(session,{channel:0,changes:{'dda.data':''}}),/Synth view/);
});

test('invalid Code calls and invalid sparse patches never retire an existing hand note',async t=>{
  const i=await setup(t);plain(i);const {session}=i.beginCode();i.noteOn('kept',60,1);const before=i.observeCode();
  assert.throws(()=>i.code(session,'setWaveform',[1,[1,2]]));assert.throws(()=>i.code(session,'noteOn',[6,'C4']));
  assert.throws(()=>i.applyCodeEdit(session,{channel:1,changes:{volume:99}}));assert.throws(()=>i.applyCodeEdit(session,{channel:1,changes:JSON.parse('{"__proto__":3}')}));
  assert.deepEqual(i.observeCode(),before);assert.equal(i.noteOff('kept'),true);
});

test('preset imports update the authored checkpoint while leaving the running Code session usable',async t=>{
  const i=await setup(t),p=plain(i),{session}=i.beginCode();i.code(session,'noteOn',[2,'C4']);
  p.wave=waveShape('saw');p.volume=9;p.pan={left:8,right:15};i.applyCodePreset(session,p,{replace:true});
  assert(i.observeCode());i.code(session,'noteOn',[2,'G4']);assert(peak(i.generateStereo(1024))>.001);
  i.stop();assert.deepEqual(i.read().preset,p);assert.deepEqual(i.synth._getState().waveforms[2],p.wave);assert.equal(i.synth._getState().registers[2][4]&31,9);
});

test('common carrier wave/volume edits keep the hardware LFO modulator wave and output independent',async t=>{
  const i=await setup(t),p=plain(i);p.lfo.enabled=true;p.lfo.wave=waveShape('triangle');p.lfo.output={enabled:true,volume:8,pan:{left:3,right:9}};i.loadPreset(p);
  const {session}=i.beginCode();i.code(session,'noteOn',[0,'C4']);i.code(session,'keyOn',[1]);
  const before=i.observeCode();p.wave=waveShape('square');p.volume=19;p.pan.left=7;i.applyCodePreset(session,p,{replace:false});
  const after=i.observeCode();assert.deepEqual(after.waveforms[1],before.waveforms[1]);assert.equal(after.registers[1][4],before.registers[1][4]);assert.equal(after.registers[1][5],before.registers[1][5]);
  assert.deepEqual(after.waveforms[0],p.wave);assert.equal(after.registers[0][4]&31,19);assert.equal(after.registers[0][5]>>4,7);
});

test('a deliberate CH2 output gate edit takes effect and old Code releases cannot steal it',async t=>{
  const i=await setup(t);plain(i);const {session}=i.beginCode();i.code(session,'noteOn',[1,'A3']);
  i.applyCodeEdit(session,{channel:0,changes:{'lfo.output.enabled':true}});
  assert.equal(i.observeCode().registers[1][4]&128,128);assert.equal(i.code(session,'noteOff',[1]),false);assert.equal(i.code(session,'keyOff',[1]),false);
  i.releaseKeyboard();assert.equal(i.observeCode().registers[1][4]&128,0);
  i.applyCodeEdit(session,{channel:0,changes:{'lfo.output.enabled':true}});i.code(session,'keyOn',[1]);i.releaseKeyboard();assert.equal(i.observeCode().registers[1][4]&128,128,'later Code gate now owns the channel');
  i.applyCodeEdit(session,{channel:0,changes:{'lfo.output.enabled':false}});assert.equal(i.observeCode().registers[1][4]&128,0);
});
