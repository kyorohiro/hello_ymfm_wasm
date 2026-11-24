import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {readSource} from '../../tetorica_src/cli/index.js';
import {getNodePlaybackFactory} from '../../tetorica_src/cli/render.js';
import {
  createFm2610SongTimeline, createFm2610VgmEngine, createFm2610VgmPlayer, prepareFm2610Vgm,
} from '../../docs/synth-fm2610/vgm.js';
import {createFm2610SongTransport} from '../../docs/synth-fm2610/song_player.js';

test('FM2610 timeline delays ADPCM register and ROM visibility to the output frame', () => {
  const engine = {
    sampleRate() { return 48000; },
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
    engine.writeYm2610B(1,0x08,0x91);
    engine.writeYm2610B(1,0x09,0x4f);
    engine.writeYm2610B(1,0,1);
    engine.writeYm2610B(0,0x11,0xc0);
    engine.writeYm2610B(0,0x10,0xb0);
    engine.writeYm2610B(0,0x08,0x0e);
    // The first writes have reached the engine before any PCM is available.
    const pending = timeline.read(0);
    assert.equal(pending.frame,-1);
    assert.equal(pending.ssg,null);
    assert.equal(pending.adpcm.adpcmB.rom.size,0);
    assert.equal(timeline.readAdpcmABytes(0),null);
    assert.equal(timeline.readAdpcmBBytes(),null);

    engine.processFrames(4);
    engine.writeYm2610B(0,0x1b,0x80);
    engine.writeYm2610B(1,0,2);
    engine.processFrames(1);
    engine.loadAdpcmRom(1,replacement,0,256);
    engine.writeYm2610B(1,0,0x81);
    engine.processFrames(2);

    const first = timeline.read(3);
    assert.equal(first.ssg.channels[0].level,14);
    assert(first.adpcm.adpcmA.voices[0].keyed);
    assert.equal(first.adpcm.adpcmA.voices[0].lastTriggerFrame,0);
    assert.equal(first.adpcm.adpcmA.voices[1].lastTriggerFrame,null);
    assert.deepEqual(timeline.readAdpcmABytes(0,first.adpcm.adpcmA),initial);
    assert(first.adpcm.adpcmB.keyed && first.adpcm.adpcmB.repeat);
    assert.deepEqual(timeline.readAdpcmBBytes(first.adpcm.adpcmB),initial);

    const level = timeline.read(4);
    const [a1, a2] = level.adpcm.adpcmA.voices;
    assert.deepEqual([a1.start,a1.playbackEnd],[a2.start,a2.playbackEnd]);
    assert.deepEqual([a1.volume,a1.left,a1.right,a1.lastTriggerTime],[17,true,false,0]);
    assert.deepEqual([a2.volume,a2.left,a2.right,a2.lastTriggerTime],[15,false,true,4/48000]);
    assert.deepEqual(timeline.readAdpcmABytes(1,level.adpcm.adpcmA),initial);
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
    assert.equal(reset.ssg,null);
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

function songOutputFixture(t) {
  const {fetch: originalFetch, AudioWorkletNode: OriginalNode} = globalThis;
  const nodes = [];
  globalThis.fetch = async url => new Response(await readFile(url));
  globalThis.AudioWorkletNode = class {
    constructor() { nodes.push(this); }
    sent = 0;
    consumed = 0;
    closed = false;
    disconnected = false;
    ended = false;
    port = {
      postMessage: message => {
        if (message.type === 'pause') {
          queueMicrotask(() => this.emit(this.consumed,{type:'paused'}));
        } else if (message.type === 'enqueue') {
          this.sent += message.left.byteLength / Float32Array.BYTES_PER_ELEMENT;
        } else if (message.type === 'end') {
          this.ended = true;
        }
      },
      close: () => { this.closed = true; },
    };
    disconnect() { this.disconnected = true; }
    emit(frames, extra = {}) {
      this.consumed = frames;
      this.port.onmessage?.({data: {type:'state',consumedFrames:frames,...extra}});
    }
  };
  const errors = [];
  const context = {sampleRate:48000,audioWorklet: {addModule: async () => {}}};
  const transport = createFm2610SongTransport({
    sound: async () => ({context,connectSongOutput() {}}),
    beforePlay() {}, onState() {}, onError: error => errors.push(error),
  });
  t.after(() => {
    transport.clear();
    globalThis.fetch = originalFetch;
    if (OriginalNode) globalThis.AudioWorkletNode = OriginalNode;
    else delete globalThis.AudioWorkletNode;
  });
  return {transport,errors,nodes};
}

const prepareMix = async () => prepareFm2610Vgm(await readSource(new URL('../fixtures/ym2610-mix.vgz',import.meta.url)));

test('FM2610 confines custom ADPCM-A reads to the current paused or retained frame', async t => {
  const {transport,errors,nodes} = songOutputFixture(t);
  const source = await prepareMix();
  const window = {start:0,end:0x100100};
  await transport.play(source,{paused:true});
  const initial = transport.getSnapshot();
  assert.equal(transport.getState().playback,'paused');
  assert.deepEqual(transport.getAdpcmAWindow(initial,0,window),
    {...window,playbackEnd:0x100,rangeValid:true,available:true});
  assert.deepEqual(transport.readAdpcmABytes(initial,0,window),transport.readAdpcmABytes(initial,0));

  transport.resume();
  assert.equal(transport.getSnapshot(),initial);
  assert.equal(transport.readAdpcmABytes(initial,0).length,256);
  assert.equal(transport.getAdpcmAWindow(initial,0,window),null);
  assert.equal(transport.readAdpcmABytes(initial,0,window),null);
  await transport.play(source,{position:.001,paused:true});
  const resumed = transport.getSnapshot();
  assert.notEqual(resumed,initial);
  assert.equal(transport.getAdpcmAWindow(initial,0,window),null);
  assert.equal(transport.readAdpcmABytes(initial,0,window),null);
  assert.equal(transport.readAdpcmABytes(resumed,0,window).length,256);
  transport.stop();
  assert.equal(transport.getSnapshot(),resumed);
  assert.equal(transport.getState().retained,true);
  assert.equal(transport.readAdpcmABytes(resumed,0,window).length,256);
  assert(nodes.at(-1).closed && nodes.at(-1).disconnected);
  assert.deepEqual(errors,[]);
});

test('FM2610 Stop retains the last confirmed output and Play restarts without old readback', async t => {
  const {transport,errors,nodes} = songOutputFixture(t);
  const source = await prepareMix();
  await transport.play(source);
  const node = nodes.at(-1);
  const confirmedFrames = 64;
  assert(node.sent > confirmedFrames);
  node.emit(confirmedFrames);
  const expected = transport.getSnapshot();
  assert.equal(expected.frame,confirmedFrames - 1);
  const expectedBytes = transport.readAdpcmBBytes(expected);
  transport.stop();
  assert.deepEqual(transport.getState(),{
    playback:'stopped', position:confirmedFrames / 48000, snapshot:expected, retained:true,
  });
  assert(node.closed && node.disconnected);
  assert.deepEqual(transport.readAdpcmBBytes(expected),expectedBytes);
  assert.equal(transport.readAdpcmABytes(expected,0).length,256);
  node.emit(node.sent);
  assert.equal(transport.getSnapshot(),expected);
  await transport.play(source);
  assert.deepEqual(transport.getState(),{playback:'playing',position:0,snapshot:null,retained:false});
  assert.equal(transport.readAdpcmBBytes(expected),null);
  assert.notEqual(nodes.at(-1),node);
  assert.deepEqual(errors,[]);
});

test('FM2610 natural end and seek to end retain the final output until Clear', async t => {
  const {transport,errors,nodes} = songOutputFixture(t);
  const source = await prepareMix();
  const duration = source.totalSamples / 44100;
  await transport.play(source);
  const node = nodes.at(-1);
  for (let i = 0; i < 10 && !node.ended; i++) node.emit(node.sent);
  assert(node.ended);
  node.emit(node.sent,{ended:true});
  const ended = transport.getSnapshot();
  assert.equal(ended.frame,node.sent - 1);
  assert.deepEqual(transport.getState(),{playback:'ended', position:duration, snapshot:ended, retained:true});
  assert.equal(transport.readAdpcmBBytes(ended).length,256);
  assert(node.closed && node.disconnected);
  transport.clear();
  assert.deepEqual(transport.getState(),{playback:'stopped',position:0,snapshot:null,retained:false});
  assert.equal(transport.readAdpcmBBytes(ended),null);

  await transport.play(source,{position:duration,paused:true});
  const sought = transport.getSnapshot();
  assert.notEqual(sought,ended);
  assert.equal(sought.frame,ended.frame);
  assert.equal(transport.getState().retained,true);
  assert.equal(transport.readAdpcmABytes(sought,0).length,256);
  assert.equal(nodes.length,1); // Seeking exactly to the end never starts an output node.
  assert.deepEqual(errors,[]);
});
