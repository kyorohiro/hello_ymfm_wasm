import test from 'node:test';
import assert from 'node:assert/strict';
import {exportPokeyVgm,readPokeyVgm,validatePokeyVgm,POKEY_VGM_IMPORT_LIMITS} from './pokey_vgm_import.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {createPokeyTimelineBuilder} from '../../web/pokey_timeline_builder.js';
import {createPokeyImportVgm} from '../../test/helpers/pokey_vgm_fixture.mjs';

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const write=(register,value,chip=0)=>[0xbb,(chip<<7)|register,value];
function vgm(commands,{clock=1789790,dual=false}={}){
  const bytes=new Uint8Array(0x100+commands.length),view=new DataView(bytes.buffer);
  bytes.set([0x56,0x67,0x6d,0x20]);view.setUint32(4,bytes.length-4,true);view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);view.setUint32(0xb0,(clock|(dual?0x40000000:0))>>>0,true);bytes.set(commands,0x100);return bytes;
}
function stream({target=0x1e,register=1,fast=true,flags=0,frequency=12000,bank=0,data=[0x11,0x16,0x12,0x17]}={}){
  return [0x67,0x66,bank,data.length&255,data.length>>>8&255,data.length>>>16&255,data.length>>>24,...data,
    0x90,0,target,0,register,0x91,0,bank,1,0,0x92,0,frequency&255,frequency>>>8&255,frequency>>>16&255,frequency>>>24,
    ...(fast?[0x95,0,0,0,flags]:[0x93,0,0,0,0,0,1|flags,data.length&255,data.length>>>8&255,data.length>>>16&255,data.length>>>24])];
}
// The original parser's playback path is independent from the importer's
// step()/capture loop and from both its packed decoder and generated builder.
function reference(input){
  const parser=new Ym2612VGM(input,{logger:null}),count=parser.header.pokeyClock&0x40000000?2:1,events=Array.from({length:count},()=>[]);let time=0;
  const targets={resolveChip(type,chip){assert.equal(type,'pokey');assert(chip<count);return {writeRegister(register,value){events[chip].push([time,register,value]);}};}};
  while(!parser.ended){const event=parser.playStep(targets);if(event.type==='wait')parser.consumeWait(targets,event.samples,samples=>{time+=samples;});}
  return {events,time,clock:parser.header.pokeyClock&0x3fffffff};
}
// Deliberately decode test output without the production timeline cursor.
function unpack(trace){
  const events=[];let position=0,time=0;
  while(position<trace.data.length){let delta=0,multiplier=1,byte;do{byte=trace.data[position++];delta+=(byte&127)*multiplier;multiplier*=128;}while(byte&128);time+=delta;events.push([time,trace.data[position++],trace.data[position++]]);}
  assert.equal(position,trace.data.length);return events;
}
async function execute(input,mode,{external=true,failDuring}={}){
  const expected=reference(input),assets=[],clients=[],phases=[];
  const source=exportPokeyVgm(input,{mode,...(external?{writeDataFile(bytes){assets.push(bytes.slice());return '/pokey/recording.dat';}}:{})});
  const run=new AsyncFunction('createSoundChip','file',source);
  const create=async(name,options)=>{
    assert.equal(name,'pokey');assert.deepEqual(options,{clock:expected.clock});const index=clients.length;
    if(failDuring==='create-second'&&index===1)throw new Error('Run stopped during creation');
    const client={clock:options.clock,disposed:0,prepared:null,played:0,
      createTimeline(builderOptions){assert.equal(builderOptions.clock,options.clock);return createPokeyTimelineBuilder(builderOptions);},
      async prepareTimeline(trace){phases.push(`prepare:${index}`);if(failDuring==='prepare')throw new Error('Run stopped during preparation');this.prepared=trace;},
      async getTimelineState(){assert.equal(index,0);assert.equal(clients.length,expected.events.length);assert(clients.every(chip=>chip.prepared));phases.push('state');return {currentFrame:975381,sampleRate:48000};},
      async playTimeline(options){assert(clients.every(chip=>chip.prepared),'all chips prepared before any audio starts');assert.deepEqual(options,{startFrame:975381+12000});phases.push(`play:${index}`);this.played++;if(failDuring==='play')throw new Error('Run stopped during playback');await Promise.resolve();return {ended:true};},
      dispose(){this.disposed++;phases.push(`dispose:${index}`);},
    };clients.push(client);return client;
  };
  const file=async(path,options)=>{assert.equal(path,'/pokey/recording.dat');assert.deepEqual(options,{type:'arrayBuffer'});assert.equal(clients.length,0,'all sidecars load before chip creation');return assets[0].buffer;};
  if(failDuring){await assert.rejects(run(create,file),/Run stopped/);for(const chip of clients)assert.equal(chip.disposed,1);return {source,assets,clients,phases};}
  await run(create,file);assert.equal(clients.length,expected.events.length);
  for(let index=0;index<clients.length;index++){const chip=clients[index];assert.equal(chip.disposed,1);assert.equal(chip.played,1);assert.equal(chip.prepared.clock,expected.clock);assert.equal(chip.prepared.durationSamples,expected.time);assert.deepEqual(unpack(chip.prepared),expected.events[index],`chip ${index} ordered original writes`);}
  assert.doesNotMatch(source,/setTimeout|sleepSamples|waitUntil/,'sample writes are consumed inside audio processing');
  return {source,assets,clients,phases,expected};
}

for(const mode of ['raw','readable','high'])for(const dual of [false,true])for(const dense of [false,true])test(`POKEY ${mode} ${dual?'dual':'single'} ${dense?'dense':'ordinary'} generated score preserves parser trace`,async()=>{
  const input=createPokeyImportVgm({dual,dense}),{source,assets,expected}=await execute(input,mode);
  assert.equal(expected.time,28665);assert.equal(assets.length,dense?1:0);
  if(dense){assert(source.length<6000,'dense DAC data stays compact');assert.match(source,/\.packed\(/);}
  else{assert.doesNotMatch(source,/pokeyData|\.dat|\.packed\(/,'ordinary BB commands need no sidecar');if(mode==='high')assert.match(source,/\.setFrequency\(/);}
});

test('POKEY same-time joined AUDF order, interleaved writes and repeated STIMER preserve exact raw fallbacks',async()=>{
  const input=vgm([...write(15,3),...write(8,0x50),...write(0,0xd1),...write(2,3),...write(9,0),...write(9,0),
    ...write(2,2),...write(0,0x40),...write(4,55),...write(2,7),...write(1,0xa4),0x70,...write(8,0x54),...write(6,0x28),...write(4,44),0x71,0x66],{clock:1789773});
  for(const mode of ['raw','readable','high']){
    const {source}=await execute(input,mode);if(mode==='high'){assert.match(source,/setFrequency\(1,/);assert.match(source,/writeRegister\(0x02, 0x02\)/);assert.match(source,/writeRegister\(0x00, 0x40\)/);assert.equal((source.match(/writeRegister\(0x09, 0x00\)/g)??[]).length,2);}
  }
});
test('POKEY metadata ending in an ordinary BB keeps the direct write editable without sidecar packing',async()=>{
  const input=vgm([0x67,0x66,0,1,0,0,0,0x1a,...write(15,3),0x94,255,...write(0,99),0x61,3,0,0x66]);
  const data=readPokeyVgm(input),stats=validatePokeyVgm(input);assert.equal(data.streamWrites,0);assert.equal(data.packedData.length,0);assert.equal(stats.ordinaryWrites,2);assert(!('events' in stats)&&!('packedData' in stats));
  for(const mode of ['raw','readable','high']){const {assets,source}=await execute(input,mode);assert.equal(assets.length,0);assert.doesNotMatch(source,/pokeyData|\.packed\(/);}
});
for(const fast of [false,true])for(const flags of (fast?[0,1,0x10]:[0,0x10,0x80]))test(`POKEY generic stream ${fast?'fast':'normal'} flags ${flags} retains parser endpoints and direct boundary order`,async()=>{
  const input=vgm([...write(15,3),...stream({fast,flags,frequency:22050}),0x61,2,0,...write(1,0x1e),0x61,6,0,0x94,255,0x61,3,0,0x66]);
  for(const mode of ['raw','readable','high'])for(const external of [false,true])await execute(input,mode,{external});
});
test('POKEY supported wait commands and empty second chip preserve whole one-pass duration',async()=>{
  const input=vgm([...write(15,3),0x61,0,0,0x70,0x62,0x63,0x7f,0x66],{dual:true});for(const mode of ['raw','readable','high']){const {clients,expected}=await execute(input,mode);assert.equal(expected.time,1+735+882+16);assert.equal(clients[1].prepared.data.length,0);}
});
test('POKEY generated owned chips dispose on preparation, playback and second creation failures',async()=>{
  const input=createPokeyImportVgm({dual:true});for(const failDuring of ['prepare','play','create-second'])await execute(input,'high',{failDuring});
});
test('POKEY preflight rejects malformed header flags, mixed clocks and extra overrides',()=>{
  for(const clock of [0,99999,100000001,1789790|0x80000000])assert.throws(()=>readPokeyVgm(vgm([...write(0,1),0x66],{clock})),/POKEY|clock/i);
  for(const offset of [0x0c,0x10,0x2c,0x40,0x74,0x9c,0xc0,0xf0]){const bytes=vgm([...write(0,1),0x66]);new DataView(bytes.buffer).setUint32(offset,1000000,true);assert.throws(()=>readPokeyVgm(bytes),/mixed|only POKEY/);}
  const extra=vgm([...write(0,1),0x66]);new DataView(extra.buffer).setUint32(0xbc,1,true);assert.throws(()=>readPokeyVgm(extra),/extra-header/);
  for(const clock of [100000,100000000])assert.equal(readPokeyVgm(vgm([...write(0,1),0x66],{clock})).clock,clock);
});
test('POKEY preflight rejects unsupported commands, undeclared chip writes and malformed DAC metadata',()=>{
  const invalid=[
    [0xbb,0x80,1,0x66],[0xbb,16,1,0x66],[0x50,0x90,0x66],[0xa0,0,0,0x66],[0x68,0x66,0,0,0,0,0,0,0,0,0,0,0x66],
    [0x67,0,0,0,0,0,0,0x66],[0x67,0x66,0x40,0,0,0,0,0x66],[0x67,0x66,0,0,0,0,128,0x66],
    [...stream({target:0x9e}),0x61,1,0,0x66],[...stream({target:2}),0x61,1,0,0x66],[...stream({register:16}),0x66],
    [0x90,255,0x1e,0,1,0x66],[0x91,0,0,1,0,0x66],[0x92,0,1,0,0,0,0x66],
    [0x90,0,0x1e,0,1,0x91,0,0,0,0,0x66],[0x90,0,0x1e,0,1,0x92,0,0,0,0,0,0x66],
    [...stream(),0x95,0,1,0,0,0x66],[...stream({flags:0x20}),0x66],[...stream({fast:false,flags:4}),0x66],
    [0x90,0,0x1e,0,1,0x93,0,0,0,0,0,0,4,0,0,0,0x66],
  ];for(const commands of invalid)assert.throws(()=>validatePokeyVgm(vgm(commands)),/POKEY VGM import:/);
});
test('POKEY preflight rejects truncation, bad offsets, missing terminator and excessive recursion',()=>{
  for(const commands of [[0xbb],[0xbb,0],[0x67,0x66,0],[0x67,0x66,0,9,0,0,0,1],[0x92,0,1],[...write(0,1)],[0x66]])assert.throws(()=>readPokeyVgm(vgm(commands)));
  for(const [offset,value]of [[0x34,0xffffffff],[4,0xffffffff],[0x34,1]]){const bytes=vgm([...write(0,1),0x66]);new DataView(bytes.buffer).setUint32(offset,value,true);assert.throws(()=>readPokeyVgm(bytes));}
  assert.throws(()=>readPokeyVgm(vgm([...Array.from({length:257},()=>[0x94,255]).flat(),...write(0,1),0x66])),/metadata/);
  assert.throws(()=>readPokeyVgm(new Uint8Array(POKEY_VGM_IMPORT_LIMITS.sourceBytes+1)),/16 MiB/);
  assert.throws(()=>exportPokeyVgm(vgm([...write(0,1),0x66]),{mode:'schedule'}),/Unknown/);
});
test('POKEY fragmented banks hit a bounded bank-copy work limit before parser copying',()=>{
  const commands=[];for(let index=0;index<400;index++)commands.push(0x67,0x66,0,0,4,0,0,...new Uint8Array(1024),0x70);commands.push(...write(0,1),0x66);
  assert.throws(()=>validatePokeyVgm(vgm(commands)),/bank-copy work limit/);
});
test('POKEY direct entries and hostile looping streams hit bounded conversion work limits',()=>{
  const writes=270000,commands=new Uint8Array(writes*3+1);for(let index=0;index<writes;index++)commands.set(write(1,index&255),index*3);commands[commands.length-1]=0x66;
  assert.throws(()=>validatePokeyVgm(vgm(commands)),/8 MiB/);
  assert.throws(()=>validatePokeyVgm(vgm([...stream({frequency:0xffffffff,flags:1}),0x61,0x90,1,0x66])),/8 MiB/);
});
test('POKEY duration preserves full unsigned sample range and rejects overflowing waits',async()=>{
  const waits=65537,commands=new Uint8Array(3+waits*3+4);commands.set(write(0,1));for(let index=0;index<waits;index++)commands.set([0x61,255,255],3+index*3);commands.set([...write(0,2),0x66],3+waits*3);
  const input=vgm(commands);assert.equal(validatePokeyVgm(input).time,0xffffffff);for(const mode of ['raw','readable','high'])await execute(input,mode);
  const overflow=new Uint8Array(commands.length+3);overflow.set(commands.subarray(0,commands.length-1));overflow.set([0x61,1,0,0x66],commands.length-1);assert.throws(()=>validatePokeyVgm(vgm(overflow)),/duration/);
});
