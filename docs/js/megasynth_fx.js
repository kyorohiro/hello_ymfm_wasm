/**
 * @typedef {{
 *   get(): number,
 *   set(value: number): number,
 *   rampTo(value: number, seconds?: number): number,
 * }} AudioParamControl
 */

/**
 * @typedef {{
 *   get(): number,
 *   set(value: number): number,
 * }} SimpleParamControl
 */

/**
 * @typedef {AudioNode | { input: AudioNode }} FXConnectTarget
 */

/**
 * @typedef {{
 *   type: "branch",
 *   effects: AnyFXUnit[],
 * }} FXBranch
 */

/**
 * @typedef {{
 *   type: string,
 *   input: AudioNode,
 *   output: AudioNode,
 *   params: Record<string, unknown>,
 *   connect(target: FXConnectTarget): FXConnectTarget,
 *   disconnect(): void,
 *   dispose(): void,
 * }} BaseFXUnit
 */

/**
 * @typedef {{ gain?: number }} GainFXOptions
 */

/**
 * @typedef {{
 *   bass?: number,
 *   bassFrequency?: number,
 *   mid?: number,
 *   midFrequency?: number,
 *   midQ?: number,
 *   treble?: number,
 *   trebleFrequency?: number,
 * }} EqFXOptions
 */

/**
 * @typedef {{
 *   highpass?: number,
 *   lowpass?: number,
 *   presence?: number,
 *   mix?: number,
 *   output?: number,
 * }} RadioToneFXOptions
 */

/**
 * @typedef {{
 *   cutoff?: number,
 *   highshelf?: number,
 *   drive?: number,
 *   mix?: number,
 *   output?: number,
 * }} LofiFXOptions
 */

/**
 * @typedef {{
 *   type?: BiquadFilterType,
 *   cutoff?: number,
 *   q?: number,
 * }} FilterFXOptions
 */

/**
 * @typedef {{
 *   time?: number,
 *   feedback?: number,
 *   mix?: number,
 * }} DelayFXOptions
 */

/**
 * @typedef {{
 *   drive?: number,
 *   mix?: number,
 *   output?: number,
 * }} DistortionFXOptions
 */

/**
 * @typedef {{
 *   threshold?: number,
 *   knee?: number,
 *   ratio?: number,
 *   attack?: number,
 *   release?: number,
 *   output?: number,
 * }} CompressorFXOptions
 */

/**
 * @typedef {{
 *   threshold?: number,
 *   floor?: number,
 *   mix?: number,
 * }} GateFXOptions
 */

/**
 * @typedef {{
 *   cutoff?: number,
 *   depth?: number,
 *   rate?: number,
 *   resonance?: number,
 *   mix?: number,
 *   getBeatSeconds?: (() => number),
 * }} WobbleFXOptions
 */

/**
 * @typedef {{
 *   time?: number,
 *   depth?: number,
 *   rate?: number,
 *   feedback?: number,
 *   mix?: number,
 *   getBeatSeconds?: (() => number),
 * }} FlangerFXOptions
 */

/**
 * @typedef {{
 *   mix?: number,
 *   tone?: number,
 *   seconds?: number,
 *   decay?: number,
 * }} ReverbFXOptions
 */

/**
 * @typedef {{
 *   phase?: number,
 *   mix?: number,
 *   getBeatSeconds?: (() => number),
 * }} SlicerFXOptions
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "gain",
 *   gain: AudioParamControl,
 * }} GainFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "eq",
 *   bass: AudioParamControl,
 *   mid: AudioParamControl,
 *   treble: AudioParamControl,
 * }} EqFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "radioTone",
 *   highpass: AudioParamControl,
 *   lowpass: AudioParamControl,
 *   presence: AudioParamControl,
 *   mix: AudioParamControl,
 *   outputGain: AudioParamControl,
 * }} RadioToneFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "lofi",
 *   cutoff: AudioParamControl,
 *   highshelf: AudioParamControl,
 *   drive: AudioParamControl,
 *   mix: AudioParamControl,
 *   outputGain: AudioParamControl,
 * }} LofiFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "filter",
 *   cutoff: AudioParamControl,
 *   q: AudioParamControl,
 * }} FilterFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "delay",
 *   time: AudioParamControl,
 *   feedback: AudioParamControl,
 *   mix: AudioParamControl,
 * }} DelayFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "distortion",
 *   drive: AudioParamControl,
 *   mix: AudioParamControl,
 *   outputGain: AudioParamControl,
 * }} DistortionFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "compressor",
 *   threshold: AudioParamControl,
 *   knee: AudioParamControl,
 *   ratio: AudioParamControl,
 *   attack: AudioParamControl,
 *   release: AudioParamControl,
 *   outputGain: AudioParamControl,
 * }} CompressorFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "gate",
 *   threshold: SimpleParamControl,
 *   floor: AudioParamControl,
 *   mix: AudioParamControl,
 * }} GateFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "wobble",
 *   cutoff: AudioParamControl,
 *   depth: AudioParamControl,
 *   rate: SimpleParamControl,
 *   resonance: AudioParamControl,
 *   mix: AudioParamControl,
 * }} WobbleFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "flanger",
 *   time: AudioParamControl,
 *   depth: AudioParamControl,
 *   rate: SimpleParamControl,
 *   feedback: AudioParamControl,
 *   mix: AudioParamControl,
 * }} FlangerFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "reverb",
 *   mix: AudioParamControl,
 *   tone: AudioParamControl,
 * }} ReverbFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "slicer",
 *   phase: SimpleParamControl,
 *   mix: AudioParamControl,
 * }} SlicerFXUnit
 */

/**
 * @typedef {BaseFXUnit & {
 *   type: "parallel",
 *   branches: FXBranch[],
 * }} ParallelFXUnit
 */

/**
 * @typedef {GainFXUnit | EqFXUnit | RadioToneFXUnit | LofiFXUnit | FilterFXUnit | DelayFXUnit | DistortionFXUnit | CompressorFXUnit | GateFXUnit | WobbleFXUnit | FlangerFXUnit | ReverbFXUnit | SlicerFXUnit | ParallelFXUnit} AnyFXUnit
 */

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} [min=-Infinity]
 * @param {number} [max=Infinity]
 * @returns {number}
 */
function clampNumber(
  value,
  fallback,
  min = -Infinity,
  max = Infinity
) {
  const next =
    Number.isFinite(Number(value))
      ? Number(value)
      : fallback;

  return Math.min(
    max,
    Math.max(min, next)
  );
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {AudioParam} audioParam
 * @param {{ min?: number, max?: number }} [options]
 * @returns {AudioParamControl}
 */
function createAudioParamControl(
  audioContext,
  audioParam,
  options = {}
) {
  const min =
    options.min ?? -Infinity;
  const max =
    options.max ?? Infinity;

  return {
    get() {
      return audioParam.value;
    },

    set(value) {
      const next = clampNumber(
        value,
        audioParam.value,
        min,
        max
      );
      audioParam.setValueAtTime(
        next,
        audioContext.currentTime
      );
      return next;
    },

    rampTo(
      value,
      seconds = 0.02
    ) {
      const next = clampNumber(
        value,
        audioParam.value,
        min,
        max
      );
      const duration =
        Math.max(
          0,
          Number(seconds) || 0
        );

      audioParam.cancelScheduledValues(
        audioContext.currentTime
      );
      audioParam.setValueAtTime(
        audioParam.value,
        audioContext.currentTime
      );
      audioParam.linearRampToValueAtTime(
        next,
        audioContext.currentTime +
          duration
      );
      return next;
    },
  };
}

/**
 * @param {AudioNode} sourceNode
 * @param {FXConnectTarget} target
 * @returns {FXConnectTarget}
 */
function connectTarget(
  sourceNode,
  target
) {
  const resolvedTarget =
    target?.input ?? target;

  if (!resolvedTarget) {
    throw new Error(
      "FX target is required"
    );
  }

  sourceNode.connect(resolvedTarget);
  return target;
}

/**
 * @param {AudioNode | null | undefined} node
 * @returns {void}
 */
function disconnectNode(node) {
  try {
    node?.disconnect();
  } catch (_error) {
    // Ignore double-disconnect or browser-specific disconnect errors.
  }
}

/**
 * @template {Record<string, unknown>} T
 * @param {{
 *   type: string,
 *   input: AudioNode,
 *   output: AudioNode,
 *   params?: T,
 *   disposeNodes?: Array<AudioNode | null | undefined>,
 * }} options
 * @returns {BaseFXUnit & T}
 */
function createEffectUnit({
  type,
  input,
  output,
  params = {},
  disposeNodes = [],
}) {
  const effect = {
    type,
    input,
    output,
    params,

    connect(target) {
      return connectTarget(
        output,
        target
      );
    },

    disconnect() {
      disconnectNode(output);
    },

    dispose() {
      for (const node of disposeNodes) {
        disconnectNode(node);
      }
    },
  };

  Object.assign(effect, params);
  return effect;
}

/**
 * @param {unknown} value
 * @returns {value is AnyFXUnit}
 */
function isFXUnit(value) {
  return !!(
    value &&
    typeof value === "object" &&
    "input" in value &&
    "output" in value &&
    typeof value.connect ===
      "function"
  );
}

/**
 * @param {unknown} value
 * @returns {value is FXBranch}
 */
function isFXBranch(value) {
  return !!(
    value &&
    typeof value === "object" &&
    value.type === "branch" &&
    Array.isArray(value.effects)
  );
}

/**
 * @param {unknown} value
 * @returns {FXBranch}
 */
function normalizeBranch(value) {
  if (isFXBranch(value)) {
    return value;
  }

  if (isFXUnit(value)) {
    return createFXBranch(value);
  }

  throw new Error(
    "parallel() expects fx.branch(...) or FX units"
  );
}

/**
 * @param {GainNode} dryGain
 * @param {GainNode} wetGain
 * @param {unknown} mix
 * @returns {void}
 */
function setDryWetMix(
  dryGain,
  wetGain,
  mix
) {
  const nextMix = clampNumber(
    mix,
    0.2,
    0,
    1
  );

  dryGain.gain.value = 1 - nextMix;
  wetGain.gain.value = nextMix;
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {GainNode} dryGain
 * @param {GainNode} wetGain
 * @returns {AudioParamControl}
 */
function createDryWetMixControl(
  audioContext,
  dryGain,
  wetGain
) {
  return {
    get() {
      return wetGain.gain.value;
    },

    set(value) {
      setDryWetMix(
        dryGain,
        wetGain,
        value
      );
      return wetGain.gain.value;
    },

    rampTo(
      value,
      seconds = 0.02
    ) {
      const nextMix = clampNumber(
        value,
        wetGain.gain.value,
        0,
        1
      );
      const duration =
        Math.max(
          0,
          Number(seconds) || 0
        );
      const now =
        audioContext.currentTime;

      wetGain.gain.cancelScheduledValues(
        now
      );
      wetGain.gain.setValueAtTime(
        wetGain.gain.value,
        now
      );
      wetGain.gain.linearRampToValueAtTime(
        nextMix,
        now + duration
      );

      dryGain.gain.cancelScheduledValues(
        now
      );
      dryGain.gain.setValueAtTime(
        dryGain.gain.value,
        now
      );
      dryGain.gain.linearRampToValueAtTime(
        1 - nextMix,
        now + duration
      );

      return nextMix;
    },
  };
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {ReverbFXOptions} [options]
 * @returns {AudioBuffer}
 */
function createImpulseResponse(
  audioContext,
  options = {}
) {
  const seconds = clampNumber(
    options.seconds,
    1.8,
    0.05,
    8
  );
  const decay = clampNumber(
    options.decay,
    2.4,
    0.1,
    12
  );
  const sampleRate =
    audioContext.sampleRate;
  const length = Math.max(
    1,
    Math.floor(sampleRate * seconds)
  );
  const impulse =
    audioContext.createBuffer(
      2,
      length,
      sampleRate
    );

  for (let channel = 0; channel < 2; channel += 1) {
    const data =
      impulse.getChannelData(
        channel
      );

    for (let index = 0; index < length; index += 1) {
      const time =
        1 - index / length;
      const envelope =
        Math.pow(time, decay);
      data[index] =
        (Math.random() * 2 - 1) *
        envelope;
    }
  }

  return impulse;
}

/**
 * @param {number} drive
 * @returns {Float32Array}
 */
function createDistortionCurve(
  drive
) {
  const amount = clampNumber(
    drive,
    1.8,
    0,
    64
  );
  const samples = 4096;
  const curve = new Float32Array(
    samples
  );
  const shape =
    1 + amount * 6;

  for (
    let index = 0;
    index < samples;
    index += 1
  ) {
    const x =
      (index / (samples - 1)) * 2 -
      1;
    curve[index] =
      Math.tanh(shape * x) /
      Math.tanh(shape);
  }

  return curve;
}

/**
 * @param {number} threshold
 * @returns {Float32Array}
 */
function createGateThresholdCurve(
  threshold
) {
  const normalizedThreshold =
    clampNumber(
      threshold,
      0.04,
      0,
      1
    );
  const samples = 1024;
  const curve = new Float32Array(
    samples
  );

  for (
    let index = 0;
    index < samples;
    index += 1
  ) {
    const x = index / (samples - 1);
    curve[index] =
      x >= normalizedThreshold
        ? 1
        : 0;
  }

  return curve;
}

/**
 * Describe one serial branch used by `parallel(...)`.
 *
 * `branch(a, b, c)` means:
 *
 * input -> a -> b -> c
 *
 * @param {...AnyFXUnit} effects
 * @returns {FXBranch}
 */
export function createFXBranch(
  ...effects
) {
  for (const effect of effects) {
    if (!isFXUnit(effect)) {
      throw new Error(
        "branch() expects FX units"
      );
    }
  }

  return {
    type: "branch",
    effects: effects.slice(),
  };
}

/**
 * Create one routing unit that splits one input into multiple branches and
 * mixes them back together.
 *
 * @param {BaseAudioContext} audioContext
 * @param {...(FXBranch | AnyFXUnit)} branchesOrEffects
 * @returns {ParallelFXUnit}
 */
export function createFXParallel(
  audioContext,
  ...branchesOrEffects
) {
  const input =
    audioContext.createGain();
  const output =
    audioContext.createGain();
  const disposeNodes = [
    input,
    output,
  ];
  const ownedEffects = new Set();
  const branches =
    branchesOrEffects.map(
      normalizeBranch
    );

  if (branches.length === 0) {
    input.connect(output);
  }

  for (const branch of branches) {
    const branchInput =
      audioContext.createGain();
    const branchOutput =
      audioContext.createGain();
    disposeNodes.push(
      branchInput,
      branchOutput
    );

    input.connect(branchInput);

    let currentNode = branchInput;
    for (const effect of branch.effects) {
      currentNode.connect(effect.input);
      currentNode = effect.output;
      ownedEffects.add(effect);
    }

    currentNode.connect(branchOutput);
    branchOutput.connect(output);
  }

  return createEffectUnit({
    type: "parallel",
    input,
    output,
    params: {
      branches: branches.slice(),
    },
    disposeNodes: [
      ...disposeNodes,
      {
        disconnect() {
          for (const effect of ownedEffects) {
            effect.dispose?.();
          }
        },
      },
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {GainFXOptions} [options]
 * @returns {GainFXUnit}
 */
export function createGainFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const output =
    audioContext.createGain();

  input.connect(output);
  output.gain.value = clampNumber(
    options.gain,
    1,
    0,
    8
  );

  return createEffectUnit({
    type: "gain",
    input,
    output,
    params: {
      gain: createAudioParamControl(
        audioContext,
        output.gain,
        {
          min: 0,
          max: 8,
        }
      ),
    },
    disposeNodes: [
      input,
      output,
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {EqFXOptions} [options]
 * @returns {EqFXUnit}
 */
export function createEqFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const lowShelf =
    audioContext.createBiquadFilter();
  const midPeak =
    audioContext.createBiquadFilter();
  const highShelf =
    audioContext.createBiquadFilter();
  const output =
    audioContext.createGain();

  lowShelf.type = "lowshelf";
  lowShelf.frequency.value =
    clampNumber(
      options.bassFrequency,
      220,
      40,
      1000
    );
  lowShelf.gain.value =
    clampNumber(
      options.bass,
      0,
      -24,
      24
    );

  midPeak.type = "peaking";
  midPeak.frequency.value =
    clampNumber(
      options.midFrequency,
      1200,
      200,
      5000
    );
  midPeak.Q.value = clampNumber(
    options.midQ,
    0.9,
    0.1,
    10
  );
  midPeak.gain.value =
    clampNumber(
      options.mid,
      0,
      -24,
      24
    );

  highShelf.type = "highshelf";
  highShelf.frequency.value =
    clampNumber(
      options.trebleFrequency,
      3200,
      800,
      12000
    );
  highShelf.gain.value =
    clampNumber(
      options.treble,
      0,
      -24,
      24
    );

  input.connect(lowShelf);
  lowShelf.connect(midPeak);
  midPeak.connect(highShelf);
  highShelf.connect(output);

  return createEffectUnit({
    type: "eq",
    input,
    output,
    params: {
      bass: createAudioParamControl(
        audioContext,
        lowShelf.gain,
        {
          min: -24,
          max: 24,
        }
      ),
      mid: createAudioParamControl(
        audioContext,
        midPeak.gain,
        {
          min: -24,
          max: 24,
        }
      ),
      treble:
        createAudioParamControl(
          audioContext,
          highShelf.gain,
          {
            min: -24,
            max: 24,
          }
        ),
    },
    disposeNodes: [
      input,
      lowShelf,
      midPeak,
      highShelf,
      output,
    ],
  });
}

/**
 * Radio-like narrow-band tone shaping.
 *
 * This is useful when game audio should feel like it is coming from:
 *
 * - a handheld radio
 * - an in-world speaker
 * - a phone / comms voice
 *
 * @param {BaseAudioContext} audioContext
 * @param {RadioToneFXOptions} [options]
 * @returns {RadioToneFXUnit}
 */
export function createRadioToneFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const dryGain =
    audioContext.createGain();
  const wetInputGain =
    audioContext.createGain();
  const highpass =
    audioContext.createBiquadFilter();
  const lowpass =
    audioContext.createBiquadFilter();
  const presence =
    audioContext.createBiquadFilter();
  const wetGain =
    audioContext.createGain();
  const outputGain =
    audioContext.createGain();
  const output =
    audioContext.createGain();

  highpass.type = "highpass";
  highpass.frequency.value =
    clampNumber(
      options.highpass,
      380,
      40,
      4000
    );

  lowpass.type = "lowpass";
  lowpass.frequency.value =
    clampNumber(
      options.lowpass,
      2800,
      300,
      12000
    );

  presence.type = "peaking";
  presence.frequency.value = 1800;
  presence.Q.value = 1.1;
  presence.gain.value =
    clampNumber(
      options.presence,
      4,
      -24,
      24
    );

  outputGain.gain.value =
    clampNumber(
      options.output,
      1,
      0,
      4
    );

  setDryWetMix(
    dryGain,
    wetGain,
    options.mix ?? 1
  );

  input.connect(dryGain);
  input.connect(wetInputGain);
  wetInputGain.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(presence);
  presence.connect(wetGain);
  dryGain.connect(outputGain);
  wetGain.connect(outputGain);
  outputGain.connect(output);

  return createEffectUnit({
    type: "radioTone",
    input,
    output,
    params: {
      highpass:
        createAudioParamControl(
          audioContext,
          highpass.frequency,
          {
            min: 40,
            max: 4000,
          }
        ),
      lowpass:
        createAudioParamControl(
          audioContext,
          lowpass.frequency,
          {
            min: 300,
            max: 12000,
          }
        ),
      presence:
        createAudioParamControl(
          audioContext,
          presence.gain,
          {
            min: -24,
            max: 24,
          }
        ),
      mix: createDryWetMixControl(
        audioContext,
        dryGain,
        wetGain
      ),
      outputGain:
        createAudioParamControl(
          audioContext,
          outputGain.gain,
          {
            min: 0,
            max: 4,
          }
        ),
    },
    disposeNodes: [
      input,
      dryGain,
      wetInputGain,
      highpass,
      lowpass,
      presence,
      wetGain,
      outputGain,
      output,
    ],
  });
}

/**
 * Small lo-fi tone shaper.
 *
 * This is intentionally lighter than a full cassette / vinyl simulation.
 * It keeps the runtime simple enough for game embedding while still giving:
 *
 * - softer highs
 * - mild band-limiting
 * - light saturation
 *
 * @param {BaseAudioContext} audioContext
 * @param {LofiFXOptions} [options]
 * @returns {LofiFXUnit}
 */
export function createLofiFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const dryGain =
    audioContext.createGain();
  const wetInputGain =
    audioContext.createGain();
  const lowpass =
    audioContext.createBiquadFilter();
  const highshelf =
    audioContext.createBiquadFilter();
  const shaper =
    audioContext.createWaveShaper();
  const wetGain =
    audioContext.createGain();
  const outputGain =
    audioContext.createGain();
  const output =
    audioContext.createGain();

  const state = {
    drive: clampNumber(
      options.drive,
      0.9,
      0,
      8
    ),
  };

  lowpass.type = "lowpass";
  lowpass.frequency.value =
    clampNumber(
      options.cutoff,
      3200,
      200,
      16000
    );

  highshelf.type = "highshelf";
  highshelf.frequency.value = 2800;
  highshelf.gain.value =
    clampNumber(
      options.highshelf,
      -8,
      -24,
      6
    );

  shaper.curve =
    createDistortionCurve(
      state.drive
    );
  shaper.oversample = "4x";

  outputGain.gain.value =
    clampNumber(
      options.output,
      1,
      0,
      4
    );

  setDryWetMix(
    dryGain,
    wetGain,
    options.mix ?? 1
  );

  input.connect(dryGain);
  input.connect(wetInputGain);
  wetInputGain.connect(lowpass);
  lowpass.connect(highshelf);
  highshelf.connect(shaper);
  shaper.connect(wetGain);
  dryGain.connect(outputGain);
  wetGain.connect(outputGain);
  outputGain.connect(output);

  return createEffectUnit({
    type: "lofi",
    input,
    output,
    params: {
      cutoff: createAudioParamControl(
        audioContext,
        lowpass.frequency,
        {
          min: 200,
          max: 16000,
        }
      ),
      highshelf:
        createAudioParamControl(
          audioContext,
          highshelf.gain,
          {
            min: -24,
            max: 6,
          }
        ),
      drive: {
        get() {
          return state.drive;
        },
        set(value) {
          state.drive =
            clampNumber(
              value,
              state.drive,
              0,
              8
            );
          shaper.curve =
            createDistortionCurve(
              state.drive
            );
          return state.drive;
        },
        rampTo(value) {
          return this.set(value);
        },
      },
      mix: createDryWetMixControl(
        audioContext,
        dryGain,
        wetGain
      ),
      outputGain:
        createAudioParamControl(
          audioContext,
          outputGain.gain,
          {
            min: 0,
            max: 4,
          }
        ),
    },
    disposeNodes: [
      input,
      dryGain,
      wetInputGain,
      lowpass,
      highshelf,
      shaper,
      wetGain,
      outputGain,
      output,
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {FilterFXOptions} [options]
 * @returns {FilterFXUnit}
 */
export function createFilterFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const filter =
    audioContext.createBiquadFilter();
  const output =
    audioContext.createGain();

  filter.type =
    options.type ?? "lowpass";
  filter.frequency.value =
    clampNumber(
      options.cutoff,
      1800,
      20,
      20000
    );
  filter.Q.value = clampNumber(
    options.q,
    1,
    0.0001,
    40
  );

  input.connect(filter);
  filter.connect(output);

  return createEffectUnit({
    type: "filter",
    input,
    output,
    params: {
      cutoff: createAudioParamControl(
        audioContext,
        filter.frequency,
        {
          min: 20,
          max: 20000,
        }
      ),
      q: createAudioParamControl(
        audioContext,
        filter.Q,
        {
          min: 0.0001,
          max: 40,
        }
      ),
    },
    disposeNodes: [
      input,
      filter,
      output,
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {DelayFXOptions} [options]
 * @returns {DelayFXUnit}
 */
export function createDelayFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const dryGain =
    audioContext.createGain();
  const wetGain =
    audioContext.createGain();
  const delay =
    audioContext.createDelay(4);
  const feedbackGain =
    audioContext.createGain();
  const output =
    audioContext.createGain();

  delay.delayTime.value =
    clampNumber(
      options.time,
      0.2,
      0,
      4
    );
  feedbackGain.gain.value =
    clampNumber(
      options.feedback,
      0.35,
      0,
      0.95
    );
  setDryWetMix(
    dryGain,
    wetGain,
    options.mix
  );

  input.connect(dryGain);
  input.connect(delay);
  delay.connect(feedbackGain);
  feedbackGain.connect(delay);
  delay.connect(wetGain);
  dryGain.connect(output);
  wetGain.connect(output);

  return createEffectUnit({
    type: "delay",
    input,
    output,
    params: {
      time: createAudioParamControl(
        audioContext,
        delay.delayTime,
        {
          min: 0,
          max: 4,
        }
      ),
      feedback: createAudioParamControl(
        audioContext,
        feedbackGain.gain,
        {
          min: 0,
          max: 0.95,
        }
      ),
      mix: createDryWetMixControl(
        audioContext,
        dryGain,
        wetGain
      ),
    },
    disposeNodes: [
      input,
      dryGain,
      wetGain,
      delay,
      feedbackGain,
      output,
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {DistortionFXOptions} [options]
 * @returns {DistortionFXUnit}
 */
export function createDistortionFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const dryGain =
    audioContext.createGain();
  const wetInputGain =
    audioContext.createGain();
  const shaper =
    audioContext.createWaveShaper();
  const wetGain =
    audioContext.createGain();
  const outputGain =
    audioContext.createGain();
  const output =
    audioContext.createGain();

  const state = {
    drive: clampNumber(
      options.drive,
      1.8,
      0,
      64
    ),
  };

  shaper.curve =
    createDistortionCurve(
      state.drive
    );
  shaper.oversample = "4x";
  outputGain.gain.value =
    clampNumber(
      options.output,
      0.8,
      0,
      4
    );
  setDryWetMix(
    dryGain,
    wetGain,
    options.mix ?? 1
  );

  input.connect(dryGain);
  input.connect(wetInputGain);
  wetInputGain.connect(shaper);
  shaper.connect(wetGain);
  dryGain.connect(outputGain);
  wetGain.connect(outputGain);
  outputGain.connect(output);

  return createEffectUnit({
    type: "distortion",
    input,
    output,
    params: {
      drive: {
        get() {
          return state.drive;
        },
        set(value) {
          state.drive =
            clampNumber(
              value,
              state.drive,
              0,
              64
            );
          shaper.curve =
            createDistortionCurve(
              state.drive
            );
          return state.drive;
        },
        rampTo(value) {
          return this.set(value);
        },
      },
      mix: createDryWetMixControl(
        audioContext,
        dryGain,
        wetGain
      ),
      outputGain:
        createAudioParamControl(
          audioContext,
          outputGain.gain,
          {
            min: 0,
            max: 4,
          }
        ),
    },
    disposeNodes: [
      input,
      dryGain,
      wetInputGain,
      shaper,
      wetGain,
      outputGain,
      output,
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {CompressorFXOptions} [options]
 * @returns {CompressorFXUnit}
 */
export function createCompressorFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const compressor =
    audioContext.createDynamicsCompressor();
  const outputGain =
    audioContext.createGain();
  const output =
    audioContext.createGain();

  compressor.threshold.value =
    clampNumber(
      options.threshold,
      -24,
      -100,
      0
    );
  compressor.knee.value =
    clampNumber(
      options.knee,
      18,
      0,
      40
    );
  compressor.ratio.value =
    clampNumber(
      options.ratio,
      8,
      1,
      20
    );
  compressor.attack.value =
    clampNumber(
      options.attack,
      0.003,
      0,
      1
    );
  compressor.release.value =
    clampNumber(
      options.release,
      0.18,
      0,
      1
    );
  outputGain.gain.value =
    clampNumber(
      options.output,
      1,
      0,
      4
    );

  input.connect(compressor);
  compressor.connect(outputGain);
  outputGain.connect(output);

  return createEffectUnit({
    type: "compressor",
    input,
    output,
    params: {
      threshold:
        createAudioParamControl(
          audioContext,
          compressor.threshold,
          {
            min: -100,
            max: 0,
          }
        ),
      knee: createAudioParamControl(
        audioContext,
        compressor.knee,
        {
          min: 0,
          max: 40,
        }
      ),
      ratio:
        createAudioParamControl(
          audioContext,
          compressor.ratio,
          {
            min: 1,
            max: 20,
          }
        ),
      attack:
        createAudioParamControl(
          audioContext,
          compressor.attack,
          {
            min: 0,
            max: 1,
          }
        ),
      release:
        createAudioParamControl(
          audioContext,
          compressor.release,
          {
            min: 0,
            max: 1,
          }
        ),
      outputGain:
        createAudioParamControl(
          audioContext,
          outputGain.gain,
          {
            min: 0,
            max: 4,
          }
        ),
    },
    disposeNodes: [
      input,
      compressor,
      outputGain,
      output,
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {GateFXOptions} [options]
 * @returns {GateFXUnit}
 */
export function createGateFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const dryGain =
    audioContext.createGain();
  const wetInputGain =
    audioContext.createGain();
  const rectifier =
    audioContext.createWaveShaper();
  const follower =
    audioContext.createBiquadFilter();
  const threshold =
    audioContext.createWaveShaper();
  const gateGain =
    audioContext.createGain();
  const floorGain =
    audioContext.createGain();
  const wetGain =
    audioContext.createGain();
  const output =
    audioContext.createGain();

  const state = {
    threshold: clampNumber(
      options.threshold,
      0.04,
      0,
      1
    ),
  };

  rectifier.curve =
    Float32Array.from(
      { length: 1024 },
      (_value, index) => {
        const x =
          (index / 1023) * 2 - 1;
        return Math.abs(x);
      }
    );
  follower.type = "lowpass";
  follower.frequency.value = 28;
  threshold.curve =
    createGateThresholdCurve(
      state.threshold
    );
  gateGain.gain.value = 0;
  floorGain.gain.value =
    clampNumber(
      options.floor,
      0,
      0,
      1
    );
  setDryWetMix(
    dryGain,
    wetGain,
    options.mix ?? 1
  );

  input.connect(dryGain);
  input.connect(wetInputGain);
  wetInputGain.connect(gateGain);
  gateGain.connect(wetGain);
  dryGain.connect(output);
  wetGain.connect(output);

  input.connect(rectifier);
  rectifier.connect(follower);
  follower.connect(threshold);
  threshold.connect(gateGain.gain);
  wetInputGain.connect(floorGain);
  floorGain.connect(wetGain);

  return createEffectUnit({
    type: "gate",
    input,
    output,
    params: {
      threshold: {
        get() {
          return state.threshold;
        },
        set(value) {
          state.threshold =
            clampNumber(
              value,
              state.threshold,
              0,
              1
            );
          threshold.curve =
            createGateThresholdCurve(
              state.threshold
            );
          return state.threshold;
        },
      },
      floor: createAudioParamControl(
        audioContext,
        floorGain.gain,
        {
          min: 0,
          max: 1,
        }
      ),
      mix: createDryWetMixControl(
        audioContext,
        dryGain,
        wetGain
      ),
    },
    disposeNodes: [
      input,
      dryGain,
      wetInputGain,
      rectifier,
      follower,
      threshold,
      gateGain,
      floorGain,
      wetGain,
      output,
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {WobbleFXOptions} [options]
 * @returns {WobbleFXUnit}
 */
export function createWobbleFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const dryGain =
    audioContext.createGain();
  const wetInputGain =
    audioContext.createGain();
  const filter =
    audioContext.createBiquadFilter();
  const wetGain =
    audioContext.createGain();
  const output =
    audioContext.createGain();
  const lfo =
    audioContext.createOscillator();
  const lfoDepth =
    audioContext.createGain();

  const resolveBeatSeconds =
    typeof options.getBeatSeconds ===
    "function"
      ? options.getBeatSeconds
      : () => 0.5;

  const state = {
    rate: clampNumber(
      options.rate,
      0.5,
      0.03125,
      16
    ),
  };

  filter.type = "lowpass";
  filter.frequency.value =
    clampNumber(
      options.cutoff,
      1400,
      40,
      20000
    );
  filter.Q.value = clampNumber(
    options.resonance,
    1.4,
    0.0001,
    40
  );
  lfo.type = "sine";
  lfoDepth.gain.value =
    clampNumber(
      options.depth,
      1100,
      0,
      12000
    );
  setDryWetMix(
    dryGain,
    wetGain,
    options.mix ?? 1
  );

  function updateRate() {
    const beatSeconds =
      clampNumber(
        resolveBeatSeconds(),
        0.5,
        0.01,
        60
      );
    const periodSeconds =
      Math.max(
        0.01,
        state.rate * beatSeconds
      );
    lfo.frequency.setValueAtTime(
      1 / periodSeconds,
      audioContext.currentTime
    );
  }

  input.connect(dryGain);
  input.connect(wetInputGain);
  wetInputGain.connect(filter);
  filter.connect(wetGain);
  dryGain.connect(output);
  wetGain.connect(output);

  lfo.connect(lfoDepth);
  lfoDepth.connect(filter.frequency);
  updateRate();
  lfo.start();

  const syncTimer =
    window.setInterval(() => {
      updateRate();
    }, 60);

  return createEffectUnit({
    type: "wobble",
    input,
    output,
    params: {
      cutoff: createAudioParamControl(
        audioContext,
        filter.frequency,
        {
          min: 40,
          max: 20000,
        }
      ),
      depth: createAudioParamControl(
        audioContext,
        lfoDepth.gain,
        {
          min: 0,
          max: 12000,
        }
      ),
      rate: {
        get() {
          return state.rate;
        },
        set(value) {
          state.rate =
            clampNumber(
              value,
              state.rate,
              0.03125,
              16
            );
          updateRate();
          return state.rate;
        },
      },
      resonance:
        createAudioParamControl(
          audioContext,
          filter.Q,
          {
            min: 0.0001,
            max: 40,
          }
        ),
      mix: createDryWetMixControl(
        audioContext,
        dryGain,
        wetGain
      ),
    },
    disposeNodes: [
      input,
      dryGain,
      wetInputGain,
      filter,
      wetGain,
      output,
      lfo,
      lfoDepth,
      {
        disconnect() {
          window.clearInterval(
            syncTimer
          );
          try {
            lfo.stop();
          } catch (_error) {
            // Ignore stop-after-stop differences across browsers.
          }
        },
      },
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {FlangerFXOptions} [options]
 * @returns {FlangerFXUnit}
 */
export function createFlangerFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const dryGain =
    audioContext.createGain();
  const wetInputGain =
    audioContext.createGain();
  const delay =
    audioContext.createDelay(0.05);
  const feedbackGain =
    audioContext.createGain();
  const wetGain =
    audioContext.createGain();
  const output =
    audioContext.createGain();
  const lfo =
    audioContext.createOscillator();
  const lfoDepth =
    audioContext.createGain();

  const resolveBeatSeconds =
    typeof options.getBeatSeconds ===
    "function"
      ? options.getBeatSeconds
      : () => 0.5;

  const state = {
    rate: clampNumber(
      options.rate,
      0.25,
      0.03125,
      16
    ),
  };

  delay.delayTime.value =
    clampNumber(
      options.time,
      0.004,
      0.0005,
      0.03
    );
  lfoDepth.gain.value =
    clampNumber(
      options.depth,
      0.002,
      0,
      0.02
    );
  feedbackGain.gain.value =
    clampNumber(
      options.feedback,
      0.25,
      0,
      0.95
    );
  lfo.type = "sine";
  setDryWetMix(
    dryGain,
    wetGain,
    options.mix ?? 1
  );

  function updateRate() {
    const beatSeconds =
      clampNumber(
        resolveBeatSeconds(),
        0.5,
        0.01,
        60
      );
    const periodSeconds =
      Math.max(
        0.01,
        state.rate * beatSeconds
      );
    lfo.frequency.setValueAtTime(
      1 / periodSeconds,
      audioContext.currentTime
    );
  }

  input.connect(dryGain);
  input.connect(wetInputGain);
  wetInputGain.connect(delay);
  delay.connect(feedbackGain);
  feedbackGain.connect(delay);
  delay.connect(wetGain);
  dryGain.connect(output);
  wetGain.connect(output);

  lfo.connect(lfoDepth);
  lfoDepth.connect(delay.delayTime);
  updateRate();
  lfo.start();

  const syncTimer =
    window.setInterval(() => {
      updateRate();
    }, 60);

  return createEffectUnit({
    type: "flanger",
    input,
    output,
    params: {
      time: createAudioParamControl(
        audioContext,
        delay.delayTime,
        {
          min: 0.0005,
          max: 0.03,
        }
      ),
      depth: createAudioParamControl(
        audioContext,
        lfoDepth.gain,
        {
          min: 0,
          max: 0.02,
        }
      ),
      rate: {
        get() {
          return state.rate;
        },
        set(value) {
          state.rate =
            clampNumber(
              value,
              state.rate,
              0.03125,
              16
            );
          updateRate();
          return state.rate;
        },
      },
      feedback:
        createAudioParamControl(
          audioContext,
          feedbackGain.gain,
          {
            min: 0,
            max: 0.95,
          }
        ),
      mix: createDryWetMixControl(
        audioContext,
        dryGain,
        wetGain
      ),
    },
    disposeNodes: [
      input,
      dryGain,
      wetInputGain,
      delay,
      feedbackGain,
      wetGain,
      output,
      lfo,
      lfoDepth,
      {
        disconnect() {
          window.clearInterval(
            syncTimer
          );
          try {
            lfo.stop();
          } catch (_error) {
            // Ignore stop-after-stop differences across browsers.
          }
        },
      },
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {ReverbFXOptions} [options]
 * @returns {ReverbFXUnit}
 */
export function createReverbFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const dryGain =
    audioContext.createGain();
  const wetGain =
    audioContext.createGain();
  const convolver =
    audioContext.createConvolver();
  const tone =
    audioContext.createBiquadFilter();
  const output =
    audioContext.createGain();

  convolver.buffer =
    createImpulseResponse(
      audioContext,
      options
    );
  tone.type = "lowpass";
  tone.frequency.value =
    clampNumber(
      options.tone,
      7200,
      200,
      20000
    );
  setDryWetMix(
    dryGain,
    wetGain,
    options.mix
  );

  input.connect(dryGain);
  input.connect(convolver);
  convolver.connect(tone);
  tone.connect(wetGain);
  dryGain.connect(output);
  wetGain.connect(output);

  return createEffectUnit({
    type: "reverb",
    input,
    output,
    params: {
      mix: createDryWetMixControl(
        audioContext,
        dryGain,
        wetGain
      ),
      tone: createAudioParamControl(
        audioContext,
        tone.frequency,
        {
          min: 200,
          max: 20000,
        }
      ),
    },
    disposeNodes: [
      input,
      dryGain,
      wetGain,
      convolver,
      tone,
      output,
    ],
  });
}

/**
 * @param {BaseAudioContext} audioContext
 * @param {SlicerFXOptions} [options]
 * @returns {SlicerFXUnit}
 */
export function createSlicerFX(
  audioContext,
  options = {}
) {
  const input =
    audioContext.createGain();
  const dryGain =
    audioContext.createGain();
  const wetInputGain =
    audioContext.createGain();
  const gateGain =
    audioContext.createGain();
  const wetGain =
    audioContext.createGain();
  const output =
    audioContext.createGain();
  const lfo =
    audioContext.createOscillator();
  const lfoDepth =
    audioContext.createGain();
  const controlSmoother =
    audioContext.createBiquadFilter();

  let phaseBeats =
    clampNumber(
      options.phase,
      0.25,
      0.03125,
      16
    );

  const resolveBeatSeconds =
    typeof options.getBeatSeconds ===
    "function"
      ? options.getBeatSeconds
      : () => 0.5;

  function updateRate() {
    const beatSeconds =
      clampNumber(
        resolveBeatSeconds(),
        0.5,
        0.01,
        60
      );
    const periodSeconds =
      Math.max(
        0.01,
        phaseBeats * beatSeconds
      );
    const frequency =
      1 / periodSeconds;
    lfo.frequency.setValueAtTime(
      frequency,
      audioContext.currentTime
    );
    controlSmoother.frequency.setValueAtTime(
      Math.max(
        24,
        Math.min(480, frequency * 18)
      ),
      audioContext.currentTime
    );
  }

  lfo.type = "square";
  lfoDepth.gain.value = 0.5;
  gateGain.gain.value = 0.5;
  controlSmoother.type =
    "lowpass";
  setDryWetMix(
    dryGain,
    wetGain,
    options.mix ?? 1
  );

  input.connect(dryGain);
  input.connect(wetInputGain);
  wetInputGain.connect(gateGain);
  gateGain.connect(wetGain);
  dryGain.connect(output);
  wetGain.connect(output);

  lfo.connect(lfoDepth);
  lfoDepth.connect(controlSmoother);
  controlSmoother.connect(
    gateGain.gain
  );
  updateRate();
  lfo.start();

  const syncTimer =
    window.setInterval(() => {
      updateRate();
    }, 60);

  return createEffectUnit({
    type: "slicer",
    input,
    output,
    params: {
      phase: {
        get() {
          return phaseBeats;
        },
        set(value) {
          phaseBeats = clampNumber(
            value,
            phaseBeats,
            0.03125,
            16
          );
          updateRate();
          return phaseBeats;
        },
      },
      mix: createDryWetMixControl(
        audioContext,
        dryGain,
        wetGain
      ),
    },
    disposeNodes: [
      input,
      dryGain,
      wetInputGain,
      gateGain,
      wetGain,
      output,
      lfo,
      lfoDepth,
      controlSmoother,
      {
        disconnect() {
          window.clearInterval(
            syncTimer
          );
          try {
            lfo.stop();
          } catch (_error) {
            // Ignore stop-after-stop differences across browsers.
          }
        },
      },
    ],
  });
}
