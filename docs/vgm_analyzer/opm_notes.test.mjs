import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpmNoteTracker,opmPitch,extractOpmNotes} from './opm_notes.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {VgmPlayer} from '../js/vgmplayer.js';
const clock=3579545;
function vgm(commands){const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);b.set([86,103,109,32]);v.setUint32(4,b.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x30,clock,true);v.setUint32(0x34,204,true);b.set(commands,256);return b;}
const song=vgm([0x54,0x28,0x4a,0x54,8,0x78,0x61,100,0,0x54,0x30,128,0x61,50,0,0x54,8,0,0x66]);
test('OPM KC gap mapping, KF fractions, octave and clock scaling',()=>{
 assert.equal(opmPitch(0x4a,0,clock),69);assert.equal(opmPitch(0x4a,32,clock),69.5);
 assert.equal(opmPitch(0,0,clock),13);assert.equal(opmPitch(0x50,0,clock),73);
 assert.equal(opmPitch(0x43,0,clock),opmPitch(0x44,0,clock));assert.equal(opmPitch(0x4f,0,clock),opmPitch(0x50,0,clock));
 assert.equal(opmPitch(0x4a,0,clock*2),81);assert.equal(opmPitch(0,0,0),null);
});
test('OPM tracker ignores repeated keys and suppresses partial, noise and CSM pitches',()=>{
 const events=[],t=createOpmNoteTracker(clock,(ch,s,time)=>events.push([ch,s.midi,time]));
 t.write(0x2f,0x4a,0);t.write(8,0x7f,1);t.write(8,0x7f,2);assert.deepEqual(events,[[7,69,1]]);
 t.write(15,128,3);assert.equal(t.channels[7].midi,null);t.write(15,0,4);assert.equal(t.channels[7].midi,69);
 t.write(8,0x0f,5);assert.equal(t.channels[7].reason,'Partial key mask');
 t.write(8,0x7f,6);t.write(0x14,128,7);assert.equal(t.channels[7].reason,'CSM');t.write(0x14,0,8);assert.equal(t.channels[7].midi,69);
 t.reset();assert(t.channels.every(c=>!c.keyOn&&c.midi===null));
});
test('OPM extraction retains fractional pitches and exact VGM sample intervals',()=>{
 const result=extractOpmNotes(song);assert.equal(result.time,150);
 assert.deepEqual(result.channels[0].notes.map(({start,end,midi,key})=>({start,end,midi,key})),[{start:0,end:100,midi:69,key:1},{start:100,end:150,midi:69.5,key:1}]);
 assert(result.channels.slice(1).every(c=>c.notes.length===0));
});
test('Player write path matches extraction across frame partitions and reset',()=>{
 const events=[];const tracker=createOpmNoteTracker(clock,(ch,s,sample)=>events.push([ch,s.midi,sample]));let player;
 const engine={sampleRate:()=>44100,reset:()=>tracker.reset(),writeYm2151:(r,v)=>tracker.write(r,v,player.processedWaitSamples),processFrames(n){return {left:new Float32Array(n),right:new Float32Array(n)};}};
 player=new VgmPlayer(engine);player.load(song);
 function run(chunks){events.length=0;player.reset();player.play();for(const n of chunks)player.process(new Float32Array(n),new Float32Array(n),n);return events.slice();}
 assert.deepEqual(run([151]),[[0,69,0],[0,69.5,100],[0,null,150]]);assert.deepEqual(run([37,64,50]),[[0,69,0],[0,69.5,100],[0,null,150]]);
});

test('Note-ish worker uses YM2151 extraction and emits timeline intervals',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const {packTimeline,timelineWindow}=await import('./note_timeline.js');
 const {extractToneNotes}=await import('./tone_notes.js');
 const messages=[];
 const source=readFileSync(new URL('./note_timeline_worker.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 const ctx=vm.createContext({extractOpmNotes,extractToneNotes,Ym2612VGM,packTimeline,timelineWindow,midiChipKind:()=>{throw Error('OPM must not use OPN selector');},self:{postMessage:m=>messages.push(m)}});
 vm.runInContext(source,ctx);ctx.self.onmessage({data:{type:'load',buffer:song}});
 assert.equal(messages[0].type,'ready');assert.equal(messages[0].duration,150);assert.deepEqual(Array.from(messages[0].names),['CH1']);
 ctx.self.onmessage({data:{type:'view',id:1,start:0,end:150,limit:100}});
 assert.deepEqual(JSON.parse(JSON.stringify(messages[1].channels[0].rows)),[[0,100,69,1],[100,150,69.5,1]]);
});
test('Analyzer live bridge uses the same pitch and clears histories on reset',async()=>{
 const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const ctx=vm.createContext({createOpmNoteTracker,opmNoteChannels:[],opmNoteTracker:null,currentChipKind:'ym2151',performance:{now:()=>100},songTimeMs:()=>100,pruneChannelNoteHistory(){},requestNoteishRender(){}});
 vm.runInContext(source.slice(source.indexOf('function resetOpmNotes('),source.indexOf('function updateToneMonitor(')),ctx);
 ctx.resetOpmNotes(clock);ctx.opmNoteTracker.write(0x28,0x4a,0);ctx.opmNoteTracker.write(8,0x78,4);ctx.opmNoteTracker.write(0x30,128,100);
 const ch=ctx.noteishChannels()[0];assert.equal(ch.noteMidi,69.5);assert.equal(ch.noteMinMidi,69);assert.equal(ch.noteMaxMidi,69.5);assert.equal(ch.noteHistory[1].sample,100);
 ctx.resetOpmNotes(clock);assert.equal(ctx.noteishChannels().length,8);assert(ctx.noteishChannels().every(c=>c.noteHistory.length===0&&!c.keyOn));
});
