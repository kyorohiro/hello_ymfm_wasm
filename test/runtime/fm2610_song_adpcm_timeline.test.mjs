import assert from 'node:assert/strict';
import test from 'node:test';
import {readSource} from '../../tetorica_src/cli/index.js';
import {getNodePlaybackFactory} from '../../tetorica_src/cli/render.js';
import {
  createFm2610SongTimeline, createFm2610VgmEngine, createFm2610VgmPlayer, prepareFm2610Vgm,
} from '../../docs/synth-fm2610/vgm.js';

test('FM2610 timeline delays ADPCM register and ROM visibility to the output frame', () => {
  const engine = {
    writeYm2610B() {},
    loadAdpcmRom() {},
    clearAdpcmRoms() {},
    processFrames() {},
    reset() { this.clearAdpcmRoms(); },
  };
  const original = {...engine};
  const timeline = createFm2610SongTimeline(engine,{variant:'ym2610',clock:8000000});
  try {
    const initial = new Uint8Array(256).fill(0x18);
    const replacement = new Uint8Array(256).fill(0x81);
    engine.loadAdpcmRom(0,initial,0,256);
    engine.loadAdpcmRom(1,initial,0,256);
    engine.writeYm2610B(1,0,1);
    engine.writeYm2610B(0,0x11,0xc0);
    engine.writeYm2610B(0,0x10,0xb0);
    // The first writes have reached the engine before any PCM is available.
    const pending = timeline.read(0);
    assert.equal(pending.frame,-1);
    assert.equal(pending.adpcm.adpcmB.rom.size,0);
    assert.equal(timeline.readAdpcmABytes(0),null);
    assert.equal(timeline.readAdpcmBBytes(),null);

    engine.processFrames(4);
    engine.writeYm2610B(0,0x1b,0x80);
    engine.processFrames(1);
    engine.loadAdpcmRom(1,replacement,0,256);
    engine.writeYm2610B(1,0,0x81);
    engine.processFrames(2);

    const first = timeline.read(3);
    assert(first.adpcm.adpcmA.voices[0].keyed);
    assert.deepEqual(timeline.readAdpcmABytes(0,first.adpcm.adpcmA),initial);
    assert(first.adpcm.adpcmB.keyed && first.adpcm.adpcmB.repeat);
    assert.deepEqual(timeline.readAdpcmBBytes(first.adpcm.adpcmB),initial);

    const level = timeline.read(4);
    assert.equal(level.adpcm.adpcmB.volume,0x80);
    assert.equal(level.adpcm.adpcmB.rom,first.adpcm.adpcmB.rom);
    const replaced = timeline.read(5);
    assert(!replaced.adpcm.adpcmA.voices[0].keyed);
    assert.notEqual(replaced.adpcm.adpcmB.rom,first.adpcm.adpcmB.rom);
    assert.equal(timeline.readAdpcmBBytes(first.adpcm.adpcmB),null);
    const bytes = timeline.readAdpcmBBytes(replaced.adpcm.adpcmB);
    assert.deepEqual(bytes,replacement);
    bytes[0] = 0;
    assert.deepEqual(timeline.readAdpcmBBytes(replaced.adpcm.adpcmB),replacement);

    engine.clearAdpcmRoms();
    engine.processFrames(1);
    assert.equal(timeline.read(6).adpcm.adpcmB.rom.size,256);
    assert.equal(timeline.read(7).adpcm.adpcmB.rom.size,0);
    assert.equal(timeline.readAdpcmABytes(0,first.adpcm.adpcmA),null);
    engine.reset();
    const reset = timeline.read(0);
    assert.equal(reset.frame,-1);
    assert(!reset.adpcm.adpcmB.keyed);
    assert.equal(timeline.readAdpcmBBytes(),null);
  } finally {
    timeline.dispose();
    assert.deepEqual(engine,original);
  }
});

test('FM2610 VGM playback keeps PCM unchanged while exposing both embedded ADPCM banks', async () => {
  const data = await readSource(new URL('../fixtures/ym2610-mix.vgz',import.meta.url));
  const source = await prepareFm2610Vgm(data);
  const moduleFactory = await getNodePlaybackFactory('ym2610b');
  const options = {moduleFactory,outputSampleRate:48000};
  const monitored = await createFm2610VgmEngine(source,options);
  const reference = await createFm2610VgmEngine(source,options);
  const timeline = createFm2610SongTimeline(monitored,source);
  function render(engine) {
    const player = createFm2610VgmPlayer(engine,source);
    player.play();
    const left = new Float32Array(128), right = new Float32Array(128);
    assert.equal(player.process(left,right,left.length),left.length);
    return {left,right};
  }
  try {
    assert.deepEqual(render(monitored),render(reference));
    assert.equal(timeline.read(-1).adpcm.adpcmB.rom.size,0);
    const live = timeline.read(127);
    assert(live.channels.some(channel => channel.gate));
    assert(live.adpcm.adpcmA.voices[0].keyed && live.adpcm.adpcmA.voices[0].available);
    assert.equal(timeline.readAdpcmABytes(0,live.adpcm.adpcmA).length,256);
    assert(live.adpcm.adpcmB.keyed && live.adpcm.adpcmB.available);
    assert.equal(live.adpcm.adpcmB.deltaN,65535);
    assert.equal(timeline.readAdpcmBBytes(live.adpcm.adpcmB).length,256);
  } finally {
    timeline.dispose();
    monitored.dispose();
    reference.dispose();
  }
});
