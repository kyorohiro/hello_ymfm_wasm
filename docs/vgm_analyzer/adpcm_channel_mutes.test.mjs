import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Ym2612VGM} from '../js/ym2612vgm.js';
import {getNodePlaybackFactory} from '../../tetorica_src/cli/render.js';
import {createPlaybackEngine, createPlaybackPlayer} from './playback_core.js';
import {installOpnChannelMutes} from './opn_channel_mutes.js';
import {renderVgmToWav} from './vgm_wav.js';

const rom = await readFile(new URL('../js/tetorica_ym2608_adpcm_rom.bin',import.meta.url));
for (const chip of ['ym2608','ym2610','ym2610b']) {
  test(chip + ' individual percussion mute preserves decoder position, pan and WAV isolation', async () => {
    const opna = chip === 'ym2608';
    const commands = [];
    if (!opna) {
      const header = Buffer.alloc(15);
      header.set([0x67,0x66,0x82]); header.writeUInt32LE(8+rom.length,3); header.writeUInt32LE(rom.length,7);
      commands.push(...header,...rom);
    }
    const reg = (r,v) => commands.push(opna ? 0x56 : 0x59,opna ? r+16 : r,v);
    reg(1,63);
    const ch = 1;
    if (!opna) reg(0x20+ch,31);
    reg(0,1<<ch);
    commands.push(0x61,0x44,0xac,0x66);
    const vgm = Buffer.alloc(256+commands.length);
    vgm.write('Vgm '); vgm.writeUInt32LE(vgm.length-4,4); vgm.writeUInt32LE(0x171,8);
    vgm.writeUInt32LE(0xcc,0x34); vgm.writeUInt32LE(8000000+(chip==='ym2610b'?0x80000000:0),opna?0x48:0x4c);
    vgm.set(commands,256);
    const engine = await createPlaybackEngine(new Ym2612VGM(vgm),{getFactory:getNodePlaybackFactory,roms:{ym2608AdpcmA:rom}});
    installOpnChannelMutes(engine,opna?'ym2608':'ym2610');
    const player = createPlaybackPlayer(engine,vgm);
    try {
      async function wavWithMuted(channel) {
        for (let i=0;i<6;i++) engine.setAdpcmAChannelMuted(i,i===channel);
        player.reset(); player.play();
        const {bytes} = await renderVgmToWav(player,{maxSeconds:.05});
        return bytes.subarray(44);
      }
      assert((await wavWithMuted(0)).some(Boolean));
      assert(!(await wavWithMuted(ch)).some(Boolean));
      engine.setAdpcmAChannelMuted(ch,false);
      engine.reset();
      const initial = engine.saveState();
      function run(mute) {
        engine.loadState(initial);
        if (!opna) engine.loadAdpcmRom(0,rom,0,rom.length);
        const write = (r,v) => opna ? engine.writeYm2608(0,16+r,v) : engine.writeYm2610B(1,r,v);
        write(1,63);
        if (!opna) write(0x20+ch,31);
        write(0,1<<ch);
        engine.processFrames(128);
        engine.setAdpcmAChannelMuted(ch,mute);
        engine.setRhythmMuted(mute);
        engine.processFrames(128);
        engine.setRhythmMuted(false);
        write(8+ch,0x9f); // Pan changes to left while this voice is muted.
        const during = engine.processFrames(256);
        engine.setAdpcmAChannelMuted(ch,false);
        return {during,after:engine.processFrames(256)};
      }
      const reference = run(false), muted = run(true);
      assert(reference.during.left.some(Boolean));
      assert(!muted.during.left.subarray(8).some(Boolean));
      assert(reference.after.left.some(Boolean));
      // OPNA can mix the preceding muted sample into the first output frame.
      const first = opna ? 1 : 0;
      assert.deepEqual(muted.after.left.subarray(first),reference.after.left.subarray(first));
      assert(!muted.after.right.subarray(8).some(Boolean));
    } finally { engine.dispose(); }
  });
}
