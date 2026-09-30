import {YM2612Synth} from '../../web/ym2612synth.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {detectVgmImport, prepareVgmImport, exportGameboyVgm, addVgmSoundChipSetup} from './playground_vgm_import.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {GameboyApu} from '../../web/gameboyapu.js';
import {GameboySynth, GameboyDirectTransport} from '../../web/gameboysynth.js';
import factory from '../../web/generated/gameboy_apu_wasm.js';
const fixture=await readFile(new URL('../../test/fixtures/gameboy-tone.vgm',import.meta.url));
const file=bytes=>({arrayBuffer:async()=>bytes});
function vgm(commands) {
  const bytes=new Uint8Array(0x100+commands.length), view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);
  view.setUint32(8,0x161,true);view.setUint32(0x34,0xcc,true);view.setUint32(0x80,4194304,true);
  bytes.set(commands,0x100);return bytes;
}
test('chip detection separates OPN, GB, unsupported and mixed/dual/custom clock inputs',()=>{
  for(const chip of ['ym2203','ym2608','ym2610','ym2612']) assert.equal(detectVgmImport({[chip+'Clock']:8000000}).family,'opn');
  assert.equal(detectVgmImport({gameBoyDmgClock:4194304}).family,'gameboy');
  assert.match(detectVgmImport({ym2612Clock:7670454,psgClock:3579545}).message,/DAC and PSG follow/);
  for(const h of [{},{ym2151Clock:4000000},{ym2203Clock:4000000,ym2612Clock:7670454},{gameBoyDmgClock:4194304|0x40000000},{gameBoyDmgClock:4000000}]) assert.equal(detectVgmImport(h).supported,false);
});
test('preflight supports VGM and VGZ; rejects malformed or unsupported Game Boy events before conversion',async()=>{
  assert.equal((await prepareVgmImport(file(fixture))).detection.supported,true);
  const gz=await readFile(new URL('../../test/fixtures/gameboy-tone.vgz',import.meta.url));
  assert.equal((await prepareVgmImport(file(gz))).detection.family,'gameboy');
  for(const commands of [[0xb3,0x16,128,0xe0,0,0,0,0,0x66],[0xb3,0x80,1,0x66],[0x50,0x90,0x66],[0xb3,0x30,1,0x66],[0xb3,0,1]]) {
    const input=vgm(commands);
    assert.equal((await prepareVgmImport(file(input))).detection.supported,false);
    assert.throws(()=>exportGameboyVgm(input));
  }
  await assert.rejects(prepareVgmImport(file(new Uint8Array(4))));
});
test('generated raw/readable code preserves all writes, timestamps, power changes, wave writes and final wait',async()=>{
  const input=vgm([0xb3,0x16,0x80,0xb3,2,0xc2,0xb3,1,0x40,0x70,0xb3,4,0xc6,0xb3,0x20,0xab,0xb3,0x16,0,0xb3,0x16,0x80,0xb3,0x12,0x3d,0x61,100,0,0x66]);
  for(const mode of ['raw','readable']) {
    const code=exportGameboyVgm(input,{mode});const writes=[];let time=0,disposed=0;
    await new (Object.getPrototypeOf(async function(){}).constructor)('createSoundChip','sleepSamples',code)(
      async name=>{assert.equal(name,'gameboy');return {reset(){},writeRegister(r,v){writes.push([time,r,v]);},dispose(){disposed++;}};},
      async(n,rate)=>{assert.equal(rate,44100);time+=n;});
    const parser=new Ym2612VGM(input,{logger:null}), expected=[];let clock=0;
    for(;;){const e=parser.step();if(e.type==='end')break;if(e.type==='wait')clock+=e.samples;else expected.push([clock,e.register,e.value]);}
    assert.deepEqual(writes,expected);assert.equal(time,clock);assert.equal(disposed,1);
    assert.doesNotMatch(code,/gb\.(initialize|wave\.stopAndSetWaveform|pulse\.keyOn)/);
    if(mode==='readable'){assert.match(code,/initial volume 12, down, period 2/);assert.match(code,/duty 25%/);assert.match(code,/sample 1\):.*wave RAM/);}
  }
});
test('generated conversion disposes on interrupted wait',async()=>{
  let disposed=false;
  const code=exportGameboyVgm(vgm([0xb3,0x16,128,0x70,0x66]));
  await assert.rejects(new (Object.getPrototypeOf(async function(){}).constructor)('createSoundChip','sleepSamples',code)(async()=>({reset(){},writeRegister(){},dispose(){disposed=true;}}),async()=>{throw new Error('stop');}),/stop/);
  assert.equal(disposed,true);
});
test('generated Game Boy code produces identical core PCM to the original event stream',async()=>{
  const wasmBinary=await readFile(new URL('../../web/generated/gameboy_apu_wasm.wasm',import.meta.url));
  const create=()=>GameboyApu.create({moduleFactory:factory,sampleRate:44100,moduleOptions:{wasmBinary}});
  const core=await create(), reference=await create();
  const actual=[],expected=[];const append=(to,out)=>{for(const x of out.left)to.push(x);for(const x of out.right)to.push(x);};
  try {
    const synth=new GameboySynth({transport:new GameboyDirectTransport(core)});
    await new (Object.getPrototypeOf(async function(){}).constructor)('createSoundChip','sleepSamples',exportGameboyVgm(fixture,{mode:'high'}))(async()=>synth,async n=>append(actual,core.generateStereo(n)));
    reference.reset();const parser=new Ym2612VGM(fixture,{logger:null});
    for(;;){const e=parser.step();if(e.type==='end')break;if(e.type==='wait')append(expected,reference.generateStereo(e.samples));else reference.writeRegister(e.register,e.value);}
    assert.deepEqual(actual,expected);assert.ok(actual.some(x=>Math.abs(x)>0.001));
  } finally {core.dispose();reference.dispose();}
});

test('S98 preparation detects OPN chips before the options dialog',async()=>{
  for(const chip of ['ym2203','ym2608','ym2612']) {
    const bytes=await readFile(new URL(`../../test/fixtures/s98-${chip}.s98`,import.meta.url));
    const result=await prepareVgmImport(file(bytes));
    assert.equal(result.detection.family,'opn');assert.equal(result.detection.chip,chip);
  }
});

test('one OPN chip remains importable with other chips; omitted dual chips do not block FM',()=>{
  for (const chip of ['ym2203','ym2608','ym2610','ym2612']) {
    const d=detectVgmImport({[chip+'Clock']:8000000,rf5c164Clock:12500000,psgClock:3579545,gameBoyDmgClock:4194304|0x40000000});
    assert.equal(d.supported,true);assert.equal(d.family,'opn');assert.equal(d.chip,chip);
    assert.deepEqual(d.omittedChips,chip === 'ym2612' ? ['gameBoyDmg'] : ['rf5c164','psg','gameBoyDmg']);
    assert.match(d.message,chip === 'ym2612' ? /Game Boy DMG will be omitted/ : /RF5C164 \+ PSG \+ Game Boy DMG will be omitted/);
  }
  assert.equal(detectVgmImport({ym2612Clock:7670454|0x40000000,psgClock:3579545}).supported,false);
});
test('YM2612 + RF5C164 + PSG imports the same FM code as the isolated YM2612 stream',async()=>{
  const mixed=vgm([0x52,0x22,8,0xb1,0x07,0xc0,0x50,0x90,0x61,100,0,0x52,0x28,0xf0,0x66]);
  const clean=vgm([0x52,0x22,8,0x61,100,0,0x52,0x28,0xf0,0x66]);
  for (const input of [mixed,clean]) {
    const view=new DataView(input.buffer);view.setUint32(0x80,0,true);view.setUint32(0x2c,7670454,true);
  }
  const view=new DataView(mixed.buffer);view.setUint32(0x6c,12500000,true);view.setUint32(0x0c,3579545,true);
  const prepared=await prepareVgmImport(file(mixed));
  assert.equal(prepared.detection.supported,true);assert.equal(prepared.detection.family,'opn');
  assert.match(prepared.detection.message,/RF5C164/);assert.match(prepared.detection.message,/PSG/);
  const reference=new Ym2612VGM(clean,{logger:null});
  for (const mode of [{},{high:true},{compact:true},{scheduled:true}]) {
    const options={...mode,splitChannels:false,includeDac:false,includePsg:false};
    assert.equal(prepared.vgm.exportPlaygroundJavaScript(options),reference.exportPlaygroundJavaScript(options));
  }
});

test('high-level conversion preserves exact timed writes with raw fallback across power cycles',async()=>{
  const commands=[];
  const write=(r,v)=>commands.push(0xb3,r,v);
  write(2,0xf2); // Off-state write remains raw.
  write(22,128);write(0,0x21);write(1,0x40);write(2,0xc2);
  write(3,0xd8);write(4,6); // Adjacent frequency pair, no trigger.
  write(4,0x86); // Preserve trigger as one raw write.
  write(6,0x3f);write(6,0xbf); // Length change raw, then duty-only API.
  write(7,0x91);write(18,0x3d);write(17,0xa3);write(12,0x40);
  write(20,0x35);write(21,0x11);write(21,0xff); // One-channel vs multiple routes.
  write(8,0x80);commands.push(0x70);write(9,6); // Separated frequency writes stay raw.
  write(13,0x22);write(14,0x46); // Changes length enable: raw fallback.
  write(13,0x33);write(14,0x47); // Same flags: API pair.
  write(32,0xab);write(22,0);write(18,0x21);write(22,128);write(17,9);
  commands.push(0x61,100,0,0x66);
  const input=vgm(commands), traces=[];
  for(const mode of ['raw','readable','high']) {
    const code=exportGameboyVgm(input,{mode});let t=0;const trace=[];
    const synth=new GameboySynth({transport:{reset(){trace.push(['reset',t]);},writeRegister(r,v){trace.push([t,r,v]);},dispose(){trace.push(['dispose',t]);}}});
    await new (Object.getPrototypeOf(async function(){}).constructor)('createSoundChip','sleepSamples',code)(async()=>synth,async n=>{t+=n;});
    traces.push(trace);
    if(mode==='high') {
      for(const name of ['adoptRegisterState','pulse.setDuty','pulse.setEnvelope','pulse.setSweep','pulse.setFrequency','wave.setFrequency','wave.setLevel','noise.setEnvelope','noise.setParameters','setPan','setMasterVolume']) assert.ok(code.includes(name),name);
      assert.match(code,/gb.writeRegister\(0x04, 0x86\)/);
      assert.match(code,/gb.writeRegister\(0x08, 0x80\)/);
      assert.match(code,/gb.writeRegister\(0x20, 0xab\)/);
    }
  }
  assert.deepEqual(traces[2],traces[0]);assert.deepEqual(traces[1],traces[0]);
});


test('YM2612 import explicitly acquires FM once before registering unchanged channel loops',async()=>{
 const input=vgm([0x52,0x30,1,0x70,0x52,0x28,0xf0,0x70,0x52,0x28,0,0x66]);
 const view=new DataView(input.buffer);view.setUint32(0x80,0,true);view.setUint32(0x2c,7670454,true);
 for(const mode of ['write','high','schedule'])for(const splitChannels of [false,true]) {
  const original=new Ym2612VGM(input,{logger:null}).exportPlaygroundJavaScript({high:mode==='high',scheduled:mode==='schedule',splitChannels,includeDac:false,dacBase64:false});
  const source=addVgmSoundChipSetup(original,{family:'opn'},'ym2612');
  assert.equal(source,'const fm = await useSoundChip("ym2612");\n\n'+original);
  const traces=[];
  for(const code of [original,source]) {
   let time=0,acquired=false,count=0;const trace=[],loops=[];
   const synth=new YM2612Synth({transport:{write:(port,r,v)=>trace.push([time,port,r,v])}});trace.length=0;
   const scope={fm:synth,useSoundChip:async name=>{assert.equal(name,'ym2612');acquired=true;count++;return synth;},
    liveLoop:(name,fn)=>{if(code===source)assert.equal(acquired,true);loops.push({name,fn});},
    sleepSamples:async n=>{time+=n;},write:(...a)=>{trace.push([time,...(a.length===2?[0,...a]:a)]);},
    beginSampleSchedule:()=>0,scheduleWritesSamples:(start,entries)=>{trace.push(...entries);},
    CH1:0,CH2:1,CH3:2,CH4:3,CH5:4,CH6:5,OP1:0,OP2:1,OP3:2,OP4:3};
   const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
   await new AsyncFunction(...Object.keys(scope),`"use strict"; {\n${code}\n}`)(...Object.values(scope));
   for(const loop of loops){time=0;await loop.fn();}
   assert.equal(count,code===source?1:0);traces.push({trace,loops:loops.map(x=>x.name)});
  }
  assert.deepEqual(traces[1],traces[0]);
 }
});
test('native OPN and independent chips retain their original ownership; translated FM uses YM2612',()=>{
 const source='// generated';
 for(const chip of ['ym2608'])assert.equal(addVgmSoundChipSetup(source,{family:'opn',chip},chip),source);
 for(const family of ['gameboy','rf5c164'])assert.equal(addVgmSoundChipSetup(source,{family},'ym2612'),source);
 for(const chip of ['ym2612','ym2203','ym2608','ym2610'])assert.match(addVgmSoundChipSetup(source,{family:'opn',chip,rf5c164:true},'ym2612'),/^const fm = await useSoundChip/);
});


test('native YM2203 and YM2610 imports explicitly acquire the selected default FM',()=>{
 for(const chip of ['ym2203','ym2610'])assert.equal(addVgmSoundChipSetup('// body',{family:'opn',chip},chip),`const fm = await useSoundChip("${chip}");\n\n// body`);
});

import {exportYm2203FullVgm} from './playground_vgm_import.js';
test('YM2203 Write and Schedule preserve FM + SSG bytes, source clock and sample times',async()=>{
 const input=vgm([0x55,0,12,0x55,8,15,0x61,0xb9,1,0x55,0xa0,99,0x61,0xb9,1,0x55,8,0,0x70,0x66]);
 const view=new DataView(input.buffer);view.setUint32(0x80,0,true);view.setUint32(0x44,4000000,true);
 const expected=[[0,0,12],[0,8,15],[441,0xa0,99],[882,8,0]];
 for(const mode of ['write','schedule']){
  const source=exportYm2203FullVgm(input,{mode});
  assert.match(source,/const opn = await useSoundChip\("ym2203"\)/);
  let time=0,clock,loop;const writes=[];
  const opn={setClock:async c=>{clock=c;},reset(){},write(p,r,v){assert.equal(p,0);writes.push([time,r,v]);},scheduleRegisters:async(events,duration)=>{writes.push(...events);time=duration;}};
  await new (Object.getPrototypeOf(async function(){}).constructor)('useSoundChip','liveLoop','sleepSamples',source)(async name=>{assert.equal(name,'ym2203');return opn;},(name,fn)=>{assert.equal(name,'ym2203');loop=fn;},async n=>{time+=n;});
  await loop();assert.equal(clock,4000000);assert.equal(time,883);assert.deepEqual(writes,expected);
 }
 assert.throws(()=>exportYm2203FullVgm(input,{mode:'invalid'}),/Write, Schedule and High/);
 view.setUint32(0x44,0x40000000|4000000,true);assert.throws(()=>exportYm2203FullVgm(input),/single YM2203/);
});
