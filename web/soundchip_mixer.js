/** Output balance shared by chip factories, synths and analyzer playback.
 * @typedef {{volume: number, pan: number, muted: boolean, solo: boolean, effectiveMuted?: boolean}} ChipMixSettings
 * @typedef {{volume?: number, pan?: number, muted?: boolean, solo?: boolean}} ChipMixOptions
 * @typedef {{id: string, left: number, right: number}} ChipMixMeter
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
/** @param {string} [name] @returns {{volume: number, pan: number, muted: boolean}} */
export function soundChipMixDefaults(name = undefined) {
  return {volume: ['gameboy', 'gameBoyDmg'].includes(name) ? .28 : 1, pan: 0, muted: false};
}
/** @param {string} [name] @returns {ChipMixSettings} */
function stripDefaults(name = undefined) { return {...soundChipMixDefaults(name), solo: false}; }
/** @param {{volume?: number, pan?: number, muted?: boolean, solo?: boolean}} settings */
export function validateChipMix(settings) {
  if (!Number.isFinite(settings.volume) || settings.volume < 0 || settings.volume > 2 ||
      !Number.isFinite(settings.pan) || settings.pan < -1 || settings.pan > 1 || typeof settings.muted !== 'boolean' || (settings.solo !== undefined && typeof settings.solo !== 'boolean')) {
    throw new RangeError('Mixer requires volume 0..2, pan -1..1 and boolean muted/solo');
  }
}
/** Stereo balance: retain the original stereo image at center.
 * @param {{volume: number, pan: number, muted: boolean, effectiveMuted?: boolean}} settings @returns {number[]} */
export function chipMixGains({volume, pan, muted, effectiveMuted}) {
  return (effectiveMuted ?? muted) ? [0, 0] : [volume * (1 - Math.max(0, pan)), volume * (1 + Math.min(0, pan))];
}

// Observers must never interrupt output registration or cleanup.
function dispatchMixerListener(listener, value) {
  try {listener(value);}
  catch (error) {
    if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
    else console.error('SoundChipMixer observer failed:', error);
  }
}

/** Settings can be prepared before start(). Importing this module opens no audio device. */
export class SoundChipMixer {
  constructor() {
    this.entries = new Map(); this.retained = new Map(); this.reservedIds = new Set(); this.transientIds = new Set();
    this.listeners = new Set(); this.meterListeners = new Set();
  }
  /** @param {string} id @param {ChipMixOptions} settings @returns {ChipMixSettings} */
  set(id, settings) {
    this.checkId(id);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(k => !['volume', 'pan', 'muted', 'solo'].includes(k))) throw new TypeError('Unknown mixer setting');
    const entry = this.entries.get(id) ?? this.retained.get(id) ?? {name: id, settings: stripDefaults(id), overrides: {}, apply: null};
    const next = {...entry.settings, ...settings}; validateChipMix(next);
    entry.settings = next; entry.overrides = {...entry.overrides, ...settings};
    this.retained.delete(id); this.entries.set(id, entry); this.applyAll(); this.notify();
    return {...next};
  }
  /** @param {string} id @returns {ChipMixSettings} */
  get(id) { return {...((this.entries.get(id) ?? this.retained.get(id))?.settings ?? stripDefaults(id))}; }
  /** @returns {Array<ChipMixSettings & {id: string, name: string, connected: boolean, effectiveMuted: boolean}>} */
  list() {
    const hasSolo = this.hasSolo();
    return [...this.entries].map(([id, entry]) => ({id, name: entry.name, connected: Boolean(entry.apply), ...entry.settings,
      effectiveMuted: entry.settings.muted || (hasSolo && !entry.settings.solo)}));
  }
  /** Reset settings explicitly, including settings retained for disconnected IDs. @param {string} [id] */
  reset(id = undefined) {
    if (id !== undefined) {
      const entry = this.entries.get(id) ?? this.retained.get(id);
      return this.set(id, stripDefaults(entry?.name ?? id));
    }
    for (const entry of [...this.entries.values(), ...this.retained.values()]) {
      entry.settings = stripDefaults(entry.name); entry.overrides = {...entry.settings};
    }
    this.applyAll(); this.notify();
  }
  hasSolo() { return [...this.entries.values()].some(entry => entry.apply && entry.settings.solo); }
  applyAll() {
    const hasSolo = this.hasSolo();
    for (const entry of this.entries.values()) entry.apply?.({...entry.settings,
      effectiveMuted: entry.settings.muted || (hasSolo && !entry.settings.solo)});
  }
  /** Observe source lifetimes and settings. No audio processing is enabled.
   * @param {(entries: ReturnType<SoundChipMixer['list']>) => void} listener */
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Mixer listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify() { for (const listener of this.listeners) dispatchMixerListener(listener, this.list()); }
  /** Opt into post-trim, pre-FX/master stereo peaks. The last unsubscribe stops measurement.
   * @param {(entries: ChipMixMeter[]) => void} listener */
  subscribeMeters(listener) {
    if (typeof listener !== 'function') throw new TypeError('Mixer meter listener must be a function');
    const wasEnabled = this.meterListeners.size > 0;
    this.meterListeners.add(listener);
    if (!wasEnabled) for (const entry of this.entries.values()) entry.meter?.setMetering(true);
    let released = false;
    return () => {
      if (released) return; released = true; this.meterListeners.delete(listener);
      if (!this.meterListeners.size) for (const entry of this.entries.values()) entry.meter?.setMetering(false);
    };
  }
  /** Endpoint hook for low-frequency aggregated peaks, never PCM. @param {string} id @param {number} left @param {number} right */
  reportMeter(id, left, right) {
    if (!this.meterListeners.size || !this.entries.get(id)?.apply || !Number.isFinite(left) || !Number.isFinite(right)) return;
    const values = [{id, left: Math.max(0, left), right: Math.max(0, right)}];
    for (const listener of this.meterListeners) dispatchMixerListener(listener, values);
  }
  /** Reserve an ID until the initializing endpoint has registered or failed.
   * @param {string} name @param {string} [requested] */
  reserveId(name, requested) {
    const id = allocateSoundChipId(name, requested, key => this.reservedIds.has(key) || Boolean(this.entries.get(key)?.apply));
    this.reservedIds.add(id);
    if (requested === undefined) this.transientIds.add(id);
    let released = false;
    return {id, release: () => {if (released) return; released = true; this.reservedIds.delete(id); if (!this.entries.has(id)) this.transientIds.delete(id);}};
  }
  checkId(id) { if (typeof id !== 'string' || !id.trim()) throw new TypeError('Mixer id must be a nonempty string'); }
  /** Register an output. Release disconnects the endpoint and retains settings only.
   * @param {string} id @param {string} name @param {(settings: ChipMixSettings) => void} apply
   * @param {{setMetering: (enabled: boolean) => void}} [meter] */
  register(id, name, apply, meter = undefined) {
    this.checkId(id);
    if (this.entries.get(id)?.apply) throw new Error(`Mixer id is already connected: ${id}`);
    const previous = this.entries.get(id) ?? this.retained.get(id);
    const entry = {name, settings: {...stripDefaults(name), ...previous?.overrides}, overrides: previous?.overrides ?? {}, apply, meter};
    this.entries.set(id, entry);
    try { this.applyAll(); meter?.setMetering(this.meterListeners.size > 0); }
    catch (error) {this.entries.delete(id); if (previous) this.entries.set(id, previous); this.applyAll(); throw error;}
    this.retained.delete(id); this.notify();
    let released = false;
    return () => {
      if (released || this.entries.get(id) !== entry) return; released = true;
      meter?.setMetering(false); this.entries.delete(id);
      if (!this.transientIds.delete(id)) this.retained.set(id, {name, settings: {...entry.settings}, overrides: {...entry.overrides}, apply: null});
      this.applyAll(); this.notify();
    };
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
    let meterTimer = null, meterNodes = null;
    const setMetering = enabled => {
      if (enabled === Boolean(meterNodes)) return;
      if (!enabled) {
        clearInterval(meterTimer); meterTimer = null;
        left.disconnect(meterNodes.left); right.disconnect(meterNodes.right);
        meterNodes.left.disconnect(); meterNodes.right.disconnect(); meterNodes.sink.disconnect(); meterNodes = null;
        return;
      }
      if (typeof context.createAnalyser !== 'function') return;
      const l = context.createAnalyser(), r = context.createAnalyser(), sink = context.createGain();
      l.fftSize = r.fftSize = 2048; sink.gain.value = 0;
      left.connect(l); right.connect(r); l.connect(sink); r.connect(sink); sink.connect(destination);
      meterNodes = {left: l, right: r, sink};
      const leftBuffer = new Float32Array(l.fftSize), rightBuffer = new Float32Array(r.fftSize);
      meterTimer = setInterval(() => {
        l.getFloatTimeDomainData(leftBuffer); r.getFloatTimeDomainData(rightBuffer);
        let lp = 0, rp = 0;
        for (let i = 0; i < leftBuffer.length; i++) {lp = Math.max(lp, Math.abs(leftBuffer[i])); rp = Math.max(rp, Math.abs(rightBuffer[i]));}
        this.reportMeter(id, lp, rp);
      }, 1000 / 15);
      meterTimer.unref?.();
    };
    let unregister;
    try { unregister = this.register(id, name, update, {setMetering}); }
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
