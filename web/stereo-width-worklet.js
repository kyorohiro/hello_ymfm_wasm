class TetoricaStereoWidthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "width",
        defaultValue: 1,
        minValue: 0,
        maxValue: 2,
        automationRate: "k-rate",
      },
    ];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!output || output.length === 0) {
      return true;
    }

    if (!input || input.length === 0) {
      for (let channel = 0; channel < output.length; channel += 1) {
        output[channel].fill(0);
      }
      return true;
    }

    const leftIn =
      input[0] ??
      input[1] ??
      new Float32Array(output[0].length);
    const rightIn =
      input[1] ??
      input[0] ??
      leftIn;
    const leftOut = output[0];
    const rightOut =
      output[1] ?? output[0];

    for (let index = 0; index < leftOut.length; index += 1) {
      const width = readParam(
        parameters.width,
        index
      );
      const left = leftIn[index] ?? 0;
      const right = rightIn[index] ?? left;
      const mid = (left + right) * 0.5;
      const side =
        (left - right) *
        0.5 *
        width;
      const gain =
        width > 1 ? 1 / width : 1;

      leftOut[index] =
        (mid + side) * gain;
      if (output[1]) {
        rightOut[index] =
          (mid - side) * gain;
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

registerProcessor(
  "tetorica-stereo-width",
  TetoricaStereoWidthProcessor
);
