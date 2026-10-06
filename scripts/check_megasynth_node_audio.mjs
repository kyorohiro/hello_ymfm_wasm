// Optional hardware check; requires audify and an audio output device.
// Args: [audify module file URL] [MegaSynthNode module file URL]
import assert from 'node:assert/strict';
import {FM_PRESETS} from '../web/megasynth-fm-presets.js';
const {MegaSynthNode} = await import(process.argv[3] ?? '../node/megasynth.mjs');
const synth = new MegaSynthNode({masterVolume: .01,
  outputOptions: process.argv[2] ? {moduleUrl: process.argv[2]} : {}});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  for (let cycle = 0; cycle < 2; cycle++) {
    await synth.start();
    const fx = synth.fx;
    fx.setChain([fx.delay({time: .01, mix: .25}), fx.reverb({mix: .15})]);
    await synth.fm.setPreset(0, FM_PRESETS.sine); await synth.flush();
    await synth.fm.noteOn(0, 4, 553);
    const before = await synth.getState();
    const until = performance.now() + 120;
    while (performance.now() < until) {}
    const after = await synth.getState();
    assert.ok(after.output.consumedFrames > before.output.consumedFrames);
    assert.ok(after.peak > .0005); assert.equal(after.sampleRate, 48000);
    await synth.stop();
    const stopped = await synth.getState();
    assert.equal(stopped.output.queuedFrames, 0);
    assert.ok(stopped.maxQueuedFrames <= 512 * 6);
    await synth.resume(); await synth.fm.noteOn(0, 4, 696); await wait(100);
    await synth.stop();
    console.log('PASS hardware cycle', cycle + 1, JSON.stringify(stopped));
    await synth.close(); assert.equal(synth.state, 'closed');
  }
} finally {await synth.close();}
