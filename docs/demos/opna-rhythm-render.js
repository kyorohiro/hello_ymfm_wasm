import {Ym2608AudioEngine} from '../js/ym2608audioengine.js';

export const VOICES = ['Bass drum', 'Snare', 'Cymbal', 'Hi-hat', 'Tom', 'Rim shot'];
export const SAMPLE_RATE = 48000;

// A fresh core per voice keeps the resampler phase and ADPCM state identical.
export async function renderRhythmVoice(rom, voice, moduleFactory, moduleOptions) {
  if (!(rom instanceof Uint8Array) || rom.length !== 8192) throw new RangeError('ROMは8192バイト（8 KiB）を指定してください。');
  if (!Number.isInteger(voice) || voice < 0 || voice > 5) throw new RangeError('Invalid voice');
  const engine = await Ym2608AudioEngine.create({ym2608ModuleFactory: moduleFactory,
    ym2608ModuleOptions: {...moduleOptions}, outputSampleRate: SAMPLE_RATE});
  try {
    engine.loadAdpcmARom(rom);
    engine.writeYm2608(0, 0x11, 48);
    engine.writeYm2608(0, 0x18 + voice, 0xc0 | 24);
    engine.writeYm2608(0, 0x10, 1 << voice);
    return engine.processFrames(SAMPLE_RATE); // One second includes the longest voice's tail.
  } finally { engine.dispose(); }
}
