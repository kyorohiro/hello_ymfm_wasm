import test from 'node:test';
import assert from 'node:assert/strict';
import {VgmPlayer} from './vgmplayer.js';
import {VgmPlayer as DocsPlayer} from '../docs/js/vgmplayer.js';
import {vgmBytes} from './test-support/vgm-mock.js';
import {MockSoundEngine, drainPlayer} from './test-support/vgm-engine-mock.js';

const reg = (frame, chip, port, address, value) =>
  ({frame, chip, instance:0, method:'register', args:[port,address,value]});
const pwm = [0x67,0x66,3,4,0,0,0, 0x23,0x01,0x56,0x04,
  0x90,0,0x11,0,2, 0x91,0,3,1,0, 0x92,0,0x22,0x56,0,0,
  0x93,0,0,0,0,0,1,2,0,0,0, 0x61,5,0, 0x66];

for (const [label, Player] of [['web',VgmPlayer],['docs',DocsPlayer]]) {
  test(`${label}: engine injection covers ports, MSX writes, waits and end`, () => {
    const commands=[0x52,0x22,8,0x70,0x53,0xb4,0xc0,0x7f,
      0xa0,8,15,0x61,2,0,0x51,0x20,0x17,0x62,0x5c,7,0xb0,
      0x63,0x52,0x2a,0x80,0x66,0x52,0x2a,99];
    const expected=[reg(0,'ym2612',0,0x22,8),reg(1,'ym2612',1,0xb4,0xc0),
      reg(17,'ay8910',0,8,15),reg(19,'ym2413',0,0x20,0x17),
      reg(754,'y8950',0,7,0xb0),reg(1636,'ym2612',0,0x2a,0x80)];
    for (const size of [1,7,128,2048]) {
      const engine=new MockSoundEngine(); const player=new Player(engine);
      player.load(vgmBytes(commands)); player.play(); drainPlayer(player,size);
      assert.deepEqual(engine.trace,expected); assert.equal(engine.frames,1636);
      player.reset(); player.play(); drainPlayer(player,size);
      assert.deepEqual(engine.trace,expected); assert.equal(engine.resets,1);
    }
  });
  test(`${label}: PWM direct and stream delivery match literal expected trace`, () => {
    const expected=[reg(0,'pwm',0,2,0x123),reg(2,'pwm',0,2,0x456)];
    for (const commands of [pwm,[0xb2,0x21,0x23,0x71,0xb2,0x24,0x56,0x72,0x66]]) {
      for (const size of [1,3,128]) {
        const engine=new MockSoundEngine(); const player=new Player(engine);
        player.load(vgmBytes(commands)); player.play(); drainPlayer(player,size);
        assert.deepEqual(engine.trace,expected); assert.equal(engine.frames,5);
      }
    }
  });
  test(`${label}: fractional output timing survives small waits and buffer partitions`, () => {
    // 160 output frames per 147 VGM ticks at 48000 Hz. Writes occur after
    // cumulative waits 1, 2 and 147: floor(ticks * 160 / 147) = 1, 2, 160.
    for (const size of [1,17,256]) {
      const engine=new MockSoundEngine(48000); const player=new Player(engine);
      player.load(vgmBytes([0x70,0x52,0x2a,1,0x70,0x52,0x2a,2,
        0x61,145,0,0x52,0x2a,3,0x66]));
      player.play(); drainPlayer(player,size);
      assert.deepEqual(engine.trace,[reg(1,'ym2612',0,0x2a,1),
        reg(2,'ym2612',0,0x2a,2),reg(160,'ym2612',0,0x2a,3)]);
      assert.equal(engine.frames,160);
    }
  });
  test(`${label}: unsupported DAC warns but normal writes continue without misdelivery`, () => {
    const engine=new MockSoundEngine(); const player=new Player(engine); const warnings=[];
    player.load(vgmBytes([0x90,0,0x09,0,0x2a,0x91,0,0,1,0,
      0x92,0,0x44,0xac,0,0,0x93,0,0,0,0,0,1,1,0,0,0,
      0x70,0x52,0x2a,0x81,0x66]),{logger:{warn:message=>warnings.push(message)}});
    player.play(); drainPlayer(player);
    assert.deepEqual(engine.trace,[reg(1,'ym2612',0,0x2a,0x81)]);
    assert.equal(warnings.length,1); assert.match(warnings[0],/Unsupported DAC stream skipped/);
  });
  test(`${label}: pause does not advance engine and resume preserves delivery`, () => {
    const engine=new MockSoundEngine(); const player=new Player(engine);
    player.load(vgmBytes([0x52,0x2a,1,0x7f,0x52,0x2a,2,0x66]));
    player.play(); player.process(new Float32Array(1),new Float32Array(1),1);
    player.pause(); const before=structuredClone(engine.trace); const frames=engine.frames;
    const left=new Float32Array(32).fill(1), right=left.slice(); player.process(left,right,32);
    assert.deepEqual(engine.trace,before); assert.equal(engine.frames,frames);
    assert.ok(left.every(v=>v===0)&&right.every(v=>v===0));
    player.resume(); drainPlayer(player);
    assert.deepEqual(engine.trace,[reg(0,'ym2612',0,0x2a,1),reg(16,'ym2612',0,0x2a,2)]);
  });
}
