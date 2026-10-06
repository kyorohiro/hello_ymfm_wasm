// Optional argument: audify/index.js file URL from a separate test installation.
import {MegaSynthNode} from '../node/megasynth.mjs';
import {FM_PRESETS} from '../web/megasynth-fm-presets.js';
import {writeFile} from 'node:fs/promises';
const synth = new MegaSynthNode({masterVolume: .03,
  outputOptions: process.argv[2] ? {moduleUrl: process.argv[2]} : {}});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await synth.start();
  synth.fx.setChain([synth.fx.delay({time: .12, mix: .25}), synth.fx.reverb({mix: .15})]);
  await synth.fm.setPreset(0, FM_PRESETS.sine); await synth.flush();
  await synth.recording.start();
  await synth.fm.noteOn(0, 4, 553); await wait(150); await synth.fm.noteOff(0);
  const recording = await synth.recording.stop();
  const recordingPath = process.argv[3] ?? '/private/tmp/megasynth-events.json';
  await writeFile(recordingPath, JSON.stringify(recording, null, 2));
  await synth.recording.import(JSON.parse(JSON.stringify(recording)));
  await synth.recording.play(null, {loop: true}); await wait(350);
  await synth.recording.stopPlayback();
  await synth.looper.start(); await synth.looper.startRecording();
  await synth.looper.noteOn(0, 4, 696); await wait(150); await synth.looper.noteOff(0);
  await synth.looper.finishRecording(); await wait(350);
  console.log(JSON.stringify({recordingPath, commands: recording.commands.length,
    durationSeconds: recording.durationSeconds, looper: await synth.looper.getState(), audio: await synth.getState()}, null, 2));
  await synth.looper.undo(); await synth.stop();
} finally {await synth.close();}
