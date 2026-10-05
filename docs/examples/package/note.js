import {MegaSynth} from 'tetorica-fm2612/megasynth.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';

// Call run() from a click handler to enable browser audio.
export async function run({signal} = {}) {
  const synth = new MegaSynth({masterVolume: 0.25});
  const stop = () => { void synth.close().catch(console.error); };
  signal?.addEventListener('abort', stop, {once: true});
  try {
    signal?.throwIfAborted();
    await synth.start();
    signal?.throwIfAborted();
    synth.fm.setPreset(0, FM_PRESETS.sine);
    synth.fm.noteOn(0, 4, 553); // Channel 0, block 4, F-number 553.
    await new Promise(resolve => setTimeout(resolve, 1000));
    signal?.throwIfAborted();
    synth.fm.noteOff(0);
    await new Promise(resolve => setTimeout(resolve, 150));
  } finally {
    signal?.removeEventListener('abort', stop);
    await synth.close();
  }
}
