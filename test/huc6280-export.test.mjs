import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,exportSource,listSourceScoreChannels,inspectSourceSupport} from '../cli/index.js';
import {analyzeLilyPondSource} from '../docs/vgm_analyzer/vgm_lilypond.js';
const w=(r,v)=>[0xb9,r,v],wait=[0x61,0x22,0x56];
function vgm(commands){
  const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);
  b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);v.setUint32(0xa4,3579545,true);
  b.set(commands,256);return b;
}
const setup=[...w(1,255)];
for(let ch=0;ch<6;ch++)setup.push(...w(0,ch),...w(2,254),...w(5,255),...w(4,159));
const source=vgm([...setup,...wait,...w(0,2),...w(4,223),...w(0,4),...w(7,128),...w(9,1),
  ...wait,...w(0,2),...w(4,159),...w(0,4),...w(7,0),...w(9,0),...wait,0x66]);
// Independent SMF event reader: absolute ticks, track names and note/bend events.
function midiTracks(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.length),tracks=[];
  assert.equal(new TextDecoder().decode(bytes.subarray(0,4)),'MThd');
  assert.equal(v.getUint16(8),1);assert.equal(v.getUint16(12),960);
  let p=14;
  const vlq=()=>{let n=0,b;do{b=bytes[p++];n=n*128+(b&127);}while(b&128);return n;};
  for(let i=0;i<v.getUint16(10);i++){
    assert.equal(new TextDecoder().decode(bytes.subarray(p,p+4)),'MTrk');
    const end=p+8+v.getUint32(p+4);p+=8;let tick=0;const events=[];
    while(p<end){tick+=vlq();const status=bytes[p++];
      if(status===255){const type=bytes[p++],length=vlq(),data=bytes.slice(p,p+length);p+=length;events.push({tick,status,type,data});}
      else {assert([0x80,0x90,0xb0,0xc0,0xe0].includes(status&240));const length=(status&240)===0xc0?1:2;events.push({tick,status,data:bytes.slice(p,p+length)});p+=length;}
    }
    assert.equal(p,end);tracks.push(events);
  }
  assert.equal(p,bytes.length);return tracks;
}
test('HuC6280 six-track MIDI preserves DDA/noise/LFO gaps and matches score intervals',()=>{
  const result=exportSource(source,{format:'midi',bpm:120}),tracks=midiTracks(result.bytes);
  assert.equal(result.noteCount,10);assert.equal(tracks.length,7);
  const score=analyzeLilyPondSource(source);
  for(let i=0;i<6;i++){
    const track=tracks[i+1];assert.equal(new TextDecoder().decode(track.find(e=>e.type===3).data),`HuC6280 CH${i+1}`);
    const notes=track.filter(e=>[0x80,0x90].includes(e.status&240));
    const expected=score.channels[i].notes.flatMap(n=>[[n.start/22050*960,0x90|i],[n.end/22050*960,0x80|i]]);
    assert.deepEqual(notes.map(e=>[e.tick,e.status]),expected);
    assert(notes.every(e=>e.data[0]===69));
  }
  assert(result.warnings.some(s=>/PCM\/DDA.*noise.*LFO/.test(s)));
});
test('MusicXML and LilyPond preserve rests, select physical channels and group them',()=>{
  for(const format of ['musicxml','lilypond']){
    const r=exportSource(source,{format,bpm:120,channels:['huc6280-ch3']});
    assert.match(r.text,/HuC6280 CH3/);assert.doesNotMatch(r.text,/HuC6280 CH1/);
    assert.equal(r.noteCount,2);
    if(format==='musicxml'){
      const body=r.text.slice(r.text.indexOf('<part id="P1">'));
      const notes=[...body.matchAll(/<note>([\s\S]*?)<\/note>/g)].map(m=>m[1]);
      assert.deepEqual(notes.map(n=>[n.includes('<rest/>'),Number(n.match(/<duration>(\d+)<\/duration>/)[1])]),[[false,4],[true,4],[false,4],[true,4]]);
    }else assert.match(r.text,/a'4\s+r4\s+a'4\s+r4/);
    const grouped=exportSource(source,{format,bpm:120,groups:[{id:'pair',name:'Pair',channels:['huc6280-ch1','huc6280-ch3']}],channels:['huc6280-ch1','huc6280-ch3']});
    assert.match(grouped.text,/Pair/);assert.equal(grouped.noteCount,4);
  }
  assert.deepEqual(listSourceScoreChannels(source).channels.map(c=>c.id),Array.from({length:6},(_,i)=>`huc6280-ch${i+1}`));
});
test('MIDI pitch bends stay within a wave interval and stop across PCM gaps',()=>{
  const b=vgm([...setup,...w(0,2),...wait,...w(2,127),...wait,...w(4,223),...wait,...w(4,159),...wait,0x66]);
  const tracks=midiTracks(exportSource(b,{format:'midi',bpm:120}).bytes),track=tracks[3];
  assert.deepEqual(track.filter(e=>[0x80,0x90].includes(e.status&240)).map(e=>[e.tick,e.status&240]),[[0,144],[1920,128],[2880,144],[3840,128]]);
  assert(track.some(e=>e.tick===960&&(e.status&240)===224&&(e.data[0]!==0||e.data[1]!==64)));
});
test('VGZ support reports all score exports, rejects dual flags and handles PCM-only tracks',async()=>{
  const b=await readSource(new URL('./fixtures/huc6280-tone.vgz',import.meta.url));
  const support=await inspectSourceSupport(b);
  for(const format of ['midi','musicxml','lilypond'])assert.equal(support.exports[format].status,'available');
  assert.equal(support.exports.tfi.status,'unavailable');
  for(const mask of [0x40000000,0x80000000]){
    const dual=b.slice();new DataView(dual.buffer).setUint32(0xa4,(3579545|mask)>>>0,true);
    for(const format of ['midi','musicxml','lilypond'])assert.throws(()=>exportSource(dual,{format,bpm:120}),/single HuC6280/);
  }
  const pcm=vgm([...w(1,255),...w(5,255),...w(4,223),...w(6,31),...wait,0x66]);
  assert.throws(()=>exportSource(pcm,{format:'midi'}),/No convertible/);
  for(const format of ['musicxml','lilypond'])assert.equal(exportSource(pcm,{format,bpm:120}).noteCount,0);
});
