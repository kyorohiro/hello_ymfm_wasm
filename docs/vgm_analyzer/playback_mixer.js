import {PCMChipMixer, chipMixGains} from '../js/soundchip_mixer.js';
import {mixerDefaults} from './mixer_defaults.js';
export {mixerDefaults} from './mixer_defaults.js';
// Absolute chip gains, before engine master gain and FX.
// Register writes and synthesis keep advancing even when a strip is muted.
const properties = {
  ym2612: 'ym2612', psg: 'psg', rf5c164: 'pcm', pwm: 'pwm',
  ym2203: 'ym2203', ym2608: 'ym2608', ym2610: 'chip',
  ym2151: 'ym2151', ay8910: 'ay8910', ym2413: 'ym2413',
  y8950: 'y8950', ym3526: 'ym3526', ym3812: 'ym3812',
  ymf262: 'ymf262', ymf278b: 'ymf278b', k051649: 'k051649',
  segaPcm: 'segapcm', gameBoyDmg: 'gameboy',
};
// Preserve Analyzer's existing gain-facing API while sharing rendering and defaults.
export class PlaybackMixer extends PCMChipMixer {
  constructor(configuration) { super(); this.configuration = configuration; }
  addSource(id, source, method = 'generateStereo', rate = 44100, downstreamTrim = undefined) {
    const trim=downstreamTrim??1;
    if(!Number.isFinite(trim)||trim<=0)throw new RangeError('Invalid Analyzer output trim');
    super.addSource(id, source, method, rate);
    const strip = this.strips.get(id);
    strip.downstreamTrim=trim;
    this.set(id, mixerDefaults(id, this.configuration));
    // A newly connected source starts at its measured level immediately.
    // Do not reset another source's in-flight user gain/pan ramp.
    [strip.left, strip.right] = chipMixGains(strip.settings);
    strip.remaining = 0;
  }
  apply(strip,pcm,frames) {
    const trim=strip.downstreamTrim??1;
    if(trim===1)return super.apply(strip,pcm,frames);
    // Keep the public setting and ramp in source units. Cancel only this
    // application's legacy downstream engine balance in the same PCM pass.
    const [left,right]=chipMixGains(strip.settings);
    for(let i=0;i<frames;i++) {
      if(strip.remaining) {
        strip.left+=(left-strip.left)/strip.remaining;
        strip.right+=(right-strip.right)/strip.remaining;strip.remaining--;
      }
      pcm.left[i]*=strip.left/trim;pcm.right[i]*=strip.right/trim;
    }
  }
  set(id, {gain, ...settings}) { super.set(id, {...settings, ...(gain === undefined ? {} : {volume: gain})}); }
  get(id) { const {volume, ...settings} = super.get(id); return {gain: volume, ...settings}; }
}

export function installPlaybackMixer(engine, configuration) {
  const mixer = new PlaybackMixer(configuration);
  const visit = (part, ids) => {
    if (part.mixerEngine) return visit(part.mixerEngine, ids);
    if (Array.isArray(part.playbackMixerSources)) {
      for(const {id,source,method,rate} of part.playbackMixerSources)mixer.addSource(id,source,method,rate,1);
      return;
    }
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
    const genesis = Boolean(part.ym2612 && typeof part.writeYm2612 === 'function');
    for (const id of ids) {
      const source = part[properties[id]];
      if (!source) continue;
      // OPNA's engine consumes borrowed PCM views; its copying renderer is not
      // on the playback path. Other engines still consume Stereo/Into.
      const method = id === 'ym2608' && typeof source.generateStereoView === 'function' ? 'generateStereoView'
        : typeof source.generateStereoInto === 'function' ? 'generateStereoInto' : 'generateStereo';
      if (typeof source[method] !== 'function') continue;
      const downstreamTrim = genesis ? id === 'ym2612' ? 0.9 : id === 'psg' ? 0.35 : 1 : 1;
      mixer.addSource(id, source, method, part.chipRate ?? part.chipSampleRate ?? part._chipSampleRate ?? part.sampleRate(), downstreamTrim);
      found = true;
    }
    // NES, HuC6280 and OKI render directly rather than through a chip wrapper.
    if (!found && ids.length === 1) mixer.addSource(ids[0], part, 'processFrames', part.sampleRate(), 1);
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
