import test from 'node:test';
import assert from 'node:assert/strict';
import factory from '../docs/generated/huc6280_wasm.js';
import {Huc6280AudioEngine} from './huc6280audioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsParser} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {VgmPlayer as DocsPlayer} from '../docs/js/vgmplayer.js';
import {MockSoundEngine,drainPlayer} from './test-support/vgm-engine-mock.js';
const u32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24&255];
function vgm(commands) {
  const b=new Uint8Array(256+commands.length),v=new DataView(b.buffer);
  b.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);
  v.setUint32(0xa4,3579545,true);b.set(commands,256);return b;
}
for(const [name,Parser,Player] of [['web',Ym2612VGM,VgmPlayer],['docs',DocsParser,DocsPlayer]]) {
  test(`${name}: HuC6280 header, timed writes and PCM streams stay separate from FM`,()=>{
    const bytes=vgm([0xb9,0,3,0x67,0x66,5,...u32(3),1,16,31,
      0x90,0,0x1b,2,6,0x91,0,5,1,0,0x92,0,...u32(22050),0x95,0,0,0,0,
      0x61,6,0,0xb9,4,0,0x66]);
    assert.equal(new Parser(bytes).header.huc6280Clock,3579545);
    for(const split of [1,7,128]) {
      const e=new MockSoundEngine(),log=[];
      e.writeHuc6280=(r,v)=>log.push([e.frames,r,v]);
      e.writeHuc6280Stream=(p,r,v)=>log.push([e.frames,p,r,v]);
      const player=new Player(e);player.load(bytes);player.play();drainPlayer(player,split);
      assert.deepEqual(log,[[0,0,3],[0,2,6,1],[2,2,6,16],[4,2,6,31],[6,4,0]]);
      assert.equal(e.trace.length,0);
    }
  });
  test(`${name}: rejects truncated writes, warns on missing/second targets, bounds header`,()=>{
    assert.throws(()=>new Parser(vgm([0xb9,6])).step());
    const warnings=[],p=new Parser(vgm([0xb9,0x86,31,0xb9,6,31,0x66]),{logger:{warn:s=>warnings.push(s)}});
    while(p.playStep({}).type!=='end'){} assert.equal(warnings.length,2);
    const old=vgm([0x66]);new DataView(old.buffer).setUint32(8,0x150,true);
    assert.equal(new Parser(old).header.huc6280Clock,0);
    new DataView(old.buffer).setUint32(8,0x171,true);new DataView(old.buffer).setUint32(0x34,12,true);
    assert.equal(new Parser(old).header.huc6280Clock,0);
  });
}
const make=()=>Huc6280AudioEngine.create({moduleFactory:factory,clock:3579545});
function wave(e,ch=0) {
  const w=(r,v)=>e.writeHuc6280(r,v);
  w(1,255);w(0,ch);w(4,64);w(4,0);
  for(let i=0;i<32;i++)w(6,i<16?31:0);
  w(2,254);w(3,0);w(5,255);w(4,159);
}
test('MAME wavetable: all six channels, pitch, stereo balance, mute and cold reset',async()=>{
  const e=await make();
  try {
    for(let ch=0;ch<6;ch++) {
      e.reset();wave(e,ch);const pcm=e.processFrames(44100);
      assert.deepEqual(pcm.left,pcm.right);assert(pcm.left.every(Number.isFinite));
      let rises=0;for(let i=1;i<pcm.left.length;i++)if(pcm.left[i-1]<0&&pcm.left[i]>=0)rises++;
      assert(Math.abs(rises-3579545/254/32)<2,`pitch ${rises}`);
      e.writeHuc6280(5,240);assert(e.processFrames(100).right.every(v=>v===0));
      e.setChannelMuted(ch,true);assert(e.processFrames(100).left.every(v=>v===0));
      e.setChannelMuted(ch,false);assert(e.processFrames(100).left.some(v=>v!==0));
      e.reset();assert(e.processFrames(100).left.every(v=>v===0));
    }
  } finally {e.dispose();}
});
test('MAME DDA stream restores selected channel and port FF uses the current channel',async()=>{
  const e=await make();
  try {
    e.writeHuc6280(1,255);e.writeHuc6280(0,2);e.writeHuc6280(4,223);e.writeHuc6280(5,255);
    e.writeHuc6280(0,3);e.writeHuc6280Stream(2,6,31);
    assert.equal(e.selectedChannel,3);
    assert.equal(e.processFrames(1).left[0],Math.fround(341*15/32768));
    e.writeHuc6280(0,2);e.writeHuc6280Stream(255,6,16);
    assert.equal(e.selectedChannel,2);assert.equal(e.processFrames(1).left[0],0);
  } finally {e.dispose();}
});
test('noise/LFO, partitioning, mute state advancement and replay are deterministic',async()=>{
  const e=await make();
  try {
    const run=(mode,sizes,muted=false)=>{
      e.reset();wave(e);wave(e,1);wave(e,4);
      if(mode==='noise')e.writeHuc6280(7,0x9e);
      if(mode==='lfo'){e.writeHuc6280(8,1);e.writeHuc6280(9,2);}
      e.setChannelMuted(0,muted);
      return sizes.flatMap(n=>[...e.processFrames(n).left]);
    };
    const base=run('wave',[2000]);
    for(const mode of ['noise','lfo']) {
      const a=run(mode,[2000]);assert.notDeepEqual(a,base);
      assert.deepEqual(run(mode,[1,99,900,1000]),a);
    }
    const whole=run('lfo',[2100]);run('lfo',[2000],true);e.setChannelMuted(0,false);
    assert.deepEqual([...e.processFrames(100).left],whole.slice(2000));
  } finally {e.dispose();}
});
