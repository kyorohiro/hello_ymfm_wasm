class TetoricaBitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "bitDepth",
        defaultValue: 16,
        minValue: 2,
        maxValue: 16,
        automationRate: "k-rate",
      },
      {
        name: "holdFrames",
        defaultValue: 1,
        minValue: 1,
        maxValue: 32,
        automationRate: "k-rate",
      },
      {
        name: "mix",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
    ];
  }

  constructor() {
    super();
    this.channelState = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output) {
      return true;
    }

    const channelCount = output.length;
    while (this.channelState.length < channelCount) {
      this.channelState.push({
        holdCounter: 0,
        heldSample: 0,
        nsError: 0,
      });
    }

    for (let channel = 0; channel < channelCount; channel += 1) {
      const inputChannel =
        input?.[channel] ?? output[channel];
      const outputChannel = output[channel];
      const state =
        this.channelState[channel];

      for (let index = 0; index < outputChannel.length; index += 1) {
        const bitDepth =
          readParam(
            parameters.bitDepth,
            index
          );
        const holdFrames = Math.max(
          1,
          Math.round(
            readParam(
              parameters.holdFrames,
              index
            )
          )
        );
        const mix =
          readParam(
            parameters.mix,
            index
          );
        const source =
          inputChannel?.[index] ?? 0;

        if (state.holdCounter <= 0) {
          const lsb =
            2 / Math.pow(2, bitDepth);
          const dither =
            (Math.random() +
              Math.random() -
              1) * lsb;
          const shaped = Math.max(
            -1,
            Math.min(
              1,
              source +
                dither -
                state.nsError * 0.85
            )
          );
          state.heldSample =
            quantizeSample(
              shaped,
              bitDepth
            );
          state.nsError =
            state.heldSample - shaped;
          state.holdCounter =
            holdFrames - 1;
        } else {
          state.holdCounter -= 1;
        }

        outputChannel[index] =
          source +
          (state.heldSample - source) *
            mix;
      }
    }

    return true;
  }
}

function readParam(values, index) {
  return values.length === 1
    ? values[0]
    : values[index];
}

function quantizeSample(sample, bitDepth) {
  const resolvedBitDepth = Math.max(
    2,
    Math.min(16, Math.round(bitDepth))
  );

  if (resolvedBitDepth >= 16) {
    return sample;
  }

  const levels = 2 ** resolvedBitDepth;
  const normalized = (sample + 1) * 0.5;
  const quantized =
    Math.round(
      normalized * (levels - 1)
    ) /
    (levels - 1);
  return quantized * 2 - 1;
}

registerProcessor(
  "tetorica-bitcrusher",
  TetoricaBitcrusherProcessor
);
