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

function disconnectNode(node) {
  try {
    node?.disconnect();
  } catch (_error) {
    // Ignore double-disconnect or browser-specific disconnect errors.
  }
}

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
      mix: {
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
      },
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
      mix: {
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
      },
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
