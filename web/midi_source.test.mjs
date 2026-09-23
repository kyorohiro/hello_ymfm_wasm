import test from 'node:test';
import assert from 'node:assert/strict';
import {midiToSource, assignMidiRoutes} from './midi_source.js';
import {createMidiApi, midiNote} from './playground_midi.js';
import {createMidiSongPlayer} from './midi_song.js';
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
 assert.throws(()=>midiToSource(data,[r,r]),/only be included once/);
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
 assert.deepEqual(Object.keys(song).sort(),['ch1Events','ch2Events','initCh','runAllCh','runCh1','runCh2','runChannels']);
 await assert.rejects(song.runAllCh(),/initCh/);
 const events=[],times=[];let clocks=0;
 const api={CH1:0,CH2:1,midi:{createSongPlayer(config){return createMidiSongPlayer(this,config);},createTimeline:()=>{clocks++;return {waitUntil:async t=>times.push(t)};},output:(dest,{channel})=>Object.fromEntries(['setPitchBendRange','noteOn','noteOff','cc'].map(method=>[method,async(...args)=>events.push([channel,method,...args])]))}};
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
 assert.deepEqual(Object.keys(song).sort(),['ch8Events','initCh','runAllCh','runCh8','runChannels']);
 let notes=0;
 const api={CH8:7,FM_PRESETS,midi:{createSongPlayer(config){return createMidiSongPlayer(this,config);},createTimeline:()=>({waitUntil:async()=>{}}),output:()=>({setVoice:async()=>{},setPitchBendRange:async()=>{},noteOn:async()=>notes++,noteOff:async()=>{},cc:async()=>{}})}};
 await song.initCh(api);await song.runCh8();assert.equal(notes,2);
 await song.initCh(api);await song.runAllCh();assert.equal(notes,4);
});

test('module rejects overlapping playback and unlocks after a failed wait',async()=>{
 const data=smf([0,0x90,60,100,96,0x80,60,0,0,255,47,0]);
 const source=midiToSource(data,[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:3}],{module:true});
 const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 let reject,cleaned=0;
 const gate=new Promise((_,r)=>reject=r);
 const api={CH4:3,midi:{createSongPlayer(config){return createMidiSongPlayer(this,config);},createTimeline:()=>({waitUntil:()=>gate}),output:()=>({setPitchBendRange:async()=>{},noteOn:async()=>{},noteOff:async()=>{},cc:async()=>cleaned++})}};
 await song.initCh(api);const running=song.runCh4();
 await assert.rejects(song.runAllCh(),/already playing/);await assert.rejects(song.initCh(api),/while playing/);
 reject(new Error('Run stopped'));await assert.rejects(running,/Run stopped/);assert.equal(cleaned,1);
 await song.initCh(api);
});

test('channel generators merge simultaneous events in source order, independent of selection order',async()=>{
 const data=smf([0,0x91,64,100,0,0x90,60,90,48,0x81,64,0,0,0x91,67,80,48,0x80,60,0,0,0x81,67,0,0,255,47,0]);
 const routes=[0,1].map(ch=>({part:`[0,0,"",${ch+1}]`,destination:'tetorica-sega-psg',channel:ch}));
 const source=midiToSource(data,routes,{module:true});
 assert.match(source,/function\* ch1Events\(output\)/);assert.match(source,/function\* ch2Events\(output\)/);
 assert(!source.includes('selected.has('));
 const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const events=[],times=[];
 const api={CH1:0,CH2:1,midi:{createSongPlayer(config){return createMidiSongPlayer(this,config);},createTimeline:()=>({waitUntil:async seconds=>times.push(seconds)}),output:(destination,{channel})=>({
  setPitchBendRange:async()=>{},cc:async()=>{},
  noteOn:async note=>events.push([channel,'on',midiNote(note)]),noteOff:async note=>events.push([channel,'off',midiNote(note)]),
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


test('auto routes skip excluded parts, keep part state separate and reserve manual channels first',()=>{
 const fm='tetorica-ym2612',psg='tetorica-sega-psg';
 const selections=[
  {part:'skip',destination:'',channel:999},
  {part:'a',destination:fm,sourceChannel:0},
  {part:'b',destination:fm,sourceChannel:0},
  {part:'c',destination:fm,channel:0},
  {part:'d',destination:psg,sourceChannel:0},
 ];
 const routes=assignMidiRoutes(selections);
 assert.deepEqual(routes.map(r=>[r.part,r.channel]),[['a',1],['b',2],['c',0],['d',0]]);
 assert.equal(selections[1].channel,undefined);
 assert.deepEqual(assignMidiRoutes([{part:'a',destination:fm,channel:0},{part:'b',destination:fm,channel:0}]).map(r=>r.channel),[0,0]);
 assert.throws(()=>assignMidiRoutes([{part:'a',destination:fm},{part:'a',destination:psg}]),/only be included once/);
});

test('automatic allocation uses all sixteen logical channels and reports overflow without merging',()=>{
 const routes=Array.from({length:16},(_,i)=>({part:String(i),destination:'tetorica-ym2612',sourceChannel:15}));
 assert.equal(new Set(assignMidiRoutes(routes).map(r=>r.channel)).size,16);
 assert.throws(()=>assignMidiRoutes([...routes,{part:'extra',destination:'tetorica-ym2612'}]),/At most 16/);
 assert.equal(assignMidiRoutes([...routes,{part:'psg',destination:'tetorica-sega-psg'}]).at(-1).channel,0);
});

test('Import always emits separate MIDI channels rather than physical pools',()=>{
 const data=smf([0,0x90,60,100,96,0x80,60,0,0,255,47,0]);
 const source=midiToSource(data,[{part:'[0,0,"",1]',destination:'tetorica-ym2612',channel:15,preset:'sine'}],{presets:FM_PRESETS,module:true});
 assert(source.includes('midi.output("tetorica-ym2612", {channel: api.CH16})'));
});

test('six parts assigned to CH1 compile into one handle and one chronological generator',async()=>{
 const tracks=Array.from({length:6},(_,i)=>[0,0x90+i,60+i,100,96,0x80+i,60+i,0,0,255,47,0]);
 const routes=Array.from({length:6},(_,i)=>({part:`[${i},0,"",${i+1}]`,destination:'tetorica-ym2612',channel:0,preset:i?'two-op-bell':'sine',bendRange:i?12:2}));
 const source=midiToSource(smf(...tracks),assignMidiRoutes(routes),{module:true,presets:FM_PRESETS});
 const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const events=[],times=[];let handles=0;
 await song.initCh({CH1:0,FM_PRESETS,midi:{createSongPlayer(config){return createMidiSongPlayer(this,config);},createTimeline:()=>({waitUntil:async t=>times.push(t)}),output:()=>{
  handles++;return Object.fromEntries(['setVoice','setPitchBendRange','noteOn','noteOff','cc'].map(m=>[m,async(...args)=>events.push([m,...args])]));
 }}});
 assert.equal(handles,1);assert.deepEqual(events,[['setVoice',FM_PRESETS.sine],['setPitchBendRange',2]]);
 assert.deepEqual(Object.keys(song).sort(),['ch1Events','initCh','runAllCh','runCh1','runChannels']);
 await song.runAllCh();assert.deepEqual(times,[0,.5]);
 assert.deepEqual(events.filter(e=>e[0]==='noteOn').map(e=>midiNote(e[1])),[60,61,62,63,64,65]);
 assert.equal(events.filter(e=>e[0]==='noteOff').length,6);
 assert.deepEqual(events.filter(e=>e[0]==='cc'),[['cc',120,0]]);
});

test('shared target receives a source-channel CC once even when multiple tracks use that source',async()=>{
 const data=smf([0,0xb0,7,100,0,0x90,60,90,96,0x80,60,0,0,255,47,0],[0,0x90,64,90,96,0x80,64,0,0,255,47,0]);
 const routes=[0,1].map(track=>({part:`[${track},0,"",1]`,destination:'tetorica-sega-psg',channel:0}));
 const source=midiToSource(data,routes,{module:true});
 assert.equal((source.match(/cc: \[7, 100\]/g)||[]).length,1);
});

test('exported events accept independent outputs without initialization, including bend and CC',async()=>{
 const data=smf([0,0x90,60,100,0,0xe0,0,96,0,0xb0,7,90,96,0x80,60,0,0,255,47,0]);
 const source=midiToSource(data,[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0}],{module:true});
 const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const events=[];
 const output=Object.fromEntries(['noteOn','noteOff','pitchBend','cc'].map(method=>[method,async(...args)=>events.push([method,...args])]));
 const entries=[...song.ch1Events(output)];
 assert.equal(events.length,0);
 assert.equal(entries[0].play,'C4');assert.equal(entries[0].duration,1);
 const player=createMidiSongPlayer({createTimeline:()=>({waitUntil:async()=>{}})},{channels:{1:{events:song.ch1Events,outputs:[output]}},endBeat:1});
 await player.runChannels([1]);
 assert.deepEqual(events,[['noteOn','C4',{velocity:100}],['pitchBend',4096/8191],['cc',7,90],['noteOff','C4'],['cc',120,0]]);
 events.length=0;
 const original=[];
 await song.initCh({CH1:0,midi:{createSongPlayer(config){return createMidiSongPlayer(this,config);},output:()=>({...output,setPitchBendRange:async()=>{},cc:async(...args)=>original.push(args)}),createTimeline:()=>({waitUntil:async()=>{throw Error('cancelled');}})}});
 await assert.rejects(song.runCh1(output),/cancelled/);
 assert.deepEqual(events,[['cc',120,0]]);assert.deepEqual(original,[]);
});

test('FM and PSG with the same MIDI channel accept separate replacement outputs',async()=>{
 const data=smf([0,0x90,60,100,96,0x80,60,0,0,255,47,0],[0,0x91,64,90,96,0x81,64,0,0,255,47,0]);
 const source=midiToSource(data,[{part:'[0,0,"",1]',destination:'tetorica-ym2612',channel:0,preset:'sine'},{part:'[1,0,"",2]',destination:'tetorica-sega-psg',channel:0}],{module:true,presets:FM_PRESETS});
 const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const events=[];
 const output=id=>Object.fromEntries(['noteOn','noteOff','cc','setVoice','setPitchBendRange'].map(method=>[method,async(...args)=>events.push([id,method,...args])]));
 await song.initCh({CH1:0,FM_PRESETS,midi:{createSongPlayer(config){return createMidiSongPlayer(this,config);},output:()=>output('default'),createTimeline:()=>({waitUntil:async()=>{}})}});
 events.length=0;
 await assert.rejects(song.runCh1(output('fm')),/one output/);
 await song.runCh1(output('fm'),output('psg'));
 assert.deepEqual(events.filter(e=>e[1]==='noteOn'),[['fm','noteOn','C4',{velocity:100}],['psg','noteOn','E4',{velocity:90}]]);
 assert.deepEqual(events.filter(e=>e[1]==='cc'),[['fm','cc',120,0],['psg','cc',120,0]]);
 assert(!events.some(e=>e[0]==='default'));
});

test('readable score matches raw MIDI dispatch through tempo changes, repeated notes and controls',async()=>{
 const data=smf(
  [0,255,81,3,7,161,32,48,0xb0,64,127,48,255,81,3,15,66,64,0,0xe0,127,127,96,0xb0,64,0,0,255,47,0],
  [0,0x90,60,100,0,0x90,64,80,48,0x90,60,70,48,0x80,60,0,0,0x90,67,60,0,0x80,67,0,48,0x80,60,0,48,0x90,64,0,0,255,47,0]
 );
 function capture() {
  let time=0;const events=[];
  const output=Object.fromEntries(['setVoice','setPitchBendRange','noteOn','noteOff','cc','pitchBend'].map(method=>[method,async(...args)=>{
   if(method==='noteOn'||method==='noteOff')args[0]=midiNote(args[0]);
   events.push([time,method,...args]);
  }]));
  const midi={createSongPlayer(config){return createMidiSongPlayer(this,config);},createTimeline:()=>({waitUntil:async seconds=>{assert(seconds>=time);time=seconds;}}),output:()=>output};
  return {midi,events};
 }
 const raw=capture(),readable=capture();
 await new AsyncFunction('midi','FM_PRESETS','CH16',midiToSource(data,[route],{presets:FM_PRESETS}))(raw.midi,FM_PRESETS,15);
 const source=midiToSource(data,[route],{presets:FM_PRESETS,module:true});
 assert(source.includes('play: "C4", duration: 1'));
 assert(!source.includes('while (true)'));
 const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 await song.initCh({midi:readable.midi,FM_PRESETS,CH16:15});await song.runAllCh();
 assert.deepEqual(readable.events,raw.events);
});
