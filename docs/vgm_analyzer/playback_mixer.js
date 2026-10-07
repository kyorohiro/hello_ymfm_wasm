import {PCMChipMixer, soundChipMixDefaults} from '../js/soundchip_mixer.js';
// Chip output trims, before the existing engine balance, master gain and FX.
// Register writes and synthesis keep advancing even when a strip is muted.
const properties = {
  ym2612: 'ym2612', psg: 'psg', rf5c164: 'pcm', pwm: 'pwm',
  ym2203: 'ym2203', ym2608: 'ym2608', ym2610: 'chip',
  ym2151: 'ym2151', ay8910: 'ay8910', ym2413: 'ym2413',
  y8950: 'y8950', ym3526: 'ym3526', ym3812: 'ym3812',
  ymf262: 'ymf262', ymf278b: 'ymf278b', k051649: 'k051649',
  segaPcm: 'segapcm', gameBoyDmg: 'gameboy',
};
// Analyzer starting balance; callers without a chip ID retain unity gain.
export const mixerDefaults = id => {
  const {volume, ...settings} = soundChipMixDefaults(id);
  return {gain: volume, ...settings};
};

// Preserve Analyzer's existing gain-facing API while sharing rendering and defaults.
export class PlaybackMixer extends PCMChipMixer {
  set(id, {gain, ...settings}) { super.set(id, {...settings, ...(gain === undefined ? {} : {volume: gain})}); }
  get(id) { const {volume, ...settings} = super.get(id); return {gain: volume, ...settings}; }
}

export function installPlaybackMixer(engine, configuration) {
  const mixer = new PlaybackMixer();
  const visit = (part, ids) => {
    if (part.mixerEngine) return visit(part.mixerEngine, ids);
    if (part.entries instanceof Map) {
      for (const [key, entry] of part.entries) {
        const type = key.split(':')[0];
        const subset = configuration.parts?.find(p => p.id === type)?.chips ??
          ids.filter(id => id === type);
        visit(entry.engine, subset);
      }
      return;
    }
    let found = false;
    for (const id of ids) {
      const source = part[properties[id]];
      if (!source) continue;
      const method = typeof source.generateStereoInto === 'function' ? 'generateStereoInto' : 'generateStereo';
      if (typeof source[method] !== 'function') continue;
      mixer.addSource(id, source, method, part.chipRate ?? part.chipSampleRate ?? part._chipSampleRate ?? part.sampleRate());
      found = true;
    }
    // NES, HuC6280 and OKI render directly rather than through a chip wrapper.
    if (!found && ids.length === 1) mixer.addSource(ids[0], part, 'processFrames', part.sampleRate());
  };
  visit(engine, configuration.chips.map(c => c.id).filter(id =>
    !(id === 'okim6258' && !engine.writeOki6258) && !(id === 'okim6295' && !engine.writeOki6295)));
  const reset = engine.reset.bind(engine);
  engine.reset = () => {reset(); mixer.reset();};
  if (engine.stateSettingsKey) {
    const key = engine.stateSettingsKey.bind(engine);
    engine.stateSettingsKey = () => JSON.stringify([key(), [...mixer.strips].map(([id, strip]) => [id, strip.settings])]);
  }
  engine.playbackMixer = mixer;
  return mixer;
}
