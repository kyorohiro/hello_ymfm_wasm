import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createOpl3Monitor,applyOpl3Write,describeOpl3Notes,extractYmf278bFmNotes} from './ymf262_notes.js';
const w=(r,v,p=0)=>[0xd0,p,r,v], wait=[0x61,0x22,0x56];
const on=(ch=0,p=0)=>[...w(0xa0+ch,580&255,p),...w(0xb0+ch,0x32,p)];
function vgm(commands,clock=33868800){
 const b=new Uint8Array(257+commands.length);b.set([86,103,109,32]);const h=new DataView(b.buffer);
 h.setUint32(8,0x171,true);h.setUint32(0x34,0xcc,true);h.setUint32(0x60,clock,true);b.set([...commands,0x66],256);return b;
}
test('OPL4 FM clock follows the playback core, and PCM writes cannot change FM notes',()=>{
 const a=extractYmf278bFmNotes(vgm([...w(5,3,1),...on(),...on(8,1),...wait,...w(0xb0,0,2),...w(0xbd,32,2),...w(4,63,2),...wait]));
 assert.equal(a.channels.length,18);assert.equal(a.channels[0].notes.length,1);assert.equal(a.channels[17].notes.length,1);
 const n=a.channels[0].notes[0], freq=33868800/768*(192/171)*580*16/2**20;
 assert.equal(n.end,44100);assert.ok(Math.abs(n.midi-(69+12*Math.log2(freq/440)))<1e-10);
 assert.match(a.channels[0].name,/YMF278B FM/);
 assert(extractYmf278bFmNotes(vgm([...on(0,2),...wait])).channels.every(ch=>!ch.notes.length));
 assert.throws(()=>extractYmf278bFmNotes(vgm([],33868800|0x40000000)),/Dual/);
});
test('OPL4 all 4op pairs, rhythm gaps, and compatibility aliasing follow FM registers',()=>{
 for(let bank=0;bank<2;bank++)for(let pair=0;pair<3;pair++){
  const a=extractYmf278bFmNotes(vgm([...w(5,3,1),...w(4,1<<(bank*3+pair),1),...on(pair,bank),...on(pair+3,bank),...wait]));
  assert.equal(a.channels[bank*9+pair].notes.length,1);assert.equal(a.channels[bank*9+pair+3].notes.length,0);
 }
 const a=extractYmf278bFmNotes(vgm([...on(6,1),...wait,...w(0xbd,32),...wait,...w(0xbd,0),...wait]));
 assert.deepEqual(a.channels[6].notes.map(n=>[n.start,n.end]),[[0,22050],[44100,66150]]);
 assert.equal(a.channels[15].notes.length,0);
});
test('Analyzer FM live hook forwards PCM untouched, updates pitch and clears on reset',()=>{
 const src=readFileSync(new URL('./vgm_analyzer.js',import.meta.url),'utf8');
 const fn=name=>{const start=src.indexOf(`function ${name}(`);return src.slice(start,src.indexOf('\n}',start)+2);};
 const writes=[];let resets=0;
 const c=vm.createContext({createOpl3Monitor,applyOpl3Write,describeOpl3Notes,isOpl:()=>false,
  chip:'ymf278b',currentChipKind:'ymf278b',noteishHeader:{ymf278bClock:33868800},apuNoteMonitor:null,apuNoteChannels:[],
  engine:{writeYmf278b:(...args)=>writes.push(args),reset:()=>resets++},
  buildMonitorChannel:()=>({noteHistory:[],noteMinMidi:null,noteMaxMidi:null}),songTimeMs:()=>0,
  pruneChannelNoteHistory(){},requestNoteishRender(){}});
 vm.runInContext(fn('updateApuNoteMonitor')+'\n'+fn('resetApuNoteChannels')+'\nresetApuNoteChannels();',c);
 const start=src.indexOf("      if (chip === 'ymf262' || chip === 'ymf278b')"),end=src.indexOf("      if (chip === 'huc6280')",start);
 assert(start>=0&&end>start);vm.runInContext(src.slice(start,end),c);
 c.engine.writeYmf278b(1,5,3);c.engine.writeYmf278b(0,0xa0,68);c.engine.writeYmf278b(0,0xb0,50);
 assert.equal(c.apuNoteChannels.length,18);const pitch=c.apuNoteChannels[0].toneMidi;assert(Number.isFinite(pitch));
 c.engine.writeYmf278b(2,0xb0,0);assert.equal(c.apuNoteChannels[0].toneMidi,pitch);assert.deepEqual(writes.at(-1),[2,0xb0,0]);
 c.engine.writeYmf278b(0,0xb0,0);assert.equal(c.apuNoteChannels[0].toneMidi,null);
 c.engine.reset();assert.equal(resets,1);assert(c.apuNoteChannels.every(ch=>ch.toneMidi===null));
});
