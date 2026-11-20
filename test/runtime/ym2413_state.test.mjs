// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {Ym2413} from '../../tetorica_src/runtime/ym2413.js';
import {Ym2413AudioEngine} from '../../tetorica_src/runtime/ym2413audioengine.js';
import {YM2413Synth,YM2413_USER_PRESETS} from '../../tetorica_src/runtime/ym2413synth.js';
import psgFactory from '../../docs/generated/segapsg_wasm.js';
const directory=path.resolve(process.env.YM2413_STATE_WASM_DIR ?? 'docs/generated');
const {default:factory}=await import(pathToFileURL(path.join(directory,'ym2413_wasm.js')));
const wasmBinary=await readFile(path.join(directory,'ym2413_wasm.wasm'));
const makeChip=()=>Ym2413.create({moduleFactory:factory,moduleOptions:{wasmBinary}});
function program(chip) {
 const synth=new YM2413Synth({transport:{writeRegister(r,v){chip.write(0,r);chip.write(1,v);}}});
 synth.setUserPatch(YM2413_USER_PRESETS.bell);
 synth.setUserOperator(0,{am:true,vibrato:true,egt:true});synth.setUserOperator(1,{am:true,vibrato:true});
 for(let ch=0;ch<6;ch++){synth.setVoice(ch,{instrument:ch%3,attenuation:4,sustain:Boolean(ch&1)});synth.noteOn(ch,48+ch*3);}
 synth.setRhythm({enabled:true,bassDrum:true,snare:true,hiHat:true,tom:true,cymbal:true});
 synth.setRhythmLevels({bassDrum:3,snare:4,hiHat:4,tom:3,cymbal:3});
 for(let ch=6;ch<9;ch++)synth.setNote(ch,48+ch);
 return synth;
}
function pcmEqual(a,b) {assert.deepEqual(a.left,b.left);assert.deepEqual(a.right,b.right);}
test('YM2413 native state preserves phase, feedback, Envelope/LFO/Noise/Rhythm and pending bus address',async t=>{
 const chip=await makeChip(),other=await makeChip();t.after(()=>{chip.dispose();other.dispose();});
 assert.equal(chip.supportsState(),true);program(chip);chip.generateStereo(1379);chip.setMuteMask(1<<2);
 chip.write(0,0x30);const saved=chip.saveState();assert(Object.isFrozen(saved)&&saved.byteLength>0);
 chip.write(1,0x25);const expected=chip.generateStereo(2048);
 program(chip);chip.setMuteMask(511);chip.generateStereo(8192);chip.reset();
 chip.loadState(saved);assert.equal(chip.muteMask,1<<2);chip.write(1,0x25);pcmEqual(chip.generateStereo(2048),expected);
 chip.loadState(saved);const stable=chip.saveState();
 assert.throws(()=>other.loadState(saved),/foreign/);assert.throws(()=>chip.loadState({...saved}),/foreign/);
 const actual=chip.generateStereo(512);chip.loadState(stable);pcmEqual(chip.generateStereo(512),actual);
 const size=chip.module._ym2413_save_state(chip.handle,0),ptr=chip.module._malloc(size);
 try {assert.equal(chip.module._ym2413_load_state(chip.handle,ptr,size-1),0);}finally{chip.module._free(ptr);}
});
for(const sampleRate of [22050,44100,48000,96000])test(`YM2413 engine ${sampleRate}: exact resampler and PSG continuation, output-setting compatibility and owned states`,async t=>{
 const make=()=>Ym2413AudioEngine.create({ym2413ModuleFactory:factory,ym2413ModuleOptions:{wasmBinary},segaPsgModuleFactory:psgFactory,psgClock:3579545,outputSampleRate:sampleRate});
 const e=await make(),other=await make();t.after(()=>{e.dispose();other.dispose();});
 program(e.ym2413);for(const v of [0x84,0x0f,0x93,0xc7,0x05,0xd5,0xe7,0xf4])e.writePsg(v);
 e.processFrames(1379);e.setChannelMuted(2,true);e.setPsgChannelMuted(1,true);e.setMasterVolume(.4);
 const saved=e.saveState(),timing=[e.remainder,e.lastSample];const expected=e.processFrames(2049);
 e.reset();e.setMasterVolume(3);e.setPsgMuted(true);e.setPsgChannelMuted(0,true);e.processFrames(4000);
 assert.throws(()=>e.loadState(saved),/incompatible/);
 e.setMasterVolume(.4);e.setPsgMuted(false);e.setPsgChannelMuted(0,false);
 e.loadState(saved);assert.deepEqual([e.remainder,e.lastSample],timing);assert.equal(e.getMasterVolume(),.4);assert.equal(e.psgMuted,false);assert.equal(e.psg.muteMask,2);
 pcmEqual(e.processFrames(2049),expected);
 const stable=e.saveState();assert.throws(()=>other.loadState(saved),/foreign/);assert.throws(()=>e.loadState({...saved}),/foreign/);
 const actual=e.processFrames(511);e.loadState(stable);pcmEqual(e.processFrames(511),actual);
});

test('VgmPlayer retires YM2413 checkpoints when Mixer settings change', async t => {
 const {VgmPlayer}=await import('../../tetorica_src/runtime/vgmplayer.js');
 const {createDemoVgm}=await import('../../docs/synth-smsgear/fixtures.js');
 const e=await Ym2413AudioEngine.create({ym2413ModuleFactory:factory,ym2413ModuleOptions:{wasmBinary}});t.after(()=>e.dispose());
 const player=new VgmPlayer(e);player.checkpointIntervalSeconds=.01;player.load(createDemoVgm({psg:false}));player.play();
 const l=new Float32Array(2048),r=new Float32Array(2048);player.process(l,r,2048);player.captureCheckpoint();
 assert(player.checkpointStats().count>0);e.setMasterVolume(.4);
 assert.equal(player.restoreCheckpoint(2048),0);assert.equal(player.checkpointStats().count,0);assert.equal(e.getMasterVolume(),.4);
});
