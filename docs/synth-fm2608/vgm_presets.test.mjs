import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {YM2608Synth} from '../js/ym2608synth.js';
import {extractFm2608VgmPresets} from './vgm_presets.js';
import {readFmPreset,FM_PRESETS,readPreset,decodeBase64} from './preset.js';

function recording() {
  const commands = [];
  const chip = new YM2608Synth({transport:{write:(port,register,value) => commands.push(0x56+port,register,value)}});
  return {chip,commands,wait() {commands.push(0x62);}};
}
function vgm(commands,{clock=8000000,opn=false} = {}) {
  const bytes = new Uint8Array(256+commands.length+1),view = new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);
  view.setUint32(0x34,256-0x34,true);view.setUint32(opn ? 0x44 : 0x48,clock,true);
  bytes.set(commands,256);bytes[bytes.length-1]=0x66;return bytes;
}
function memoryBlock(data,address=64) {
  const block = new Uint8Array(15+data.length),view = new DataView(block.buffer);
  block.set([0x67,0x66,0x81]);view.setUint32(3,8+data.length,true);
  view.setUint32(7,0x200000,true);view.setUint32(11,address,true);block.set(data,15);return block;
}
const extract = source => extractFm2608VgmPresets(source,{yieldTask:async()=>{}});

test('FM extraction coalesces timestamp writes, keeps partial gates and shares a voice across Auto channels',async()=>{
  const r=recording(),preset=readFmPreset(FM_PRESETS.sine);
  r.chip.setPreset(0,preset);r.chip.setLfo(true,4);r.chip.keyOn(0,[3]);
  r.chip.setAlgo(0,7,5);r.wait();
  r.chip.noteOff(0);r.chip.setPreset(1,{...preset,feedback:5});r.chip.keyOn(1,[3]);r.wait();
  r.chip.keyOn(1,[2,3]);r.wait();
  const bytes=vgm(r.commands),original=bytes.slice(),result=await extract(bytes);
  assert.deepEqual(bytes,original);
  assert.equal(result.presets.length,2);
  const voice=result.presets[0];
  assert.deepEqual(voice.selection,{section:'fm',channel:'auto'});
  assert.equal(voice.source.firstSample,0);assert.equal(voice.source.occurrences,2);
  assert.deepEqual(voice.source.channels,[0,1]);
  for(const channel of voice.preset.fm){assert.equal(channel.feedback,5);assert.equal(channel.keyMask,8);}
  assert.deepEqual(voice.preset.lfo,{enabled:true,frequency:4});
  assert.equal(result.presets[1].preset.fm[0].keyMask,12);
  assert.deepEqual(readPreset(voice.preset),voice.preset);
});

test('CH3 special frequencies and timer-driven CSM remain portable hardware settings',async()=>{
  const r=recording();r.chip.setPreset(2,readFmPreset(FM_PRESETS.sine));
  r.chip.setChannel3SpecialMode(true);
  for(let operator=0;operator<4;operator++)r.chip.setChannel3SpecialFrequency(operator,operator+1,400+operator*100);
  r.chip.keyOn(2,[1,3]);r.wait();r.chip.keyOff(2);
  r.chip.write(0,0x24,0xf0);r.chip.write(0,0x25,2);r.chip.write(0,0x27,0x81);r.wait();
  const result=await extract(vgm(r.commands));
  assert.equal(result.presets.length,2);
  const [special,csm]=result.presets;
  assert.deepEqual(special.selection,{section:'fm',channel:2});
  assert.equal(special.preset.channel3.mode,'special');assert.equal(special.preset.fm[2].keyMask,10);
  assert.deepEqual(special.preset.channel3.frequencies,Array.from({length:4},(_,operator)=>({block:operator+1,fnum:400+operator*100})));
  assert.equal(csm.preset.channel3.mode,'csm');assert.equal(csm.preset.channel3.timerA,0x3c2);
  assert.deepEqual(csm.selection,{section:'fm',channel:2});
});

test('unrecorded OPNA stereo routing follows the current core reset defaults',async()=>{
  const r=recording();r.chip.setPreset(0,readFmPreset(FM_PRESETS.sine));r.chip.keyOn(0);r.wait();
  const commands=[];
  for(let offset=0;offset<r.commands.length;) {
    const command=r.commands[offset];
    if(command===0x62){commands.push(command);offset++;continue;}
    if(r.commands[offset+1] < 0xb4 || r.commands[offset+1] > 0xb6) commands.push(...r.commands.slice(offset,offset+3));
    offset+=3;
  }
  const result=await extract(vgm(commands));assert.equal(result.presets.length,1);
  assert.deepEqual(result.presets[0].preset.fm[0].pan,{left:true,right:true});
});

test('SSG extraction retains active shared noise/envelope settings while pitch alone deduplicates',async()=>{
  const r=recording();r.chip.ssg.tone(0,{frequency:220,volume:10});r.wait();
  r.chip.ssg.setFrequency(0,440);r.chip.write(0,6,25);r.wait();
  r.chip.ssg.setMixer(0,{tone:true,noise:true});r.chip.ssg.setEnvelope({period:512,shape:10});r.chip.ssg.setVolume(0,10,true);r.wait();
  const result=await extract(vgm(r.commands));
  assert.equal(result.presets.length,2);
  const [tone,envelope]=result.presets;
  assert.equal(tone.source.occurrences,2);assert.deepEqual(tone.selection,{section:'ssg',channel:'auto'});
  assert(tone.preset.ssg.channels.every(voice=>voice.volume===10&&!voice.envelope&&!voice.noise));
  assert(envelope.preset.ssg.channels.every(voice=>voice.envelope&&voice.noise&&voice.tone));
  assert.equal(envelope.preset.ssg.noisePeriod,25);assert.equal(envelope.preset.ssg.envelopePeriod,512);assert.equal(envelope.preset.ssg.envelopeShape,10);
});

test('silent timestamp gates, disabled upper FM channels and SSG DC-only routing produce no false sounds',async()=>{
  const r=recording();r.chip.setPreset(0,readFmPreset(FM_PRESETS.sine));r.chip.keyOn(0);r.chip.keyOff(0);
  r.chip.setPreset(3,readFmPreset(FM_PRESETS.sine));r.chip.keyOn(3);r.chip.write(0,0x29,0x1f);
  r.chip.ssg.setMixer(0,{tone:false,noise:false});r.chip.ssg.setVolume(0,15);r.wait();
  const result=await extract(vgm(r.commands));assert.deepEqual(result.presets,[]);
});

test('Rhythm preserves its physical voice, pan and valid zero voice-level settings',async()=>{
  const r=recording();r.chip.rhythm.setVolume(63);r.chip.rhythm.setVoice(4,{volume:0,left:true,right:false});r.chip.rhythm.keyOn(4);r.wait();
  const result=await extract(vgm(r.commands));assert.equal(result.presets.length,1);
  const voice=result.presets[0];assert.equal(voice.section,'rhythm');assert.deepEqual(voice.selection,{section:'rhythm',channel:4});
  assert.equal(voice.preset.rhythm.volume,63);assert.deepEqual(voice.preset.rhythm.voices[4],{volume:0,left:true,right:false});
});

test('complete ADPCM-B blocks retain exact bytes, addressing, rate and repeat while incomplete streams report omissions',async()=>{
  const r=recording(),data=Uint8Array.from({length:32},(_,i)=>i*7&255);
  r.commands.push(...memoryBlock(data));r.chip.adpcm.setSample({start:64,end:96});
  const actualRate=r.chip.adpcm.setPlaybackRate(22050);
  r.chip.adpcm.setVolume(123);r.chip.adpcm.setPan(true,false);r.chip.adpcm.keyOn({repeat:true});r.wait();
  r.chip.adpcm.setSample({start:128,end:160});r.chip.adpcm.keyOn();r.wait();
  r.chip.write(1,0,0x80);r.wait();
  const result=await extract(vgm(r.commands));assert.equal(result.presets.length,1);
  const voice=result.presets[0],sample=voice.preset.adpcm;
  assert.deepEqual(voice.selection,{section:'adpcm',channel:0});assert.deepEqual(decodeBase64(sample.data),data);
  assert.equal(sample.address,64);assert.equal(sample.start,64);assert.equal(sample.end,96);
  assert.equal(sample.sampleRate,actualRate);assert.equal(sample.rootNote,60);assert.equal(sample.volume,123);
  assert.equal(sample.left,true);assert.equal(sample.right,false);assert.equal(sample.repeat,true);
  assert(result.warnings.some(value=>/complete ADPCM sample/.test(value)));
  assert(result.warnings.some(value=>/CPU-driven live streams/.test(value)));
});

test('YM2203 VGZ and S98 reuse compatibility preparation and can cancel without producing partial results',async()=>{
  const writes=[0x55,7,0x3e,0x55,8,10,0x62],source=vgm(writes,{opn:true,clock:3993600});
  const result=await extract(gzipSync(source));
  assert.equal(result.source.chip,'ym2203');assert.equal(result.source.format,'VGZ');assert.equal(result.source.playbackClock,7987200);
  assert.equal(result.presets[0].section,'ssg');
  const s98Commands=[0,7,0x3e,0,8,10,0xff,0xfd],s98=new Uint8Array(48+s98Commands.length),view=new DataView(s98.buffer);
  s98.set([83,57,56,51]);view.setUint32(4,1,true);view.setUint32(8,100,true);view.setUint32(0x14,48,true);
  view.setUint32(0x1c,1,true);view.setUint32(0x20,2,true);view.setUint32(0x24,3993600,true);s98.set(s98Commands,48);
  assert.equal((await extract(s98)).presets.length,1);
  const controller=new AbortController();controller.abort();
  await assert.rejects(extractFm2608VgmPresets(source,{signal:controller.signal}),{name:'AbortError'});
  const invalid=source.slice();new DataView(invalid.buffer).setUint32(0x2c,7670454,true);
  await assert.rejects(extract(invalid),/Unsupported chip/);
});

test('completed CPU-uploaded ADPCM memory is imported through the same hardware transfer observer',async()=>{
  const r=recording(),data=Uint8Array.from({length:32},(_,i)=>255-i);
  // The transfer spans a larger end address so all 32 selected bytes are written.
  r.chip.adpcm.setSample({start:64,end:128});r.chip.write(1,0,0x60);
  for(const value of data)r.chip.write(1,8,value);
  r.chip.write(1,0,1);r.chip.adpcm.setSample({start:64,end:96});
  r.chip.adpcm.setPlaybackRate(16000);r.chip.adpcm.setVolume(200);r.chip.adpcm.setPan(true,true);r.chip.adpcm.keyOn();r.wait();
  const result=await extract(vgm(r.commands));assert.equal(result.presets.length,1);
  assert.deepEqual(decodeBase64(result.presets[0].preset.adpcm.data),data);
  assert.equal(result.presets[0].preset.adpcm.repeat,false);
});

test('ADPCM default limit follows native reset while an internal limit wrap explains omitted samples',async()=>{
  const data=Uint8Array.from({length:64},(_,i)=>i*3&255),setup=()=>{
    const r=recording();r.commands.push(...memoryBlock(data,0));
    r.chip.adpcm.setSample({start:0,end:64});r.chip.adpcm.setPlaybackRate(16000);
    r.chip.adpcm.setVolume(200);r.chip.adpcm.setPan(true,true);r.chip.adpcm.keyOn();
    return r;
  };
  const defaults=setup(),withoutLimit=[];
  for(let offset=0;offset<defaults.commands.length;) {
    if(defaults.commands[offset]===0x67){withoutLimit.push(...defaults.commands.slice(offset,offset+79));offset+=79;continue;}
    if(defaults.commands[offset]!==0x57||![12,13].includes(defaults.commands[offset+1]))withoutLimit.push(...defaults.commands.slice(offset,offset+3));
    offset+=3;
  }
  const reset=await extract(vgm([...withoutLimit,0x62]));
  assert.equal(reset.presets.length,1);assert.deepEqual(decodeBase64(reset.presets[0].preset.adpcm.data),data);
  const wrapping=setup();wrapping.chip.write(1,12,0);wrapping.chip.write(1,13,0);wrapping.wait();
  const omitted=await extract(vgm(wrapping.commands));assert.equal(omitted.presets.length,0);
  assert(omitted.warnings.some(value=>/limit address wraps playback to address 0/.test(value)));
  const ending=setup();ending.chip.write(1,12,1);ending.chip.write(1,13,0);ending.wait();
  assert.equal((await extract(vgm(ending.commands))).presets.length,1);
});

test('a large unique-preset library is bounded before committing project files',async()=>{
  const r=recording();r.chip.ssg.tone(0,{frequency:220,volume:10});r.chip.ssg.setVolume(0,10,true);
  for(let period=1;period<=4097;period++){r.chip.ssg.setEnvelope({period,shape:10});r.wait();}
  const source=vgm(r.commands),original=source.slice();
  await assert.rejects(extract(source),/12 MiB project limit|4,096 different OPNA presets/);
  assert.deepEqual(source,original);
});

test('extraction remains cancellable after source validation has completed',async()=>{
  const source=vgm([0x56,8,10,...Array(6000).fill(0x70)]),controller=new AbortController();
  let yields=0;
  await assert.rejects(extractFm2608VgmPresets(source,{signal:controller.signal,yieldTask:async()=>{
    if(++yields===2)controller.abort();
  }}),{name:'AbortError'});
  assert.equal(yields,2);
});
