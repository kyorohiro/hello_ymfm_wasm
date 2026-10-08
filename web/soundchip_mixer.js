/** Output balance shared by chip factories, synths and analyzer playback.
 * @typedef {{volume: number, pan: number, muted: boolean}} ChipMixSettings
 * @typedef {{volume?: number, pan?: number, muted?: boolean}} ChipMixOptions
 */
let chipIdSequence = 0;
/** Allocate synchronously, before asynchronous chip initialization can overlap.
 * @param {string} name @param {string} [requested] @param {(id:string)=>boolean} [occupied]
 */
export function allocateSoundChipId(name, requested, occupied = () => false) {
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !requested.trim()) throw new TypeError('Mixer id must be a nonempty string');
    if (occupied(requested)) throw new Error(`Mixer id is already connected or initializing: ${requested}`);
    return requested;
  }
  let id;
  do {id = `${name}:${++chipIdSequence}`;} while (occupied(id));
  return id;
}
/** @param {string} [name] @returns {ChipMixSettings} */
export function soundChipMixDefaults(name = undefined) {
  return {volume: ['gameboy', 'gameBoyDmg'].includes(name) ? .28 : 1, pan: 0, muted: false};
}
/** @param {{volume?: number, pan?: number, muted?: boolean}} settings */
export function validateChipMix(settings) {
  if (!Number.isFinite(settings.volume) || settings.volume < 0 || settings.volume > 2 ||
      !Number.isFinite(settings.pan) || settings.pan < -1 || settings.pan > 1 || typeof settings.muted !== 'boolean') {
    throw new RangeError('Mixer requires volume 0..2, pan -1..1 and a boolean muted');
  }
}
/** Stereo balance: retain the original stereo image at center.
 * @param {ChipMixSettings} settings @returns {number[]} */
export function chipMixGains({volume, pan, muted}) {
  return muted ? [0, 0] : [volume * (1 - Math.max(0, pan)), volume * (1 + Math.min(0, pan))];
}

/** Settings can be prepared before start(). Importing this module opens no audio device. */
export class SoundChipMixer {
  constructor() { this.entries = new Map(); this.reservedIds = new Set(); }
  /** @param {string} id @param {ChipMixOptions} settings @returns {ChipMixSettings} */
  set(id, settings) {
    this.checkId(id);
    if (!settings || typeof settings !== 'object' || Object.keys(settings).some(k => !['volume', 'pan', 'muted'].includes(k))) throw new TypeError('Unknown mixer setting');
    const entry = this.entries.get(id) ?? {name: id, settings: soundChipMixDefaults(id), apply: null};
    const next = {...entry.settings, ...settings}; validateChipMix(next);
    entry.apply?.(next); entry.settings = next; entry.overrides = {...entry.overrides, ...settings}; this.entries.set(id, entry);
    return {...next};
  }
  /** @param {string} id @returns {ChipMixSettings} */
  get(id) { return {...(this.entries.get(id)?.settings ?? soundChipMixDefaults(id))}; }
  /** @returns {Array<ChipMixSettings & {id: string, name: string, connected: boolean}>} */
  list() { return [...this.entries].map(([id, entry]) => ({id, name: entry.name, connected: Boolean(entry.apply), ...entry.settings})); }
  /** @param {string} [id] */
  reset(id = undefined) {
    if (id !== undefined) return this.set(id, soundChipMixDefaults(this.entries.get(id)?.name ?? id));
    for (const [key, entry] of this.entries) this.set(key, soundChipMixDefaults(entry.name));
  }
  /** Reserve an ID until the initializing endpoint has registered or failed.
   * @param {string} name @param {string} [requested] */
  reserveId(name, requested) {
    const id = allocateSoundChipId(name, requested, key => this.reservedIds.has(key) || Boolean(this.entries.get(key)?.apply));
    this.reservedIds.add(id);
    let released = false;
    return {id, release: () => {if (released) return; released = true; this.reservedIds.delete(id);}};
  }
  checkId(id) { if (typeof id !== 'string' || !id.trim()) throw new TypeError('Mixer id must be a nonempty string'); }
  /** Register an output. The returned release only unregisters this connection.
   * @param {string} id @param {string} name @param {(settings: ChipMixSettings) => void} apply */
  register(id, name, apply) {
    this.checkId(id);
    if (this.entries.get(id)?.apply) throw new Error(`Mixer id is already connected: ${id}`);
    const previous = this.entries.get(id);
    const entry = {name, settings: {...soundChipMixDefaults(name), ...previous?.overrides}, overrides: previous?.overrides ?? {}, apply};
    apply(entry.settings); this.entries.set(id, entry);
    return () => { if (this.entries.get(id) === entry) this.entries.delete(id); };
  }
  /** Connect one stereo AudioNode before FX/master. Release disconnects this route only.
   * @param {string} id @param {string} name @param {AudioNode} node @param {AudioNode} destination @param {BaseAudioContext} [context] */
  connect(id, name, node, destination, context = node.context) {
    const left = context.createGain(), right = context.createGain();
    const splitter = context.createChannelSplitter(2), merger = context.createChannelMerger(2);
    node.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1);
    left.connect(merger, 0, 0); right.connect(merger, 0, 1); merger.connect(destination);
    let initialized = false;
    const update = settings => {
      const gains = chipMixGains(settings);
      [left, right].forEach((gain, i) => {
        const param = gain.gain, now = context.currentTime;
        if (!initialized) param.value = gains[i];
        else {
          param.cancelAndHoldAtTime?.(now);
          if (!param.cancelAndHoldAtTime) {param.cancelScheduledValues(now); param.setValueAtTime(param.value, now);}
          param.linearRampToValueAtTime(gains[i], now + .005);
        }
      });
      initialized = true;
    };
    const disconnect = () => {node.disconnect(splitter); splitter.disconnect(); left.disconnect(); right.disconnect(); merger.disconnect();};
    let unregister;
    try { unregister = this.register(id, name, update); }
    catch (error) {disconnect(); throw error;}
    let released = false;
    return () => {if (released) return; released = true; unregister(); disconnect();};
  }
}

/** Synchronous per-source PCM trims. Advances muted sources and ramps over 5 ms. */
export class PCMChipMixer {
  constructor() { this.strips = new Map(); }
  addSource(id, source, method = 'generateStereo', rate = 44100) {
    if (this.strips.has(id)) throw new Error(`Duplicate mixer source: ${id}`);
    if (typeof source?.[method] !== 'function') throw new Error(`Missing mixer renderer: ${id}`);
    // Raw PCM stays at unity unless the owning application selects a balance.
    const strip = {settings: soundChipMixDefaults(), left: 1, right: 1, remaining: 0, rate};
    this.strips.set(id, strip);
    const render = source[method].bind(source);
    source[method] = (...args) => {
      const result = render(...args);
      const pcm = method === 'generateStereoInto' ? {left: args[0], right: args[1]} : result;
      this.apply(strip, pcm, method === 'generateStereoInto' ? (args[2] ?? args[0].length) : pcm.left.length);
      return result;
    };
  }
  set(id, settings) {
    const strip = this.strips.get(id);
    if (!strip) throw new Error(`Unknown mixer source: ${id}`);
    const next = {...strip.settings, ...settings}; validateChipMix(next);
    strip.settings = next; strip.remaining = Math.max(1, Math.round(strip.rate * .005));
  }
  get(id) { return {...this.strips.get(id)?.settings}; }
  reset() {
    for (const strip of this.strips.values()) {
      [strip.left, strip.right] = chipMixGains(strip.settings); strip.remaining = 0;
    }
  }
  apply(strip, pcm, frames) {
    const [left, right] = chipMixGains(strip.settings);
    if (!strip.remaining && left === 1 && right === 1) return;
    for (let i = 0; i < frames; i++) {
      if (strip.remaining) {
        strip.left += (left - strip.left) / strip.remaining;
        strip.right += (right - strip.right) / strip.remaining; strip.remaining--;
      }
      pcm.left[i] *= strip.left; pcm.right[i] *= strip.right;
    }
  }
}
