// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

/** A short software output transition, independent of chip registers and note
 * ownership. The caller chooses the transition only after a valid command.
 * Settled attacks and bypass pass through the original PCM without changes.
 */
export class OutputClickGuard {
  #phase = 'bypass';
  #position = 0;
  #durationFrames;
  #lastLeft = 0;
  #lastRight = 0;
  #startLeft = 0;
  #startRight = 0;

  constructor({sampleRate, milliseconds = 5} = {}) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Click guard sample rate must be positive');
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new RangeError('Click guard duration must be positive');
    const frames = Math.max(2, Math.round(sampleRate * milliseconds / 1000));
    if (!Number.isSafeInteger(frames)) throw new RangeError('Click guard duration exceeds the frame limit');
    this.#durationFrames = frames;
  }

  attack() {this.#transition('attack');}
  release() {this.#transition('release');}
  #transition(phase) {
    this.#startLeft = this.#lastLeft;
    this.#startRight = this.#lastRight;
    this.#position = 0;
    this.#phase = phase;
  }
  bypass() {this.#phase = 'bypass'; this.#position = 0;}
  read() {
    return {phase:this.#phase, remainingFrames:this.#phase === 'attack' || this.#phase === 'release' ? this.#durationFrames - this.#position : 0,
      durationFrames:this.#durationFrames};
  }

  /** Validate the complete stereo block before mutating output or transition
   * state. Empty blocks are allowed and do not advance time.
   * @param {{left:Float32Array,right:Float32Array}} pcm
   */
  process(pcm) {
    const left = pcm?.left, right = pcm?.right;
    if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length) throw new TypeError('Click guard expects equal-length stereo Float32Arrays');
    if (left.buffer === right.buffer && left.byteOffset < right.byteOffset + right.byteLength && right.byteOffset < left.byteOffset + left.byteLength) throw new TypeError('Click guard channel buffers must not overlap');
    for (let index = 0; index < left.length; index++) {
      if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) throw new RangeError('Click guard PCM must contain finite samples');
    }
    for (let index = 0; index < left.length; index++) {
      if (this.#phase === 'muted') {
        left[index] = 0; right[index] = 0;
      } else if (this.#phase === 'attack' || this.#phase === 'release') {
        const targetLeft = this.#phase === 'attack' ? left[index] : 0;
        const targetRight = this.#phase === 'attack' ? right[index] : 0;
        if (this.#position === 0) {
          left[index] = this.#startLeft; right[index] = this.#startRight;
        } else if (this.#position === this.#durationFrames - 1) {
          left[index] = targetLeft; right[index] = targetRight;
        } else {
          const t = this.#position / (this.#durationFrames - 1), blend = t * t * (3 - 2 * t);
          left[index] = this.#startLeft * (1 - blend) + targetLeft * blend;
          right[index] = this.#startRight * (1 - blend) + targetRight * blend;
        }
        this.#position++;
        if (this.#position === this.#durationFrames) this.#phase = this.#phase === 'attack' ? 'bypass' : 'muted';
      }
      // Read back the rounded Float32 value: a later transition must start
      // exactly at the sample that was emitted, including during a retrigger.
      this.#lastLeft = left[index]; this.#lastRight = right[index];
    }
    return pcm;
  }
}
