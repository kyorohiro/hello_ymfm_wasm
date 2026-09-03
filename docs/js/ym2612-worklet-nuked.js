// Same as ym2612-worklet.js, backed by the Nuked-OPN2 WASM build instead of
// ymfm. Keep this file's only difference from ym2612-worklet.js the import
// below, so fixes to the processor logic are easy to port between the two.
import ym2612ModuleFactory from "../generated/nuked_opn2_wasm.js";
import { createYm2612 } from "./ym2612.js";
import segaPsgModuleFactory from "../generated/segapsg_wasm.js";
import { SegaPSG, SEGAPSG_CLOCK } from "./segapsg.js";

// Same mix balance as GenesisAudioEngine.process() in genesisaudioengine.js.
const YM_GAIN = 0.9;
const PSG_GAIN = 0.35;

function clampSample(value) {
  if (value < -1) {
    return -1;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

class YM2612Processor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.ym2612 = null;
    this.psg = null;
    this.pendingCommands = [];
    this.envelopeRmsBuckets = [];
    this.envelopeBucketSize = 512;
    this.envelopeMessageSize = 16;
    this.captureActive = false;
    this.captureId = null;
    this.captureLeftChunks = [];
    this.captureRightChunks = [];
    this.captureFrameCount = 0;

    this.port.onmessage = (event) => {
      const command = event.data;

      if (command.type === "initialize") {
        void this.init(
          command.wasmBinary,
          command.psgWasmBinary
        );
        return;
      }

      if (!this.ym2612) {
        this.pendingCommands.push(command);
        return;
      }

      this.applyCommand(command);
    };
  }

  async init(wasmBinary, psgWasmBinary) {
    try {
      this.ym2612 = await createYm2612(
        ym2612ModuleFactory,
        {
          wasmBinary: new Uint8Array(wasmBinary),
        }
      );
      this.ym2612.setHooks({
        onIrq: (asserted) => {
          this.port.postMessage({
            type: "irq",
            asserted,
          });
        },
      });

      if (psgWasmBinary) {
        // dynamic import() is disallowed inside WorkletGlobalScope, so
        // segaPsgModuleFactory is a static top-level import above; pages
        // that never opt into PSG (e.g. the Synth demo) still pay a small
        // fixed cost to fetch/parse that glue module, but never instantiate
        // it since psgWasmBinary is only sent when a caller opts in.
        this.psg = await SegaPSG.create({
          moduleFactory:
            segaPsgModuleFactory,
          moduleOptions: {
            wasmBinary: new Uint8Array(
              psgWasmBinary
            ),
          },
          sampleRate:
            this.ym2612.sampleRate(),
          clock: SEGAPSG_CLOCK,
        });
      }

      for (const command of this.pendingCommands) {
        this.applyCommand(command);
      }

      this.pendingCommands.length = 0;

      this.port.postMessage({
        type: "ready",
      });
    } catch (error) {
      this.port.postMessage({
        type: "error",
        message: error instanceof Error
          ? error.message
          : String(error),
      });
    }
  }

  applyCommand(command) {
    if (command.type === "write") {
      this.ym2612.writeRegister(
        command.register,
        command.value,
        command.port
      );
      return;
    }

    if (command.type === "psg-write") {
      this.psg?.write(command.value);
      return;
    }

    if (command.type === "psg-reset") {
      this.psg?.reset();
      return;
    }

    if (command.type === "reset") {
      this.ym2612.reset();
      this.psg?.reset();
      return;
    }

    if (command.type === "start-capture") {
      this.captureActive = true;
      this.captureId =
        command.captureId ?? null;
      this.captureLeftChunks = [];
      this.captureRightChunks = [];
      this.captureFrameCount = 0;
      return;
    }

    if (command.type === "stop-capture") {
      this.flushCapture();
      return;
    }

    if (command.type === "discard-capture") {
      this.captureActive = false;
      this.captureId = null;
      this.captureLeftChunks = [];
      this.captureRightChunks = [];
      this.captureFrameCount = 0;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];

    if (!output || output.length < 2) {
      return true;
    }

    const leftOut = output[0];
    const rightOut = output[1];

    if (!this.ym2612) {
      leftOut.fill(0);
      rightOut.fill(0);
      return true;
    }

    const { left, right } =
      this.ym2612.generateStereo(leftOut.length);

    if (this.psg) {
      const psg =
        this.psg.generateStereo(
          leftOut.length
        );

      for (
        let index = 0;
        index < leftOut.length;
        index += 1
      ) {
        left[index] = clampSample(
          left[index] * YM_GAIN +
            psg.left[index] * PSG_GAIN
        );
        right[index] = clampSample(
          right[index] * YM_GAIN +
            psg.right[index] * PSG_GAIN
        );
      }
    }

    leftOut.set(left);
    rightOut.set(right);
    this.capturePcm(left, right);
    this.captureOutputEnvelope(
      left,
      right
    );

    return true;
  }

  captureOutputEnvelope(left, right) {
    const frames =
      Math.min(
        left.length,
        right.length
      );

    for (
      let start = 0;
      start < frames;
      start +=
        this.envelopeBucketSize
    ) {
      const end = Math.min(
        frames,
        start +
          this.envelopeBucketSize
      );
      let sum = 0;

      for (
        let index = start;
        index < end;
        index += 1
      ) {
        const mixed =
          (left[index] +
            right[index]) *
          0.5;
        sum += mixed * mixed;
      }

      const rms = Math.sqrt(
        sum /
          Math.max(
            1,
            end - start
          )
      );
      this.envelopeRmsBuckets.push(rms);
    }

    if (
      this.envelopeRmsBuckets.length >=
      this.envelopeMessageSize
    ) {
      const rmsValues =
        new Float32Array(
          this.envelopeRmsBuckets.splice(
            0,
            this.envelopeMessageSize
          )
        );

      this.port.postMessage(
        {
          type: "output-envelope",
          rmsValues,
        },
        [rmsValues.buffer]
      );
    }

    while (
      this.envelopeRmsBuckets.length >
      this.envelopeMessageSize * 8
    ) {
      this.envelopeRmsBuckets.splice(
        0,
        this.envelopeMessageSize
      );
    }
  }

  capturePcm(left, right) {
    if (!this.captureActive) {
      return;
    }

    this.captureLeftChunks.push(
      new Float32Array(left)
    );
    this.captureRightChunks.push(
      new Float32Array(right)
    );
    this.captureFrameCount +=
      Math.min(
        left.length,
        right.length
      );
  }

  flushCapture() {
    const captureId =
      this.captureId;
    const frameCount =
      this.captureFrameCount;
    const leftData =
      new Float32Array(frameCount);
    const rightData =
      new Float32Array(frameCount);

    let writeOffset = 0;
    for (const chunk of this.captureLeftChunks) {
      leftData.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }

    writeOffset = 0;
    for (const chunk of this.captureRightChunks) {
      rightData.set(chunk, writeOffset);
      writeOffset += chunk.length;
    }

    this.captureActive = false;
    this.captureId = null;
    this.captureLeftChunks = [];
    this.captureRightChunks = [];
    this.captureFrameCount = 0;

    this.port.postMessage(
      {
        type: "capture-stopped",
        captureId,
        frameCount,
        left: leftData,
        right: rightData,
      },
      [
        leftData.buffer,
        rightData.buffer,
      ]
    );
  }
}

registerProcessor("ym2612-processor", YM2612Processor);
