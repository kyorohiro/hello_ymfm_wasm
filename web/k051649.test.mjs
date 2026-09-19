import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {K051649, validateK051649} from './k051649.js';
import {K051649AudioEngine} from './k051649audioengine.js';
import {MsxAudioEngine, validateMsxPlaybackHeader} from './msxaudioengine.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {Ym2612VGM as DocsVGM} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import factory from '../docs/generated/k051649_wasm.js';
import ayFactory from '../docs/generated/ay8910_wasm.js';
const options={moduleFactory:factory,moduleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/k051649_wasm.wasm',import.meta.url))}};
const ayOptions={moduleFactory:ayFactory,moduleOptions:{wasmBinary:readFileSync(new URL('../docs/generated/ay8910_wasm.wasm',import.meta.url))}};

function vgm(commands,{ay8910Clock=0,k051649Clock=1789773,loop=false}={}){
  const bytes=new Uint8Array(0x100+commands.length),v=new DataView(bytes.buffer);
  bytes.set([86,103,109,32]);v.setUint32(4,bytes.length-4,true);v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);
  v.setUint32(0x74,ay8910Clock,true);v.setUint32(0x9c,k051649Clock,true);v.setUint32(0x18,4410,true);
  if(loop){v.setUint32(0x1c,0x100-0x1c,true);v.setUint32(0x20,4410,true);}
  bytes.set(commands,0x100);return bytes;
}
// Program channel `ch` with a ramp waveform (via SCC+ port 4, which never
// shares waveram), mid-range frequency, max volume and key on.
function program(chip,ch=0){
  for(let i=0;i<32;i++)chip.writeRegister(4,ch*32+i,((i-16)*8)&0xff);
  chip.writeRegister(1,ch*2,0x50);chip.writeRegister(1,ch*2+1,0);
  chip.writeRegister(2,ch,0x0f);
  chip.writeRegister(3,0,1<<ch);
}
const commandsFor=(port,reg,value)=>[0xd2,port,reg,value];
const tune=[...[...Array(32).keys()].flatMap(i=>commandsFor(4,i,((i-16)*8)&0xff)),
  ...commandsFor(1,0,0x50),...commandsFor(1,1,0),...commandsFor(2,0,0x0f),...commandsFor(3,0,1),
  0x61,0x44,0x05,0x66]; // wait 1348 samples so playback actually renders audio, then end

for(const Parser of [Ym2612VGM,DocsVGM])test(`K051649 header and command parsing (${Parser===DocsVGM?'docs':'web'})`,()=>{
  const p=new Parser(vgm(tune));
  assert.equal(p.header.k051649Clock,1789773);
  assert.deepEqual([...p.analyzeCommandUsage()],[['0xd2',36],['0x61',1],['0x66',1]]);
  assert.match(p.analyzeCommandContext(0xd2).join('\n'),/k051649 port=/);
  const writes=[];const target={k051649:{writeRegister:(...a)=>writes.push(a)}};
  for(let i=0;i<36;i++)p.playStep(target);
  assert.deepEqual(writes[0],[4,0,((0-16)*8)&0xff]);assert.deepEqual(writes.at(-1),[3,0,1]);
  assert.deepEqual(p.playStep(target),{type:'wait',samples:1348});
  assert.deepEqual(p.playStep(target),{type:'end'});
  // Second-chip bit (0x80 on the port byte) is not supported yet.
  assert.throws(()=>new Parser(vgm([0xd2,0x80,0,1,0x66])).playStep(target),/Second K051649/);
  assert.throws(()=>new Parser(vgm([0xd2,0,0])).step());
});

test('K051649 clock/rate validation rejects out-of-range input',()=>{
  for(const clock of [0,-1,NaN,Infinity,0x40000000])assert.throws(()=>validateK051649({clock}),RangeError);
  for(const sampleRate of [0,-1,NaN,400000])assert.throws(()=>validateK051649({clock:1789773,sampleRate}),RangeError);
  assert.doesNotThrow(()=>validateK051649({clock:1789773}));
});

test('K051649 register write bounds are validated',async()=>{
  const chip=await K051649.create({...options,clock:1789773});
  try{
    for(const args of [[-1,0,0],[8,0,0],[0,-1,0],[0,256,0],[0,0,-1],[0,0,256],[0.5,0,0]])
      assert.throws(()=>chip.writeRegister(...args),RangeError);
    assert.doesNotThrow(()=>chip.writeRegister(0,0,0));
  }finally{chip.dispose();}
});

test('SCC waveform (port 0): channel 5 shares waveram with channel 4',async()=>{
  // Two fresh chips, each keying only one of the shared channels, so both
  // measurements start from an identical (reset) counter phase.
  const a=await K051649.create({...options,clock:1789773});
  const b=await K051649.create({...options,clock:1789773});
  try{
    for(const chip of [a,b])for(let i=0;i<32;i++)chip.writeRegister(0,0x60+i,i*4);
    a.writeRegister(1,6,0x50);a.writeRegister(1,7,0);a.writeRegister(2,3,0x0f);a.writeRegister(3,0,1<<3);
    b.writeRegister(1,8,0x50);b.writeRegister(1,9,0);b.writeRegister(2,4,0x0f);b.writeRegister(3,0,1<<4);
    const four=a.generateStereo(2000),five=b.generateStereo(2000);
    assert.deepEqual(four.left,five.left);
    assert(four.left.some(v=>v!==0),'the shared waveform must actually sound');
  }finally{a.dispose();b.dispose();}
});

test('SCC+ waveform (port 4) does not share waveram across channels',async()=>{
  const chip=await K051649.create({...options,clock:1789773});
  try{
    for(let i=0;i<32;i++)chip.writeRegister(4,3*32+i,10);
    for(let i=0;i<32;i++)chip.writeRegister(4,4*32+i,-10&0xff);
    chip.writeRegister(1,6,0x50);chip.writeRegister(1,7,0);chip.writeRegister(2,3,0x0f);chip.writeRegister(3,0,1<<3);
    const four=chip.generateStereo(500);
    chip.reset();
    for(let i=0;i<32;i++)chip.writeRegister(4,3*32+i,10);
    for(let i=0;i<32;i++)chip.writeRegister(4,4*32+i,-10&0xff);
    chip.writeRegister(1,8,0x50);chip.writeRegister(1,9,0);chip.writeRegister(2,4,0x0f);chip.writeRegister(3,0,1<<4);
    const five=chip.generateStereo(500);
    assert(four.left.some((v,i)=>Math.abs(v-five.left[i])>1e-6),'independent SCC+ waveforms must differ');
  }finally{chip.dispose();}
});

test('K051649 test register bit 0x40 write-protects waveram',async()=>{
  // Independent, never-yet-generated chips: the resampler and wavetable
  // counter both start at the same phase, so a fresh generateStereo() call
  // is directly comparable without any mid-stream phase drift to account for.
  const reference=await K051649.create({...options,clock:1789773});
  const protectedChip=await K051649.create({...options,clock:1789773});
  const unprotectedChip=await K051649.create({...options,clock:1789773});
  try{
    program(reference,0);
    program(protectedChip,0);
    protectedChip.writeRegister(5,0,0x40);
    for(let i=0;i<32;i++)protectedChip.writeRegister(0,i,0);
    protectedChip.writeRegister(5,0,0);
    assert.deepEqual(reference.generateStereo(200).left,protectedChip.generateStereo(200).left,'protected write must not change the waveform');
    program(unprotectedChip,0);
    for(let i=0;i<32;i++)unprotectedChip.writeRegister(0,i,0);
    assert(unprotectedChip.generateStereo(200).left.every(v=>v===0),'unprotected write must silence the waveform');
  }finally{reference.dispose();protectedChip.dispose();unprotectedChip.dispose();}
});

test('K051649 halts below frequency 9 and channel <9 volume/key have no bearing',async()=>{
  const chip=await K051649.create({...options,clock:1789773});
  try{
    for(let i=0;i<32;i++)chip.writeRegister(4,i,80);
    chip.writeRegister(1,0,8);chip.writeRegister(1,1,0);chip.writeRegister(2,0,0x0f);chip.writeRegister(3,0,1);
    assert(chip.generateStereo(2000).left.every(v=>v===0),'frequency <= 8 must halt the channel');
  }finally{chip.dispose();}
});

test('K051649 output partitions deterministically and reset/mute behave',async()=>{
  const a=await K051649.create({...options,clock:1789773}),b=await K051649.create({...options,clock:1789773});
  try{
    program(a,0);program(b,0);
    const full=a.generateStereo(4096);
    const parts=[512,2048,1,17,1518].map(n=>b.generateStereo(n).left);
    assert.deepEqual(Float32Array.from(parts.flatMap(x=>[...x])),full.left);
    assert.deepEqual(full.left,full.right);
    assert(Math.max(...full.left)-Math.min(...full.left)>0);
    a.setMuteMask(0x1f);assert(a.generateStereo(1000).left.every(x=>x===0));b.generateStereo(1000);
    a.setMuteMask(0);assert.deepEqual(a.generateStereo(500).left,b.generateStereo(500).left);
    a.reset();program(a,0);assert.deepEqual(a.generateStereo(4096).left,full.left);
    for(const n of [-1,NaN,0.5,0x1000001])assert.throws(()=>a.generateStereo(n),RangeError);
    assert.equal(a.generateStereo(0).left.length,0);
  }finally{a.dispose();b.dispose();}
  assert.throws(()=>a.generateStereo(1),/disposed/);a.dispose();
});

test('K051649AudioEngine per-channel mute isolates one channel from the rest',async()=>{
  const a=await K051649AudioEngine.create({...options,clock:1789773}),b=await K051649AudioEngine.create({...options,clock:1789773});
  try{
    // Key on/off (port 3) is a single 5-bit mask covering all channels, so
    // program() calls above overwrite each other's bit; set the combined
    // mask once after every channel's waveform/frequency/volume is loaded.
    for(let ch=0;ch<5;ch++){program(a.k051649,ch);program(b.k051649,ch);}
    a.k051649.writeRegister(3,0,0x1f);b.k051649.writeRegister(3,0,0x1f);
    assert.deepEqual(a.processFrames(128),b.processFrames(128));
    b.setSccChannelMuted(2,true);
    const reference=a.processFrames(1024),muted=b.processFrames(1024);
    assert(reference.left.some(v=>v!==0));
    b.setSccMuted(true);assert(b.processFrames(256).left.every(v=>v===0));
    b.setSccMuted(false);
    assert.notDeepEqual(reference.left,muted.left);
  }finally{a.dispose();b.dispose();}
});

test('MSX header validation accepts K051649 and rejects the dual-chip variant',()=>{
  assert.doesNotThrow(()=>validateMsxPlaybackHeader({ay8910Clock:1789773,k051649Clock:1789773}));
  assert.throws(()=>validateMsxPlaybackHeader({k051649Clock:0x40000001}),/dual-chip/);
  assert.throws(()=>validateMsxPlaybackHeader({k051649Clock:1789773,ym2612Clock:1}),/Support coming soon/);
});

test('AY + SCC VGM dispatches command 0xD2 through MsxAudioEngine, mutes and seeks',async()=>{
  const engine=await MsxAudioEngine.create({ayModuleFactory:ayFactory,ayModuleOptions:ayOptions.moduleOptions,ayClock:1789773,k051649ModuleFactory:factory,k051649ModuleOptions:options.moduleOptions,k051649Clock:1789773});
  try{
    engine.setAyMuted(true);
    const p=new VgmPlayer(engine);p.load(vgm(tune,{loop:true}));p.play();
    const full=new Float32Array(4410);p.process(full,new Float32Array(4410),4410);
    assert(full.some(v=>v!==0));
    await seekPlayback(p,1000);p.resume();
    const part=new Float32Array(400);p.process(part,new Float32Array(400),400);assert.deepEqual(part,full.slice(1000,1400));
    p.pause();const silent=new Float32Array(100);p.process(silent,silent,100);assert(silent.every(x=>x===0));
    p.reset();p.play();
    engine.setSccChannelMuted(0,true);
    const muted=new Float32Array(4410);p.process(muted,new Float32Array(4410),4410);
    assert(muted.every(v=>v===0));
  }finally{engine.dispose();}
});
