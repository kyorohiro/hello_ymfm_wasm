import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Ym2608} from '../../tetorica_src/runtime/ym2608.js';
import {YM2608Synth,YM2608DirectTransport} from '../../tetorica_src/runtime/ym2608synth.js';
import {FM_PRESETS} from '../../tetorica_src/runtime/megasynth-fm-presets.js';

const directory=process.env.YM2608_SOURCE_GAIN_WASM_DIR
  ? pathToFileURL(resolve(process.env.YM2608_SOURCE_GAIN_WASM_DIR)+'/')
  : new URL('../../tetorica_src/runtime/generated/',import.meta.url);
const factory=(await import(new URL('ym2608_wasm.js',directory))).default;
const wasmBinary=await readFile(new URL('ym2608_wasm.wasm',directory));
const rhythmRom=await readFile(new URL('../../tetorica_src/runtime/tetorica_ym2608_adpcm_rom.bin',import.meta.url));
let module;
const moduleFactory=async()=>module??=await factory({wasmBinary});
const parts=['fm','ssg','rhythm','adpcm'];
const peak=pcm=>pcm.left.reduce((max,value)=>Math.max(max,Math.abs(value)),0);
function closePcm(actual,expected,scale=1) {
  for(const side of ['left','right'])for(let index=0;index<actual[side].length;index++)
    assert(Math.abs(actual[side][index]-expected[side][index]*scale)<1e-6,`${side} frame${index}`);
}
async function fixture(t,active=parts) {
  const chip=await Ym2608.create({moduleFactory});t.after(()=>chip.dispose());
  const synth=new YM2608Synth({transport:new YM2608DirectTransport(chip)});
  if(active.includes('fm')) {
    const preset=structuredClone(FM_PRESETS.sine);preset.operators[3].tl=40;
    synth.setPreset(0,preset);synth.noteOn(0,'C4');
  }
  if(active.includes('ssg')) {
    synth.ssg.setFrequency(0,330);synth.ssg.setMixer(0,{tone:true,noise:false});synth.ssg.setVolume(0,4);
  }
  if(active.includes('rhythm')) {
    synth.rhythm.loadRom(rhythmRom);synth.rhythm.setVolume(40);synth.rhythm.setVoice(0,{volume:18,left:true,right:true});synth.rhythm.keyOn(0);
  }
  if(active.includes('adpcm')) {
    await synth.adpcm.loadSample({channels:[Float32Array.from({length:128},(_,index)=>.4*Math.sin(index*Math.PI/64))],sampleRate:16000});
    synth.adpcm.setVolume(96);synth.adpcm.setPan(true,true);synth.adpcm.keyOn({repeat:true});
  }
  chip.generateStereo(1024);
  return {chip,synth};
}

for(const source of parts)test(`real YM2608 ${source} source fader scales only output and preserves muted evolution`,async t=>{
  const {chip}=await fixture(t,[source]),saved=chip.saveState(),reference=chip.generateStereo(8192);
  assert(peak(reference)>1e-5,source+' fixture must be audible before fading');
  const registers=[];chip.setHooks({onWrite:value=>registers.push(value)});
  for(const gain of [0,.5,1.5]) {
    chip.loadState(saved);chip.setSourceGains({[source]:gain});
    closePcm(chip.generateStereo(8192),reference,gain);
    assert.deepEqual(chip.getOutputGains(),{fm:1,ssg:1});
  }
  assert.deepEqual(registers,[],'source faders do not rewrite instrument registers');
  chip.loadState(saved);chip.setSourceGains({[source]:0});chip.generateStereo(8192);chip.setSourceGains({[source]:1});
  const resumed=chip.generateStereo(4096);
  chip.loadState(saved);chip.generateStereo(8192);assert.deepEqual(chip.generateStereo(4096),resumed,'silent sources keep their exact phase/envelope/sample evolution');
  chip.loadState(saved);assert.deepEqual(chip.generateStereo(8192),reference,'opaque snapshots restore source gains and chip phase');
});

test('real mixed YM2608 four-source faders combine independently with the legacy two-bus gains',async t=>{
  const {chip}=await fixture(t),saved=chip.saveState(),reference=chip.generateStereo(4096),isolated={};
  assert(peak(reference)<.5,'comparison stays below clipping');
  for(const source of parts) {
    chip.loadState(saved);chip.setSourceGains(Object.fromEntries(parts.map(part=>[part,part===source?1:0])));
    isolated[source]=chip.generateStereo(4096);
  }
  const sources={fm:.6,ssg:.4,rhythm:.3,adpcm:.2},legacy={fm:.8,ssg:.7};
  chip.loadState(saved);chip.setSourceGains(sources);chip.setOutputGains(legacy);const mixed=chip.generateStereo(4096);
  for(const side of ['left','right'])for(let index=0;index<mixed[side].length;index++) {
    const expected=parts.reduce((sum,part)=>sum+isolated[part][side][index]*sources[part]*(part==='ssg'?legacy.ssg:legacy.fm),0);
    assert(Math.abs(mixed[side][index]-expected)<1e-6,side+' mixed frame'+index);
    const unity=parts.reduce((sum,part)=>sum+isolated[part][side][index],0);
    assert(Math.abs(reference[side][index]-unity)<1e-6,'unity source mix retains the original PCM');
  }
  const snapshot=chip.saveState(),after=chip.generateStereo(2048);
  chip.setSourceGains({adpcm:0,rhythm:0});chip.setOutputGains({fm:0,ssg:0});chip.loadState(snapshot);
  assert.deepEqual(chip.getSourceGains(),sources);assert.deepEqual(chip.getOutputGains(),legacy);assert.deepEqual(chip.generateStereo(2048),after);
});

test('real native source setter rejects every invalid field without partial host-gain changes',async t=>{
  const {chip}=await fixture(t),gains={fm:.4,ssg:.5,rhythm:.6,adpcm:.7};chip.setSourceGains(gains);
  const saved=chip.saveState(),expected=chip.generateStereo(2048);
  for(const values of [[NaN,1,1,1],[1,-1,1,1],[1,1,Infinity,1],[1,1,1,1024.1]]){
    chip.loadState(saved);
    assert.equal(chip.module._ym2608_set_source_gains(chip.handle,...values),0);
    assert.deepEqual(chip.generateStereo(2048),expected,'native rejection cannot partly apply earlier valid fields');
  }
});
