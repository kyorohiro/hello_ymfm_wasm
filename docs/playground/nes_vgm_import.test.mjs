import test from 'node:test';
import assert from 'node:assert/strict';
import {detectVgmImport, prepareVgmImport, exportNesVgm} from './playground_vgm_import.js';
import {NesApu} from '../../web/nesapu.js';
import {NesApuSynth, NesApuDirectTransport} from '../../web/nesapusynth.js';
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
function vgm(commands, clock = 1789773 | 0x80000000) {
  const bytes = new Uint8Array(0x100 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]); view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x161, true); view.setUint32(0x34, 0xcc, true); view.setUint32(0x84, clock >>> 0, true);
  bytes.set(commands, 0x100); return bytes;
}
const write = (r, v) => [0xb4, r, v];
const memory = (offset, bytes) => [0x67,0x66,0xc2,bytes.length + 2,0,0,0,offset & 255,offset >> 8,...bytes];
const commands = [
 ...memory(0xc000, [0xff,0x00,0xff,0x00]),
 ...write(0x15, 1), ...write(0, 0xbf), ...write(2, 0xfd), ...write(3, 8),
 0x61, 0x20, 0x03,
 ...write(0x15, 0), ...write(0x3f, 2), ...write(0x29, 128),
 ...Array.from({length:64},(_,i)=>write(0x40+i,i)).flat(), ...write(0x29, 0),
 ...write(0x20, 0xa0), ...write(0x22, 0x74), ...write(0x23, 0),
 ...write(0x24, 0x88), ...write(0x27, 128), ...write(0x28, 1), ...write(0x28, 7), ...write(0x25, 0), ...write(0x26, 80), ...write(0x27, 0),
 0x61,0x20,0x03,
 ...write(0x23, 128), ...write(0x10, 0x4f), ...write(0x11, 64), ...write(0x12, 0), ...write(0x13, 0), ...write(0x15, 16),
 0x61,0x20,0x03, ...write(0x15, 0), 0x61,100,0, 0x66,
];
test('NES detection: NTSC/FDS, mixed, dual and PAL', () => {
 assert.equal(detectVgmImport({nesApuClock:1789773}).family,'nes');
 assert.equal(detectVgmImport({nesApuClock:1789773|0x80000000}).fds,true);
 for (const header of [{nesApuClock:1662607},{nesApuClock:1789773|0x40000000},{nesApuClock:1789773,gameBoyDmgClock:4194304}]) assert.equal(detectVgmImport(header).supported,false);
});
test('NES preflight rejects bad commands, registers, RAM and missing FDS flag', async () => {
 const inputs = [vgm([...write(0x80,1),0x66]),vgm([...write(0x18,1),0x66]),vgm([...write(0x2b,1),0x66]),vgm([...write(0x3f,2),0x66],1789773),vgm([0x50,0x90,0x66]),vgm([...memory(65535,[1,2]),...write(0,1),0x66]),vgm([...write(0,1)]),vgm([0x66])];
 for(const bytes of inputs){assert.equal((await prepareVgmImport({arrayBuffer:async()=>bytes})).detection.supported,false);assert.throws(()=>exportNesVgm(bytes));}
 assert.equal((await prepareVgmImport({arrayBuffer:async()=>vgm(commands)})).detection.supported,true);
});
for (const mode of ['raw','readable','high']) test(`NES ${mode}: exact ordered writes, uploads, waits and audible PCM`, async () => {
 const source = exportNesVgm(vgm(commands),{mode});
 const chip = new NesApu({fds:true}), reference = new NesApu({fds:true});
 const writes=[], uploads=[];let time=0, disposed=0;const pcm=[];
 const transport={clock:1789773,fdsEnabled:true,
  reset(){chip.reset();},writeRegister(r,v){writes.push([time,r,v]);chip.writeRegister(r,v);},
  loadMemory(bytes,address){uploads.push([time,address,[...bytes]]);chip.loadMemory(bytes,address);},
 };
 const synth = new NesApuSynth({transport});writes.length=0;
 synth.dispose=()=>{disposed++;chip.dispose();};
 await new AsyncFunction('createSoundChip','sleepSamples',source)(async(name,options)=>{assert.equal(name,'nes');assert.equal(options.fds,true);return synth;},async(n,rate)=>{assert.equal(rate,44100);pcm.push(...chip.generateStereo(n).left);time+=n;});
 const expected=[], expectedPcm=[];let t=0;
 const {Ym2612VGM}=await import('../js/ym2612vgm.js');const parser=new Ym2612VGM(vgm(commands),{logger:null});
 for(;;){const e=parser.step();if(e.type==='end')break;if(e.type==='wait'){expectedPcm.push(...reference.generateStereo(e.samples).left);t+=e.samples;}else if(e.type==='nes-apu-data')reference.loadMemory(e.data,e.offset);else {const r=e.register<=0x17?0x4000+e.register:e.register===0x3f?0x4023:e.register<=0x2a?0x4080+e.register-0x20:0x4000+e.register;expected.push([t,r,e.value]);reference.writeRegister(r,e.value);}}
 assert.deepEqual(writes,expected);assert.deepEqual(uploads,[[0,0xc000,[255,0,255,0]]]);assert.equal(time,t);assert.equal(disposed,1);assert.deepEqual(pcm,expectedPcm);assert.ok(pcm.some(x=>Math.abs(x)>.01));reference.dispose();
 assert.doesNotMatch(source,/nes\.noteOn|nes\.reset\(/);
 if(mode==='high'){assert.match(source,/nes.pulse.setVoice/);assert.match(source,/nes.setFrequency/);}
 if(mode==='readable')assert.match(source,/FDS wave RAM sample 63/);
});
test('NES conversion disposes on interrupted memory upload or wait',async()=>{
 for(const during of ['memory','wait']){let disposed=0;const source=exportNesVgm(vgm(commands));await assert.rejects(new AsyncFunction('createSoundChip','sleepSamples',source)(async()=>({resetRegisters(){},loadMemory(){if(during==='memory')throw Error('stopped');},writeRegister(){},dispose(){disposed++;}}),async()=>{throw Error('stopped');}),/stopped/);assert.equal(disposed,1);}
});
test('native reset has no Synth writes; raw RAM uploads preserve offsets and own bytes',async()=>{
 let resets=0;const writes=[],uploads=[];const synth=new NesApuSynth({transport:{writeRegister:(...args)=>writes.push(args),reset(){resets++;},loadMemory:(data,address)=>uploads.push({data,address})}});
 writes.length=0;synth.resetRegisters();assert.equal(writes.length,0);assert.equal(resets,2);
 const data=new Uint8Array([1,2,3]);synth.loadMemory(data,0x1234);data.fill(0);assert.equal(uploads[0].address,0x1234);assert.deepEqual([...uploads[0].data],[1,2,3]);
 assert.throws(()=>synth.loadMemory(new Uint8Array(2),65535),/RAM range/);
});
