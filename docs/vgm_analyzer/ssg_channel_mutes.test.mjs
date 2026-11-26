import test from 'node:test';
import assert from 'node:assert/strict';
import {getNodePlaybackFactory} from '../../tetorica_src/cli/render.js';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {createPlaybackEngine, createPlaybackPlayer, selectPlaybackConfiguration} from './playback_core.js';
import {renderVgmToWav} from './vgm_wav.js';
import {installOpnChannelMutes} from './opn_channel_mutes.js';

test('OPN SSG channel mutes isolate each voice in rendered WAV',async()=>{
 for (const [command,offset,clock] of [[0x55,0x44,4000000],[0x56,0x48,8000000],[0x58,0x4c,8000000],[0x58,0x4c,0x80000000+8000000]]) {
  for (let ch=0;ch<3;ch++) {
   const commands=[command,2*ch,64,command,7,0x3f^(1<<ch),command,8+ch,15,0x61,0x44,0xac,0x66];
   const vgm=Buffer.alloc(256+commands.length);
   vgm.write('Vgm ');vgm.writeUInt32LE(vgm.length-4,4);vgm.writeUInt32LE(0x171,8);
   vgm.writeUInt32LE(0xcc,0x34);vgm.writeUInt32LE(clock,offset);vgm.set(commands,256);
   const parser = new Ym2612VGM(vgm);
   const engine = await createPlaybackEngine(parser,{getFactory:getNodePlaybackFactory,allowMissingYm2608RhythmRom:true});
   installOpnChannelMutes(engine,selectPlaybackConfiguration(parser).kind);
   const player = createPlaybackPlayer(engine,vgm);
   const render=async channel=>{
    for (let i=0;i<3;i++) engine.setSsgChannelMuted(i,i===channel);
    player.reset(); player.play();
    const {bytes}=await renderVgmToWav(player,{maxSeconds:.05});
    return Buffer.from(bytes).subarray(44);
   };
   assert((await render((ch+1)%3)).some(Boolean),'muting a neighbour preserves the tone');
   assert(!(await render(ch)).some(Boolean),'muting the active voice silences its WAV');
   engine.dispose();
  }
 }
});

test('checkpoint restores the programmed envelope for a muted SSG channel', () => {
  const writes = [];
  const engine = {
    writeYm2608:(...write)=>writes.push(write), reset(){}, stateSettingsKey:()=>'base',
    saveState:()=>({}), loadState(){},
  };
  installOpnChannelMutes(engine,'ym2608');
  engine.setSsgChannelMuted(1,true);
  engine.writeYm2608(0,9,16);
  const checkpoint = engine.saveState();
  engine.writeYm2608(0,9,12);
  engine.writeYm2608(1,9,0xff);
  assert.deepEqual(writes.slice(-2), [[0,9,0],[1,9,0xff]]);
  engine.reset();
  engine.loadState(checkpoint);
  engine.setSsgChannelMuted(1,false);
  assert.deepEqual(writes.at(-1),[0,9,16]);
});
