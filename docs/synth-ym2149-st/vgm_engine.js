// SPDX-License-Identifier: BSD-3-Clause
import factory from '../generated/ay8910_wasm.js';
import {Ay8910AudioEngine} from '../js/ay8910audioengine.js';
import {checkYmVgmAbort} from './vgm_source.js';

/** Synchronous native AY rendering with the existing Synth speaker centering.
 * The host applies its calibrated chip / master gains once, after this output.
 */
export async function createYmVgmEngine(source, {signal, moduleFactory = factory, wasmBinary} = {}) {
  checkYmVgmAbort(signal);
  if (source?.format !== 'vgm' || !Array.isArray(source.trace?.events) || !Number.isInteger(source.durationFrames) || source.durationFrames < 0)
    throw new TypeError('Prepare an AY VGM source before creating its engine');
  const type = source.header.ay8910Type, flags = source.header.ay8910Flags;
  const chipEngine = await Ay8910AudioEngine.create({
    moduleFactory, moduleOptions: wasmBinary ? {wasmBinary} : undefined,
    clock: source.clock, type, flags, outputSampleRate: 44100, masterVolume: 1,
  });
  let disposed = false, frame = 0, cursor = 0, muteMask = 7, speakerOffset = 0;
  const registers = new Uint8Array(16), registerKnown = new Uint8Array(16), events = source.trace.events;
  const centerSpeaker = type === 0x10 && !!(flags & 1);
  const open = () => {
    if (disposed) throw new Error('YM VGM engine is disposed');
    checkYmVgmAbort(signal);
  };
  const applyAtFrame = () => {
    while (cursor < events.length && events[cursor].time <= frame) {
      const {register, value} = events[cursor++];
      chipEngine.writeAy8910(register, value);
      registers[register] = value;
      registerKnown[register] = 1;
      if (register >= 8 && register <= 10) {
        const bit = 1 << (register - 8);
        muteMask = value & 31 ? muteMask & ~bit : muteMask | bit;
        chipEngine.ay8910.setMuteMask(muteMask);
        const active = 3 - ((muteMask & 1) + ((muteMask >> 1) & 1) + ((muteMask >> 2) & 1));
        speakerOffset = centerSpeaker ? Math.fround(active * 0.125 / 3) : 0;
      }
    }
  };
  try {
    checkYmVgmAbort(signal);
    chipEngine.ay8910.setMuteMask(7);
    applyAtFrame();
    const api = {
      clock: source.clock,
      sampleRate: () => 44100,
      get frame() { return frame; },
      get ended() { return frame >= source.durationFrames; },
      processFrames(count) {
        open();
        if (!Number.isInteger(count) || count < 0 || count > 0x1000000) throw new RangeError('Invalid YM VGM frame count');
        const length = Math.min(count, source.durationFrames - frame);
        const left = new Float32Array(length), right = new Float32Array(length);
        let written = 0;
        while (written < length) {
          applyAtFrame();
          const next = Math.min(frame + length - written, events[cursor]?.time ?? Infinity);
          const size = next - frame;
          if (size <= 0) throw new Error('YM VGM timeline did not advance');
          const pcm = chipEngine.processFrames(size);
          if (speakerOffset) for (let index = 0; index < size; index++) {
            pcm.left[index] += speakerOffset; pcm.right[index] += speakerOffset;
          }
          left.set(pcm.left, written); right.set(pcm.right, written);
          written += size; frame += size;
        }
        applyAtFrame();
        return {left, right};
      },
      snapshot() {
        open();
        return {frame, clock: source.clock, type, flags, effectiveClock: source.clock / (flags & 0x10 ? 2 : 1), registers: Array.from(registers), registerKnown: Array.from(registerKnown)};
      },
      dispose() { if (!disposed) { disposed = true; chipEngine.dispose(); } },
    };
    return api;
  } catch (error) { chipEngine.dispose(); throw error; }
}
