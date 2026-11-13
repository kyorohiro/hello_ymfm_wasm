import test from 'node:test';
import assert from 'node:assert/strict';
import {createPsfSongInteraction} from './psf_song_interaction.js';

function host() {
  const registers=new Uint16Array(512),source=new Uint16Array(512),revisions=new Uint32Array(512),gates=Array(24).fill(0),pitches=Array(24).fill(0),writes=[];
  let sequence=0,open=true;
  const write=(offset,value)=>{registers[offset/2]=value;};
  function cpu(offset,value) {
    write(offset,value);source[offset/2]=value;revisions[offset/2]=++sequence;
    if(offset<0x180) {
      const ch=offset>>4,reg=offset&15;
      if(reg===4)pitches[ch]=sequence;
      if(reg===6||reg===14)gates[ch]=pitches[ch]=sequence;
    }else if(offset>=0x188&&offset<=0x18e) {
      const shift=offset&2?16:0;
      for(let ch=shift;ch<Math.min(24,shift+16);ch++)if(value&(1<<(ch-shift)))gates[ch]=sequence;
    }
  }
  cpu(0x1aa,0xc000);
  for(let ch=0;ch<24;ch++){cpu(ch*16,0x2000);cpu(ch*16+2,0x1000);cpu(ch*16+4,0x1000);cpu(ch*16+6,0x400);cpu(ch*16+8,0x000f);cpu(ch*16+10,0x3fc0);cpu(ch*16+14,0x402);}
  const manual=createPsfSongInteraction({read:offset=>registers[offset/2],write(offset,value){writes.push([offset,value]);write(offset,value);},
    revision:offset=>revisions[offset/2],sourceValue:offset=>source[offset/2],gateRevision:ch=>gates[ch],pitchRevision:ch=>pitches[ch],isOpen:()=>open});
  return {manual,registers,writes,cpu,close(){open=false;},read:offset=>registers[offset/2]};
}

test('sparse volume and ADSR edits preserve raw companions, gate, pitch, sample addresses and other channels',()=>{
  const h=host(),before=h.registers.slice();
  const accepted=h.manual.edit(3,{volumeLeft:-.5,envelope:{sustainRate:20,releaseRate:7}});
  assert.equal(accepted.channel,3);
  assert.deepEqual(h.writes,[[48,0x6001],[58,0x2507]]);
  for(let index=0;index<h.registers.length;index++)if(![24,29].includes(index))assert.equal(h.registers[index],before[index]);
  assert(h.read(58)&0x2000,'reserved ADSR2 bit13 is kept');
});

test('invalid compound edits and note options reject before any accepted write',()=>{
  const h=host();
  for(const patch of [{volumeLeft:.5,envelope:{attackRate:128}},{volumeLeft:.2,pitch:0x4000},{volumeRight:NaN},{sample:2},{envelope:{unknown:1}}])assert.throws(()=>h.manual.edit(2,patch));
  for(const args of [['n',24,60],['n',1,128],['n',1,60,{bend:25}],['n',1,60,{referencePitch:NaN}],['n',1,60,{unknown:true}]])assert.throws(()=>h.manual.noteOn(...args));
  assert.deepEqual(h.writes,[]);
});

test('repeated keyboard notes use a stable source-pitch basis and only the newest same-CH hand owns release',()=>{
  const h=host();
  h.manual.noteOn('first',0,72);assert.equal(h.read(4),0x2000);
  assert.equal(h.manual.noteOn('second',0,60).stolenId,'first');assert.equal(h.read(4),0x1000);
  const count=h.writes.length;assert.equal(h.manual.noteOff('first'),false);assert.equal(h.writes.length,count);
  assert(h.manual.noteOff('second'));assert.deepEqual(h.writes.at(-1),[0x18c,1]);
  h.manual.noteOn('third',0,60,{referenceMidi:48});assert.equal(h.read(4),0x2000);
  h.manual.noteOff('third');h.manual.noteOn('fourth',0,60);assert.equal(h.read(4),0x1000);
});

test('a later same-value CPU Gate or sample write owns the CH while unrelated CPU gates do not',()=>{
  for(const [offset,value]of [[0x188,1],[0x18c,1],[6,0x400],[14,0x402]]){
    const h=host();h.manual.noteOn('a',0,60);h.cpu(offset,value);const count=h.writes.length;
    assert.equal(h.manual.noteOff('a'),false);assert.equal(h.writes.length,count);
  }
  const h=host();h.manual.noteOn('a',0,60);h.cpu(0x188,2);assert(h.manual.noteOff('a'));
});

test('CPU Pitch steals only Pitch; stale bend reset is ignored, but its still-manual Gate can release',()=>{
  const h=host();h.manual.noteOn('a',0,60);h.manual.setPitchBend(12);assert.equal(h.read(4),0x2000);
  h.cpu(4,0x2000);const count=h.writes.length;
  assert.equal(h.manual.setPitchBend(0),false);assert.equal(h.writes.length,count);
  assert(h.manual.noteOff('a'));h.manual.noteOn('b',0,60);assert.equal(h.read(4),0x2000,'new key adopts the newer CPU reference');
});

test('Noise keys only trigger hardware Gate and a PMON carrier leaves its predecessor unchanged',()=>{
  const h=host();h.cpu(0x194,1);h.cpu(4,0);h.cpu(6,0);
  assert(h.manual.describe(0).playable);h.manual.noteOn('noise',0,12);h.manual.setPitchBend(12);
  assert.deepEqual(h.writes,[[0x188,1]]);h.manual.noteOff('noise');
  h.cpu(0x190,2);const before=h.registers.slice(0,8);h.writes.length=0;
  assert(h.manual.describe(1).hardwarePmon);h.manual.noteOn('carrier',1,60,{bend:0});
  assert.deepEqual(h.registers.slice(0,8),before);assert.deepEqual(h.writes,[[20,0x1000],[0x188,2]]);
});

test('scalar manual Pitch retires only an older keyboard Pitch claim, and releaseAll touches only still-owned gates',()=>{
  const h=host();h.manual.noteOn('a',0,60);h.manual.noteOn('b',17,60);
  h.manual.edit(0,{pitch:0x1200});assert.equal(h.manual.setPitchBend(0),true,'other owned voice still bends');assert.equal(h.read(4),0x1200);
  h.cpu(0x188,1);h.writes.length=0;assert(h.manual.releaseAll());assert.deepEqual(h.writes,[[0x18e,2]]);
  assert.equal(h.manual.releaseAll(),false);h.manual.dispose();assert.throws(()=>h.manual.noteOn('c',0,60),{name:'AbortError'});
});

test('raw manual Pitch becomes the next Reference key basis until the CPU writes a newer Pitch',()=>{
  const h=host();h.manual.edit(0,{pitch:0x1200});
  h.manual.noteOn('edited',0,60);assert.equal(h.read(4),0x1200);h.manual.noteOff('edited');
  h.manual.noteOn('octave',0,72);assert.equal(h.read(4),0x2400);h.manual.noteOff('octave');
  h.manual.noteOn('again',0,60);assert.equal(h.read(4),0x1200);h.manual.noteOff('again');
  h.cpu(4,0x900);h.manual.noteOn('new-source',0,60);assert.equal(h.read(4),0x900);
});
