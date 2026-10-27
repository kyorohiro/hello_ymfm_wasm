import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {exportWonderSwanVgm, readWonderSwanVgm, validateWonderSwanVgm, WONDERSWAN_VGM_IMPORT_LIMITS} from './wonderswan_vgm_import.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import factory from '../generated/wonderswan_wasm.js';
import {WonderSwan} from '../../web/wonderswan.js';
import {WonderSwanSynth} from '../../web/wonderswansynth.js';
import {createWonderSwanVgm} from '../../test/helpers/wonderswan_vgm_fixture.mjs';

const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const wasmBinary = await readFile(new URL('../generated/wonderswan_wasm.wasm', import.meta.url));
const module = await factory({wasmBinary});
const write = (register, value) => [0xbc, register, value];
function vgm(commands, clock = 3072000) {
  const bytes = new Uint8Array(0x100 + commands.length), view = new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]); view.setUint32(4, bytes.length - 4, true);
  view.setUint32(8, 0x171, true); view.setUint32(0x34, 0xcc, true); view.setUint32(0xc0, clock >>> 0, true);
  bytes.set(commands, 0x100); return bytes;
}
function stream({type = 0x21, fast = true, flags = 0, frequency = 22050, bank = 0x0a} = {}) {
  return [0x67,0x66,bank,4,0,0,0,0x11,0x22,0x33,0x44,
    0x90,0,type,0,9, 0x91,0,bank,1,0,
    0x92,0,frequency & 255,frequency >>> 8 & 255,frequency >>> 16 & 255,frequency >>> 24,
    ...(fast ? [0x95,0,0,0,flags] : [0x93,0,0,0,0,0,1 | flags,4,0,0,0]),
  ];
}
function referenceTrace(input, chip) {
  const parser = new Ym2612VGM(input, {logger:null}), events = [], left = [], right = [];
  let time = 0;
  const targets = {wonderswan: {
    writeRegister(register,value) {events.push({type:'register',address:0x80+register,value,time});chip?.writeRegister(0x80+register,value);},
    writeMemory(address,value) {events.push({type:'memory',address,value,time});chip?.writeMemory(address,value);},
  }};
  while (!parser.ended) {
    const event = parser.playStep(targets);
    if (event.type === 'wait') parser.consumeWait(targets,event.samples, samples => {
      if (chip) {const pcm = chip.generateStereo(samples);left.push(...pcm.left);right.push(...pcm.right);}
      time += samples;
    });
  }
  return {events,time,left,right};
}
// Independent expansion only in tests: production retains a compact PCM cursor.
function visitScore(score, write, wait = () => {}) {
  let time = 0;
  const eventAt = (sample, kind, address, value) => {
    wait(sample-time); time=sample; write(kind,address,value,time);
  };
  for (const row of score.events) {
    if (row[1] !== 2) {eventAt(row[0],row[1],row[2],row[3]);continue;}
    let position=row[2], sample=row[0];
    for(let index=0;index<row[4];index++) {
      let delta=0,multiplier=1,byte;
      do {byte=score.pcmData[position++];delta+=(byte&127)*multiplier;multiplier*=128;}while(byte&128);
      sample+=delta;eventAt(sample,0,0x89,score.pcmData[position++]);
    }
    assert.equal(position,row[2]+row[3]);assert.equal(sample,row[5]);
  }
  wait(score.durationSamples-time);
}
async function compare(input, mode, binary = false) {
  const clock = new Ym2612VGM(input,{logger:null}).header.wonderswanClock;
  const chip = await WonderSwan.create({moduleFactory:async()=>module,clock,sampleRate:44100});
  const original = await WonderSwan.create({moduleFactory:async()=>module,clock,sampleRate:44100});
  const expected = referenceTrace(input,original), events = [], left = [], right = [];
  let time = 0, disposed = 0, resets = 0, prepared, played=0;
  const synth = new WonderSwanSynth({clock,transport:{
    writeRegister() {throw new Error('Import must not send immediate register writes');},
    writeMemory() {throw new Error('Import must not send immediate RAM writes');},
    reset() {throw new Error('Import must not reset outside its prepared score');},
    async prepareTimeline(score) {prepared=score;},
    async playTimeline() {
      played++;resets++;chip.reset();
      visitScore(prepared,(kind,address,value,sample)=>{
        events.push({type:kind===0?'register':'memory',address,value,time:sample});
        if(kind===0)chip.writeRegister(address,value);else chip.writeMemory(address,value);
      },samples=>{const pcm=chip.generateStereo(samples);left.push(...pcm.left);right.push(...pcm.right);time+=samples;});
    },
    dispose() {disposed++;},
  }});
  const files = [];
  const source = exportWonderSwanVgm(input,{mode, ...(binary ? {writePcmFile:bytes=>{files.push(bytes.slice());return '/voice.dat';}} : {})});
  try {
    await new AsyncFunction('createSoundChip','file',source)(async(name,options)=>{assert.equal(name,'wonderswan');assert.equal(options,undefined);return synth;},async(path,options)=>{assert.equal(path,'/voice.dat');assert.deepEqual(options,{type:'arrayBuffer'});return files[0].buffer;});
    assert.deepEqual(events,expected.events,'all ordered timestamped bytes survive conversion');
    assert.deepEqual(left,expected.left,'real WASM left PCM matches the source stream');
    assert.deepEqual(right,expected.right,'real WASM right PCM matches the source stream');
    assert.equal(time,expected.time);assert.equal(disposed,1);assert.equal(resets,1);assert.equal(played,1);assert.equal(prepared.clock,clock);
    assert.doesNotMatch(source,/score\.initialize\(|score\.noteOn\(|score\.setWaveform\(/,'no implicit waveform/gate/setup writes');
    assert.doesNotMatch(source,/waitUntil|setTimeout|createTimeline\(\)/,'no JS timer per sample');
    return {source,expected,files};
  } finally {synth.dispose();chip.dispose();original.dispose();}
}

for (const mode of ['raw','readable','high']) for (const [sound,channel] of [['wave',0],['wave',1],['wave',2],['wave',3],['noise',3],['sweep',2],['voice',1]]) {
  test(`WonderSwan ${sound} CH${channel+1} ${mode}: exact writes, RAM, final wait and real core PCM`,async()=>{
    const input = createWonderSwanVgm({mode:sound,channel,seconds:0.1});
    const {source,expected} = await compare(input,mode);
    assert.equal(expected.time,4410);assert.ok(expected.left.some(value=>value!==0));
    assert.ok(expected.events.some(event=>event.type==='memory'&&event.address===0x1200));
    assert.match(source,/await ws\.prepareTimeline\(score\.finish\(4410\)\)/);
    assert.doesNotMatch(source,/sleepSamples\(/);
    if (mode==='high') {assert.match(source,/score\.setFrequency\(/);assert.match(source,/score\.setVolume\(/);}
    if (mode==='high'&&sound==='voice') assert.match(source,/score\.pcm\(/);
  });
}

test('nonstandard clocks, reserved frequency bits and interleaved writes keep an exact raw fallback',async()=>{
  const input = vgm([...write(0,0x80),...write(1,6),...write(2,0x40),...write(0x0f,0x48),...write(3,7),...write(4,0x01),...write(5,0x80),...write(0x11,8),...write(0x10,7),0x61,0x80,0,0x66],3200001);
  const {source}=await compare(input,'high');
  assert.match(source,/setFrequency\(0,/);
  assert.match(source,/writeRegister\(0x82, 0x40\)/,'interleaved pair cannot be reordered');
  assert.match(source,/writeRegister\(0x85, 0x80\)/,'reserved bits cannot be discarded');
});

for (const fast of [false,true]) for (const flags of [0,0x10,0x80].filter(value=>!fast||value!==0x80)) test(`timed 0x21 Voice PCM ${fast?'fast':'normal'} flags ${flags}: source parser owns timing`,async()=>{
  const input = vgm([...write(0x11,8),...write(0x14,15),...write(0x10,0x22),...stream({fast,flags}),0x61,2,0,...write(9,0xee),0x61,6,0,0x94,255,0x61,3,0,0x66]);
  const materialized = readWonderSwanVgm(input), reference = referenceTrace(input);
  assert.deepEqual(materialized.events,reference.events);assert.equal(materialized.time,11);
  const atBoundary=reference.events.filter(event=>event.time===2&&event.address===0x89).map(event=>event.value);
  assert.deepEqual(atBoundary,flags===0x10?[0x33,0xee]:[0x22,0xee],'stream endpoint precedes following direct write');
  for (const mode of ['raw','readable','high']) await compare(input,mode);
});

test('wait forms and zero wait preserve stream start, direct RAM order and final duration',()=>{
  const input=vgm([...stream(),0x61,0,0,0xc6,0x12,0x34,0xa5,0x70,0x62,0x63,0x7f,0x66]);
  const actual=readWonderSwanVgm(input),expected=referenceTrace(input);
  assert.deepEqual(actual.events,expected.events);assert.equal(actual.time,1+735+882+16);
  assert.deepEqual(actual.events.slice(0,2),[{type:'register',address:0x89,value:0x11,time:0},{type:'memory',address:0x1234,value:0xa5,time:0}]);
});

test('conversion rejects unsupported clocks, header variants, mixed clocks and extra overrides',()=>{
  for (const clock of [0,99999,100000001,3072000|0x40000000,3072000|0x80000000]) assert.throws(()=>readWonderSwanVgm(vgm([...write(0,1),0x66],clock)),/WonderSwan|clock/i);
  for (const offset of [0x0c,0x2c,0x40,0xb0,0xc4,0xf0]) {
    const input=vgm([...write(0,1),0x66]);new DataView(input.buffer).setUint32(offset,1000000,true);
    assert.throws(()=>readWonderSwanVgm(input),/mixed|single/);
  }
  const extra=vgm([...write(0,1),0x66]);new DataView(extra.buffer).setUint32(0xbc,1,true);assert.throws(()=>readWonderSwanVgm(extra),/extra-header/);
  for (const clock of [100000,100000000]) assert.equal(readWonderSwanVgm(vgm([...write(0,1),0x66],clock)).clock,clock);
});

test('preflight rejects hidden commands, second chips, unsupported registers, DMA and RAM blocks',()=>{
  const invalid = [
    [0xbc,0x80,1,0x66],[0xbc,0x20,1,0x66],[0xbc,0x64,1,0x66],
    [0xc6,0x80,0,1,0x66],[0xc6,0x40,0,1,0x66],
    [...stream(),0x50,0x90,0x66],[0x68,0x66,0x0a,0,0,0,0,0,0,0,0,0,0x66],
    [0x67,0x66,0xc3,0,0,0,0,0x66],[0x67,0x66,0x4a,0,0,0,0,0x66],
    [...stream({type:0xa1}),0x61,1,0,0x66],[...stream({type:0x02}),0x61,1,0,0x66],
    [0x91,0,0x0a,1,0,0x66],[0x90,255,0x21,0,9,0x66],
    [0x90,0,0x21,1,9,0x66],[0x90,0,0x21,0,0x20,0x66],
    [0x90,0,0x21,0,9,0x91,0,0x0a,0,0,0x66],
    [0x90,0,0x21,0,9,0x92,0,0,0,0,0,0x66],
    [...stream(),0x95,0,1,0,0,0x66], [...stream(),0x95,0,0,0,0x20,0x66],
    [0x90,0,0x21,0,9,0x95,0,0,0,0,0x66],
    [...stream(),0x93,0,0,0,0,0,4,4,0,0,0,0x66],
  ];
  for (const commands of invalid) assert.throws(()=>readWonderSwanVgm(vgm(commands)),/WonderSwan VGM import:/);
});

test('preflight rejects truncated commands, invalid offsets, no end and excessive parser recursion',()=>{
  for (const commands of [[0xbc],[0xbc,0],[0xc6,0x12,0x34],[0x67,0x66,0],[0x67,0x66,0x0a,9,0,0,0,1], [0x92,0,1], [...write(0,1)], [0x66]]) assert.throws(()=>readWonderSwanVgm(vgm(commands)));
  const badOffset=vgm([...write(0,1),0x66]);new DataView(badOffset.buffer).setUint32(0x34,0xffffffff,true);assert.throws(()=>readWonderSwanVgm(badOffset));
  const metadata=Array.from({length:257},()=>[0x94,255]).flat();assert.throws(()=>readWonderSwanVgm(vgm([...metadata,...write(0,1),0x66])),/metadata/);
  assert.throws(()=>readWonderSwanVgm(new Uint8Array(WONDERSWAN_VGM_IMPORT_LIMITS.sourceBytes+1)),/16 MiB/);
});

test('high-rate looping streams stop at the expansion bound instead of hanging',()=>{
  const input=vgm([...stream({fast:true,flags:1,frequency:0xffffffff}),0x61,20,0,0x66]);
  assert.throws(()=>readWonderSwanVgm(input),/1000000-write conversion limit/);
});

test('fragmented banks are rejected before repeated parser bank copies become excessive',()=>{
  // Each small block is separated by a wait, defeating a recursion-only bound.
  // The parser joins a bank on every append, so bound the total copy work too.
  const commands=[];
  for(let i=0;i<400;i++)commands.push(0x67,0x66,0x0a,0,4,0,0,...new Uint8Array(1024),0x70);
  commands.push(...write(0,1),0x66);
  assert.throws(()=>readWonderSwanVgm(vgm(commands)),/bank-copy work limit/);
});

test('generated owned chip disposes on prepare and play cancellation',async()=>{
  const source=exportWonderSwanVgm(vgm([0xc6,0x12,0x34,0xa5,...write(0,1),0x61,1,0,0x66]));
  for (const during of ['prepare','play']) {
    let disposed=0;
    const synth=new WonderSwanSynth({transport:{writeRegister(){},writeMemory(){},reset(){},dispose(){disposed++;},
      async prepareTimeline(){if(during==='prepare')throw new Error('Run stopped');},
      async playTimeline(){if(during==='play')throw new Error('Run stopped');},
    }});
    await assert.rejects(new AsyncFunction('createSoundChip',source)(async()=>synth),/Run stopped/);
    assert.equal(disposed,1);
  }
  assert.throws(()=>exportWonderSwanVgm(vgm([...write(0,1),0x66]),{mode:'schedule'}),/Unknown/);
});

test('only authored Voice PCM is packed; RAM, control interruptions and ordinary CH2 volume remain editable',async()=>{
  const input=vgm([...write(0x11,8),...write(0x14,15),...write(9,0xab),...write(0x10,0x22),
    ...write(9,0x11),0x72,...write(9,0x22),0xc6,0x12,0,0xa5,...write(9,0x33),
    ...write(8,0x45),...write(9,0x44),...write(0x10,2),...write(9,0x55),0x73,0x66]);
  const packed=readWonderSwanVgm(input,{packPcm:true});
  const runs=packed.events.filter(event=>event.type==='pcm');
  assert.deepEqual(runs,[
    {type:'pcm',time:0,offset:0,length:4,count:2,endTime:3},
    {type:'pcm',time:3,offset:4,length:2,count:1,endTime:3},
    {type:'pcm',time:3,offset:6,length:2,count:1,endTime:3},
  ]);
  assert.deepEqual([...packed.pcmData],[0,0x11,3,0x22,0,0x33,0,0x44]);
  assert.deepEqual(packed.events.filter(event=>event.type==='register'&&event.address===0x89).map(event=>event.value),[0xab,0x55]);
  const stats=validateWonderSwanVgm(input);
  assert.deepEqual(stats,{time:7,clock:3072000,writes:12,ordinaryWrites:8,pcmWrites:4,pcmBytes:8});
  assert.ok(!('events' in stats)&&!('pcmData' in stats),'preflight retains no expanded or packed writes');
  for (const mode of ['raw','readable','high']) for (const binary of [false,true]) {
    const {source,files}=await compare(input,mode,binary);
    assert.match(source,/score\.writeMemory\(0x1200, 0xa5\)/);
    assert.match(source,mode==='high'?/score\.setVolume\(1, 10, 11\)/:/score\.writeRegister\(0x89, 0xab\)/);
    assert.equal(files.length,binary?1:0);
  }
});

for (const mode of ['raw','readable','high']) test(`external Voice PCM ${mode}: real WASM output matches the source`,async()=>{
  const {files}=await compare(createWonderSwanVgm({mode:'voice',channel:1,seconds:0.1}),mode,true);
  assert.equal(files.length,1);
});

test('more than one million direct PCM writes import as one compact file with every original 3/4-sample interval',async()=>{
  const count=1000017, commands=new Uint8Array(9+count*4+1);
  commands.set([...write(0x11,8),...write(0x14,15),...write(0x10,0x22)]);
  const sampleAt=index=>Math.floor(index/2)*7+(index%2?3:0);
  const hash=(previous,time,value)=>(Math.imul(previous^time,16777619)^value)>>>0;
  let expectedHash=2166136261;
  for (let index=0;index<count;index++) {
    const value=(index*37+19)&255;
    commands.set([0xbc,9,value,index%2?0x73:0x72],9+index*4);
    expectedHash=hash(expectedHash,sampleAt(index),value);
  }
  commands[commands.length-1]=0x66;
  const input=vgm(commands),stats=validateWonderSwanVgm(input);
  assert.deepEqual(stats,{clock:3072000,time:sampleAt(count),writes:count+3,ordinaryWrites:3,pcmWrites:count,pcmBytes:count*2});
  const packed=readWonderSwanVgm(input,{packPcm:true});
  assert.equal(packed.events.length,4,'dense PCM never becomes a million event objects');
  assert.equal(packed.pcmData.length,count*2);
  assert.deepEqual([...packed.pcmData.subarray(0,6)],[0,19,3,56,4,93]);
  assert.throws(()=>readWonderSwanVgm(input),/1000000-write/,'the explicit expanded-debug API remains bounded');
  let expectedPayload;
  for (const mode of ['raw','readable','high']) {
    let payload,callbacks=0,time=0,seen=0,actualHash=2166136261,disposed=0;
    const source=exportWonderSwanVgm(input,{mode,writePcmFile(bytes){callbacks++;payload=bytes;return '/million-voice.dat';}});
    assert.equal(callbacks,1);assert.ok(source.length<10000,'the musical controls remain a small editable program');
    if (expectedPayload) assert.deepEqual(payload,expectedPayload,'style does not change original sample bytes or timing');
    else expectedPayload=payload;
    const synth=new WonderSwanSynth({transport:{writeRegister(){throw new Error('immediate');},writeMemory(){},reset(){},
      async prepareTimeline(score) {this.score=score;},
      async playTimeline() {visitScore(this.score,(kind,address,value,sample)=>{time=sample;if(kind===0&&address===0x89){actualHash=hash(actualHash,time,value);seen++;}});time=this.score.durationSamples;},
      dispose(){disposed++;},
    }});
    await new AsyncFunction('createSoundChip','file',source)(async()=>synth,async(path)=>{assert.equal(path,'/million-voice.dat');return payload.buffer;});
    assert.equal(seen,count);assert.equal(actualHash,expectedHash);assert.equal(time,stats.time);assert.equal(disposed,1);
  }
});

test('PCM sample deltas preserve the full unsigned 32-bit duration and validate five-byte varuints',async()=>{
  const waits=65537,commands=new Uint8Array(6+3*waits+4);
  commands.set([...write(0x10,0x22),...write(9,17)]);
  for(let index=0;index<waits;index++)commands.set([0x61,255,255],6+index*3);
  commands.set([...write(9,34),0x66],6+waits*3);
  let payload;const source=exportWonderSwanVgm(vgm(commands),{writePcmFile:bytes=>{payload=bytes;return '/long-delta.dat';}});
  assert.deepEqual([...payload],[0,17,255,255,255,255,15,34]);
  const trace=[];
  const transport={writeRegister(){},writeMemory(){},reset(){},dispose(){},
    async prepareTimeline(score){this.score=score;},
    async playTimeline(){visitScore(this.score,(kind,address,value,time)=>trace.push([time,address,value]));},
  };
  const synth=new WonderSwanSynth({transport});
  await new AsyncFunction('createSoundChip','file',source)(async()=>synth,async()=>payload.buffer);
  assert.deepEqual(trace,[[0,0x90,0x22],[0,0x89,17],[0xffffffff,0x89,34]]);
});

test('missing or edited PCM assets fail before chip creation or any sound writes',async()=>{
  const input=vgm([...write(0x10,0x22),...write(9,17),0x72,...write(9,34),0x73,...write(9,51),0x72,...write(9,68),0x66]);
  let payload;const source=exportWonderSwanVgm(input,{writePcmFile:bytes=>{payload=bytes;return '/voice.dat';}});
  const wrongFirst=payload.slice();wrongFirst[0]=1;
  const excessiveDelta=payload.slice();excessiveDelta.set([255,255,255,255,16],2);
  const outsideRun=payload.slice();outsideRun[2]=127;
  for(const data of [payload.subarray(1),wrongFirst,excessiveDelta,outsideRun,null]) {
    let created=0;
    await assert.rejects(new AsyncFunction('createSoundChip','createTimeline','file',source)(async()=>{created++;throw new Error('must not create');},()=>{throw new Error('must not wait');},async()=>{if(!data)throw new Error('file missing');return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);}),/WonderSwan PCM|file missing/);
    assert.equal(created,0);
  }
});

test('same-time PCM remains compact and is never sent by JavaScript during play',async()=>{
  const commands=[...write(0x10,0x22)];
  for(let index=0;index<256;index++)commands.push(...write(9,index&255));
  commands.push(0x66);
  const source=exportWonderSwanVgm(vgm(commands),{mode:'high'});
  let prepared,disposed=0;
  const synth=new WonderSwanSynth({transport:{writeRegister(){assert.fail('immediate PCM');},writeMemory(){},reset(){},
    async prepareTimeline(score){prepared=score;},async playTimeline(){throw new Error('Run stopped');},dispose(){disposed++;},
  }});
  await assert.rejects(new AsyncFunction('createSoundChip',source)(async()=>synth),/Run stopped/);
  assert.equal(disposed,1);assert.equal(prepared.events.length,2);assert.equal(prepared.events[1][4],256);
});

test('hostile looping PCM streams hit the packed memory/work budget without retaining expanded events',()=>{
  const input=vgm([...write(0x10,0x22),...stream({fast:true,flags:1,frequency:0xffffffff}),0x61,0x90,1,0x66]);
  assert.throws(()=>validateWonderSwanVgm(input),/8 MiB playback limit/);
});
