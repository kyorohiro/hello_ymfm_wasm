// Optional first argument: an audify/index.js file URL. Second: WAV output path.
import {MegaSynthNode} from '../node/megasynth.mjs';
import {FM_PRESETS} from '../web/megasynth-fm-presets.js';
import {encodeWav} from '../web/wav.js';
import {writeFile} from 'node:fs/promises';
const synth = new MegaSynthNode({masterVolume: .03, engineOptions: {looperMode: 'pcm'},
  outputOptions: process.argv[2] ? {moduleUrl: process.argv[2]} : {}});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  await synth.start();
  synth.fx.setChain([synth.fx.delay({time: .12, mix: .2}), synth.fx.reverb({mix: .1})]);
  await synth.fm.setPreset(0, FM_PRESETS.sine); await synth.flush();
  await synth.looper.start(); await synth.looper.startRecording();
  await synth.looper.noteOn(0, 4, 553); await wait(150);
  await synth.looper.noteOff(0); await wait(100);
  const unit = await synth.looper.finishRecording();
  await synth.fm.reset(); await wait(550); // Only the recorded PCM now plays through nativeFX.
  const pcm = await synth.looper.exportAudio(unit.id); // Explicit PCM transfer for WAV export.
  const wavPath = process.argv[3] ?? '/private/tmp/megasynth-pcm-loop.wav';
  await writeFile(wavPath, encodeWav({left: pcm.channels[0], right: pcm.channels[1], sampleRate: pcm.sampleRate}));
  console.log(JSON.stringify({wavPath, unit: unit.audio, state: await synth.getState()}, null, 2));
  await synth.looper.undo(); await synth.stop();
} finally {await synth.close();}
