import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ym2612VGM} from '../docs/js/ym2612vgm.js';
import {VgmPlayer} from '../docs/js/vgmplayer.js';
import {GenesisAudioEngine} from '../docs/js/genesisaudioengine.js';
import {createPlaybackEngine,createPlaybackPlayer,selectPlaybackConfiguration} from '../docs/vgm_analyzer/playback_core.js';
import {getNodePlaybackFactory,renderSource} from '../cli/render.js';
import {readSource} from '../cli/index.js';
import {renderVgmToWav} from '../docs/vgm_analyzer/vgm_wav.js';
const fixture=name=>new URL(`./fixtures/${name}.vgz`,import.meta.url);
const parser=(header,commands=[])=>({header,analyzeCommandUsage:()=>new Map(commands.map(c=>[c,1]))});
test('configuration handles variants, compositions, ROM needs and reserved header noise',()=>{
  for(const [header,kind] of [
    [{ym2203Clock:4000000},'ym2203'],[{ym2608Clock:8000000},'ym2608'],
    [{ym2610Clock:0x80000000+8000000},'ym2610'],
    [{ym2151Clock:3579545,okim6258Clock:4000000,okim6258Flags:4},'ym2151'],
    [{ay8910Clock:1789773,ym2413Clock:3579545},'ay8910'],
    [{ym2612Clock:7670453,rf5c164Clock:12500000,psgClock:3579545},'ym2612'],
  ]) assert.equal(selectPlaybackConfiguration(parser(header)).kind,kind);
  assert.throws(()=>selectPlaybackConfiguration(parser({ym2610Clock:0x40000000+8000000})),{code:'UNSUPPORTED_CONFIGURATION'});
  assert.throws(()=>selectPlaybackConfiguration(parser({ym2612Clock:7670453,ym2203Clock:4000000})),{code:'UNSUPPORTED_CONFIGURATION'});
  const p=parser({ym2608Clock:8000000});p.requiresYm2608RhythmRom=()=>true;
  assert.deepEqual(selectPlaybackConfiguration(p).requiredRoms,['ym2608AdpcmA']);
  assert.deepEqual(selectPlaybackConfiguration(parser({ay8910Clock:1789773,gameBoyDmgClock:0xc0000001})).ignoredClocks,['gameBoyDmgClock']);
});
test('missing resources are distinct from unsupported compositions, before initialization',async()=>{
  await assert.rejects(createPlaybackEngine(parser({ym2203Clock:4000000})),e=>e.code==='MISSING_RESOURCE'&&e.details.resource==='ym2203');
  const p=parser({ym2608Clock:8000000});p.requiresYm2608RhythmRom=()=>true;
  let called=false;
  await assert.rejects(createPlaybackEngine(p,{getFactory:()=>{called=true;}}),e=>e.code==='MISSING_RESOURCE'&&e.details.resource==='ym2608AdpcmA');
  assert.equal(called,false);
});
// Run the actual Browser orchestration with only its UI/output-device boundary stubbed.
async function browserPlayer(source) {
  const code=await readFile(new URL('../docs/vgm_analyzer/vgm_analyzer.js',import.meta.url),'utf8');
  const noOp=()=>{};
  const context=vm.createContext({
    createPlaybackEngine,selectPlaybackConfiguration,VgmPlayer,
    getBrowserPlaybackFactory:getNodePlaybackFactory,currentBuffer:source,
    currentChipKind:'ym2612',engine:null,player:null,engineClockKey:null,
    masterVolume:1,ym2608AdpcmARomBytes:null,ymf278bWaveRomBytes:null,
    CHANNEL_MUTE_CHIPS:[],channelMonitor:[],
    observePsgPlaybackEngine:noOp,applySourceMutes:noOp,applyMasterVolume:noOp,
    sourceChipKind:()=> 'ym2612',effectiveSourceMutes:()=>({}),hasOkiSource:()=>false,
    prefetchFactorSelect:{value:'1'},loopCheckbox:{checked:false},reportPlaybackWarning:noOp,
    audioContext:null,AudioContext:class {constructor(o){this.sampleRate=o.sampleRate;this.state='running';}},
  });
  vm.runInContext(code.slice(code.indexOf('async function ensurePlaybackReady('),code.indexOf('function isPlaybackReady(')),context);
  await context.ensurePlaybackReady(new Ym2612VGM(source));
  return context;
}
test('shared PCM is sample-exact against previous Browser Genesis construction; CLI WAV agrees',async()=>{
  for(const name of ['psg-tone','genesis-pcm','opn-tone']) {
    let source=await readSource(fixture(name));
    if (name==='opn-tone') {
      const setup=[0x52,0xb0,7,0x52,0xb4,0xc0];
      for(const slot of [0,4,8,12]) for(const [reg,value] of [[0x30,1],[0x40,0],[0x50,31],[0x60,0],[0x70,0],[0x80,15]]) setup.push(0x52,reg+slot,value);
      const extended=new Uint8Array(source.length+setup.length);
      extended.set(source.subarray(0,256));extended.set(setup,256);extended.set(source.subarray(256),256+setup.length);
      new DataView(extended.buffer).setUint32(4,extended.length-4,true);source=extended;
    }
    const vgm=new Ym2612VGM(source),h=vgm.header;
    const browserContext=await browserPlayer(source),shared=browserContext.engine;
    const previous=await GenesisAudioEngine.create({
      ym2612ModuleFactory:await getNodePlaybackFactory('ym2612'),
      segaPsgModuleFactory:await getNodePlaybackFactory('segapsg'),
      rf5c164ModuleFactory:await getNodePlaybackFactory('rf5c164'),
      ym2612Clock:(h.ym2612Clock & 0x3fffffff)||undefined,
      psgClock:(h.psgClock & 0x3fffffff)||undefined,rf5c164Clock:h.rf5c164Clock,
    });
    try {
      const a=browserContext.player,b=new VgmPlayer(previous);b.load(source);
      a.play();b.play();assert.equal(a.sampleRate(),b.sampleRate());
      for(let i=0;i<8;i++) {
        const al=new Float32Array(1024),ar=new Float32Array(1024),bl=new Float32Array(1024),br=new Float32Array(1024);
        a.process(al,ar,1024);b.process(bl,br,1024);
        assert.deepEqual(al,bl);assert.deepEqual(ar,br);
      }
      b.stop();b.play();
      const browser=await renderVgmToWav(b,{maxSeconds:.1});
      const cli=await renderSource(source,{maxSeconds:.1});
      assert.deepEqual(cli.bytes,browser.bytes);
      assert(cli.bytes.subarray(44).some(x=>x!==0),`${name} must produce audible data`);
    } finally {shared.dispose();previous.dispose();}
  }
});
test('Browser and CLI call shared creation; Core has no platform imports',async()=>{
  const browser=await readFile(new URL('../docs/vgm_analyzer/vgm_analyzer.js',import.meta.url),'utf8');
  assert.match(browser,/engine = await createPlaybackEngine\(vgm/);
  assert.doesNotMatch(browser,/engine = await create(?:Ym|Genesis|Msx|Sega|Gameboy)/);
  const core=await readFile(new URL('../docs/vgm_analyzer/playback_core.js',import.meta.url),'utf8');
  assert.doesNotMatch(core,/from ['"]node:|\b(?:document|window|AudioContext|console|fetch)\./);
});

test('shared creation disposes the primary engine when an attached resource fails',async()=>{
  const original=GenesisAudioEngine.create;
  let disposed=0;
  GenesisAudioEngine.create=async()=>({sampleRate:()=>44100,dispose:()=>disposed++});
  try {
    await assert.rejects(createPlaybackEngine(parser({ym2612Clock:7670454,okim6258Clock:4000000,okim6258Flags:4}),{
      getFactory:name=>name==='okim6258'?undefined:()=>{},
    }),e=>e.code==='MISSING_RESOURCE'&&e.details.resource==='okim6258');
    assert.equal(disposed,1);
  } finally {GenesisAudioEngine.create=original;}
});

test('OPN recipes use the same injected factory and ROM contract without a CLI engine',async()=>{
  const {Ym2203AudioEngine}=await import('../docs/js/ym2203audioengine.js');
  const {Ym2608AudioEngine}=await import('../docs/js/ym2608audioengine.js');
  const {Ym2610BAudioEngine}=await import('../docs/js/ym2610baudioengine.js');
  for(const [Engine,header,key,clockKey,resource] of [
    [Ym2203AudioEngine,{ym2203Clock:4000000},'ym2203ModuleFactory','ym2203Clock','ym2203'],
    [Ym2608AudioEngine,{ym2608Clock:8000000},'ym2608ModuleFactory','ym2608Clock','ym2608'],
    [Ym2610BAudioEngine,{ym2610Clock:0x80000000+8000000},'moduleFactory','clock','ym2610b'],
  ]) {
    const original=Engine.create,factory=()=>{},requests=[],rom=new Uint8Array([1,2]);
    let options,loaded;
    Engine.create=async o=>{options=o;return {dispose(){},loadAdpcmARom:r=>{loaded=r;}};};
    try {
      const engine=await createPlaybackEngine(parser(header),{getFactory:name=>{requests.push(name);return factory;},roms:resource==='ym2608'?{ym2608AdpcmA:rom}:{}});
      assert.deepEqual(requests,[resource]);assert.equal(options[key],factory);
      assert.equal(options[clockKey],resource==='ym2203'?4000000:8000000);
      if(resource==='ym2610b') assert.equal(options.variant,true);
      if(resource==='ym2608') assert.equal(loaded,rom);
      engine.dispose();
    } finally {Engine.create=original;}
  }
});

test('YM2203 renders FM and SSG independently and matches the shared Browser engine',async()=>{
  const {Ym2203AudioEngine}=await import('../docs/js/ym2203audioengine.js');
  const rendered=[];
  for(const name of ['fm','ssg','mix']) {
    const source=await readSource(fixture('ym2203-'+name));
    const result=await renderSource(source,{maxSeconds:.1});
    assert.deepEqual(result.warnings,[]);
    assert(result.bytes.subarray(44).some(x=>x!==0),`${name} must sound`);
    rendered.push(result.bytes);
    const engine=await Ym2203AudioEngine.create({ym2203ModuleFactory:await getNodePlaybackFactory('ym2203'),ym2203Clock:4000000});
    try {
      const player=createPlaybackPlayer(engine,source);player.play();
      const browser=await renderVgmToWav(player,{maxSeconds:.1});
      assert.deepEqual(result.bytes,browser.bytes);
    } finally {engine.dispose();}
  }
  assert.notDeepEqual(rendered[2],rendered[0],'mix includes SSG');
  assert.notDeepEqual(rendered[2],rendered[1],'mix includes FM');
  const original=await readSource(fixture('ym2203-mix'));
  for(const [offset,value] of [[0x44,0x40000000+4000000],[0x44,0x80000000+4000000],[0x0c,3579545],[0x48,8000000],[0x6c,12500000]]) {
    const source=original.slice();new DataView(source.buffer).setUint32(offset,value,true);
    await assert.rejects(renderSource(source),error=>error.code==='UNSUPPORTED_CONFIGURATION');
  }
  const missing=original.slice();new DataView(missing.buffer).setUint32(0x90,4000000,true);missing[0x94]=4;
  await assert.rejects(createPlaybackEngine(new Ym2612VGM(missing),{getFactory:name=>name==='okim6258'?undefined:getNodePlaybackFactory(name)}),error=>error.code==='MISSING_RESOURCE'&&error.details.resource==='okim6258');
});
