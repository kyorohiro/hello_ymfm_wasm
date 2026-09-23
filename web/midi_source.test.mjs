import test from 'node:test';
import assert from 'node:assert/strict';
import {midiToSource} from './midi_source.js';
import {createMidiApi} from './playground_midi.js';
import {FM_PRESETS} from './megadrive-fm-presets.js';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
function smf(...tracks){const out=[77,84,104,100,0,0,0,6,0,tracks.length>1?1:0,0,tracks.length,0,96];for(const t of tracks)out.push(77,84,114,107,0,0,t.length>>8,t.length&255,...t);return Uint8Array.from(out);}
const route={part:'[1,0,"",1]',destination:'tetorica-ym2612',channel:15,preset:'sine'};

test('generated JS runs without MIDI data, preserves tempo changes, simultaneous notes and cross-track controls',async()=>{
 const data=smf(
  [0,255,81,3,7,161,32,0,0xb0,64,127,96,255,81,3,15,66,64,0,0xe0,127,127,96,0xb0,64,0,0,255,47,0],
  [0,0x90,60,100,0,0x90,64,80,96,0x80,60,0,96,0x90,64,0,0,255,47,0]
 );
 const source=midiToSource(data,[route],{presets:FM_PRESETS,name:'test\n.mid'});
 assert(!source.includes('playFile'));assert(!source.includes('arrayBuffer'));assert(source.includes('channel: CH16'));
 const events=[],times=[];
 const midi={createTimeline:()=>({waitUntil:async seconds=>times.push(seconds)}),output:(destination,options)=>{
  assert.equal(destination,route.destination);assert.equal(options.channel,15);
  return Object.fromEntries(['setVoice','setPitchBendRange','noteOn','noteOff','cc','pitchBend'].map(method=>[method,async(...args)=>events.push([method,...args])]));
 }};
 await new AsyncFunction('midi','FM_PRESETS','CH16',source)(midi,FM_PRESETS,15);
 assert.deepEqual(times,[0,.5,1.5]);
 assert.deepEqual(events.filter(e=>e[0]==='noteOn'),[['noteOn',60,{velocity:100}],['noteOn',64,{velocity:80}]]);
 assert.deepEqual(events.filter(e=>e[0]==='noteOff'),[['noteOff',60],['noteOff',64]]);
 assert.deepEqual(events.filter(e=>e[0]==='cc'),[['cc',64,127],['cc',64,0],['cc',120,0]]);
 assert.deepEqual(events.find(e=>e[0]==='pitchBend'),['pitchBend',1]);
});

test('compiler keeps source ports distinct and validates selected parts/voices',()=>{
 const data=smf([0,0xb0,7,90,0,255,47,0],[0,255,33,1,2,0,0x90,60,100,96,0x80,60,0,0,255,47,0]);
 const r={part:'[1,2,"",1]',destination:'tetorica-sega-psg',channel:0};
 const source=midiToSource(data,[r]);assert(!source.includes('.cc(7, 90)'));assert(source.includes('segapsg_1.noteOn'));
 assert.throws(()=>midiToSource(data,[r,r]),/separate/);
 assert.throws(()=>midiToSource(data,[{...r,channel:16}]),/Invalid/);
 assert.throws(()=>midiToSource(data,[{...r,destination:'tetorica-ym2612',preset:'missing'}]),/Unknown preset/);
 assert.throws(()=>midiToSource(data,[]),/Select/);
});

test('timeline absorbs execution/timer delays and catches up without shifting the origin',async()=>{
 let time=10;const waits=[];
 const api=createMidiApi(()=>{}, {bpm:()=>120,now:()=>time,sleep:async seconds=>{waits.push(seconds);time+=seconds+.02;}});
 const timeline=api.createTimeline();
 await timeline.waitUntil(1);time+=.03;
 await timeline.waitUntil(2);assert(Math.abs(waits[1]-.95)<1e-9);
 time=15;await timeline.waitUntil(3);assert.equal(waits[2],0);
 await timeline.waitUntil(6);assert(Math.abs(waits[3]-.98)<1e-9);
 for(const value of [-1,NaN,Infinity,5])await assert.rejects(timeline.waitUntil(value));
});

test('timeline checks cancellation after waking',async()=>{
 let stopped=false;
 const api=createMidiApi(()=>{}, {bpm:()=>120,now:()=>0,check:()=>{if(stopped)throw new Error('Run stopped');},sleep:async()=>{stopped=true;}});
 await assert.rejects(api.createTimeline().waitUntil(1),/Run stopped/);
});

test('generated module imports silently, exports selected channels and merges them in source order',async()=>{
 const data=smf([0,0x90,60,100,0,0x91,64,90,96,0x80,60,0,0,0x81,64,0,0,255,47,0]);
 const routes=[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0},{part:'[0,0,"",2]',destination:'tetorica-sega-psg',channel:1}];
 const source=midiToSource(data,routes,{module:true});
 const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 assert.deepEqual(Object.keys(song).sort(),['initCh','runAllCh','runCh1','runCh2','runChannels']);
 await assert.rejects(song.runAllCh(),/initCh/);
 const events=[],times=[];let clocks=0;
 const api={CH1:0,CH2:1,midi:{createTimeline:()=>{clocks++;return {waitUntil:async t=>times.push(t)};},output:(dest,{channel})=>Object.fromEntries(['setPitchBendRange','noteOn','noteOff','cc'].map(method=>[method,async(...args)=>events.push([channel,method,...args])]))}};
 await song.initCh(api);events.length=0;
 await song.runAllCh();
 assert.equal(clocks,1);assert.deepEqual(times,[0,.5]);
 assert.deepEqual(events.filter(e=>e[1]==='noteOn').map(e=>e[0]),[0,1]);
 events.length=0;times.length=0;
 await assert.rejects(song.runChannels([99]),/Unknown/);
 await song.runChannels([2]);assert(events.every(e=>e[0]===1));assert.deepEqual(times,[0,.5]);
});

test('same target CH on FM and PSG has one export and module can be initialized with a fresh runtime',async()=>{
 const data=smf([0,0x90,60,100,96,0x80,60,0,0,255,47,0],[0,0x91,64,90,96,0x81,64,0,0,255,47,0]);
 const source=midiToSource(data,[{part:'[0,0,"",1]',destination:'tetorica-ym2612',channel:7,preset:'sine'},{part:'[1,0,"",2]',destination:'tetorica-sega-psg',channel:7}],{module:true,presets:FM_PRESETS});
 const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 assert.deepEqual(Object.keys(song).sort(),['initCh','runAllCh','runCh8','runChannels']);
 let notes=0;
 const api={CH8:7,FM_PRESETS,midi:{createTimeline:()=>({waitUntil:async()=>{}}),output:()=>({setVoice:async()=>{},setPitchBendRange:async()=>{},noteOn:async()=>notes++,noteOff:async()=>{},cc:async()=>{}})}};
 await song.initCh(api);await song.runCh8();assert.equal(notes,2);
 await song.initCh(api);await song.runAllCh();assert.equal(notes,4);
});

test('module rejects overlapping playback and unlocks after a failed wait',async()=>{
 const data=smf([0,0x90,60,100,96,0x80,60,0,0,255,47,0]);
 const source=midiToSource(data,[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:3}],{module:true});
 const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 let reject,cleaned=0;
 const gate=new Promise((_,r)=>reject=r);
 const api={CH4:3,midi:{createTimeline:()=>({waitUntil:()=>gate}),output:()=>({setPitchBendRange:async()=>{},noteOn:async()=>{},noteOff:async()=>{},cc:async()=>cleaned++})}};
 await song.initCh(api);const running=song.runCh4();
 await assert.rejects(song.runAllCh(),/already playing/);await assert.rejects(song.initCh(api),/while playing/);
 reject(new Error('Run stopped'));await assert.rejects(running,/Run stopped/);assert.equal(cleaned,1);
 await song.initCh(api);
});

test('channel generators merge simultaneous events in source order, independent of selection order',async()=>{
 const data=smf([0,0x91,64,100,0,0x90,60,90,48,0x81,64,0,0,0x91,67,80,48,0x80,60,0,0,0x81,67,0,0,255,47,0]);
 const routes=[0,1].map(ch=>({part:`[0,0,"",${ch+1}]`,destination:'tetorica-sega-psg',channel:ch}));
 const source=midiToSource(data,routes,{module:true});
 assert.match(source,/function\* ch1Events\(\)/);assert.match(source,/function\* ch2Events\(\)/);
 assert(!source.includes('selected.has('));
 const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const events=[],times=[];
 const api={CH1:0,CH2:1,midi:{createTimeline:()=>({waitUntil:async seconds=>times.push(seconds)}),output:(destination,{channel})=>({
  setPitchBendRange:async()=>{},cc:async()=>{},
  noteOn:async note=>events.push([channel,'on',note]),noteOff:async note=>events.push([channel,'off',note]),
 })}};
 await song.initCh(api);
 for(const selected of [[0,1],[1,0]]) {
  events.length=0;times.length=0;
  await song.runChannels(selected.map(ch=>ch+1));
  assert.deepEqual(events,[[1,'on',64],[0,'on',60],[1,'off',64],[1,'on',67],[0,'off',60],[1,'off',67]]);
  assert.deepEqual(times,[0,.25,.5]);
 }
 events.length=0;await song.runChannels([2,2]);assert.equal(events.length,4);
 events.length=0;times.length=0;await song.runChannels([]);assert.deepEqual(times,[]);assert.deepEqual(events,[]);
});
