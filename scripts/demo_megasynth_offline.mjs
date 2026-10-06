// Node 22+: node scripts/demo_megasynth_offline.mjs /private/tmp/megasynth-native-fx.wav
// The Worker owns WASM, DSP, PCM and file output; Main receives metadata only.
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {resolve, dirname} from 'node:path';
import {mkdir, writeFile} from 'node:fs/promises';

if (isMainThread) {
  const output = resolve(process.argv[2] ?? '/private/tmp/megasynth-native-fx.wav');
  const worker = new Worker(new URL(import.meta.url), {workerData: {output}});
  const result = await new Promise((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => {if (code) reject(new Error(`Worker exited: ${code}`));});
  });
  console.log(JSON.stringify(result, null, 2));
} else {
  const {createMegaSynthOffline} = await import('../web/megasynth_offline.js');
  const {FM_PRESETS} = await import('../web/megasynth-fm-presets.js');
  const {encodeWav} = await import('../web/wav.js');
  const synth = await createMegaSynthOffline({sampleRate: 48000, masterVolume: .25});
  try {
    const fx = synth.fx;
    fx.setChain([fx.delay({time: .12, feedback: .3, mix: .25}), fx.reverb({mix: .15})]);
    synth.fm.setPreset(0, FM_PRESETS.sine);
    for (const [index, fnum] of [553, 696, 829].entries()) {
      const frame = index * 14400;
      synth.schedule(frame, {target: 'fm', method: 'noteOn', args: [0, 4, fnum]});
      synth.schedule(frame + 9600, {target: 'fm', method: 'noteOff', args: [0]});
    }
    // Include silence after noteOff so delay/reverb tails can finish.
    const pcm = synth.render(96000);
    const bytes = encodeWav(pcm);
    await mkdir(dirname(workerData.output), {recursive: true});
    await writeFile(workerData.output, bytes);
    parentPort.postMessage({output: workerData.output, sampleRate: synth.sampleRate,
      frames: synth.currentFrame, seconds: synth.currentTime, bytes: bytes.length,
      processing: 'Node Worker: YM2612 WASM → nativeFX WASM → WAV',
      audioContext: typeof globalThis.AudioContext});
  } finally { synth.close(); }
}
