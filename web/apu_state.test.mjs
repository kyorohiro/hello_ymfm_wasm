import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPlaybackEngine} from '../docs/vgm_analyzer/playback_core.js';
import {getNodePlaybackFactory} from '../cli/render.js';
import {Ym2612VGM} from './ym2612vgm.js';
import {VgmPlayer} from './vgmplayer.js';
import {seekPlayback} from '../docs/vgm_analyzer/seek_playback.js';
import vm from 'node:vm';
import {createGameboyMonitor} from '../docs/vgm_analyzer/gameboy_notes.js';
import {createNesMonitor,applyNesWrite} from '../docs/vgm_analyzer/nes_notes.js';

const fixture=name=>readFileSync(new URL(`../test/fixtures/${name}.vgm`,import.meta.url));
const make=bytes=>createPlaybackEngine(new Ym2612VGM(bytes),{getFactory:getNodePlaybackFactory});
const render=(player,n)=>{const left=new Float32Array(n),right=new Float32Array(n);player.process(left,right,n);return {left,right};};
const player=(engine,bytes)=>{const p=new VgmPlayer(engine);p.load(bytes);p.setPrefetchFactor(1);p.play();return p;};
function song(bytes){
  const parser=new Ym2612VGM(bytes);let offset;
  while(true){offset=parser.position;const event=parser.step();if(event.type==='wait')break;assert.notEqual(event.type,'end');}
  const commands=[...Array.from({length:100},()=>[0x61,0xb9,1]).flat(),0x66];
  const out=new Uint8Array(offset+commands.length);out.set(bytes.subarray(0,offset));out.set(commands,offset);
  const view=new DataView(out.buffer);view.setUint32(4,out.length-4,true);view.setUint32(0x18,44100,true);
  view.setUint32(0x1c,0,true);view.setUint32(0x20,0,true);return out;
}

for(const name of ['gameboy-tone','nes-tone','fds-tone']){
  test(`${name}: snapshots preserve phases, filters and memory after reset`,async()=>{
    const bytes=song(fixture(name)),engine=await make(bytes),other=await make(bytes);
    try{
      render(player(engine,bytes),137);
      if(name!=='gameboy-tone'){
        engine.loadNesMemory(Uint8Array.from({length:49},(_,i)=>i*17&255),0xc000);
        for(const [r,v] of [[0x10,0x4f],[0x11,64],[0x12,0],[0x13,3],[0x15,0x1f]])engine.writeNesApu(r,v);
        if(name==='fds-tone'){
          engine.writeNesApu(0x27,0x80);
          for(let i=0;i<32;i++)engine.writeNesApu(0x28,i&7);
          for(const [r,v] of [[0x20,0x41],[0x24,0x41],[0x25,5],[0x26,0x31],[0x27,1],[0x2a,1]])engine.writeNesApu(r,v);
        }
      }else{
        // Square sweep/envelope, wave RAM and noise LFSR all need restoration.
        const writes=[[0x15,0xff],[0,0x19],[2,0xa2],[4,0x86],[6,0x40],[7,0xb2],[8,0x44],[9,0x86],
          [0x0a,0x80],[0x0c,0x20],...Array.from({length:16},(_,i)=>[0x20+i,i*17]),
          [0x0d,0x23],[0x0e,0x87],[0x11,0xf2],[0x12,0x35],[0x13,0x80]];
        for(const [r,v] of writes)engine.writeGameboyApu(r,v);
      }
      engine.processFrames(79);
      assert.equal(engine.supportsState(),true);
      const state=engine.saveState(),expected=engine.processFrames(1291);
      assert(expected.left.some(v=>v!==0));
      engine.reset();engine.loadNesMemory?.(new Uint8Array(49),0xc000);engine.processFrames(101);
      engine.loadState(state);assert.deepEqual(engine.processFrames(1291),expected);
      engine.loadState(state);assert.deepEqual(engine.processFrames(1291),expected);
      assert.throws(()=>other.loadState(state),/Incompatible/);
      engine.setChannelMuted(0,true);assert.throws(()=>engine.loadState(state),/Incompatible/);
      engine.setChannelMuted(0,false);engine.setMasterVolume(.5);assert.throws(()=>engine.loadState(state),/Incompatible/);
      engine.setMasterVolume(1);
      engine.playbackMixer.set(name==='gameboy-tone'?'gameBoyDmg':'nesApu',{gain:.25});
      assert.throws(()=>engine.loadState(state),/Incompatible/);
    }finally{engine.dispose();other.dispose();}
  });

  test(`${name}: cached backward and forward seeks match replay and reduce synthesis`,async()=>{
    const bytes=song(fixture(name)),engine=await make(bytes),reference=await make(bytes);
    try{
      const p=player(engine,bytes),q=player(reference,bytes);p.checkpointIntervalSeconds=.02;
      for(let i=0;i<20;i++)render(p,1024);
      assert(p.checkpointStats().count>0);
      let work=0;const process=engine.processFrames.bind(engine);
      engine.processFrames=n=>{work+=n;return process(n);};
      for(const seconds of [.175,.35,.1]){
        work=0;await seekPlayback(p,seconds*44100);await seekPlayback(q,seconds*44100);
        assert(work<engine.sampleRate()*seconds/2,`replayed ${work} frames`);
        p.play();q.play();assert.deepEqual(render(p,777),render(q,777));
      }
      p.clearQueuedAudio();assert.equal(p.checkpointStats().count,0);
      p.load(bytes);assert.equal(p.checkpointStats().count,0);
    }finally{engine.dispose();reference.dispose();}
  });
}

test('Game Boy native snapshots reject wrong size/configuration before modifying sound',async()=>{
  const engine=await make(song(fixture('gameboy-tone')));
  try{
    render(player(engine,song(fixture('gameboy-tone'))),137);
    const chip=engine.gameboy,module=chip.module,state=chip.saveState();
    const size=module._gameboy_apu_save_state(chip.handle,0),ptr=module._malloc(size);
    try{
      module._gameboy_apu_save_state(chip.handle,ptr);
      const expected=chip.generateStereo(391);chip.loadState(state);
      assert.equal(module._gameboy_apu_load_state(chip.handle,ptr,size-1),0);
      new DataView(module.HEAPF32.buffer).setUint32(ptr+8,8000,true);
      assert.equal(module._gameboy_apu_load_state(chip.handle,ptr,size),0);
      assert.deepEqual(chip.generateStereo(391),expected);
    }finally{module._free(ptr);}
  }finally{engine.dispose();}
});

for(const [name,kind] of [['gameboy-tone','gameboy'],['nes-tone','nes'],['fds-tone','nes']]){
  test(`${name}: Analyzer retains checkpoints and restores Note-ish including FDS methods`,async()=>{
    const source=readFileSync(new URL('../docs/vgm_analyzer/vgm_analyzer.js',import.meta.url),'utf8');
    const body=source.slice(source.indexOf('async function ensurePlaybackReady('),source.indexOf('\nfunction isPlaybackReady('));
    const bytes=song(fixture(name)),engine=await make(bytes);
    try{
      const monitor=kind==='nes'?createNesMonitor(name==='fds-tone'):createGameboyMonitor();
      const mutes=Array.from({length:kind==='nes'?6:4},()=>false);
      const c=vm.createContext({psgChannelMutes:[],mixerUi:{attach(){}},engine,engineClockKey:'',currentChipKind:kind,player:null,VgmPlayer,
        vgm:new Ym2612VGM(bytes),currentBuffer:bytes,structuredClone,selectPlaybackConfiguration:()=>({kind}),CHANNEL_MUTE_CHIPS:[],
        channelMonitor:[],monitorFrequencyHigh:[],psgMonitor:{},pcmMonitor:{},lastYm2612DacEnable:0,
        apuNoteMonitor:monitor,apuNoteChannels:[{marker:17}],createNesMonitor,channelMutesForChip:()=>mutes,
        requestChannelMonitorRender(){},requestNoteishRender(){},applySourceMutes(){},sourceChipKind:()=>kind,effectiveSourceMutes:()=>({}),hasOkiSource:()=>false,
        applyMasterVolume(){},prefetchFactorSelect:{value:'1'},loopCheckbox:{checked:false},
        audioContext:{sampleRate:engine.sampleRate(),state:'running'},reportPlaybackWarning(){},noteishHeader:{}});
      const key=body.match(/const nextClockKey = ([\s\S]*?);/)[1].replace('nextChipKind',JSON.stringify(kind));
      vm.runInContext(`engineClockKey = ${key};\n${body}`,c);
      await c.ensurePlaybackReady(c.vgm);assert.equal(c.player.checkpointIntervalSeconds,5);
      c.player.checkpointIntervalSeconds=.02;const parser=c.player.parser;
      c.player.play();for(let i=0;i<20;i++)render(c.player,1024);
      const cached=c.player.checkpointStats().count;assert(cached>0);
      await c.ensurePlaybackReady(c.vgm);assert.equal(c.player.parser,parser);assert.equal(c.player.checkpointStats().count,cached);
      c.apuNoteChannels=[{marker:99}];
      await seekPlayback(c.player,.175*44100);
      assert.equal(c.apuNoteChannels[0].marker,17);
      if(name==='fds-tone')assert.doesNotThrow(()=>applyNesWrite(c.apuNoteMonitor,0x22,0x44));
      mutes[0]=true;assert.equal(c.player.restoreCheckpoint(10000),0);assert.equal(c.player.checkpointStats().count,0);
      c.currentBuffer=bytes.slice();await c.ensurePlaybackReady(c.vgm);assert.notEqual(c.player.parser,parser);
    }finally{engine.dispose();}
  });
}
