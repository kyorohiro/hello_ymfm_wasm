import {SOUNDCHIP_MIXER_PRESETS} from '../js/soundchip_mixer_presets.js';
import {ANALYZER_MIXER_DEFAULTS} from './mixer_calibration_data.js';

const canonicalKinds = {psg:'segapsg',gameBoyDmg:'gameboy',nesApu:'nes',segaPcm:'segapcm'};
const measured = new Map(SOUNDCHIP_MIXER_PRESETS.calibrated.factoryDefaults.kinds.map(({name,volume})=>[name,volume]));

function engineTrim(id, configuration) {
  const owner = configuration?.kind === 'mixed'
    ? configuration.parts?.find(part=>part.chips?.includes(id))
    : configuration;
  return owner?.kind === 'ym2612' ? id === 'ym2612' ? .9 : id === 'psg' ? .35 : 1 : 1;
}

/** Fixed reference levels and measured PSG balance; no analysis of the user's music.
 * A renderer may provide its actual downstream trim instead of the UI configuration.
 * Explicit saved gain remains an absolute strip setting, above these defaults.
 * @param {string} id @param {object} [configuration] @param {number} [downstreamTrim]
 */
export function mixerDefaults(id, configuration = undefined, downstreamTrim = undefined) {
  const kind = Object.hasOwn(canonicalKinds,id) ? canonicalKinds[id] : id;
  const volume = Object.hasOwn(ANALYZER_MIXER_DEFAULTS,id) ? ANALYZER_MIXER_DEFAULTS[id] : measured.get(kind);
  // Unknown/unmeasured sources keep unity rather than borrowing another chip's level.
  if(volume === undefined)return {gain:1,pan:0,muted:false};
  const trim = downstreamTrim ?? engineTrim(id,configuration);
  if(!Number.isFinite(trim)||trim<=0)throw new RangeError('Invalid Analyzer output trim');
  const gain = Number((volume/trim).toFixed(6));
  if(!Number.isFinite(gain)||gain<=0||gain>2)throw new RangeError('Analyzer reference gain exceeds the Mixer range');
  return {gain,pan:0,muted:false};
}
