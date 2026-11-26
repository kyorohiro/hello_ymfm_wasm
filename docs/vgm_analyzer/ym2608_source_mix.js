export const YM2608_SOURCE_LABELS = Object.freeze({fm:'FM',ssg:'SSG',rhythm:'Rhythm',adpcm:'ADPCM'});
const ym2610Sources = Object.freeze({fm:'FM',ssg:'SSG',adpcmA:'ADPCM-A',adpcmB:'ADPCM-B'});
export const SOURCE_LABELS = Object.freeze({
  ym2608: YM2608_SOURCE_LABELS,
  ym2610: ym2610Sources,
  'ym2608:2': YM2608_SOURCE_LABELS,
  'ym2610:2': ym2610Sources,
});

export const ym2608SourceDefaults = () => ({gain:1,muted:false});

/** Validate an authored source patch before changing native output or retained settings. */
export function validateYm2608SourceMixPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => key !== 'gain' && key !== 'muted')) {
    throw new TypeError('OPN source settings require gain and/or muted');
  }
  const patch = {...value};
  if (Object.hasOwn(patch,'gain') && (!Number.isFinite(patch.gain) || patch.gain < 0 || patch.gain > 3.8)) {
    throw new RangeError('OPN source gain must be a finite value from 0 to 3.8');
  }
  if (Object.hasOwn(patch,'muted') && typeof patch.muted !== 'boolean') {
    throw new TypeError('OPN source muted must be boolean');
  }
  return patch;
}

/** Scalar source controls before the native chip sum. They do not render PCM
 * or alter registers; the calibrated whole-chip strip remains downstream. */
export class OpnSourceMixer {
  #source;
  #settings;
  #chip;
  #parts;
  constructor(source, chip = 'ym2608') {
    this.#chip = chip;
    this.#parts = Object.keys(SOURCE_LABELS[chip]);
    if (typeof source?.setSourceGains !== 'function') throw new Error(chip.toUpperCase() + ' independent source gains are unavailable; reload the generated runtime.');
    this.#source = source;
    this.#settings = Object.fromEntries(this.#parts.map(part => [part,ym2608SourceDefaults()]));
    this.apply();
  }
  #checkPart(part) {
    if (typeof part !== 'string' || !this.#parts.includes(part)) throw new TypeError('Unknown ' + this.#chip.toUpperCase() + ' source: ' + String(part));
  }
  #apply(settings) {
    const gains = this.#parts.map(part => settings[part].muted ? 0 : settings[part].gain);
    this.#source.setSourceGains(this.#chip === 'ym2610' ? gains :
      Object.fromEntries(this.#parts.map((part,index) => [part,gains[index]])));
  }
  get(part) { this.#checkPart(part); return {...this.#settings[part]}; }
  set(part, value) {
    this.#checkPart(part);
    const next = {...this.#settings,[part]:{...this.#settings[part],...validateYm2608SourceMixPatch(value)}};
    // A stale or rejecting WASM backend must not commit an unapplied setting.
    this.#apply(next);
    this.#settings = next;
    return this.get(part);
  }
  apply() { this.#apply(this.#settings); }
  getState() { return Object.fromEntries(this.#parts.map(part => [part,this.get(part)])); }
}

export {OpnSourceMixer as Ym2608SourceMixer};
