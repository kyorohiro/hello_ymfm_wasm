import {GameboyApu} from '../js/gameboyapu.js';
import {GameboySynth, GameboyDirectTransport} from '../js/gameboysynth.js';
import moduleFactory from '../generated/gameboy_apu_wasm.js';

export const DEFAULT_PULSE = Object.freeze({channel: 0, duty: 0.5, note: 'A4', volume: 10});
export const PULSE_SECONDS = 1.5;

export function validatePulse(settings) {
  if (![0, 1].includes(settings.channel) || ![0.125, 0.25, 0.5, 0.75].includes(settings.duty) ||
      !['C4', 'A4', 'C5'].includes(settings.note) || !Number.isInteger(settings.volume) ||
      settings.volume < 1 || settings.volume > 15) throw new RangeError('Invalid Pulse settings');
}

export function pulseSetupCode(settings) {
  validatePulse(settings);
  const {channel, duty, note, volume} = settings;
  return `gb.initialize();
gb.setMasterVolume(3, 3);
gb.pulse.setVoice(${channel}, {
  duty: ${duty}, volume: ${volume},
  envelope: {direction: 'down', period: 0},
});
gb.pulse.setNote(${channel}, '${note}');
gb.pulse.keyOn(${channel});`;
}

export function pulseCode(settings) {
  return `const gb = await useSoundChip('gameboy');
try {
${pulseSetupCode(settings).split('\n').map(line => '  ' + line).join('\n')}
  // sleepはJavaScript側の再生時間。ハードウェアの長さカウンターではない。
  await sleep(${PULSE_SECONDS});
  gb.pulse.keyOff(${settings.channel});
} finally {
  gb.dispose();
}`;
}

/** Render the displayed setup through the shared Synth; the caller owns only PCM. */
export async function renderPulse(settings, {sampleRate = 48000, moduleOptions} = {}) {
  validatePulse(settings);
  const chip = await GameboyApu.create({moduleFactory, moduleOptions, sampleRate});
  const gb = new GameboySynth({transport: new GameboyDirectTransport(chip)});
  try {
    gb.initialize();
    gb.setMasterVolume(3, 3);
    gb.pulse.setVoice(settings.channel, {duty: settings.duty, volume: settings.volume,
      envelope: {direction: 'down', period: 0}});
    gb.pulse.setNote(settings.channel, settings.note);
    gb.pulse.keyOn(settings.channel);
    const pcm = chip.generateStereo(Math.round(sampleRate * PULSE_SECONDS));
    gb.pulse.keyOff(settings.channel);
    return {...pcm, sampleRate};
  } finally {
    gb.dispose();
    chip.dispose();
  }
}
