import ym2612ModuleFactory from "./generated/ym2612_wasm.js";
import { createYm2612 } from "./ym2612.js";
import segaPsgModuleFactory from "./generated/segapsg_wasm.js";
import { SegaPSG, SEGAPSG_CLOCK } from "./segapsg.js";

// Same mix balance as GenesisAudioEngine.process() in genesisaudioengine.js.
const YM_GAIN = 0.9;
const PSG_GAIN = 0.35;
const VGM_SAMPLE_RATE = 44100;

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
    this.scheduledCommands = [];
    this.dacBanks = new Map();
    this.dacStreams = [];
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
    if (command.type === "schedule-writes") {
      for (const entry of command.entries ?? []) {
        this.scheduledCommands.push(entry);
      }
      this.scheduledCommands.sort((a, b) => a.time - b.time);
      return;
    }
    if (command.type === "clear-scheduled-writes") {
      this.scheduledCommands.length = 0;
      return;
    }
    if (command.type === "load-dac-bank") {
      this.dacBanks.set(
        command.name,
        new Uint8Array(command.data)
      );
      return;
    }
    if (command.type === "play-dac-bank") {
      const data = this.dacBanks.get(command.name);
      if (!data) {
        this.port.postMessage({
          type: "error",
          message: `Unknown DAC bank: ${command.name}`,
        });
        return;
      }
      this.dacStreams.push({
        data,
        startFrame: Math.round(command.time * sampleRate),
        offset: 0,
      });
      return;
    }
    if (command.type === "clear-dac-playback") {
      this.dacStreams.length = 0;
      return;
    }
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

    let offset = 0;
    const endFrame = currentFrame + leftOut.length;
    while (true) {
      const scheduled = this.scheduledCommands[0];
      const scheduledFrame = scheduled
        ? Math.round(scheduled.time * sampleRate)
        : Infinity;
      const dacFrame = this.nextDacFrame();
      const frame = Math.min(scheduledFrame, dacFrame);
      if (frame >= endFrame) break;
      const eventOffset = Math.max(offset, frame - currentFrame);
      this.renderFrames(leftOut, rightOut, offset, eventOffset - offset);
      offset = eventOffset;
      if (scheduledFrame === frame) {
        this.scheduledCommands.shift();
        this.ym2612.writeRegister(
          scheduled.register,
          scheduled.value,
          scheduled.port
        );
      }
      this.writeDueDacFrames(frame);
    }
    this.renderFrames(leftOut, rightOut, offset, leftOut.length - offset);
    this.capturePcm(leftOut, rightOut);
    this.captureOutputEnvelope(
      leftOut,
      rightOut
    );

    return true;
  }

  nextDacFrame() {
    let nextFrame = Infinity;
    for (const stream of this.dacStreams) {
      if (stream.offset + 5 > stream.data.length) continue;
      const offset = stream.offset;
      const samples = stream.data[offset] |
        (stream.data[offset + 1] << 8) |
        (stream.data[offset + 2] << 16) |
        (stream.data[offset + 3] << 24);
      nextFrame = Math.min(
        nextFrame,
        this.dacSampleOffsetToFrame(
          stream,
          samples >>> 0
        )
      );
    }
    return nextFrame;
  }

  writeDueDacFrames(frame) {
    for (let index = this.dacStreams.length - 1; index >= 0; index -= 1) {
      const stream = this.dacStreams[index];
      while (stream.offset + 5 <= stream.data.length) {
        const offset = stream.offset;
        const samples = stream.data[offset] |
          (stream.data[offset + 1] << 8) |
          (stream.data[offset + 2] << 16) |
          (stream.data[offset + 3] << 24);
        if (
          this.dacSampleOffsetToFrame(
            stream,
            samples >>> 0
          ) > frame
        ) {
          break;
        }
        this.ym2612.writeRegister(0x2a, stream.data[offset + 4], 0);
        stream.offset += 5;
      }
      if (stream.offset + 5 > stream.data.length) {
        this.dacStreams.splice(index, 1);
      }
    }
  }

  // VGM offsets are 44.1 kHz samples; AudioWorklet frames follow the device rate.
  dacSampleOffsetToFrame(stream, sampleOffset) {
    return stream.startFrame + Math.round(
      sampleOffset * sampleRate /
        VGM_SAMPLE_RATE
    );
  }

  renderFrames(leftOut, rightOut, offset, frames) {
    if (frames <= 0) return;
    const { left, right } = this.ym2612.generateStereo(frames);
    if (this.psg) {
      const psg = this.psg.generateStereo(frames);
      for (let index = 0; index < frames; index += 1) {
        left[index] = clampSample(left[index] * YM_GAIN + psg.left[index] * PSG_GAIN);
        right[index] = clampSample(right[index] * YM_GAIN + psg.right[index] * PSG_GAIN);
      }
    }
    leftOut.set(left, offset);
    rightOut.set(right, offset);
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
