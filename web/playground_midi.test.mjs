import test from 'node:test';
import assert from 'node:assert/strict';
import {createMidiRack,createMidiApi} from './playground_midi.js';
import {FM_PRESETS} from './megadrive-fm-presets.js';
import {parseMidiFile} from './midi_file.js';
function rack(n=6){const writes=[],psg=[];return {writes,psg,r:createMidiRack({write:e=>writes.push(e),writePsg:e=>psg.push(e),preset:FM_PRESETS.sine,fmChannels:n})};}
function smf(...tracks){const out=[77,84,104,100,0,0,0,6,0,tracks.length>1?1:0,0,tracks.length,0,96];for(const t of tracks){out.push(77,84,114,107,0,0,t.length>>8,t.length&255,...t);}return Uint8Array.from(out);}
test('MIDI CH16 uses FM voice zero with pan and velocity; held voice survives patch change',()=>{
 const {r,writes}=rack();r.noteOn('tetorica-ym2612',15,60,127);assert(writes.some(e=>e.register===0xb4&&e.value===192));
 assert(writes.some(e=>e.register===0x28&&e.value===240));const n=writes.length;
 r.setVoice(15,FM_PRESETS['two-op-bell']);assert.equal(writes.length,n);
 r.noteOff('tetorica-ym2612',15,60);assert.equal(writes.at(-1).value,0);
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
 assert.throws(()=>api.output('tetorica-ym2612',{channel:16}));
 const a=api.output('tetorica-ym2612');await a.noteOn('C4');owner='b';await a.noteOn('E4');api.cancelOwner('a');assert.equal(writes.at(-1).value,0);
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

test('FM bend retunes only the addressed MIDI channel, without key or voice writes',()=>{
 const {r,writes}=rack();r.noteOn('tetorica-ym2612',8,60);r.noteOn('tetorica-ym2612',8,64);r.noteOn('tetorica-ym2612',9,67);
 const original=writes.filter(e=>e.register===0xa0).at(-1).value;writes.length=0;
 r.pitchBend('tetorica-ym2612',8,1,.5);
 assert.deepEqual(writes.map(e=>e.register),[0xa4,0xa0,0xa5,0xa1]);assert(writes.every(e=>e.time===.5));assert.notEqual(writes[1].value,original);
 writes.length=0;r.pitchBend('tetorica-ym2612',8,0);assert.equal(writes[1].value,original);
});
test('bend applies to future notes and range changes; PSG bend preserves volume',()=>{
 const bent=rack(),reference=rack();bent.r.setPitchBendRange('tetorica-ym2612',1,12);bent.r.pitchBend('tetorica-ym2612',1,-1);
 bent.r.noteOn('tetorica-ym2612',1,72);reference.r.noteOn('tetorica-ym2612',1,60);
 assert.deepEqual(bent.writes,reference.writes);
 bent.r.noteOn('tetorica-sega-psg',1,60,80);bent.psg.length=0;
 bent.r.pitchBend('tetorica-sega-psg',1,1,1);assert.equal(bent.psg.length,2);assert.equal(bent.psg[0].value&0xf0,0x80);assert.equal(bent.psg[0].time,1);
 const period=bent.psg[0].value;bent.psg.length=0;bent.r.setPitchBendRange('tetorica-sega-psg',1,12);assert.notEqual(bent.psg[0].value,period);
});
test('Stop resets bend/range and invalid values do not mutate audio',async()=>{
 const {r,writes}=rack(),ref=rack();r.pitchBend('tetorica-ym2612',1,1);r.setPitchBendRange('tetorica-ym2612',1,12);r.stop();writes.length=0;
 r.noteOn('tetorica-ym2612',1,60);ref.r.noteOn('tetorica-ym2612',1,60);assert.deepEqual(writes,ref.writes);
 const api=createMidiApi((m,a)=>r[m](...a),{sleep:async()=>{},bpm:()=>120});const out=api.output('tetorica-ym2612');
 const n=writes.length;for(const v of [NaN,Infinity,-2,2])await assert.rejects(out.pitchBend(v));
 for(const v of [NaN,Infinity,-1,97])await assert.rejects(out.setPitchBendRange(v));assert.equal(writes.length,n);
 await out.setPitchBendRange(2.5);await out.pitchBend(.5);
});


test('physical scalar pins a voice and unavailable channels are silent',async()=>{
 const {r,writes}=rack();
 const api=createMidiApi((m,a)=>m==='release'?r.noteOff(a[0],a[1],a[2],undefined,a[3],a[4]):r[m](...a),{sleep:async()=>{},bpm:()=>120});
 for(let channel=0;channel<16;channel++) {
  const out=api.output('tetorica-ym2612',{channel});writes.length=0;
  await out.noteOn(60);
  assert.deepEqual(writes.filter(e=>e.register===0x28).map(e=>e.value),channel<6?[240+(channel<3?channel:channel+1)]:[]);
  await out.noteOff(60);
 }
 for(const channel of [-1,16,1.5,NaN,[0,-1]])assert.throws(()=>api.output('tetorica-ym2612',{channel}));
});

test('CC volume/expression restore original carrier levels and do not retrigger or replace a held patch',()=>{
 const {r,writes}=rack();r.noteOn('tetorica-ym2612',0,60,100);
 const base=writes.filter(e=>e.register===0x4c).at(-1).value;
 r.setVoice(0,FM_PRESETS['two-op-bell']);writes.length=0;
 r.cc('tetorica-ym2612',0,11,0,.5);
 assert.deepEqual(writes.map(e=>[e.register,e.value,e.time]),[0x40,0x48,0x44,0x4c].map(reg=>[reg,127,.5]));
 r.cc('tetorica-ym2612',0,11,127);assert.equal(writes.at(-1).value,base);
 r.cc('tetorica-ym2612',1,7,0);assert.equal(writes.at(-1).value,base);
 r.cc('tetorica-ym2612',0,7,64);assert(writes.at(-1).value>base);
 r.cc('tetorica-ym2612',0,7,127);assert.equal(writes.at(-1).value,base);
 assert(writes.every(e=>e.register!==0x28));
});

test('FM pan is quantized and intersects preset routing; PSG gain changes without retuning',()=>{
 const {r,writes,psg}=rack();r.noteOn('tetorica-ym2612',0,60);
 for(const [value,bits] of [[0,128],[42,128],[43,192],[84,192],[85,64],[127,64]]) {
  writes.length=0;r.cc('tetorica-ym2612',0,10,value);
  assert.equal(writes.length,1);assert.equal(writes[0].register,0xb4);assert.equal(writes[0].value&192,bits);
 }
 r.stop();r.setVoice(0,{...FM_PRESETS.sine,pan:{left:true,right:false}});
 r.cc('tetorica-ym2612',0,10,127);r.noteOn('tetorica-ym2612',0,60);
 assert.equal(writes.filter(e=>e.register===0xb4).at(-1).value&192,0);
 r.noteOn('tetorica-sega-psg',0,60,127);psg.length=0;
 r.cc('tetorica-sega-psg',0,7,0);assert.deepEqual(psg.map(e=>e.value),[0x9f]);
 r.cc('tetorica-sega-psg',0,7,127);assert.equal(psg.at(-1).value,0x90);
 r.cc('tetorica-sega-psg',0,10,0);assert.equal(psg.length,2);
});

test('sustain holds duplicate notes until pedal-up and stale note-offs cannot release stolen voices',()=>{
 const {r,writes}=rack(1);r.cc('tetorica-ym2612',0,64,64);
 r.noteOn('tetorica-ym2612',0,60);const n=writes.length;
 r.noteOff('tetorica-ym2612',0,60);assert.equal(writes.length,n);
 r.noteOn('tetorica-ym2612',0,60);const m=writes.length;
 r.cc('tetorica-ym2612',0,64,63);assert.equal(writes.length,m,'new held key must survive pedal up');
 r.noteOff('tetorica-ym2612',0,60);assert.equal(writes.at(-1).value,0);
});

test('all notes off respects sustain; reset releases pedal, restores expression/bend, retains volume/pan/range',()=>{
 const {r,writes}=rack();
 r.cc('tetorica-ym2612',0,7,64);r.cc('tetorica-ym2612',0,10,0);
 r.cc('tetorica-ym2612',0,64,127);r.noteOn('tetorica-ym2612',0,60);
 r.cc('tetorica-ym2612',0,123,0);assert.notEqual(writes.at(-1).value,0);
 writes.length=0;r.cc('tetorica-ym2612',0,121,0);assert(writes.some(e=>e.register===0x28&&e.value===0));
 r.noteOn('tetorica-ym2612',0,67);r.setPitchBendRange('tetorica-ym2612',0,12);r.pitchBend('tetorica-ym2612',0,1);
 r.cc('tetorica-ym2612',0,11,0);r.cc('tetorica-ym2612',0,121,0);
 const a=writes.filter(e=>e.register===0xa4).at(-1).value;
 r.pitchBend('tetorica-ym2612',0,1);assert.equal(writes.filter(e=>e.register===0xa4).at(-1).value,a+8);
 assert.equal(writes.filter(e=>e.register===0xb4).at(-1).value&192,128);
 assert(writes.filter(e=>e.register===0x4c).at(-1).value<127);
});

test('all sound off mutes released FM tails and Stop clears PSG sustain/controller state',()=>{
 const {r,writes,psg}=rack();r.noteOn('tetorica-ym2612',0,60);r.noteOff('tetorica-ym2612',0,60);writes.length=0;
 r.cc('tetorica-ym2612',1,120,0);assert.equal(writes.length,0);
 r.cc('tetorica-ym2612',0,120,0);assert.equal(writes.length,4);assert(writes.every(e=>e.value===127));
 r.cc('tetorica-sega-psg',0,64,127);r.noteOn('tetorica-sega-psg',0,60,127);r.noteOff('tetorica-sega-psg',0,60);
 assert.notEqual(psg.at(-1).value,0x9f);r.stop();assert.equal(psg.at(-1).value,0x9f);
 r.noteOn('tetorica-sega-psg',0,60,127);r.noteOff('tetorica-sega-psg',0,60);assert.equal(psg.at(-1).value,0x9f);
});

test('API forwards CC, rejects invalid data, and owner cleanup forcibly releases sustained notes',async()=>{
 const {r,writes}=rack();let owner='loop';
 const api=createMidiApi((m,a)=>m==='release'?r.noteOff(a[0],a[1],a[2],undefined,a[3],a[4]):r[m](...a),{sleep:async()=>{},bpm:()=>120,owner:()=>owner});
 const out=api.output('tetorica-ym2612',{channel:0});
 for(const pair of [[-1,0],[7,128],[1.5,0],[7,NaN]])await assert.rejects(out.cc(...pair));
 assert.equal(writes.length,0);assert.equal(await out.cc(1,0),false);
 await out.cc(64,127);await out.play('C4');const n=writes.length;
 owner='other';await api.output('tetorica-ym2612',{channel:1}).noteOn('E4');
 api.cancelOwner('loop');assert(writes.length>n);assert.equal(writes.at(-1).value,0);
});

test('SMF warnings distinguish supported CC, unsupported controllers and PSG pan limitation',()=>{
 const supported=parseMidiFile(smf([0,0xb0,7,100,0,0xb0,64,127,0,0xb0,123,0,0,255,47,0]));
 assert.deepEqual(supported.warnings,[]);
 const unsupported=parseMidiFile(smf([0,0xb0,1,100,0,0xb0,10,64,0,255,47,0]));
 assert(unsupported.warnings.some(w=>w.includes('CC 1 retained')));
 assert(unsupported.warnings.some(w=>w.includes('PSG pan')));
});


test('logical MIDI parts share all six physical FM voices, then steal the oldest',()=>{
 const {r,writes}=rack();
 for(let channel=0;channel<6;channel++)r.noteOn('tetorica-ym2612',channel,60+channel,100);
 assert.deepEqual(writes.filter(e=>e.register===0x28).map(e=>e.value),[240,241,242,244,245,246]);
 writes.length=0;r.noteOn('tetorica-ym2612',6,72,100);
 assert.deepEqual(writes.filter(e=>e.register===0x28).map(e=>e.value),[0,240]);
 const count=writes.length;r.noteOff('tetorica-ym2612',0,60);assert.equal(writes.length,count);
 r.noteOff('tetorica-ym2612',6,72);assert.equal(writes.at(-1).value,0);
});

function apiRack() {
 const state=rack();
 state.api=createMidiApi((m,a)=>m==='release'?state.r.noteOff(a[0],a[1],a[2],undefined,a[3],a[4]):state.r[m](...a),{sleep:async()=>{},bpm:()=>120});
 return state;
}
test('three-voice pool and fixed CH4/5/6 coexist without stealing outside the pool',async()=>{
 const {api,writes}=apiRack();
 const chord=api.output('tetorica-ym2612',{channel:[0,1,2]});
 for(const ch of [3,4,5])await api.output('tetorica-ym2612',{channel:ch}).noteOn(60+ch);
 writes.length=0;
 for(const note of [60,64,67,72])await chord.noteOn(note);
 assert.deepEqual(writes.filter(e=>e.register===0x28).map(e=>e.value),[240,241,242,0,240]);
 writes.length=0;await chord.noteOff(60);assert.equal(writes.length,0);
 await chord.noteOff(72);assert.equal(writes.at(-1).value,0);
});

test('overlapping handles steal safely and CC/voice/sustain remain handle-local',async()=>{
 const {api,writes}=apiRack();
 const a=api.output('tetorica-ym2612',{channel:3}),b=api.output('tetorica-ym2612',{channel:3});
 await a.setVoice(FM_PRESETS.sine);await a.cc(7,0);await a.cc(64,127);await a.noteOn(60);
 await b.setVoice(FM_PRESETS['two-op-bell']);writes.length=0;await b.noteOn(64);
 assert.deepEqual(writes.filter(e=>e.register===0x28).map(e=>e.value),[4,244]);
 assert(writes.some(e=>e.port===1&&e.register>=0x40&&e.register<=0x4c&&e.value<127));
 writes.length=0;await a.noteOff(60);await a.cc(120,0);await a.pitchBend(1);assert.equal(writes.length,0);
 await b.noteOff(64);assert.equal(writes.at(-1).value,4,'sustain on a must not hold b');
});

test('omitted channel uses all voices while separate automatic handles keep their own controls',async()=>{
 const {api,writes}=apiRack();const a=api.output('tetorica-ym2612'),b=api.output('tetorica-ym2612',{channel:undefined});
 await a.cc(10,0);await a.noteOn(60);await b.noteOn(64);
 assert.equal(writes.filter(e=>e.register===0xb4).at(-1).value&192,128);
 assert.equal(writes.filter(e=>e.register===0xb5).at(-1).value&192,192);
 for(const n of [65,67,69,71])await b.noteOn(n);
 assert.deepEqual(writes.filter(e=>e.register===0x28).map(e=>e.value),[240,241,242,244,245,246]);
});

test('PSG pools are copied, deduplicated and bounded to physical tone voices',async()=>{
 const {api,psg}=apiRack();const slots=[2,0,2,15];
 const out=api.output('tetorica-sega-psg',{channel:slots});slots.splice(0,slots.length,1);
 await out.noteOn(60);await out.noteOn(64);await out.noteOn(67);
 assert(!psg.some(e=>(e.value&0xf0)===0xb0));
 assert(psg.some(e=>e.value===0xdf));
 const n=psg.length;await api.output('tetorica-sega-psg',{channel:[]}).noteOn(60);assert.equal(psg.length,n);
});
