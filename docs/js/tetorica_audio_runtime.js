import * as fx from "./megasynth_fx.js";

/**
 * Chip-independent browser audio state shared by Tetorica synths.
 *
 * Routing behavior is migrated here incrementally; this first version owns
 * the mutable state so chip synths can compose it without changing callers.
 */
export class TetoricaAudioRuntime {
  constructor(options = {}) {
    this.ownsAudioContext = !options.audioContext;
    this.audioContext = options.audioContext ?? null;
    this.outputNode = options.outputNode ?? null;
    this.sampleOutputNode = options.sampleOutputNode ?? null;
    this.masterVolume = options.masterVolume ?? 1;
    this.masterInputNode = null;
    this.masterOutputNode = null;
    this.fxChain = [];
    this.sampleBuffers = new Map();
    this.sampleVoices = new Set();
    this.streamEntries = new Map();
    this.noiseVoices = new Set();
    this.audioHandles = new Map();
    this.sample = null;
    this.stream = null;
    this.noise = null;
  }

  setMediaApis(sample, stream) {
    this.sample = sample;
    this.stream = stream;
  }

  stopSample(name) {
    for (const voice of this.sampleVoices) {
      if (name == null || voice.name === String(name)) voice.stop();
    }
  }

  unloadSample(name) {
    const normalizedName = String(name);
    this.stopSample(normalizedName);
    return this.sampleBuffers.delete(normalizedName);
  }

  storeSample(name, buffer) {
    this.sampleBuffers.set(name, buffer);
    return buffer;
  }

  getSample(name) {
    return this.sampleBuffers.get(String(name)) ?? null;
  }

  hasSample(name) {
    return this.sampleBuffers.has(String(name));
  }

  listSamples() {
    return Array.from(this.sampleBuffers.keys());
  }

  createSampleApi(options = {}) {
    return {
      load: (name, source) =>
        this.loadSample(name, source, options),
      play: (name, playOptions = {}) =>
        this.playSample(name, playOptions),
      stop: (name) =>
        this.stopSample(name),
      stopAll: () =>
        this.stopSample(),
      unload: (name) =>
        this.unloadSample(name),
      isLoaded: (name) =>
        this.hasSample(name),
      get: (name) =>
        this.getSample(name),
      list: () =>
        this.listSamples(),
    };
  }

  createStreamApi(options = {}) {
    return {
      load: (name, url) =>
        this.loadStream(name, url, options),
      play: (name, playOptions = {}) =>
        this.playStream(name, playOptions, options),
      pause: (name) =>
        this.pauseStream(name),
      stop: (name) =>
        this.stopStream(name),
      unload: (name) =>
        this.unloadStream(name),
      isLoaded: (name) =>
        this.streamEntries.has(String(name)),
      get: (name) =>
        this.streamEntries.get(String(name)) ?? null,
      list: () =>
        Array.from(this.streamEntries.keys()),
    };
  }

  createNoiseApi() {
    if (this.noise) return this.noise;

    this.noise = {
      create: (options = {}) => this.createNoiseVoice(options),
      stopAll: () => this.stopNoise(),
    };
    return this.noise;
  }

  createFXApi(options = {}) {
    if (!this.audioContext) throw new Error("Audio is not ready yet");

    const withBeatSeconds = (fxOptions = {}) => ({
      ...fxOptions,
      getBeatSeconds: options.getBeatSeconds ?? (() => 0.5),
    });
    const context = this.audioContext;
    return {
      gain: (fxOptions = {}) => fx.createGainFX(context, fxOptions),
      eq: (fxOptions = {}) => fx.createEqFX(context, fxOptions),
      radioTone: (fxOptions = {}) => fx.createRadioToneFX(context, fxOptions),
      lofi: (fxOptions = {}) => fx.createLofiFX(context, fxOptions),
      stereoWidth: (fxOptions = {}) => fx.createStereoWidthFX(context, fxOptions),
      bitcrusher: (fxOptions = {}) => fx.createBitcrusherFX(context, fxOptions),
      filter: (fxOptions = {}) => fx.createFilterFX(context, fxOptions),
      delay: (fxOptions = {}) => fx.createDelayFX(context, fxOptions),
      distortion: (fxOptions = {}) => fx.createDistortionFX(context, fxOptions),
      compressor: (fxOptions = {}) => fx.createCompressorFX(context, fxOptions),
      gate: (fxOptions = {}) => fx.createGateFX(context, fxOptions),
      wobble: (fxOptions = {}) => fx.createWobbleFX(context, withBeatSeconds(fxOptions)),
      flanger: (fxOptions = {}) => fx.createFlangerFX(context, withBeatSeconds(fxOptions)),
      chorus: (fxOptions = {}) => fx.createChorusFX(context, withBeatSeconds(fxOptions)),
      tapeSaturation: (fxOptions = {}) => fx.createTapeSaturationFX(context, fxOptions),
      reverb: (fxOptions = {}) => fx.createReverbFX(context, fxOptions),
      branch: (...effects) => fx.createFXBranch(...effects),
      parallel: (...branches) => fx.createFXParallel(context, ...branches),
      slicer: (fxOptions = {}) => fx.createSlicerFX(context, withBeatSeconds(fxOptions)),
      setChain: (effects = []) => {
        this.setFXChain(effects);
        return effects;
      },
      clear: (fxOptions = {}) => this.clearFXChain(fxOptions),
    };
  }

  setAudioHandle(id, value) {
    this.disposeAudioHandle(id);
    this.audioHandles.set(String(id), value);
    return value;
  }

  getAudioHandle(id) {
    return this.audioHandles.get(String(id)) ?? null;
  }

  disposeAudioHandle(id) {
    const key = String(id);
    const value = this.audioHandles.get(key);
    value?.dispose?.();
    this.audioHandles.delete(key);
  }

  disposeAudioHandles(ids = this.audioHandles.keys()) {
    for (const id of [...ids]) this.disposeAudioHandle(id);
  }

  createNoiseVoice(options = {}) {
    const audioContext = this.audioContext;
    if (!audioContext) {
      throw new Error("noise.create() requires MegaSynth to be initialized first");
    }

    const attackSeconds = clampNumber(options.attack, 0, 0, 60);
    const releaseSeconds = clampNumber(options.release, 0, 0, 60);
    const targetGain = clampNumber(options.gain, 0.3, 0, 8);
    const gainNode = audioContext.createGain();
    const filterNode = audioContext.createBiquadFilter();
    const hasStereoPanner = typeof audioContext.createStereoPanner === "function";
    const pannerNode = hasStereoPanner ? audioContext.createStereoPanner() : audioContext.createGain();

    filterNode.type = "lowpass";
    filterNode.frequency.value = 1600;
    filterNode.Q.value = 0.2;
    gainNode.gain.value = attackSeconds > 0 ? 0 : targetGain;
    if (hasStereoPanner) pannerNode.pan.value = clampNumber(options.pan, 0, -1, 1);

    filterNode.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(this.mediaOutputNode());

    const voice = {
      type: normalizeNoiseType(options.type),
      attack: createSimpleParamControl(
        () => voice.attackSeconds,
        (value) => (voice.attackSeconds = clampNumber(value, voice.attackSeconds, 0, 60))
      ),
      release: createSimpleParamControl(
        () => voice.releaseSeconds,
        (value) => (voice.releaseSeconds = clampNumber(value, voice.releaseSeconds, 0, 60))
      ),
      gain: createAudioParamControl(audioContext, gainNode.gain, { min: 0, max: 8 }),
      pan: hasStereoPanner
        ? createAudioParamControl(audioContext, pannerNode.pan, { min: -1, max: 1 })
        : createFixedParamControl(),
      filter: {
        set(type, frequency, q = filterNode.Q.value) {
          filterNode.type = String(type);
          voice.filter.cutoff.set(frequency);
          voice.filter.q.set(q);
        },
        cutoff: createAudioParamControl(audioContext, filterNode.frequency, { min: 10, max: 20000 }),
        q: createAudioParamControl(audioContext, filterNode.Q, { min: 0.0001, max: 1000 }),
      },
      start: () => {
        if (voice.disposed) throw new Error("noise voice has already been disposed");
        if (voice.source) return;

        const source = audioContext.createBufferSource();
        source.buffer = createNoiseBuffer(audioContext, voice.type);
        source.loop = true;
        source.connect(filterNode);
        source.addEventListener("ended", () => {
          if (voice.source === source) voice.source = null;
          try { source.disconnect(); } catch {}
        }, { once: true });
        voice.source = source;

        const now = audioContext.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        if (voice.attackSeconds > 0) {
          gainNode.gain.setValueAtTime(0, now);
          gainNode.gain.linearRampToValueAtTime(voice.gain.get(), now + voice.attackSeconds);
        } else {
          gainNode.gain.setValueAtTime(voice.gain.get(), now);
        }
        source.start();
      },
      stop: () => {
        if (!voice.source) return;
        const source = voice.source;
        voice.source = null;
        const now = audioContext.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        if (voice.releaseSeconds > 0) {
          gainNode.gain.linearRampToValueAtTime(0, now + voice.releaseSeconds);
          source.stop(now + voice.releaseSeconds);
        } else {
          source.stop();
        }
      },
      dispose: () => {
        if (voice.disposed) return;
        voice.stop();
        voice.disposed = true;
        this.noiseVoices.delete(voice);
        try { filterNode.disconnect(); } catch {}
        try { gainNode.disconnect(); } catch {}
        try { pannerNode.disconnect(); } catch {}
      },
      source: null,
      disposed: false,
      attackSeconds,
      releaseSeconds,
    };

    this.noiseVoices.add(voice);
    if (options.autoStart !== false) voice.start();
    return voice;
  }

  stopNoise() {
    for (const voice of this.noiseVoices) voice.stop();
  }

  disposeNoise() {
    for (const voice of [...this.noiseVoices]) voice.dispose();
  }

  mediaOutputNode() {
    return this.sampleOutputNode ?? this.masterInputNode ?? this.outputNode ?? this.audioContext.destination;
  }

  async loadSample(name, source, options = {}) {
    if (
      source === undefined &&
      typeof name === "string"
    ) {
      source = name;
    }

    if (
      typeof source === "string" &&
      (
        typeof name !== "string" ||
        name.length === 0 ||
        name === source
      )
    ) {
      name = source;
    }

    if (
      typeof name !== "string" ||
      name.length === 0
    ) {
      throw new Error(
        "sample.load(source) or sample.load(name, source) requires a non-empty name"
      );
    }

    const audioContext =
      this.audioContext ??
      options.createAudioContext?.();

    if (!audioContext) {
      throw new Error(
        "sample.load() requires an AudioContext factory"
      );
    }

    if (!this.audioContext) {
      this.audioContext = audioContext;
      this.ownsAudioContext = true;
    }

    let audioBuffer = null;

    if (
      typeof AudioBuffer !== "undefined" &&
      source instanceof AudioBuffer
    ) {
      audioBuffer = source;
    } else if (typeof source === "string") {
      const normalizedSourceUrl =
        normalizeLocalMediaUrl(
          source
        );
      if (!NATIVE_FETCH) {
        throw new Error(
          "sample.load() requires fetch support"
        );
      }
      const response =
        await NATIVE_FETCH(
          normalizedSourceUrl
        );

      if (!response.ok) {
        throw new Error(
          `Failed to load sample "${name}": ${response.status} ${response.statusText}`
        );
      }

      const arrayBuffer =
        await response.arrayBuffer();
      audioBuffer =
        await decodeAudioBuffer(
          audioContext,
          arrayBuffer
        );
    } else if (source instanceof ArrayBuffer) {
      audioBuffer =
        await decodeAudioBuffer(
          audioContext,
          source
        );
    } else {
      throw new Error(
        "sample.load(source) or sample.load(name, source) source must be a URL string, ArrayBuffer, or AudioBuffer"
      );
    }

    return this.storeSample(name, audioBuffer);
  }

  playSample(name, options = {}) {
    if (!this.audioContext) {
      throw new Error(
        "sample.play() requires MegaSynth to be initialized first"
      );
    }

    const buffer = this.getSample(name);

    if (!buffer) {
      throw new Error(
        `Unknown sample: ${name}`
      );
    }

    const source =
      this.audioContext.createBufferSource();
    source.buffer = buffer;

    const gainNode =
      this.audioContext.createGain();
    const stereoPannerSupported =
      typeof this.audioContext
        .createStereoPanner ===
      "function";
    const pannerNode =
      stereoPannerSupported
        ? this.audioContext.createStereoPanner()
        : this.audioContext.createGain();

    const playbackRate =
      normalizeFiniteNumber(
        options.playbackRate,
        1
      );
    const gain =
      normalizeFiniteNumber(
        options.gain,
        1
      );
    const offset =
      Math.max(
        0,
        normalizeFiniteNumber(
          options.offset,
          0
        )
      );
    const duration =
      options.duration == null
        ? null
        : Math.max(
            0,
            normalizeFiniteNumber(
              options.duration,
              0
            )
          );
    const fadeIn =
      Math.max(
        0,
        normalizeFiniteNumber(
          options.fadeIn,
          0
        )
      );
    const fadeOut =
      Math.max(
        0,
        normalizeFiniteNumber(
          options.fadeOut,
          0
        )
      );

    source.playbackRate.value =
      playbackRate;
    source.loop = options.loop === true;
    source.loopStart = Math.max(
      0,
      normalizeFiniteNumber(
        options.loopStart,
        0
      )
    );
    source.loopEnd = Math.max(
      0,
      normalizeFiniteNumber(
        options.loopEnd,
        0
      )
    );

    if (
      stereoPannerSupported &&
      "pan" in options
    ) {
      pannerNode.pan.value =
        Math.max(
          -1,
          Math.min(
            1,
            normalizeFiniteNumber(
              options.pan,
              0
            )
          )
        );
    }

    const now =
      this.audioContext.currentTime;
    gainNode.gain.cancelScheduledValues(
      now
    );
    if (fadeIn > 0) {
      gainNode.gain.setValueAtTime(
        0,
        now
      );
      gainNode.gain.linearRampToValueAtTime(
        gain,
        now + fadeIn
      );
    } else {
      gainNode.gain.setValueAtTime(
        gain,
        now
      );
    }

    source.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(
      this.sampleOutputNode ??
        this.masterInputNode ??
        this.outputNode ??
        this.audioContext.destination
    );

    let stopped = false;
    const voice = {
      name: String(name),
      source,
      gainNode,
      pannerNode,
      stop: () => {
        if (stopped) {
          return;
        }

        stopped = true;
        const stopTime =
          this.audioContext.currentTime;

        if (fadeOut > 0) {
          gainNode.gain.cancelScheduledValues(
            stopTime
          );
          gainNode.gain.setValueAtTime(
            gainNode.gain.value,
            stopTime
          );
          gainNode.gain.linearRampToValueAtTime(
            0,
            stopTime + fadeOut
          );
          source.stop(
            stopTime + fadeOut
          );
        } else {
          source.stop();
        }
      },
    };

    source.addEventListener(
      "ended",
      () => {
        this.sampleVoices.delete(
          voice
        );
        try {
          source.disconnect();
        } catch {}
        try {
          gainNode.disconnect();
        } catch {}
        try {
          pannerNode.disconnect();
        } catch {}
      },
      { once: true }
    );

    this.sampleVoices.add(voice);

    if (duration != null) {
      source.start(now, offset, duration);
    } else {
      source.start(now, offset);
    }

    return voice;
  }

  async loadStream(name, url, options = {}) {
    if (
      url === undefined &&
      typeof name === "string"
    ) {
      url = name;
    }

    if (
      typeof url === "string" &&
      (
        typeof name !== "string" ||
        name.length === 0 ||
        name === url
      )
    ) {
      name = url;
    }

    if (
      typeof name !== "string" ||
      name.length === 0
    ) {
      throw new Error(
        "stream.load(url) or stream.load(name, url) requires a non-empty name"
      );
    }
    if (
      typeof url !== "string" ||
      url.length === 0
    ) {
      throw new Error(
        "stream.load(url) or stream.load(name, url) requires a non-empty url"
      );
    }
    const normalizedUrl =
      normalizeLocalMediaUrl(url);

    const existing =
      this.streamEntries.get(name);
    if (existing) {
      existing.stop();
      this.unloadStream(name);
    }

    const audioContext =
      this.audioContext ??
      options.createAudioContext?.();

    if (!audioContext) {
      throw new Error(
        "stream.load() requires an AudioContext factory"
      );
    }

    if (!this.audioContext) {
      this.audioContext = audioContext;
      this.ownsAudioContext = true;
    }

    const element = new Audio();
    element.src = normalizedUrl;
    element.preload = "auto";
    element.crossOrigin = "anonymous";

    const sourceNode =
      audioContext.createMediaElementSource(
        element
      );
    const gainNode =
      audioContext.createGain();
    const stereoPannerSupported =
      typeof audioContext
        .createStereoPanner ===
      "function";
    const pannerNode =
      stereoPannerSupported
        ? audioContext.createStereoPanner()
        : audioContext.createGain();

    sourceNode.connect(gainNode);
    gainNode.connect(pannerNode);
    pannerNode.connect(
      this.sampleOutputNode ??
        this.masterInputNode ??
        this.outputNode ??
        audioContext.destination
    );

    const entry = {
      name,
      element,
      sourceNode,
      gainNode,
      pannerNode,
      play: (playOptions = {}) =>
        this.playLoadedStream(
          entry,
          playOptions,
          options
        ),
      pause: () => {
        element.pause();
      },
      stop: () => {
        element.pause();
        element.currentTime = 0;
      },
    };

    this.streamEntries.set(
      name,
      entry
    );

    return entry;
  }

  async playStream(
    name,
    options = {},
    runtimeOptions = {}
  ) {
    const entry =
      this.streamEntries.get(
        String(name)
      );

    if (!entry) {
      throw new Error(
        `Unknown stream: ${name}`
      );
    }

    await this.playLoadedStream(
      entry,
      options,
      runtimeOptions
    );
    return entry;
  }

  async playLoadedStream(
    entry,
    options = {},
    runtimeOptions = {}
  ) {
    if (!this.audioContext) {
      throw new Error(
        "stream.play() requires an AudioContext"
      );
    }

    const {
      element,
      gainNode,
      pannerNode,
    } = entry;
    const now =
      this.audioContext.currentTime;
    const gain =
      normalizeFiniteNumber(
        options.gain,
        1
      );
    const fadeIn =
      Math.max(
        0,
        normalizeFiniteNumber(
          options.fadeIn,
          0
        )
      );

    element.loop = options.loop === true;
    element.playbackRate =
      Math.max(
        0.01,
        normalizeFiniteNumber(
          options.playbackRate,
          1
        )
      );

    if (options.offset != null) {
      element.currentTime = Math.max(
        0,
        normalizeFiniteNumber(
          options.offset,
          0
        )
      );
    }

    if (
      "pan" in options &&
      "pan" in pannerNode
    ) {
      pannerNode.pan.value =
        Math.max(
          -1,
          Math.min(
            1,
            normalizeFiniteNumber(
              options.pan,
              0
            )
          )
        );
    }

    gainNode.gain.cancelScheduledValues(
      now
    );
    if (fadeIn > 0) {
      gainNode.gain.setValueAtTime(
        0,
        now
      );
      gainNode.gain.linearRampToValueAtTime(
        gain,
        now + fadeIn
      );
    } else {
      gainNode.gain.setValueAtTime(
        gain,
        now
      );
    }

    await runtimeOptions.resume?.();
    await element.play();
  }

  pauseStream(name) {
    for (const entry of this.streamEntries.values()) {
      if (
        name == null ||
        entry.name === String(name)
      ) {
        entry.pause();
      }
    }
  }

  stopStream(name) {
    for (const entry of this.streamEntries.values()) {
      if (
        name == null ||
        entry.name === String(name)
      ) {
        entry.stop();
      }
    }
  }

  unloadStream(name) {
    const entry =
      this.streamEntries.get(
        String(name)
      );
    if (!entry) {
      return false;
    }

    entry.stop();
    try {
      entry.sourceNode.disconnect();
    } catch {}
    try {
      entry.gainNode.disconnect();
    } catch {}
    try {
      entry.pannerNode.disconnect();
    } catch {}
    entry.element.removeAttribute("src");
    entry.element.load();

    return this.streamEntries.delete(
      String(name)
    );
  }

  ensureRouting(audioContext) {
    this.audioContext = audioContext;
    if (!this.masterInputNode) this.masterInputNode = audioContext.createGain();
    if (!this.masterOutputNode) {
      this.masterOutputNode = audioContext.createGain();
      this.masterOutputNode.gain.value = this.masterVolume;
    }
    this.rebuildFXChain();
  }

  connectChipOutput(node) {
    if (!node || !this.masterInputNode) throw new Error("Audio routing is not ready");
    node.connect(this.masterInputNode);
  }

  setFXChain(effects = [], options = {}) {
    if (!Array.isArray(effects)) throw new Error("FX chain must be an array");
    const previous = this.fxChain.slice();
    this.fxChain = effects.slice();
    this.rebuildFXChain();
    if (options.dispose) previous.forEach((effect) => effect?.dispose?.());
  }

  getFXChain() { return this.fxChain.slice(); }

  connect(effect) {
    this.fxChain.push(effect);
    this.rebuildFXChain();
  }

  clearFXChain(options = {}) {
    const previous = this.fxChain.slice();
    this.fxChain = [];
    this.rebuildFXChain();
    if (options.dispose) previous.forEach((effect) => effect?.dispose?.());
    return previous;
  }

  disposeFXChain() {
    const previous = this.fxChain;
    this.fxChain = [];
    for (const effect of previous) effect?.dispose?.();
  }

  connectOutput(node = null) {
    this.outputNode = node ?? this.outputNode ?? this.audioContext?.destination ?? null;
    this.rebuildFXChain();
  }

  setMasterVolume(volume) {
    this.masterVolume = volume;
    if (this.masterOutputNode) this.masterOutputNode.gain.value = volume;
    return volume;
  }

  disconnectRouting() {
    this.masterInputNode?.disconnect();
    this.masterOutputNode?.disconnect();
    this.fxChain.forEach((effect) => effect?.disconnect?.());
  }

  closeMedia() {
    this.sample?.stopAll?.();
    this.sampleBuffers.clear();
    this.stream?.stop?.();
    for (const name of this.stream?.list?.() ?? []) {
      this.stream.unload(name);
    }
    this.disposeNoise();
    this.disposeAudioHandles();
  }

  rebuildFXChain() {
    if (!this.masterInputNode || !this.masterOutputNode) return;
    this.disconnectRouting();
    let current = this.masterInputNode;
    for (const effect of this.fxChain) {
      if (!effect?.input || !effect?.output) throw new Error("Each FX unit must expose input and output nodes");
      current.connect(effect.input);
      current = effect.output;
    }
    const target = this.outputNode ?? this.audioContext?.destination;
    if (target) {
      current.connect(this.masterOutputNode);
      this.masterOutputNode.connect(target);
    }
  }
}

const NATIVE_FETCH =
  typeof globalThis.fetch ===
  "function"
    ? globalThis.fetch.bind(globalThis)
    : null;

const NOISE_BUFFER_SECONDS = 8;
const NOISE_TYPES = new Set(["white", "pink", "brown", "gray", "clip"]);
const NOISE_BUFFER_CACHE = new WeakMap();

function clampNumber(value, fallback, min = -Infinity, max = Infinity) {
  const next = Number.isFinite(Number(value)) ? Number(value) : fallback;
  return Math.min(max, Math.max(min, next));
}

function createAudioParamControl(audioContext, audioParam, options = {}) {
  const min = options.min ?? -Infinity;
  const max = options.max ?? Infinity;
  return {
    get: () => audioParam.value,
    set(value) {
      const next = clampNumber(value, audioParam.value, min, max);
      audioParam.setValueAtTime(next, audioContext.currentTime);
      return next;
    },
    rampTo(value, seconds = 0.02) {
      const next = clampNumber(value, audioParam.value, min, max);
      const now = audioContext.currentTime;
      audioParam.cancelScheduledValues(now);
      audioParam.setValueAtTime(audioParam.value, now);
      audioParam.linearRampToValueAtTime(next, now + Math.max(0, Number(seconds) || 0));
      return next;
    },
  };
}

function createSimpleParamControl(getter, setter) {
  return { get: getter, set: setter };
}

function createFixedParamControl() {
  return { get: () => 0, set: () => 0, rampTo: () => 0 };
}

function normalizeNoiseType(type) {
  return NOISE_TYPES.has(type) ? type : "white";
}

function createNoiseBuffer(audioContext, type) {
  let buffers = NOISE_BUFFER_CACHE.get(audioContext);
  if (!buffers) {
    buffers = new Map();
    NOISE_BUFFER_CACHE.set(audioContext, buffers);
  }

  const normalizedType = normalizeNoiseType(type);
  const existing = buffers.get(normalizedType);
  if (existing) return existing;

  const buffer = audioContext.createBuffer(
    1,
    Math.max(1, Math.floor(audioContext.sampleRate * NOISE_BUFFER_SECONDS)),
    audioContext.sampleRate
  );
  const data = buffer.getChannelData(0);
  if (normalizedType === "pink") fillPinkNoise(data);
  else if (normalizedType === "brown") fillBrownNoise(data);
  else if (normalizedType === "gray") fillGrayNoise(data);
  else if (normalizedType === "clip") fillClipNoise(data);
  else fillWhiteNoise(data);
  buffers.set(normalizedType, buffer);
  return buffer;
}

function fillWhiteNoise(data) {
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
}

function fillPinkNoise(data) {
  let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[index] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

function fillBrownNoise(data) {
  let lastOut = 0;
  for (let index = 0; index < data.length; index += 1) {
    lastOut = (lastOut + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[index] = lastOut * 3.5;
  }
}

function fillGrayNoise(data) {
  let previous = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    data[index] = (white - previous * 0.985) * 0.75;
    previous = white;
  }
}

function fillClipNoise(data) {
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    data[index] = white > 0.2 ? 1 : white < -0.2 ? -1 : 0;
  }
}

async function decodeAudioBuffer(
  audioContext,
  arrayBuffer
) {
  return new Promise(
    (resolve, reject) => {
      audioContext.decodeAudioData(
        arrayBuffer.slice(0),
        resolve,
        reject
      );
    }
  );
}

function normalizeFiniteNumber(
  value,
  fallback
) {
  if (value == null) {
    return fallback;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(
      `expected a finite number, got ${value}`
    );
  }
  return numeric;
}

function normalizeLocalMediaUrl(url) {
  const value = resolveBuiltInMediaAlias(
    String(url)
  );

  if (
    value.startsWith("data:") ||
    value.startsWith("blob:")
  ) {
    return value;
  }

  if (
    typeof location === "undefined" ||
    !location?.href
  ) {
    return value;
  }

  const resolved = new URL(
    value,
    location.href
  );

  if (
    resolved.origin !==
    location.origin
  ) {
    throw new Error(
      "Only same-origin media URLs are allowed in MegaSynth.sample/stream"
    );
  }

  return resolved.href;
}

function resolveBuiltInMediaAlias(url) {
  if (
    typeof url !== "string" ||
    url.length === 0
  ) {
    return url;
  }

  if (
    url.startsWith("sonic-pi/") &&
    !url.includes("://")
  ) {
    const sampleName =
      url
        .slice("sonic-pi/".length)
        .replaceAll("-", "_");
    return `./samples/sonic-pi/${sampleName}.flac`;
  }

  if (!url.startsWith("sonic-pi/")) {
    return url;
  }

  return url;
}
