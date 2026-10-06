// Install audify beside the app, then: node scripts/demo_megasynth_node.mjs
// An optional first argument is a file URL to an audify installation for testing.
import {MegaSynthNode} from '../node/megasynth.mjs';
import {FM_PRESETS} from '../web/megasynth-fm-presets.js';
const synth = new MegaSynthNode({masterVolume: .15,
  outputOptions: process.argv[2] ? {moduleUrl: process.argv[2]} : {}});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await synth.start();
  const fx = synth.fx;
  fx.setChain([fx.delay({time: .12, feedback: .3, mix: .25}), fx.reverb({mix: .15})]);
  await synth.fm.setPreset(0, FM_PRESETS.sine); await synth.flush();
  for (const fnum of [553, 696, 829]) {
    await synth.fm.noteOn(0, 4, fnum); await wait(220);
    await synth.fm.noteOff(0); await wait(100);
  }
  await wait(400);
  await synth.stop();
  console.log(JSON.stringify(await synth.getState(), null, 2));
  await synth.resume();
  await synth.fm.noteOn(0, 4, 553); await wait(200); await synth.fm.noteOff(0);
  await synth.stop();
} finally {await synth.close();}
