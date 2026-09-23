import test from 'node:test';
import assert from 'node:assert/strict';
import {createMidiRack,createMidiApi} from './playground_midi.js';
import {FM_PRESETS} from './megadrive-fm-presets.js';
import {parseMidiFile} from './midi_file.js';
function rack(n=6){const writes=[],psg=[];return {writes,psg,r:createMidiRack({write:e=>writes.push(e),writePsg:e=>psg.push(e),preset:FM_PRESETS.sine,fmChannels:n})};}
function smf(...tracks){const out=[77,84,104,100,0,0,0,6,0,tracks.length>1?1:0,0,tracks.length,0,96];for(const t of tracks){out.push(77,84,114,107,0,0,t.length>>8,t.length&255,...t);}return Uint8Array.from(out);}
test('MIDI CH16 uses FM voice zero with pan and velocity; held voice survives patch change',()=>{
 const {r,writes}=rack();r.noteOn('tetorica-ym2612',16,60,127);assert(writes.some(e=>e.register===0xb4&&e.value===192));
 assert(writes.some(e=>e.register===0x28&&e.value===240));const n=writes.length;
 r.setVoice(16,FM_PRESETS['two-op-bell']);assert.equal(writes.length,n);
 r.noteOff('tetorica-ym2612',16,60);assert.equal(writes.at(-1).value,0);
});
test('stolen and duplicate notes cannot be released by an older note-off',()=>{
 const {r,writes}=rack(1);r.noteOn('tetorica-ym2612',1,60);r.noteOn('tetorica-ym2612',1,60);
 const n=writes.length;r.noteOff('tetorica-ym2612',1,60);assert.equal(writes.length,n);
 r.noteOff('tetorica-ym2612',1,60);assert.equal(writes.at(-1).value,0);
});
test('PSG has three shared voices and timed writes; stop clears both sources',()=>{
 const {r,psg,writes}=rack();for(let i=0;i<4;i++)r.noteOn('tetorica-sega-psg',i+1,60+i,100,.5);
 assert(psg.every(e=>e.time===.5));assert(psg.some(e=>e.value===0x9f));
 r.noteOn('tetorica-ym2612',1,60);r.stop(1);assert.equal(writes.at(-1).time,1);assert.equal(psg.at(-1).value,0xdf);
});
test('output API validates channels, shares rack and cleans only owner voices',async()=>{
 const {r,writes}=rack();let owner='a';
 const api=createMidiApi((m,a)=>m==='release'?r.noteOff(a[0],a[1],a[2],undefined,a[3]):r[m](...a),{sleep:async()=>{},bpm:()=>120,owner:()=>owner});
 assert.throws(()=>api.output('tetorica-ym2612',{channel:0}));
 const a=api.output('tetorica-ym2612',{channel:8});await a.noteOn('C4');owner='b';await a.noteOn('E4');api.cancelOwner('a');assert.equal(writes.at(-1).value,0);
 await a.noteOff('E4');assert.equal(writes.at(-1).value,1);
 await assert.rejects(api.output('tetorica-sega-psg').setVoice(FM_PRESETS.sine));
});
test('SMF keeps bank/program ordering, ports and original ticks while integrating tempo',()=>{
 const song=parseMidiFile(smf(
  [0,255,81,3,7,161,32,96,255,81,3,15,66,64,96,255,47,0],
  [0,255,33,1,2,0,0xb7,0,3,0,0xc7,4,0,0x97,60,100,0x81,0x40,0x87,60,0,0,255,47,0]
 ));
 assert.equal(song.seconds,1.5);assert.equal(song.parts[0].channel,8);assert.equal(song.parts[0].port,2);
 const notes=song.events.filter(e=>e.type==='channel');assert.deepEqual(notes.map(e=>e.kind),[11,12,9,8]);assert.equal(notes.at(-1).seconds,1.5);
});
test('SMF accepts running status and rejects truncation, unsupported timing and unterminated tracks',()=>{
 const b=smf([0,0x90,60,100,1,61,100,0,255,47,0]);assert.equal(parseMidiFile(b).parts[0].notes,2);
 assert.throws(()=>parseMidiFile(b.slice(0,-1)));const bad=b.slice();bad[12]=128;assert.throws(()=>parseMidiFile(bad),/PPQN/);
 assert.throws(()=>parseMidiFile(smf([0,0x90,60,100])),/end-of-track/);
});

test('MIDI voice writes produce nonzero audio through the actual YM2612 core',async()=>{
 const {getNodePlaybackFactory}=await import('../cli/render.js');
 const {createYm2612}=await import('./ym2612.js');
 const chip=await createYm2612(await getNodePlaybackFactory('ym2612'));
 try {
  const rack=createMidiRack({preset:FM_PRESETS.sine,write:e=>chip.writeRegister(e.register,e.value,e.port),writePsg(){}});
  rack.noteOn('tetorica-ym2612',8,60,100);
  const pcm=chip.generateStereo(4096);assert(pcm.left.some(v=>v!==0));rack.stop();
 }finally{chip.dispose();}
});

test('late duration cleanup cannot release a voice from a newer Run',()=>{
 const old=rack(),oldId=old.r.noteOn('tetorica-ym2612',1,60);old.r.stop();
 const next=rack();next.r.noteOn('tetorica-ym2612',1,60);const n=next.writes.length;
 next.r.noteOff('tetorica-ym2612',1,60,undefined,oldId);assert.equal(next.writes.length,n);
 next.r.noteOff('tetorica-ym2612',1,60);assert.equal(next.writes.at(-1).value,0);
});
