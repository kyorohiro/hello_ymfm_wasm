export const YM2608_SOURCE_LABELS = Object.freeze({fm:'FM',ssg:'SSG',rhythm:'Rhythm',adpcm:'ADPCM'});
const parts = Object.keys(YM2608_SOURCE_LABELS);

export const ym2608SourceDefaults = () => ({gain:1,muted:false});

/** Validate an authored source patch before changing native output or retained settings. */
export function validateYm2608SourceMixPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => key !== 'gain' && key !== 'muted')) {
    throw new TypeError('YM2608 source settings require gain and/or muted');
  }
  const patch = {...value};
  if (Object.hasOwn(patch,'gain') && (!Number.isFinite(patch.gain) || patch.gain < 0 || patch.gain > 3.8)) {
    throw new RangeError('YM2608 source gain must be a finite value from 0 to 3.8');
  }
  if (Object.hasOwn(patch,'muted') && typeof patch.muted !== 'boolean') {
    throw new TypeError('YM2608 source muted must be boolean');
  }
  return patch;
}

/** Scalar source controls before the native YM2608 sum. They do not render PCM
 * or alter registers; the calibrated whole-chip strip remains downstream. */
export class Ym2608SourceMixer {
  #source;
  #settings;
  constructor(source) {
    if (typeof source?.setSourceGains !== 'function') throw new Error('YM2608 independent source gains are unavailable; reload the generated runtime.');
    this.#source = source;
    this.#settings = Object.fromEntries(parts.map(part => [part,ym2608SourceDefaults()]));
    this.apply();
  }
  #checkPart(part) {
    if (typeof part !== 'string' || !Object.hasOwn(YM2608_SOURCE_LABELS,part)) throw new TypeError('Unknown YM2608 source: ' + String(part));
  }
  #apply(settings) {
    this.#source.setSourceGains(Object.fromEntries(parts.map(part => [part,settings[part].muted ? 0 : settings[part].gain])));
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
  getState() { return Object.fromEntries(parts.map(part => [part,this.get(part)])); }
}
