import test from 'node:test';
import assert from 'node:assert/strict';
import {midiToSource, assignMidiRoutes} from './midi_source.js';
import {createMidiApi, midiNote} from './playground_midi.js';
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
 const events=[],times=[];let elapsed=0;
 const sleepSamples=async samples=>{elapsed+=samples/44100;times.push(elapsed);};
 const midi={createTimeline:()=>({waitUntil:async seconds=>times.push(seconds)}),output:(destination,options)=>{
  assert.equal(destination,route.destination);assert.equal(options.channel,15);
  return Object.fromEntries(['setVoice','setPitchBendRange','noteOn','noteOff','cc','pitchBend'].map(method=>[method,async(...args)=>events.push([method,...args])]));
 }};
 await new AsyncFunction('midi','FM_PRESETS','CH16','sleepSamples',source)(midi,FM_PRESETS,15,sleepSamples);
 assert.deepEqual(times,[.5,1.5]);
 assert.deepEqual(events.filter(e=>e[0]==='noteOn'),[['noteOn','C4',{velocity:100}],['noteOn','E4',{velocity:80}]]);
 assert.deepEqual(events.filter(e=>e[0]==='noteOff'),[['noteOff','C4'],['noteOff','E4']]);
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


function mockApi() {
 const events=[],waits=[];let samples=0;
 const api={FM_PRESETS,sleepSamples:async n=>{waits.push(n);samples+=n;},midi:{output:(destination,{channel})=>makeOutput(`${destination}/${channel}`)}};
 for(let i=0;i<16;i++)api[`CH${i+1}`]=i;
 function makeOutput(id) {
  return Object.fromEntries(['setVoice','setPitchBendRange','noteOn','noteOff','cc','pitchBend'].map(method=>[method,async(...args)=>{
   if(method==='noteOn'||method==='noteOff')args[0]=midiNote(args[0]);
   events.push([samples,id,method,...args]);
  }]));
 }
 return {api,events,waits,makeOutput};
}
async function compile(data,routes) {
 const source=midiToSource(data,routes,{module:true,presets:FM_PRESETS});
 assert(!/createSongPlayer|createTimeline|yield |offOrder/.test(source));
 return {source,song:await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)};
}
const twoTracks=()=>smf([0,0x90,60,100,96,0x80,60,0,0,255,47,0],[0,0x91,64,90,96,0x81,64,0,0,255,47,0]);
const psgRoutes=[0,1].map(i=>({part:`[${i},0,"",${i+1}]`,destination:'tetorica-sega-psg',channel:i}));

test('generated module only needs standard output methods and sleepSamples',async()=>{
 const {song,source}=await compile(twoTracks(),psgRoutes);
 assert.match(source,/await sleepSamples\(22050\)/);
 assert.match(source,/await segapsg_1.noteOn\("C4"/);
 assert.deepEqual(Object.keys(song).sort(),['ch1Events','ch2Events','initCh','performance','runAllCh','runCh1','runCh2','runChannels']);
 await assert.rejects(song.runAllCh(),/initCh/);
 const {api,events,waits}=mockApi();await song.initCh(api);events.length=0;
 await song.runAllCh();assert.deepEqual(waits,[22050]);
 assert.deepEqual(events.filter(e=>e[2]==='noteOn').map(e=>[e[0],e[3]]),[[0,60],[0,64]]);
 assert.deepEqual(events.filter(e=>e[2]==='noteOff').map(e=>[e[0],e[3]]),[[22050,60],[22050,64]]);
});

test('selection order does not reorder simultaneous notes; duplicates and empty selections are handled',async()=>{
 const {song}=await compile(twoTracks(),psgRoutes);
 const state=mockApi();await song.initCh(state.api);state.events.length=0;
 await song.runChannels([2,1]);
 assert.deepEqual(state.events.filter(e=>e[2]==='noteOn').map(e=>e[3]),[60,64]);
 state.events.length=0;await song.runChannels([2,2]);
 assert.deepEqual(state.events.filter(e=>e[2]==='noteOn').map(e=>e[3]),[64]);
 assert(state.events.every(e=>e[1].endsWith('/1')));
 state.events.length=0;state.waits.length=0;await song.runChannels([]);
 assert.deepEqual(state.events,[]);assert.deepEqual(state.waits,[]);
 await assert.rejects(song.runChannels([99]),/Unknown/);
});

test('output replacement and standalone channel function use no initialized player',async()=>{
 const {song}=await compile(twoTracks(),psgRoutes);
 const state=mockApi();const output=state.makeOutput('replacement');
 await song.ch1Events(output,state.api.sleepSamples);
 assert.deepEqual(state.events.filter(e=>e[2]==='noteOn').map(e=>e[3]),[60]);
 assert(state.events.every(e=>e[1]==='replacement'));
 assert.deepEqual(state.waits,[22050]);
 await song.initCh(state.api);state.events.length=0;
 await song.runCh1(output);assert(state.events.every(e=>e[1]==='replacement'));
});

test('same channel on FM and PSG takes two outputs and reinitializes safely',async()=>{
 const routes=[{...psgRoutes[0],destination:'tetorica-ym2612',channel:7,preset:'sine'},{...psgRoutes[1],channel:7}];
 const {song}=await compile(twoTracks(),routes);
 const state=mockApi();await song.initCh(state.api);state.events.length=0;
 await assert.rejects(song.runCh8(state.makeOutput('fm')),/one output/);
 await song.runCh8(state.makeOutput('fm'),state.makeOutput('psg'));
 assert.deepEqual(state.events.filter(e=>e[2]==='noteOn').map(e=>[e[1],e[3]]),[['fm',60],['psg',64]]);
 await song.initCh(state.api);state.events.length=0;await song.runAllCh();
 assert.equal(state.events.filter(e=>e[2]==='noteOn').length,2);
});

test('six source parts sharing CH1 have one handle, one time sequence and first voice settings',async()=>{
 const tracks=Array.from({length:6},(_,i)=>[0,0x90+i,60+i,100,96,0x80+i,60+i,0,0,255,47,0]);
 const routes=tracks.map((_,i)=>({part:`[${i},0,"",${i+1}]`,destination:'tetorica-ym2612',channel:0,preset:i?'two-op-bell':'sine',bendRange:i?12:2}));
 const {song}=await compile(smf(...tracks),routes);const state=mockApi();await song.initCh(state.api);
 assert.deepEqual(state.events.map(e=>e.slice(2)),[['setVoice',FM_PRESETS.sine],['setPitchBendRange',2]]);
 state.events.length=0;await song.runAllCh();
 assert.deepEqual(state.events.filter(e=>e[2]==='noteOn').map(e=>e[3]),[60,61,62,63,64,65]);
 assert.equal(state.events.filter(e=>e[2]==='cc').length,1);assert.deepEqual(state.waits,[22050]);
});

test('cross-track controllers, tempo changes, overlapping and unmatched notes match raw standard calls',async()=>{
 const data=smf(
  [0,255,81,3,7,161,32,48,0xb0,64,127,48,255,81,3,15,66,64,0,0xe0,127,127,96,0xb0,64,0,0,255,47,0],
  [0,0x80,50,0,0,0x90,60,100,0,0x90,64,80,48,0x90,60,70,48,0x80,60,0,0,0x90,67,60,0,0x80,67,0,48,0x80,60,0,48,0x90,64,0,0,0x90,70,100,0,255,47,0]
 );
 const raw=mockApi(),module=mockApi();
 await new AsyncFunction('midi','FM_PRESETS','CH16','sleepSamples',midiToSource(data,[route],{presets:FM_PRESETS}))(raw.api.midi,FM_PRESETS,15,raw.api.sleepSamples);
 const {song}=await compile(data,[route]);await song.initCh(module.api);await song.runAllCh();
 assert.deepEqual(module.events,raw.events);assert.deepEqual(module.waits,[11025,11025,22050,22050]);
 assert.deepEqual(module.events.filter(e=>e[2]==='pitchBend').map(e=>[e[0],e[3]]),[[22050,1]]);
});

test('cancellation cleans replacement outputs, rejects overlapping runs and releases the guard',async()=>{
 const {song}=await compile(twoTracks(),psgRoutes);const state=mockApi();let reject;
 const gate=new Promise((_,r)=>{reject=r;});state.api.sleepSamples=()=>gate;
 await song.initCh(state.api);state.events.length=0;
 const output=state.makeOutput('replacement');const playing=song.runCh1(output);
 await assert.rejects(song.runAllCh(),/already playing/);
 await assert.rejects(song.initCh(state.api),/while playing/);
 reject(Error('Run stopped'));await assert.rejects(playing,/Run stopped/);
 assert.deepEqual(state.events.filter(e=>e[2]==='cc').map(e=>e.slice(1)),[['replacement','cc',120,0]]);
 state.api.sleepSamples=async()=>{};await song.initCh(state.api);await song.runAllCh();
});

test('absolute sample rounding avoids accumulating rounding error across short waits',async()=>{
 const track=[];for(let i=0;i<96;i++)track.push(1,0xb0,7,100);
 track.push(0,0x90,60,100,0,0x80,60,0,0,255,47,0);
 const {song}=await compile(smf(track),[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0}]);
 const state=mockApi();await song.initCh(state.api);await song.runAllCh();
 assert.equal(state.waits.reduce((a,b)=>a+b,0),22050);
 assert.deepEqual([...new Set(state.waits)].sort(),[229,230]);
});

test('controller shared by source tracks is only applied once per target',async()=>{
 const data=smf([0,0xb0,7,100,0,0x90,60,90,96,0x80,60,0,0,255,47,0],[0,0x90,64,90,96,0x80,64,0,0,255,47,0]);
 const routes=[0,1].map(track=>({part:`[${track},0,"",1]`,destination:'tetorica-sega-psg',channel:0}));
 const {song}=await compile(data,routes);const state=mockApi();await song.initCh(state.api);state.events.length=0;
 await song.runAllCh();assert.equal(state.events.filter(e=>e[2]==='cc'&&e[3]===7).length,1);
});

test('long MIDI performance has bounded function bodies and preserves waits and commands across sections',async()=>{
 const track=[];
 for(let i=0;i<3000;i++)track.push(0,0x90,60,100,1,0x80,60,0);
 track.push(0,255,47,0);
 const data=smf(track),routes=[{part:'[0,0,"",1]',destination:'tetorica-sega-psg',channel:0}];
 for(const module of [false,true]) {
  const source=midiToSource(data,routes,{module});
  const sections=[...source.matchAll(/async function section\d+\(\) \{\n([\s\S]*?)\n    \}/g)];
  assert(sections.length>50);
  assert(sections.every(match=>match[1].split('\n').length<=128));
  const state=mockApi();
  if(module) {
   const song=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
   await song.initCh(state.api);state.events.length=0;await song.runAllCh();
  } else await new AsyncFunction('midi','CH1','sleepSamples',source)(state.api.midi,0,state.api.sleepSamples);
  const notes=state.events.filter(e=>e[2]==='noteOn'||e[2]==='noteOff');
  assert.equal(notes.length,6000);
  for(let i=0;i<notes.length;i++)assert.equal(notes[i][2],i%2?'noteOff':'noteOn');
  assert.equal(state.waits.reduce((a,b)=>a+b,0),Math.round(3000/96*.5*44100));
 }
});
