import {SOUNDCHIP_MIXER_PRESETS, SOUNDCHIP_MIXER_LISTENING_LEVELS} from '../js/soundchip_mixer_presets.js';
import {ANALYZER_MIXER_DEFAULTS} from './mixer_calibration_data.js';

const canonicalKinds = {psg:'segapsg',gameBoyDmg:'gameboy',nesApu:'nes',segaPcm:'segapcm'};
const measured = new Map(SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.map(({name,volume})=>[name,volume]));

/** Legacy engine balance used only to interpret saved renderer-relative gains. */
export function legacyEngineTrim(id, configuration) {
  const owner = configuration?.kind === 'mixed'
    ? configuration.parts?.find(part=>part.chips?.includes(id))
    : configuration;
  return owner?.kind === 'ym2612' ? id === 'ym2612' ? .9 : id === 'psg' ? .35 : 1 : 1;
}

/** Absolute source levels with explicit listening levels; no analysis of the user's music.
 * Legacy callers may still pass a trim, but it never changes these source-unit defaults.
 * Explicit saved gain remains an absolute strip setting, above these defaults.
 * @param {string} id @param {object} [configuration] @param {number} [downstreamTrim]
 */
export function mixerDefaults(id, configuration = undefined, downstreamTrim = undefined) {
  const kind = Object.hasOwn(canonicalKinds,id) ? canonicalKinds[id] : id;
  const volume = Object.hasOwn(SOUNDCHIP_MIXER_LISTENING_LEVELS,kind) ? SOUNDCHIP_MIXER_LISTENING_LEVELS[kind]
    : Object.hasOwn(ANALYZER_MIXER_DEFAULTS,id) ? ANALYZER_MIXER_DEFAULTS[id] : measured.get(kind);
  // Unknown/unmeasured sources keep unity rather than borrowing another chip's level.
  if(volume === undefined)return {gain:1,pan:0,muted:false};
  if(downstreamTrim!==undefined&&(!Number.isFinite(downstreamTrim)||downstreamTrim<=0))throw new RangeError('Invalid Analyzer output trim');
  const gain = volume;
  if(!Number.isFinite(gain)||gain<=0||gain>2)throw new RangeError('Analyzer reference gain exceeds the Mixer range');
  return {gain,pan:0,muted:false};
}
