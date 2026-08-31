const NOISE_BUFFER_SECONDS = 8;

const NOISE_TYPES = new Set([
  "white",
  "pink",
  "brown",
  "gray",
  "clip",
]);

const NOISE_BUFFER_CACHE =
  new WeakMap();

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

function getNoiseBufferMap(
  audioContext
) {
  let map =
    NOISE_BUFFER_CACHE.get(
      audioContext
    ) ?? null;

  if (!map) {
    map = new Map();
    NOISE_BUFFER_CACHE.set(
      audioContext,
      map
    );
  }

  return map;
}

function fillWhiteNoise(
  channelData
) {
  for (
    let index = 0;
    index < channelData.length;
    index += 1
  ) {
    channelData[index] =
      Math.random() * 2 - 1;
  }
}

function fillPinkNoise(
  channelData
) {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (
    let index = 0;
    index < channelData.length;
    index += 1
  ) {
    const white =
      Math.random() * 2 - 1;

    b0 =
      0.99886 * b0 +
      white * 0.0555179;
    b1 =
      0.99332 * b1 +
      white * 0.0750759;
    b2 =
      0.969 * b2 +
      white * 0.153852;
    b3 =
      0.8665 * b3 +
      white * 0.3104856;
    b4 =
      0.55 * b4 +
      white * 0.5329522;
    b5 =
      -0.7616 * b5 -
      white * 0.016898;

    channelData[index] =
      (
        b0 +
        b1 +
        b2 +
        b3 +
        b4 +
        b5 +
        b6 +
        white * 0.5362
      ) * 0.11;

    b6 = white * 0.115926;
  }
}

function fillBrownNoise(
  channelData
) {
  let lastOut = 0;

  for (
    let index = 0;
    index < channelData.length;
    index += 1
  ) {
    const white =
      Math.random() * 2 - 1;
    lastOut =
      (lastOut +
        0.02 * white) /
      1.02;
    channelData[index] =
      lastOut * 3.5;
  }
}

function fillGrayNoise(
  channelData
) {
  let previous = 0;

  for (
    let index = 0;
    index < channelData.length;
    index += 1
  ) {
    const white =
      Math.random() * 2 - 1;
    const current =
      white - previous * 0.985;
    previous = white;
    channelData[index] =
      current * 0.75;
  }
}

function fillClipNoise(
  channelData
) {
  for (
    let index = 0;
    index < channelData.length;
    index += 1
  ) {
    const white =
      Math.random() * 2 - 1;
    if (white > 0.2) {
      channelData[index] = 1;
    } else if (white < -0.2) {
      channelData[index] = -1;
    } else {
      channelData[index] = 0;
    }
  }
}

function createNoiseBuffer(
  audioContext,
  type
) {
  const normalizedType =
    NOISE_TYPES.has(type)
      ? type
      : "white";
  const bufferMap =
    getNoiseBufferMap(
      audioContext
    );
  const existing =
    bufferMap.get(
      normalizedType
    ) ?? null;

  if (existing) {
    return existing;
  }

  const frameCount = Math.max(
    1,
    Math.floor(
      audioContext.sampleRate *
        NOISE_BUFFER_SECONDS
    )
  );
  const audioBuffer =
    audioContext.createBuffer(
      1,
      frameCount,
      audioContext.sampleRate
    );
  const channelData =
    audioBuffer.getChannelData(0);

  if (normalizedType === "pink") {
    fillPinkNoise(channelData);
  } else if (
    normalizedType === "brown"
  ) {
    fillBrownNoise(channelData);
  } else if (
    normalizedType === "gray"
  ) {
    fillGrayNoise(channelData);
  } else if (
    normalizedType === "clip"
  ) {
    fillClipNoise(channelData);
  } else {
    fillWhiteNoise(channelData);
  }

  bufferMap.set(
    normalizedType,
    audioBuffer
  );
  return audioBuffer;
}

function resolveOutputNode(
  megaDrive
) {
  return (
    megaDrive.sampleOutputNode ??
    megaDrive.masterInputNode ??
    megaDrive.outputNode ??
    megaDrive.audioContext
      .destination
  );
}

function normalizeNoiseType(type) {
  return NOISE_TYPES.has(type)
    ? type
    : "white";
}

function createNoiseVoice(
  megaDrive,
  activeVoices,
  options = {}
) {
  const audioContext =
    megaDrive.audioContext;

  if (!audioContext) {
    throw new Error(
      "noise.create() requires MegaSynth to be initialized first"
    );
  }

  const stereoPannerSupported =
    typeof audioContext
      .createStereoPanner ===
    "function";
  const gainNode =
    audioContext.createGain();
  const filterNode =
    audioContext.createBiquadFilter();
  const pannerNode =
    stereoPannerSupported
      ? audioContext.createStereoPanner()
      : audioContext.createGain();

  filterNode.type = "lowpass";
  filterNode.frequency.value =
    1600;
  filterNode.Q.value = 0.2;
  gainNode.gain.value =
    clampNumber(
      options.gain,
      0.3,
      0,
      8
    );

  if (stereoPannerSupported) {
    pannerNode.pan.value =
      clampNumber(
        options.pan,
        0,
        -1,
        1
      );
  }

  filterNode.connect(gainNode);
  gainNode.connect(pannerNode);
  pannerNode.connect(
    resolveOutputNode(
      megaDrive
    )
  );

  const voice = {
    type: normalizeNoiseType(
      options.type
    ),
    gain:
      createAudioParamControl(
        audioContext,
        gainNode.gain,
        { min: 0, max: 8 }
      ),
    pan: stereoPannerSupported
      ? createAudioParamControl(
          audioContext,
          pannerNode.pan,
          {
            min: -1,
            max: 1,
          }
        )
      : {
          get() {
            return 0;
          },
          set() {
            return 0;
          },
          rampTo() {
            return 0;
          },
        },
    filter: {
      set(
        type,
        frequency,
        q = filterNode.Q.value
      ) {
        filterNode.type =
          String(type);
        voice.filter.cutoff.set(
          frequency
        );
        voice.filter.q.set(q);
      },
      cutoff:
        createAudioParamControl(
          audioContext,
          filterNode.frequency,
          {
            min: 10,
            max: 20000,
          }
        ),
      q: createAudioParamControl(
        audioContext,
        filterNode.Q,
        {
          min: 0.0001,
          max: 1000,
        }
      ),
    },
    start() {
      if (voice.disposed) {
        throw new Error(
          "noise voice has already been disposed"
        );
      }
      if (voice.source) {
        return;
      }

      const source =
        audioContext.createBufferSource();
      source.buffer =
        createNoiseBuffer(
          audioContext,
          voice.type
        );
      source.loop = true;
      source.connect(filterNode);
      source.addEventListener(
        "ended",
        () => {
          if (voice.source === source) {
            voice.source =
              null;
          }
          try {
            source.disconnect();
          } catch {}
        },
        { once: true }
      );
      voice.source = source;
      source.start();
    },
    stop() {
      if (!voice.source) {
        return;
      }
      const source = voice.source;
      voice.source = null;
      source.stop();
      try {
        source.disconnect();
      } catch {}
    },
    dispose() {
      if (voice.disposed) {
        return;
      }
      voice.stop();
      voice.disposed = true;
      activeVoices.delete(voice);
      try {
        filterNode.disconnect();
      } catch {}
      try {
        gainNode.disconnect();
      } catch {}
      try {
        pannerNode.disconnect();
      } catch {}
    },
    source: null,
    disposed: false,
  };

  activeVoices.add(voice);

  if (options.autoStart !== false) {
    voice.start();
  }

  return voice;
}

export function createPlaygroundNoiseApi(
  megaDrive
) {
  const activeVoices =
    new Set();

  return {
    create(options = {}) {
      return createNoiseVoice(
        megaDrive,
        activeVoices,
        options
      );
    },
    stopAll() {
      for (const voice of activeVoices) {
        voice.stop();
      }
    },
  };
}
