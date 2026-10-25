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

const MIXER_POLICY_VERSION = 1;
const MAX_MIXER_KINDS = 128;
const MAX_MIXER_ENTRIES = 512;
const MAX_MIXER_IDENTIFIER = 256;
const MIX_FIELDS = ['volume', 'pan', 'muted', 'solo'];
const COMMON_FIELDS = ['volume', 'pan'];
function policyObject(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !fields.includes(key))) {
    throw new TypeError(`Invalid ${label}`);
  }
}
function policyIdentifier(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_MIXER_IDENTIFIER) {
    throw new TypeError(`${label} must be a nonempty string of at most ${MAX_MIXER_IDENTIFIER} characters`);
  }
  return value;
}
function policySettings(value, fields, label) {
  policyObject(value, fields, label);
  const copy = {...value};
  for (const [key, item] of Object.entries(copy)) {
    if (typeof item !== (['volume', 'pan'].includes(key) ? 'number' : 'boolean')) throw new TypeError(`Invalid ${label}`);
  }
  validateChipMix({...stripDefaults(), ...copy});
  return copy;
}
function parseDefaults(value) {
  policyObject(value, ['version', 'kinds'], 'mixer defaults');
  if (value.version !== MIXER_POLICY_VERSION || !Array.isArray(value.kinds) || value.kinds.length > MAX_MIXER_KINDS) {
    throw new TypeError(`Mixer defaults require version 1 and at most ${MAX_MIXER_KINDS} kinds`);
  }
  const parsed = new Map(), names = new Set();
  for (const record of value.kinds) {
    policyObject(record, ['name', ...COMMON_FIELDS], 'mixer kind default');
    const name = policyIdentifier(record.name, 'Mixer kind');
    if (names.has(name)) throw new TypeError(`Duplicate mixer kind: ${name}`);
    names.add(name);
    const {name: ignored, ...settings} = record;
    const next = policySettings(settings, COMMON_FIELDS, 'mixer kind settings');
    if (Object.keys(next).length) parsed.set(name, next);
  }
  return parsed;
}
function parseState(value) {
  policyObject(value, ['version', 'entries'], 'mixer project state');
  if (value.version !== MIXER_POLICY_VERSION || !Array.isArray(value.entries) || value.entries.length > MAX_MIXER_ENTRIES) {
    throw new TypeError(`Mixer project state requires version 1 and at most ${MAX_MIXER_ENTRIES} entries`);
  }
  const parsed = new Map(), ids = new Set();
  for (const record of value.entries) {
    policyObject(record, ['id', 'name', 'settings'], 'mixer project entry');
    const id = policyIdentifier(record.id, 'Mixer id');
    if (ids.has(id)) throw new TypeError(`Duplicate mixer project id: ${id}`);
    ids.add(id);
    const name = Object.hasOwn(record, 'name') ? policyIdentifier(record.name, 'Mixer kind') : undefined;
    const settings = policySettings(record.settings, MIX_FIELDS, 'mixer project settings');
    if (Object.keys(settings).length) parsed.set(id, {name, settings});
  }
  return parsed;
}
function parseFactoryEntries(value) {
  policyObject(value, ['version', 'entries'], 'mixer factory entries');
  if (value.version !== MIXER_POLICY_VERSION || !Array.isArray(value.entries) || value.entries.length > MAX_MIXER_ENTRIES) {
    throw new TypeError(`Mixer factory entries require version 1 and at most ${MAX_MIXER_ENTRIES} entries`);
  }
  const parsed = new Map(), ids = new Set();
  for (const record of value.entries) {
    policyObject(record, ['id', 'name', 'settings'], 'mixer factory entry');
    const id = policyIdentifier(record.id, 'Mixer id'), name = policyIdentifier(record.name, 'Mixer kind');
    if (ids.has(id)) throw new TypeError(`Duplicate mixer factory id: ${id}`);
    ids.add(id);
    const settings = policySettings(record.settings, COMMON_FIELDS, 'mixer factory settings');
    if (Object.keys(settings).length) parsed.set(id, {name, settings});
  }
  return parsed;
}
function parseFactoryEngines(value) {
  policyObject(value, ['version', 'engines'], 'mixer factory engines');
  if (value.version !== MIXER_POLICY_VERSION || !Array.isArray(value.engines) || value.engines.length > MAX_MIXER_KINDS) {
    throw new TypeError('Mixer factory engines require version 1 and a bounded engine list');
  }
  const parsed = new Map();
  for (const record of value.engines) {
    policyObject(record, ['name', 'engine', ...COMMON_FIELDS], 'mixer factory engine');
    const name = policyIdentifier(record.name, 'Mixer kind'), engine = policyIdentifier(record.engine, 'Mixer engine');
    const engines = parsed.get(name) ?? new Map();
    if (engines.has(engine)) throw new TypeError(`Duplicate mixer factory engine: ${name}/${engine}`);
    const {name: ignoredName, engine: ignoredEngine, ...settings} = record;
    engines.set(engine, policySettings(settings, COMMON_FIELDS, 'mixer factory engine settings'));
    parsed.set(name, engines);
  }
  return parsed;
}
const policyOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Observers must never interrupt output registration or cleanup.
function dispatchMixerListener(listener, value, change = undefined) {
  try {listener(value, change);}
  catch (error) {
    if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
    else console.error('SoundChipMixer observer failed:', error);
  }
}

/** Settings can be prepared before start(). Importing this module opens no audio device. */
/** @typedef {{gainUnits?:'legacy'|'source',factoryDefaults?:{version:number,kinds:Array<{name:string,volume?:number,pan?:number}>},
 * factoryEntries?:{version:number,entries:Array<{id:string,name:string,settings:{volume?:number,pan?:number}}>},
 * factoryEngines?:{version:number,engines:Array<{name:string,engine:string,volume?:number,pan?:number}>}}} SoundChipMixerOptions */
export class SoundChipMixer {
  /** @type {'legacy'|'source'} */
  #gainUnits;
  /** Source units replace a composite endpoint's legacy chip balance.
   * Legacy units preserve existing endpoint behavior for generic consumers.
   * @returns {'legacy'|'source'} */
  get gainUnits() {return this.#gainUnits;}
  /** Application factory policy is optional and never part of authored exports.
   * @param {SoundChipMixerOptions} [options] */
  constructor({gainUnits = 'legacy', factoryDefaults, factoryEntries, factoryEngines} = {}) {
    if(!['legacy','source'].includes(gainUnits))throw new RangeError('Mixer gainUnits must be legacy or source');
    this.#gainUnits = gainUnits;
    const factoryKinds = factoryDefaults === undefined ? new Map() : parseDefaults(factoryDefaults);
    const factoryIds = factoryEntries === undefined ? new Map() : parseFactoryEntries(factoryEntries);
    const engineDefaults = factoryEngines === undefined ? new Map() : parseFactoryEngines(factoryEngines);
    this.entries = new Map(); this.retained = new Map(); this.reservedIds = new Set(); this.transientIds = new Set();
    this.kindDefaults = new Map(); this.deferredState = new Map();
    this.factoryDefaults = factoryKinds; this.factoryEntries = factoryIds;
    this.factoryEngines = engineDefaults;
    this.listeners = new Set(); this.meterListeners = new Set();
  }
  /** @param {string} [name] @param {string} [id] @param {string} [engine] */
  defaults(name, id = undefined, engine = undefined) {
    const factory = this.factoryEntries.get(id);
    return {...stripDefaults(name), ...this.factoryDefaults.get(name), ...this.factoryEngines.get(name)?.get(engine),
      ...(factory?.name === name ? factory.settings : {}), ...this.kindDefaults.get(name)};
  }
  settingsFor(entry) {
    const overrides = entry.overrideName === undefined || entry.overrideName === entry.name ? entry.overrides : {};
    return {...this.defaults(entry.name, entry.id, entry.engine), ...overrides};
  }
  /** Effective common volume/pan, including factory fallbacks.
   * @param {string} name @param {string} [engine] */
  getKindDefault(name, engine = undefined) {
    policyIdentifier(name, 'Mixer kind');
    if (engine !== undefined) policyIdentifier(engine, 'Mixer engine');
    const {volume, pan} = this.defaults(name, undefined, engine);
    return {volume, pan};
  }
  /** Explicit common policy only; mute and solo belong to a project/session. */
  exportDefaults() {
    return {version:MIXER_POLICY_VERSION, kinds:[...this.kindDefaults].sort(([a], [b]) => policyOrder(a, b))
      .map(([name, settings]) => ({name, ...settings}))};
  }
  /** Validate the whole common policy before replacing it. Does not access storage. */
  configureDefaults(value) {
    const next = parseDefaults(value);
    this.kindDefaults = next;
    for (const entry of [...this.entries.values(), ...this.retained.values(), ...this.deferredState.values()]) entry.settings = this.settingsFor(entry);
    this.applyAll(); this.notify();
    return this.exportDefaults();
  }
  setKindDefault(name, settings) {
    policyIdentifier(name, 'Mixer kind');
    const patch = policySettings(settings, COMMON_FIELDS, 'mixer kind settings');
    const next = new Map(this.kindDefaults);
    const merged = {...next.get(name), ...patch};
    if (Object.keys(merged).length) next.set(name, merged);
    return this.configureDefaults({version:MIXER_POLICY_VERSION, kinds:[...next].map(([name, values]) => ({name, ...values}))});
  }
  /** Persist authored overrides for stable IDs, including disconnected sources. */
  exportState() {
    const all = new Map([...this.retained, ...this.deferredState]);
    for (const [id, entry] of this.entries) if (!this.transientIds.has(id)) all.set(id, entry);
    const entries = [...all].filter(([, entry]) => Object.keys(entry.overrides).length)
      .sort(([a], [b]) => policyOrder(a, b)).map(([id, entry]) => {
        const name = entry.overrideName ?? (entry.kindKnown ? entry.name : undefined);
        return {id, ...(name === undefined ? {} : {name}), settings:{...entry.overrides}};
      });
    const state = {version:MIXER_POLICY_VERSION, entries};
    parseState(state);
    return state;
  }
  /** Replace project policy without replacing connected entry objects or routes.
   * Optional kind defaults are validated with the project before one output update. */
  restoreState(value, defaults = undefined) {
    const next = parseState(value);
    const common = defaults === undefined ? undefined : parseDefaults(defaults);
    if (common !== undefined) this.kindDefaults = common;
    this.deferredState.clear();
    for (const [id, entry] of this.entries) {
      if (!entry.apply) {this.entries.delete(id); continue;}
      const transient = this.transientIds.has(id);
      const saved = transient ? undefined : next.get(id);
      entry.overrides = {...saved?.settings};
      entry.overrideName = saved?.name ?? entry.name;
      entry.settings = this.settingsFor(entry);
      if (!transient) next.delete(id);
    }
    this.retained.clear();
    for (const [id, saved] of next) {
      const entry = {id, name:saved.name ?? id, kindKnown:saved.name !== undefined, overrideName:saved.name,
        overrides:{...saved.settings}, apply:null};
      entry.settings = this.settingsFor(entry);
      (this.transientIds.has(id) ? this.deferredState : this.retained).set(id, entry);
    }
    this.applyAll(); this.notify();
    return this.exportState();
  }
  /** @param {string} id @param {ChipMixOptions} settings @returns {ChipMixSettings} */
  set(id, settings) {
    this.checkId(id);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(k => !MIX_FIELDS.includes(k))) throw new TypeError('Unknown mixer setting');
    const entry = this.entries.get(id) ?? this.retained.get(id) ?? {id, name:id, kindKnown:false, overrides:{}, apply:null};
    const overrides = entry.overrideName !== undefined && entry.overrideName !== entry.name ? {} : entry.overrides;
    const authored = {...overrides, ...settings};
    const next = {...this.defaults(entry.name, id, entry.engine), ...authored}; validateChipMix(next);
    entry.settings = next; entry.overrides = authored;
    entry.overrideName = entry.kindKnown ? entry.name : undefined;
    this.retained.delete(id); this.entries.set(id, entry); this.applyAll(); this.notify();
    return {...next};
  }
  /** @param {string} id @returns {ChipMixSettings} */
  get(id) { return {...((this.entries.get(id) ?? this.retained.get(id))?.settings ?? this.defaults(id, id))}; }
  /** @returns {Array<ChipMixSettings & {id: string, name: string, connected: boolean, effectiveMuted: boolean}>} */
  list() {
    const hasSolo = this.hasSolo();
    return [...this.entries].map(([id, entry]) => ({id, name:entry.name, ...(entry.engine === undefined ? {} : {engine:entry.engine}), connected:Boolean(entry.apply), ...entry.settings,
      effectiveMuted:entry.settings.muted || (hasSolo && !entry.settings.solo)}));
  }
  /** Clear authored overrides back to current common/factory defaults. */
  reset(id = undefined) {
    if (id !== undefined) {
      this.checkId(id);
      const entry = this.entries.get(id) ?? this.retained.get(id);
      if (!entry) return this.set(id, {});
      entry.overrides = {}; entry.overrideName = entry.kindKnown ? entry.name : undefined;
      entry.settings = this.settingsFor(entry); this.applyAll(); this.notify();
      return {...entry.settings};
    }
    for (const entry of [...this.entries.values(), ...this.retained.values(), ...this.deferredState.values()]) {
      entry.overrides = {}; entry.overrideName = entry.kindKnown ? entry.name : undefined;
      entry.settings = this.settingsFor(entry);
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
   * Source registration and release identify lifecycle-only notifications so
   * persistence observers can distinguish them from authored settings changes.
   * @param {(entries: ReturnType<SoundChipMixer['list']>, change?: {sourceLifecycle: boolean}) => void} listener */
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Mixer listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  notify(change = undefined) { for (const listener of this.listeners) dispatchMixerListener(listener, this.list(), change); }
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
    const id = allocateSoundChipId(name, requested, key => this.reservedIds.has(key) || Boolean(this.entries.get(key)?.apply) ||
      requested === undefined && (this.entries.has(key) || this.retained.has(key) || this.deferredState.has(key)));
    this.reservedIds.add(id);
    if (requested === undefined) this.transientIds.add(id);
    let released = false;
    return {id, release: () => {if (released) return; released = true; this.reservedIds.delete(id); if (!this.entries.has(id)) this.releaseTransientId(id);}};
  }
  releaseTransientId(id) {
    const transient = this.transientIds.delete(id);
    const pending = this.deferredState.get(id);
    if (transient && pending) {this.deferredState.delete(id); this.retained.set(id, pending);}
    return transient;
  }
  checkId(id) { if (typeof id !== 'string' || !id.trim()) throw new TypeError('Mixer id must be a nonempty string'); }
  /** Register an output. Release disconnects the endpoint and retains settings only.
   * @param {string} id @param {string} name @param {(settings: ChipMixSettings) => void} apply
   * @param {{setMetering: (enabled: boolean) => void}} [meter]
   * @param {{engine?:string}} [identity] Engine selects factory fallbacks, not an extra multiplier or a saved setting. */
  register(id, name, apply, meter = undefined, {engine} = {}) {
    this.checkId(id);
    if (engine !== undefined) policyIdentifier(engine, 'Mixer engine');
    if (this.entries.get(id)?.apply) throw new Error(`Mixer id is already connected: ${id}`);
    const previousEntry = this.entries.get(id), previous = previousEntry ?? (this.transientIds.has(id) ? undefined : this.retained.get(id));
    const entry = {id, name, engine, kindKnown:true, overrides:{...previous?.overrides},
      overrideName:previous?.overrideName ?? (previous?.kindKnown ? previous.name : name), apply, meter};
    entry.settings = this.settingsFor(entry);
    this.entries.set(id, entry);
    try { this.applyAll(); meter?.setMetering(this.meterListeners.size > 0); }
    catch (error) {this.entries.delete(id); if (previousEntry) this.entries.set(id, previousEntry); this.applyAll(); throw error;}
    this.retained.delete(id); this.notify({sourceLifecycle:true});
    let released = false;
    return () => {
      if (released || this.entries.get(id) !== entry) return; released = true;
      meter?.setMetering(false); this.entries.delete(id);
      if (!this.releaseTransientId(id)) {
        const saved = {id, name:entry.overrideName ?? name, engine, kindKnown:true, overrideName:entry.overrideName,
          overrides:{...entry.overrides}, apply:null};
        saved.settings = this.settingsFor(saved); this.retained.set(id, saved);
      }
      this.applyAll(); this.notify({sourceLifecycle:true});
    };
  }
  /** Connect one stereo AudioNode before FX/master. Release disconnects this route only.
   * @param {string} id @param {string} name @param {AudioNode} node @param {AudioNode} destination @param {BaseAudioContext} [context]
   * @param {{engine?:string}} [identity] */
  connect(id, name, node, destination, context = node.context, identity = {}) {
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
    const disconnect = () => {
      // Stop can silence the source before an awaited Keyboard release retires
      // this route. Its splitter is then already detached; the owned graph
      // still needs cleanup without disconnecting any newer source routes.
      try {node.disconnect(splitter);} catch (error) {if(error?.name!=='InvalidAccessError')throw error;}
      splitter.disconnect(); left.disconnect(); right.disconnect(); merger.disconnect();
    };
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
    try { unregister = this.register(id, name, update, {setMetering}, identity); }
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
      // Borrowed views can expose reserved capacity beyond the generated frames.
      // Only fresh samples advance the gain ramp or receive the output trim.
      const frames = method === 'generateStereoInto' ? (args[2] ?? args[0].length)
        : method === 'generateStereoView' ? args[0] : pcm.left.length;
      this.apply(strip, pcm, frames);
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
