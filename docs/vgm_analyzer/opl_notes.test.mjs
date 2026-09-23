import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {extractOplNotes,createOplMonitor,applyOplWrite,snapshotOpl,describeOplNotes} from './opl_notes.js';
import {exportSource,listSourceScoreChannels,inspectSourceSupport} from './analyzer_core.js';
import {chipSupportContext} from './test_helpers/chip_support_context.mjs';
const wait=[0x61,0x22,0x56];
function vgm(kind,entries,clock=3579545) {
 const code=kind==='y8950'?0x5c:kind==='ym3526'?0x5b:0x5a;
 const commands=entries.flatMap(e=>e==='wait'?wait:[code,...e]);
 const bytes=new Uint8Array(257+commands.length),view=new DataView(bytes.buffer);
 bytes.set([86,103,109,32]);view.setUint32(8,0x171,true);view.setUint32(0x34,0xcc,true);
 view.setUint32(kind==='y8950'?0x58:kind==='ym3526'?0x54:0x50,clock,true);bytes.set([...commands,0x66],256);return bytes;
}
for(const kind of ['ym3526','ym3812','y8950']) {
 test(`${kind}: pitch changes, retriggers, all nine channels and final note closure`,()=>{
  const entries=Array.from({length:9},(_,ch)=>[[0xa0+ch,68],[0xb0+ch,0x32]]).flat();
  const a=extractOplNotes(vgm(kind,[...entries,'wait',[0xa0,69],'wait',[0xb0,0x12],[0xb0,0x32],'wait']));
  assert.equal(a.channels.length,9);assert.equal(a.channels[8].notes[0].end,66150);
  const notes=a.channels[0].notes;assert.equal(notes.length,3);assert.equal(notes[0].key,notes[1].key);assert.notEqual(notes[1].key,notes[2].key);
  assert.ok(Math.abs(notes[0].midi-69)<0.03);
 });
 test(`${kind}: rhythm and CSM gaps are excluded; zero FNUM remains unknown`,()=>{
  const a=extractOplNotes(vgm(kind,[[0xa6,68],[0xb6,0x32],'wait',[0xbd,32],'wait',[0xbd,0],'wait',[8,128],'wait',[8,0],'wait']));
  assert.deepEqual(a.channels[6].notes.map(n=>[n.start,n.end]),[[0,22050],[44100,66150],[88200,110250]]);
  assert.match([...a.warnings.keys()].join(' '),/rhythm/);assert.match([...a.warnings.keys()].join(' '),/CSM/);
  assert.equal(extractOplNotes(vgm(kind,[[0xb0,32],'wait'])).channels[0].notes[0].midi,null);
  assert.throws(()=>extractOplNotes(vgm(kind,[],3579545|0x40000000)),/Dual/);
 });
 test(`${kind}: shared exports and channel IDs`,async()=>{
  const source=vgm(kind,[[0xa0,68],[0xb0,0x32],'wait',[0xb0,0x12]]);
  assert.equal(listSourceScoreChannels(source).channels[8].id,`${kind}-ch9`);
  const midi=exportSource(source,{format:'midi',bpm:120});assert.equal(midi.noteCount,1);assert.equal(new TextDecoder().decode(midi.bytes.slice(0,4)),'MThd');
  assert.match(exportSource(source,{format:'musicxml',bpm:120,channels:[`${kind}-ch1`]}).text,/<step>A<\/step>/);
  assert.match(exportSource(source,{format:'lilypond',bpm:120}).text,new RegExp(kind.toUpperCase()+' CH1'));
  const support=await inspectSourceSupport(source);for(const format of ['midi','musicxml','lilypond'])assert.equal(support.exports[format].status,'available');
 });
 test(`${kind}: live state and JSON preserve operator offsets and waveform semantics`,()=>{
  const regs=createOplMonitor();
  for(const [r,v] of [[1,32],[0xa8,68],[0xb8,50],[0xc8,15],[0x32,0xf5],[0x35,0x02],[0x52,0xc7],[0x72,0xab],[0x92,0xcd],[0xf2,3]])applyOplWrite(regs,r,v);
  const snap=JSON.parse(JSON.stringify(snapshotOpl(regs,kind,3579545))),ch=snap.channels[8];
  assert.equal(ch.keyOn,true);assert.equal(ch.feedback,7);assert.equal(ch.connection,1);
  assert.equal(ch.operators[0].offset,18);assert.equal(ch.operators[1].offset,21);
  assert.equal(ch.operators[0].multiplier,5);assert.equal(ch.operators[0].attack,10);assert.equal(ch.operators[0].release,13);
  assert.equal(ch.operators[0].waveform,kind==='ym3812'?3:0);assert.equal(snap.registers[0xf2],3);
  regs.fill(0);assert.ok(describeOplNotes(regs,3579545).every(n=>!n.keyOn));
 });
 test(`${kind}: UI exposes notes, operator info and MIDI without enabling TFI`,()=>{
  const source=fs.readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function updateChipSupport()'),source.indexOf('\nfunction buildParseInfo'));
  const context={...chipSupportContext(),currentChipKind:kind,currentBuffer:new Uint8Array(1),midiExportAvailable:true,setOutputTab(){}};
  vm.runInNewContext(fn+'\nupdateChipSupport();',context);
  assert.equal(context.noteishTab.disabled,false);assert.equal(context.operatorInfoTab.disabled,false);assert.equal(context.sheetMusicTab.disabled,false);assert.equal(context.exportMidiButton.disabled,false);
  assert.equal(context.exportSnapshotTfiButton.disabled,true);assert.equal(context.oplMonitorRoot.hidden,false);
 });
}

for(const kind of ['ym3526','ym3812','y8950']) test(`${kind}: live Note-ish updates, CSM omission and reset`,async()=>{
 const {isOpl}=await import('./opl_notes.js');
 const source=fs.readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const fn=name=>{const start=source.indexOf(`function ${name}(`);return source.slice(start,source.indexOf('\n}',start)+2);};
 const c={isOpl,createOplMonitor,describeOplNotes,currentChipKind:kind,noteishHeader:{[`${kind}Clock`]:3579545},apuNoteMonitor:null,apuNoteChannels:[],
  buildMonitorChannel:i=>({channel:i,noteHistory:[],noteMinMidi:null,noteMaxMidi:null}),songTimeMs:()=>0,pruneChannelNoteHistory(){},requestNoteishRender(){}};
 vm.createContext(c);vm.runInContext(fn('updateApuNoteMonitor')+'\n'+fn('resetApuNoteChannels'),c);c.resetApuNoteChannels();
 for(const [r,v] of [[0xa0,68],[0xb0,50]])applyOplWrite(c.apuNoteMonitor,r,v);
 c.updateApuNoteMonitor();assert.equal(c.apuNoteChannels.length,9);assert.equal(c.apuNoteChannels[0].keyOn,true);assert.equal(c.apuNoteChannels[0].label,`${kind.toUpperCase()} CH1`);
 applyOplWrite(c.apuNoteMonitor,8,128);c.updateApuNoteMonitor();assert.equal(c.apuNoteChannels[0].toneMidi,null);assert.equal(c.apuNoteChannels[0].unavailable,true);
 applyOplWrite(c.apuNoteMonitor,8,0);applyOplWrite(c.apuNoteMonitor,0xb0,18);c.updateApuNoteMonitor();assert.equal(c.apuNoteChannels[0].toneMidi,null,'key off closes live note');
 c.resetApuNoteChannels();assert.ok(c.apuNoteChannels.every(ch=>!ch.keyOn));
});

test('OPL operator display downloads the current JSON state',()=>{
 let downloaded,clicked=false;
 const element=()=>({style:{},addEventListener(name,fn){this[name]=fn;},append(...children){this.children=children;},click(){clicked=true;}});
 const root=element(),registers=createOplMonitor();applyOplWrite(registers,0x20,0x71);
 const context={snapshotOpl,document:{createElement:element},Blob:class {constructor(parts){downloaded=JSON.parse(parts[0]);}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout(){}};
 const source=fs.readFileSync(new URL('./opl_monitor.js',import.meta.url),'utf8').replace(/^import .*;\n/m,'').replace('export function','function');
 vm.runInNewContext(source,context);
 const monitor=context.mountOplMonitor(root,()=>({registers,kind:'ym3812',clock:3579545,rawClock:3579545}));monitor.render();
 assert.match(root.children[3].textContent,/OP1: MUL 1/);assert.equal(root.children.length,12);
 applyOplWrite(registers,0x20,0x72);root.children[2].click();
 assert.equal(clicked,true);assert.equal(downloaded.channels[0].operators[0].multiplier,2);assert.equal(downloaded.format,'tetorica-opl-snapshot');
});

for(const kind of ['ym3526','ym3812','y8950']) test(`${kind}: waveform enable toggles interpretation without losing raw register data`,()=>{
 const regs=createOplMonitor();applyOplWrite(regs,0xe0,0xff);
 assert.equal(snapshotOpl(regs,kind,3579545).channels[0].operators[0].waveform,0);
 applyOplWrite(regs,1,32);
 const enabled=snapshotOpl(regs,kind,3579545);
 assert.equal(enabled.channels[0].operators[0].waveform,kind==='ym3812'?3:0);
 applyOplWrite(regs,1,0);
 const disabled=snapshotOpl(regs,kind,3579545);
 assert.equal(disabled.channels[0].operators[0].waveform,0);
 assert.equal(disabled.channels[0].operators[0].waveformRegister,255);
 assert.equal(enabled.registers[1],32,'snapshots must not change with subsequent writes');
});

for(const kind of ['ym3526','ym3812','y8950']) test(`${kind}: rhythm affects only CH7–9 and register changes while off do not create notes`,()=>{
 const entries=Array.from({length:9},(_,i)=>[[0xa0+i,68],[0xb0+i,50]]).flat();
 const score=extractOplNotes(vgm(kind,[...entries,'wait',[0xbd,63],'wait',[0xbd,0],'wait',
  ...Array.from({length:9},(_,i)=>[0xb0+i,18]),[0xa0,100],'wait']));
 for(const ch of score.channels.slice(0,6))assert.deepEqual(ch.notes.map(n=>[n.start,n.end]),[[0,66150]]);
 for(const ch of score.channels.slice(6))assert.deepEqual(ch.notes.map(n=>[n.start,n.end]),[[0,22050],[44100,66150]]);
 assert.equal(score.time,88200);
});
