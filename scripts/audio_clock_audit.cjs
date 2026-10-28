'use strict';

const {createHash} = require('node:crypto');

const PILOT_PERIOD = 2 ** 24;
const PROCESSOR_NAMES = Object.freeze({
  pilot: 'tetorica-clock-audit-pilot',
  extra: 'tetorica-clock-audit-extra',
  capture: 'tetorica-clock-audit-capture',
});

// Keep the analysis functions self-contained: browser checks also install their
// function source with addInitScript, without importing any production module.
function analyzePilotPcm(values, options = {}) {
  const period = options.period ?? 2 ** 24;
  const expectedFrames = options.expectedFrames ?? values.length;
  const receivedFrames = options.inputFrames ?? options.pilotInputFrames ?? values.length;
  const limit = 32;
  const sampleGaps = [];
  let nonFinite = 0;
  let invalidSamples = 0;
  let sampleGapCount = 0;
  let zeroSamples = 0;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === 0) zeroSamples++;
    if (!Number.isFinite(value)) nonFinite++;
    else if (value < 0 || value >= 1 || !Number.isInteger(value * period)) invalidSamples++;
    if (index === 0 || !Number.isFinite(value) || !Number.isFinite(values[index - 1])) continue;
    const previous = values[index - 1];
    const delta = ((value - previous) * period + period) % period;
    if (delta !== 1) {
      sampleGapCount++;
      if (sampleGaps.length < limit) sampleGaps.push({index, previous, value, delta});
    }
  }
  const validConfiguration = Number.isSafeInteger(period) && period > 1 &&
    Number.isSafeInteger(expectedFrames) && expectedFrames >= 2 &&
    Number.isSafeInteger(receivedFrames) && receivedFrames >= 0;
  const complete = values.length === expectedFrames && receivedFrames === expectedFrames;
  const continuous = validConfiguration && complete && nonFinite === 0 &&
    invalidSamples === 0 && sampleGapCount === 0;
  return {
    continuous, period, expectedFrames, frames: values.length, receivedFrames,
    complete, nonFinite, invalidSamples, sampleGapCount, sampleGaps, zeroSamples,
    firstSample: values.length ? values[0] : null,
    lastSample: values.length ? values[values.length - 1] : null,
  };
}

function analyzeClockRows(rows) {
  const gaps = [];
  const unstableReads = [];
  const malformedRows = [];
  let gapCount = 0;
  let unstableReadCount = 0;
  let malformedRowCount = 0;
  let expectedOffset = 0;
  let previous = null;
  const firstFrame = rows.length ? rows[0].frame : null;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const valid = Number.isSafeInteger(row.frame) && row.frame >= 0 &&
      Number.isSafeInteger(row.offset) && row.offset === expectedOffset &&
      Number.isSafeInteger(row.quantum) && row.quantum > 0 &&
      Number.isSafeInteger(row.ordinal) && (!previous || row.ordinal === previous.ordinal + 1);
    if (!valid) {
      malformedRowCount++;
      if (malformedRows.length < 32) malformedRows.push({index, ...row, expectedOffset});
    }
    const expectedFrame = firstFrame + row.offset;
    if (row.frame !== expectedFrame) {
      gapCount++;
      if (gaps.length < 32) gaps.push({index, frame: row.frame, expectedFrame,
        previousFrame: previous?.frame ?? null, offset: row.offset, quantum: row.quantum,
        ordinal: row.ordinal});
    }
    if ((row.frameAgain !== undefined && row.frameAgain !== row.frame) ||
        (row.endFrame !== undefined && row.endFrame !== row.frame) ||
        (row.endFrameAgain !== undefined && row.endFrameAgain !== row.frame)) {
      unstableReadCount++;
      if (unstableReads.length < 32) unstableReads.push({index, ...row});
    }
    expectedOffset += row.quantum;
    previous = row;
  }
  const measurementValid = rows.length > 0 && malformedRowCount === 0;
  return {
    continuous: measurementValid && gapCount === 0 && unstableReadCount === 0,
    measurementValid, rowCount: rows.length, firstFrame,
    lastFrame: rows.length ? rows[rows.length - 1].frame : null,
    frames: expectedOffset, gapCount, gaps, unstableReadCount, unstableReads,
    malformedRowCount, malformedRows,
  };
}

function hashFloat32Pcm(values) {
  const pcm = values instanceof Float32Array ? values : Float32Array.from(values);
  return createHash('sha256').update(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)).digest('hex');
}

// Pilot values count generated samples, independently of currentFrame. Every
// value is exactly representable in Float32, including the (2**24-1) -> 0 wrap.
// The capture is a silent graph sink; pilotInput:1 keeps the pilot separate from
// the real instrument arriving on input0. All physical output must also pass a
// zero-gain node maintained by the caller.
const processorSource = `
class ClockAuditPilot extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = 0;
    this.calls = 0;
    this.previous = null;
    this.previousQuantum = 0;
    this.clockGaps = [];
    this.clockGapCount = 0;
    this.port.onmessage = () => this.port.postMessage({
      frames: this.frames, calls: this.calls, clockGapCount: this.clockGapCount,
      clockGaps: this.clockGaps,
    });
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    const quantum = output[0].length;
    const frame = currentFrame;
    if (this.previous !== null && frame !== this.previous + this.previousQuantum) {
      this.clockGapCount++;
      if (this.clockGaps.length < 100) this.clockGaps.push({
        frame, expectedFrame: this.previous + this.previousQuantum,
        ordinal: this.calls, generatedFrames: this.frames, quantum,
      });
    }
    for (let index = 0; index < quantum; index++) {
      output[0][index] = ((this.frames + index) % 16777216) / 16777216;
    }
    for (let channel = 1; channel < output.length; channel++) output[channel].fill(0);
    this.previous = frame;
    this.previousQuantum = quantum;
    this.frames += quantum;
    this.calls++;
    return true;
  }
}
class ClockAuditExtra extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.port.onmessage = () => { this.active = false; };
  }
  process(_inputs, outputs) {
    for (const channel of outputs[0]) channel.fill(this.active ? 0.125 : 0);
    return this.active;
  }
}
class ClockAuditCapture extends AudioWorkletProcessor {
  constructor({processorOptions = {}} = {}) {
    super();
    this.pilotInput = processorOptions.pilotInput ?? 0;
    this.pending = null;
    this.ordinal = 0;
    this.port.onmessage = ({data}) => {
      if (this.pending) throw Error('Concurrent audio clock capture');
      if (!Number.isSafeInteger(data.frames) || data.frames < 2 || data.frames >= 16777216) {
        throw Error('Invalid audio clock capture frame count');
      }
      this.pending = {
        id: data.id, frames: data.frames, offset: 0,
        left: new Float32Array(data.frames), right: new Float32Array(data.frames),
        pilot: new Float32Array(data.frames), inputFrames: 0, pilotInputFrames: 0,
        firstFrame: null, lastFrame: null, frameGaps: 0, gaps: [], quantumFrames: [], rows: [],
      };
    };
  }
  process(inputs, outputs) {
    for (const channel of outputs[0]) channel.fill(0);
    const pending = this.pending;
    const ordinal = this.ordinal++;
    if (!pending) return true;
    const frame = currentFrame;
    const frameAgain = currentFrame;
    const time = currentTime;
    const quantum = outputs[0][0].length;
    const audio = inputs[0] ?? [];
    const pilot = inputs[this.pilotInput]?.[0];
    if (pending.firstFrame === null) pending.firstFrame = frame;
    if (frame !== pending.firstFrame + pending.offset) {
      pending.frameGaps++;
      if (pending.gaps.length < 100) pending.gaps.push({
        currentFrame: frame, expected: pending.firstFrame + pending.offset,
        offset: pending.offset, ordinal, quantum,
      });
    }
    if (!pending.quantumFrames.includes(quantum)) pending.quantumFrames.push(quantum);
    const count = Math.min(quantum, pending.frames - pending.offset);
    pending.inputFrames += Math.min(count, audio[0]?.length ?? 0);
    pending.pilotInputFrames += Math.min(count, pilot?.length ?? 0);
    for (let index = 0; index < count; index++) {
      const offset = pending.offset + index;
      pending.left[offset] = audio[0]?.[index] ?? 0;
      pending.right[offset] = audio[1]?.[index] ?? audio[0]?.[index] ?? 0;
      pending.pilot[offset] = pilot?.[index] ?? NaN;
    }
    pending.rows.push({
      frame, frameAgain, endFrame: currentFrame, endFrameAgain: currentFrame,
      currentTime: time, offset: pending.offset, ordinal, quantum,
      inputLengths: inputs.map(input => input.map(channel => channel.length)),
      pilotInputFrames: pilot?.length ?? 0, pilotFirst: pilot?.[0] ?? null,
    });
    pending.lastFrame = frame;
    pending.offset += count;
    if (pending.offset === pending.frames) {
      this.pending = null;
      this.port.postMessage(pending,
        [pending.left.buffer, pending.right.buffer, pending.pilot.buffer]);
    }
    return true;
  }
}
registerProcessor('${PROCESSOR_NAMES.pilot}', ClockAuditPilot);
registerProcessor('${PROCESSOR_NAMES.extra}', ClockAuditExtra);
registerProcessor('${PROCESSOR_NAMES.capture}', ClockAuditCapture);
`;

module.exports = {
  PILOT_PERIOD, PROCESSOR_NAMES, processorSource,
  analyzePilotPcm, analyzeClockRows, hashFloat32Pcm,
};
