import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Ym2610B } from "../js/ym2610b.js";
import { Ym2610BAudioEngine } from "../js/ym2610baudioengine.js";
import { Ym2612VGM } from "../js/ym2612vgm.js";
import { VgmPlayer } from "../js/vgmplayer.js";

// Run the shipped web/worker/shell build in an isolated shell context. Only
// the ES module syntax is adapted; the generated runtime and WASM are unchanged.
const runtimeUrl = new URL("../generated/ym2610b_wasm.js", import.meta.url);
const source = readFileSync(runtimeUrl, "utf8")
  .replaceAll("import.meta.url", JSON.stringify(runtimeUrl.href))
  .replace("export default Module;", "Module;");
const moduleFactory = vm.runInNewContext(source, {
  console, WebAssembly, Uint8Array, setTimeout, clearTimeout, performance, URL,
});
const moduleOptions = {
  wasmBinary: new Uint8Array(readFileSync(new URL("../generated/ym2610b_wasm.wasm", import.meta.url))),
};
const createChip = (variant=true) => Ym2610B.create({moduleFactory,moduleOptions:{...moduleOptions},variant});
const write=(c,p,r,v)=>{c.write(p*2,r);c.write(p*2+1,v);};
const peak=a=>a.reduce((m,n)=>Math.max(m,Math.abs(n)),0);
const u32=n=>[n&255,n>>>8&255,n>>>16&255,n>>>24];
const block=(type,data,offset=0,size=data.length,second=false)=>[0x67,0x66,0x82+type,...u32((data.length+8)|(second?0x80000000:0)),...u32(size),...u32(offset),...data];
function vgm(commands,variant=true) {
 const b=new Uint8Array(256+commands.length);b.set([86,103,109,32]);const v=new DataView(b.buffer);
 v.setUint32(8,0x171,true);v.setUint32(0x34,0xcc,true);v.setUint32(0x4c,(8000000|(variant?0x80000000:0))>>>0,true);b.set(commands,256);return b;
}
const aRegs=[[1,63],[8,0x9f],[0x10,0],[0x18,0],[0x20,1],[0x28,0],[0,1]];
const bRegs=[[0x11,0x80],[0x12,0],[0x13,0],[0x14,1],[0x15,0],[0x19,255],[0x1a,255],[0x1b,255],[0x10,0x80]];
test('generated YM2610/B mixes SSG, mutes and resumes',async()=>{
 for(const variant of [false,true]) {
  const c=await createChip(variant);
  try {
   write(c,0,0,100);write(c,0,7,0x3e);write(c,0,8,15);
   const pcm=c.generateStereo(4096);assert.ok(peak(pcm.left)>0.1);assert.deepEqual(pcm.left,pcm.right);
   c.setSourceMuteMask(1);c.generateStereo(128);assert.equal(peak(c.generateStereo(2048).left),0);
   c.setSourceMuteMask(0);assert.ok(peak(c.generateStereo(2048).left)>0.1);
  } finally {c.dispose();}
 }
});
test('ADPCM A/B real WASM reads independent ROM banks and respects pan/mute',async()=>{
 for(const type of [0,1]) {
  const c=await createChip();
  try {
   c.loadAdpcmRom(type,new Uint8Array(512).fill(0x17));
   for(const [r,v] of type===0?aRegs:bRegs) write(c,type===0?1:0,r,v);
   const pcm=c.generateStereo(12000);assert.ok(peak(pcm.left)>0.01,`ADPCM ${type}`);assert.equal(peak(pcm.right),0);
   c.reset();c.setSourceMuteMask(type===0?2:4);
   for(const [r,v] of type===0?aRegs:bRegs) write(c,type===0?1:0,r,v);
   c.generateStereo(128); // Drain retained interpolation samples after reset.
   assert.equal(peak(c.generateStereo(12000).left),0);
  } finally {c.dispose();}
 }
});
test('VGM parser validates and transfers split ROMs and skips second chip',()=>{
 const loads=[],warnings=[];
 const parser=new Ym2612VGM(vgm([...block(0,[1,2],0,4),...block(0,[3,4],2,4),...block(1,[5],0,4,true),0x66]),{logger:{warn:m=>warnings.push(m)}});
 while(parser.playStep({ym2610:{loadAdpcmRom:(...a)=>loads.push(a)}}).type!=='end') {}
 assert.equal(loads.length,2);assert.deepEqual([...loads[1][1]],[3,4]);assert.equal(loads[1][2],2);assert.ok(warnings.length);
 assert.throws(()=>new Ym2612VGM(vgm([...block(0,[1,2],3,4),0x66])).step(),/range/);
});
test('VGM Player loads A/B ROMs and clears them on file changes; restart replays blocks',async()=>{
 const engine=await Ym2610BAudioEngine.create({moduleFactory,moduleOptions:{...moduleOptions}});
 try {
  const commands=[...block(0,new Uint8Array(512).fill(0x17)),...aRegs.flatMap(([r,v])=>[0x59,r,v]),0x61,0x44,0xac,0x66];
  const player=new VgmPlayer(engine);player.load(vgm(commands));player.play();
  const l=new Float32Array(4096),r=new Float32Array(4096);player.process(l,r,4096);assert.ok(peak(l)>0.01);const loaded=Float32Array.from(l);
  player.reset();player.play();player.process(l,r,4096);assert.ok(peak(l)>0.01);
  engine.reset();player.load(vgm([...aRegs.flatMap(([r,v])=>[0x59,r,v]),0x61,0x44,0xac,0x66]));player.play();player.process(l,r,4096);
  // Empty ROM reads zeros, which may decode a tiny DC signal; it must differ from loaded samples.
  const reference=await Ym2610BAudioEngine.create({moduleFactory,moduleOptions:{...moduleOptions}});
  try {
    for(const [reg,val] of aRegs) reference.writeYm2610B(1,reg,val);
    const blank=reference.processFrames(4096);
    assert.ok(Math.abs(peak(l.slice(256))-peak(blank.left.slice(256)))<0.002);
    assert.ok(loaded.some((sample,i)=>i>256 && Math.abs(sample-l[i])>0.01));
  } finally {reference.dispose();}
 } finally {engine.dispose();}
});
test('VGM variant bit selects four or six actual FM hardware channels',async()=>{
 for(const variant of [false,true]) {
  for(const channel of [0,1]) {
   const c=await createChip(variant);
   try {
    for(const slot of [0,4,8,12]) {
      for(const [base,val] of [[0x30,1],[0x40,0],[0x50,31],[0x60,0],[0x70,0],[0x80,15]]) write(c,0,base+slot+channel,val);
    }
    write(c,0,0xb0+channel,7);write(c,0,0xb4+channel,0xc0);
    write(c,0,0xa4+channel,0x22);write(c,0,0xa0+channel,0x69);write(c,0,0x28,0xf0+channel);
    const level=peak(c.generateStereo(4096).left);
    if(variant || channel===1) assert.ok(level>0.01);else assert.equal(level,0);
   } finally {c.dispose();}
  }
 }
});
test('Analyzer file-open scans YM2610 writes and ROM blocks without treating operands as commands',()=>{
  for (const variant of [false,true]) {
    const parser=new Ym2612VGM(vgm([
      ...block(0,[0x58,0x59,0x66],0,4),
      0x58,0x28,0xf1,0x59,0x08,0x80,0x61,100,0,
      ...block(1,[0x66],0,4),0x58,0x28,0,0x66,
    ],variant));
    assert.deepEqual(Object.fromEntries(parser.analyzeCommandUsage()),{
      '0x67':2,'0x58':2,'0x59':1,'0x61':1,'0x66':1,
    });
    assert.equal(parser.dataBlockSummary().length,2);
    assert.doesNotThrow(()=>parser.analyzeSpecialCommands());
    assert.doesNotThrow(()=>parser.pcmRamWriteSummary());
    assert.doesNotThrow(()=>parser.analyzeCommandContext(0x92));
    const context=JSON.stringify(parser.analyzeCommandContext(0x59));
    assert.match(context,/ym2610 port=1/);
    assert.match(context,/ym2610 port=0/);
  }
});
