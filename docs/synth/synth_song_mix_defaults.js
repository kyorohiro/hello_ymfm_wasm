import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';

// Reference playback uses the same absolute source gains as Playground and
// VGM Analyzer. Keep the measured values in their generated shared preset.
const kinds = new Map(SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.map(kind=>[kind.name,kind.volume]));
const sources = {ym2612:'ym2612',psg:'segapsg',pcm:'rf5c164',pwm:'pwm'};

export const SYNTH_SONG_MIX_DEFAULTS = Object.freeze(Object.fromEntries(
  Object.entries(sources).map(([id,kind])=>{
    const gain = kinds.get(kind);
    if (typeof gain!=='number'||!Number.isFinite(gain)||gain<0||gain>3.8) {
      throw new Error(`Missing or invalid calibrated reference source gain: ${kind}`);
    }
    return [id,gain];
  })
));
