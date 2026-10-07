import test from 'node:test';
import assert from 'node:assert/strict';
import {readSource,renderSource} from '../cli/index.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {createPlaybackEngine,createPlaybackPlayer,selectPlaybackConfiguration,applyPlaybackMutes} from '../docs/vgm_analyzer/playback_core.js';
const offsets={ym2612:0x2c,ym2151:0x30,ym2203:0x44,ym3812:0x50,y8950:0x58,segaPcm:0x38};
async function setup(name){
 const bytes=await readSource(new URL(`./fixtures/${name}.vgz`,import.meta.url)),p=new Ym2612VGM(bytes),parts=[];
 while(true){const pos=p.position,e=p.step();if(e.type==='wait'||e.type==='end')break;parts.push(...bytes.subarray(pos,p.position));}
 return {header:p.header,commands:parts};
}
function file(setups,extra={}){
 const commands=[...setups.flatMap(s=>s.commands),0x61,255,255,0x66];
 const bytes=new Uint8Array(256+commands.length),v=new DataView(bytes.buffer);
 bytes.set([86,103,109,32]);v.setUint32(8,0x171,true);v.setUint32(0x34,204,true);v.setUint32(0x18,65535,true);
 for(const s of setups)for(const [id,offset] of Object.entries(offsets))if(s.header[id+'Clock'])v.setUint32(offset,s.header[id+'Clock'],true);
 for(const [offset,value] of Object.entries(extra))v.setUint32(Number(offset),value,true);
 bytes.set(commands,256);return bytes;
}
async function pcm(bytes,{mute=[],sizes=[1000],replay=false,volume=1}={}){
 const vgm=new Ym2612VGM(bytes),config=selectPlaybackConfiguration(vgm);
 const e=await createPlaybackEngine(vgm,{getFactory:getNodePlaybackFactory,masterVolume:volume});
 try{
  applyPlaybackMutes(e,config,mute);const p=createPlaybackPlayer(e,bytes);
  const pass=()=>{p.play();const result=[[],[]];for(const n of sizes){const l=new Float32Array(n),r=new Float32Array(n);p.process(l,r,n);result[0].push(...l);result[1].push(...r);}return result;};
  const result=pass();if(replay){p.reset();assert.deepEqual(pass(),result);}return result;
 }finally{e.dispose();}
}
test('header composes two unrelated FM engines, routes writes, mutes and gain once',async()=>{
 const a=await setup('opm-audible'),b=await setup('ym3812-tone');
 const bytes=file([a,b]);assert.equal(selectPlaybackConfiguration(new Ym2612VGM(bytes)).kind,'mixed');
 const [pa,pb,mixed]=await Promise.all([pcm(file([a])),pcm(file([b])),pcm(bytes,{replay:true})]);
 assert(pa[0].some(Boolean));assert(pb[0].some(Boolean));
 for(let c=0;c<2;c++)assert.deepEqual(mixed[c],pa[c].map((n,i)=>Math.fround(n+pb[c][i])));
 assert.deepEqual(await pcm(bytes,{mute:['ym2151']}),pb);
 assert.deepEqual(await pcm(bytes,{sizes:[1,2,7,90,300,600]}),mixed);
 const gain=await pcm(bytes,{volume:.5});for(let c=0;c<2;c++)assert.deepEqual(gain[c],mixed[c].map(v=>v*.5));
 const wav=await renderSource(bytes,{maxSeconds:.02});assert.deepEqual(wav.warnings,[]);assert(wav.bytes.subarray(44).some(Boolean));
});
test('Genesis native output rate is adapted; OPN and PSG remain audible across chunk boundaries',async()=>{
 const a=await setup('psg-tone'),b=await setup('ym2203-mix');
 // setup() preserves this fixture's PSG clock separately.
 const bytes=file([a,b],{[0x0c]:a.header.psgClock});
 const config=selectPlaybackConfiguration(new Ym2612VGM(bytes));assert.equal(config.kind,'mixed');
 assert.deepEqual(config.parts.map(p=>p.id),['genesis','ym2203']);
 const all=await pcm(bytes);assert(all[0].some(Boolean));
 // Split the VGM waits themselves, not just the player's output queue.
 const waits=[1,2,7,90,300,600,64535].flatMap(n=>[0x61,n&255,n>>>8]);
 const split=new Uint8Array(bytes.length-4+waits.length+1);
 split.set(bytes.subarray(0,-4));split.set([...waits,0x66],bytes.length-4);
 assert.deepEqual(await pcm(split),all);

 assert.deepEqual(await pcm(bytes,{sizes:[1,2,7,90,300,600]}),all);
 const opl=await pcm(bytes,{mute:['genesis']});assert.deepEqual(opl,await pcm(file([b])));
 // OPN's native reset does not restore its initial synthesis phase; test
 // the rate adapter's reset independently of that existing core behavior.
 const psg=await pcm(bytes,{mute:['ym2203'],replay:true});assert(psg[0].some(Boolean));
 for(let c=0;c<2;c++)assert.deepEqual(all[c],opl[c].map((n,i)=>Math.fround(n+psg[c][i])));
 assert((await pcm(bytes,{mute:['genesis','ym2203']}))[0].every(v=>v===0));
});
test('all supported clocks instantiate with isolated targets; unknown chips/dual reject',async()=>{
 const header={ym2612Clock:7670454,psgClock:3579545,ym2203Clock:4000000,ym2608Clock:8000000,ym2610Clock:8000000,ym2151Clock:4000000,ym2413Clock:3579545,ym3526Clock:3579545,ym3812Clock:3579545,ymf262Clock:14318180,ymf278bClock:33868800,y8950Clock:3579545,ay8910Clock:1789773,k051649Clock:1789773,huc6280Clock:3579545,nesApuClock:1789773,gameBoyDmgClock:4194304,segaPcmClock:4000000,rf5c164Clock:12500000,pwmClock:23011361,okim6258Clock:4000000,okim6258Flags:4,okim6295Clock:1320000};
 const vgm={header,analyzeCommandUsage:()=>new Map([['0xb3',1],['0xc0',1]]),requiresYm2608RhythmRom:()=>true,requiresYmf278bWaveRom:()=>true};
 const c=selectPlaybackConfiguration(vgm);assert.equal(c.kind,'mixed');
 assert.deepEqual(c.parts.flatMap(p=>p.chips).sort(),c.chips.map(p=>p.id).sort());
 assert.deepEqual(c.requiredRoms,['ym2608AdpcmA','ymf278bWave']);
 const engine=await createPlaybackEngine({...vgm,requiresYm2608RhythmRom:()=>false,requiresYmf278bWaveRom:()=>false},{getFactory:getNodePlaybackFactory});
 try{
  assert.equal(engine.sampleRate(),44100);
  assert.deepEqual([...engine.playbackMixer.strips.keys()].sort(),c.chips.map(c=>c.id).sort());
  const pcm=engine.processFrames(17);assert.equal(pcm.left.length,17);assert(pcm.left.every(Number.isFinite));
  const calls=[];
  for(const id of ['y8950','ymf278b','segaPcm'])engine.entries.get(id+':0').engine.loadSampleMemory=(...args)=>calls.push([id,...args]);
  for(const id of ['y8950','ymf278b','segapcm'])engine.vgmTargets[id].loadSampleMemory(new Uint8Array([7]),0,1);
  assert.deepEqual(calls.map(c=>c[0]),['y8950','ymf278b','segaPcm']);
  engine.reset();assert(engine.processFrames(13).right.every(Number.isFinite));
 }finally{engine.dispose();}

 assert.throws(()=>selectPlaybackConfiguration({...vgm,header:{...header,unknownClock:1}}),/Unsupported sound chip/);
 assert.throws(()=>selectPlaybackConfiguration({...vgm,header:{...header,ym3812Clock:0x40000001}}),/Dual/);
});
test('mixed ROM requirements fail before allocating any chip',async()=>{
 let allocated=false;
 await assert.rejects(createPlaybackEngine({header:{ym2608Clock:8000000,ym3812Clock:3579545},analyzeCommandUsage:()=>new Map(),requiresYm2608RhythmRom:()=>true},{getFactory:()=>{allocated=true;}}),e=>e.code==='MISSING_RESOURCE');
 assert.equal(allocated,false);
});
