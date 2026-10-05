import {MegaSynth} from 'tetorica-fm2612/megasynth.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';

export async function run({signal} = {}) {
  const synth = new MegaSynth({masterVolume: 0.25});
  const stop = () => { void synth.close().catch(console.error); };
  signal?.addEventListener('abort', stop, {once: true});
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    signal?.throwIfAborted();
    await synth.start();
    signal?.throwIfAborted();
    synth.fm.setPreset(0, FM_PRESETS['two-op-bell']);
    // YM2612 F-numbers for C, D, E, G and C in the next block.
    for (const [block, fnum] of [[4, 617], [4, 693], [4, 778], [4, 925], [5, 617]]) {
      signal?.throwIfAborted();
      synth.fm.noteOn(0, block, fnum);
      await sleep(220);
      signal?.throwIfAborted();
      synth.fm.noteOff(0);
      await sleep(80);
    }
    await sleep(300);
  } finally {
    signal?.removeEventListener('abort', stop);
    await synth.close();
  }
}
