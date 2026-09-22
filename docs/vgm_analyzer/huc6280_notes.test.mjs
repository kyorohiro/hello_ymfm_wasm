import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHuc6280Monitor,applyHuc6280Write,describeHuc6280Notes,extractHuc6280Notes} from './huc6280_notes.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {packTimeline,timelineWindow} from './note_timeline.js';
import {groupScoreChannels} from './score_groups.js';
import {Huc6280AudioEngine} from '../js/huc6280audioengine.js';
import factory from '../generated/huc6280_wasm.js';
import {VgmPlayer} from '../js/vgmplayer.js';
const clock=3579545;
const w=(r,v)=>[0xb9,r,v],wait=n=>[0x61,n&255,n>>>8];
const u32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
const setup=ch=>[...w(1,255),...w(0,ch),...w(2,254),...w(3,0),...w(5,255),...w(4,159)];
function vgm(commands){
  const bytes=new Uint8Array(256+commands.length),v=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);
  v.setUint32(0xa4,clock,true);bytes.set(commands,256);return bytes;
}
test('six channels: mode changes, MAME priority, LFO exclusions and period zero',()=>{
  const state=createHuc6280Monitor(),write=(r,v)=>applyHuc6280Write(state,r,v),notes=()=>describeHuc6280Notes(state,clock);
  write(1,255);
  for(let i=0;i<6;i++){
    write(0,i);write(2,254);write(5,255);write(4,159);
    assert(Math.abs(notes()[i].midi-69)<.05);
    write(4,223);assert.equal(notes()[i].type,'PCM/DDA');assert.equal(notes()[i].midi,null);
    write(4,159);assert.equal(notes()[i].keyOn,true);
  }
  write(9,2);
  assert.deepEqual(notes().map(n=>n.type),['LFO','LFO','Wave','Wave','Wave','Wave']);
  assert(notes().slice(0,2).every(n=>n.midi===null));
  write(0,0);write(4,223);assert.equal(notes()[0].type,'PCM/DDA');
  write(0,4);write(7,128);write(4,223);assert.equal(notes()[4].type,'Noise');
  write(0,2);write(7,128);assert.equal(notes()[2].type,'Wave');
  write(2,0);write(3,0);assert.equal(notes()[2].midi,69+12*Math.log2(clock/(32*4096)/440));
  write(0,7);write(4,255);assert.equal(notes().length,6);
});
test('disabled and inaudible attenuation stop notes; one audible side is sufficient',()=>{
  const state=createHuc6280Monitor(),write=(r,v)=>applyHuc6280Write(state,r,v),note=()=>describeHuc6280Notes(state,clock)[0];
  write(1,255);write(5,240);write(2,254);write(4,159);
  assert.equal(note().keyOn,true);
  write(1,15);assert.equal(note().reason,'Silent');assert.equal(note().midi,null);
  write(1,255);write(4,128);assert.equal(note().reason,'Silent');
  write(4,31);assert.equal(note().reason,'Off');
  write(4,159);assert.equal(note().keyOn,true);assert.equal(note().trigger,2);
});
const switching=vgm([...setup(2),...wait(100),...w(4,223),...wait(100),...w(4,159),...wait(100),...w(4,0),0x66]);
test('Song intervals close for DDA and resume without spanning the gap',()=>{
  const result=extractHuc6280Notes(switching);
  assert.equal(result.time,300);
  assert.deepEqual(result.channels[2].notes.map(n=>[n.start,n.end]),[[0,100],[200,300]]);
  assert(result.channels.filter((_,i)=>i!==2).every(ch=>ch.notes.length===0));
  const bytes=vgm([...setup(4),...wait(10),...w(7,128),...wait(10),...w(7,0),...wait(10),0x66]);
  assert.deepEqual(extractHuc6280Notes(bytes).channels[4].notes.map(n=>[n.start,n.end]),[[0,10],[20,30]]);
  const lfo=vgm([...setup(0),...setup(1),...setup(2),...wait(10),...w(9,1),...wait(10),...w(9,0),...wait(10),0x66]);
  const channels=extractHuc6280Notes(lfo).channels;
  for(const ch of channels.slice(0,2))assert.deepEqual(ch.notes.map(n=>[n.start,n.end]),[[0,10],[20,30]]);
  assert.deepEqual(channels[2].notes.map(n=>[n.start,n.end]),[[0,30]]);
});
test('PCM stream selects/restores channels and never infers pitch from sample bytes',()=>{
  // Stream control-register writes exercise channel restoration as well as
  // sample timing; an interleaved direct write must still address CH4.
  const bytes=vgm([...setup(2),...setup(3),
    0x67,0x66,5,...u32(2),223,159,0x90,0,0x1b,2,4,0x91,0,5,1,0,0x92,0,...u32(4410),0x95,0,0,0,0,
    ...wait(5),...w(4,0),...wait(15),0x66]);
  const channels=extractHuc6280Notes(bytes).channels;
  assert.deepEqual(channels[2].notes.map(n=>[n.start,n.end]),[[10,20]]);
  assert.deepEqual(channels[3].notes.map(n=>[n.start,n.end]),[[0,5]]);
});
test('Song worker includes HuC6280 notes with gaps',()=>{
  const messages=[],context=vm.createContext({extractHuc6280Notes,Ym2612VGM,packTimeline,timelineWindow,groupScoreChannels,
    self:{postMessage:m=>messages.push(m)}});
  const worker=readFileSync(new URL('./note_timeline_worker.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInContext(worker,context);context.self.onmessage({data:{type:'load',buffer:switching}});
  assert.equal(messages[0].type,'ready',messages[0].message);assert.equal(messages[0].duration,300);
  assert.deepEqual(Array.from(messages[0].names),['HuC6280 CH3']);
  context.self.onmessage({data:{type:'view',start:0,end:300,limit:100}});
  assert.deepEqual(Array.from(messages[1].channels[0].rows,r=>[r[0],r[1]]),[[0,100],[200,300]]);
});
test('live UI monitor follows real engine writes, mode labels, history and replay reset',async()=>{
  const source=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
  const fn=name=>{const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);};
  const engine=await Huc6280AudioEngine.create({moduleFactory:factory,clock});
  const context=vm.createContext({engine,createHuc6280Monitor,applyHuc6280Write,describeHuc6280Notes,
    currentChipKind:'huc6280',noteishHeader:{huc6280Clock:clock},apuNoteChannels:[],apuNoteMonitor:null,
    isOpl:()=>false,songTimeMs:()=>0,requestNoteishRender(){},pruneChannelNoteHistory(){},
    buildMonitorChannel:()=>({noteHistory:[],noteMinMidi:null,noteMaxMidi:null})});
  vm.runInContext(fn('updateApuNoteMonitor')+'\n'+fn('resetApuNoteChannels')+'\nresetApuNoteChannels();',context);
  const start=source.indexOf("      if (chip === 'huc6280') {");
  const end=source.indexOf("      if (chip === 'nes') {",start);
  vm.runInContext("const chip='huc6280';\n"+source.slice(start,end),context);
  try {
    const player=new VgmPlayer(engine);player.setPrefetchFactor(1);player.load(switching);player.play();
    const process=n=>player.process(new Float32Array(n),new Float32Array(n),n);
    process(101);
    assert.equal(context.apuNoteChannels.length,6);
    assert.equal(context.apuNoteChannels[2].apuType,'PCM/DDA');
    assert.equal(context.apuNoteChannels[2].toneMidi,null);
    process(100);assert.equal(context.apuNoteChannels[2].apuType,'Wave');
    assert(context.apuNoteChannels[2].toneMidi!==null);
    assert(context.apuNoteChannels[2].noteHistory.some(n=>n.midiFloat===null));
    player.reset();assert(context.apuNoteChannels.every(ch=>ch.toneMidi===null));
    player.play();process(1);assert(context.apuNoteChannels[2].toneMidi!==null);
    engine.writeHuc6280(0,3);
    engine.writeHuc6280Stream(2,4,223);
    assert.equal(context.apuNoteChannels[2].apuType,'PCM/DDA');
    assert.equal(context.apuNoteChannels[2].toneMidi,null);
    assert.equal(context.apuNoteMonitor.selected,3);
    assert.equal(engine.selectedChannel,3);
  } finally {engine.dispose();}
});
