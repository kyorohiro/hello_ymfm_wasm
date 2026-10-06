/** Experimental offline MegaSynth engine. Browser / Node; no audio device. */
import {createSoundChip} from './soundchip.js';
import {YM2612Synth, YM2612DirectTransport} from './ym2612synth.js';
import {NativeFXEngine} from './native_fx_engine.js';
import {createNativeFXController} from './native_fx.js';

const FM_METHODS = new Set(['setPreset', 'setOperator', 'setAlgo', 'setPan',
  'setLfo', 'setFrequency', 'noteOn', 'noteOff', 'write', 'reset']);

/** Load the same native FX WASM used by the browser Worklet. */
async function loadFX(options) {
  if (options.fxModule) return options.fxModule;
  let bytes = options.fxWasmBinary;
  if (!bytes) {
    const url = new URL(options.fxWasmUrl ?? './native_audio_effect.wasm', import.meta.url);
    if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
      const {readFile} = await import('node:fs/promises');
      bytes = await readFile(url, {signal: options.signal});
    } else {
      const response = await fetch(url, {signal: options.signal});
      if (!response.ok) throw new Error(`Native FX WASM: HTTP ${response.status}`);
      bytes = await response.arrayBuffer();
    }
  }
  return WebAssembly.compile(bytes);
}

/**
 * Create an experimental YM2612 + nativeFX offline renderer.
 * This is a separate entry point; the existing browser MegaSynth is unchanged.
 * Options: sampleRate (default 48000), masterVolume (default 1), chipOptions,
 * fxModule / fxWasmBinary / fxWasmUrl, signal.
 */
export async function createMegaSynthOffline(options = {}) {
  const sampleRate = options.sampleRate ?? 48000;
  const masterVolume = options.masterVolume ?? 1;
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError('sampleRate must be an integer from 8000 to 192000');
  }
  if (!Number.isFinite(masterVolume) || masterVolume < 0 || masterVolume > 3.8) {
    throw new RangeError('masterVolume must be from 0 to 3.8');
  }
  options.signal?.throwIfAborted();
  const module = await loadFX(options);
  options.signal?.throwIfAborted();
  const dsp = new NativeFXEngine(module, sampleRate);
  const chip = await createSoundChip('ym2612', {...options.chipOptions, signal: options.signal});
  try {
    options.signal?.throwIfAborted();
    return new MegaSynthOffline(chip, dsp, sampleRate, masterVolume);
  } catch (error) { chip.dispose(); throw error; }
}

class MegaSynthOffline {
  #chip; #dsp; #transport; #frame = 0; #closed = false;
  #events = []; #order = 0; #phase = 0; #lastLeft = 0; #lastRight = 0;
  #idleLeft; #idleRight; #chipRate;
  #sampleRate; #masterVolume;

  constructor(chip, dsp, sampleRate, masterVolume) {
    this.#chip = chip; this.#dsp = dsp; this.#sampleRate = sampleRate;
    this.#masterVolume = masterVolume; this.#chipRate = chip.sampleRate();
    const idle = chip.generateStereoView(1);
    this.#idleLeft = idle.left[0]; this.#idleRight = idle.right[0]; chip.reset();
    this.#transport = new YM2612DirectTransport(chip);
    // Retained fm/fx handles must reject commands after close().
    const write = this.#transport.write.bind(this.#transport);
    this.#transport.write = (port, register, value) => {
      this.#assertOpen(); return write(port, register, value);
    };
    for (const method of ['reset', 'dacCommand']) {
      if (typeof this.#transport[method] !== 'function') continue;
      const original = this.#transport[method].bind(this.#transport);
      this.#transport[method] = (...args) => {
        this.#assertOpen();
        if (method === 'reset') { this.#phase = 0; this.#lastLeft = 0; this.#lastRight = 0; }
        return original(...args);
      };
    }
    this.fm = new YM2612Synth({transport: this.#transport});
    this.fx = createNativeFXController(command => {
      this.#assertOpen(); this.#dsp.command(structuredClone(command));
    });
  }

  get currentFrame() { return this.#frame; }
  get sampleRate() { return this.#sampleRate; }
  get masterVolume() { return this.#masterVolume; }
  get currentTime() { return this.#frame / this.sampleRate; }
  #assertOpen() { if (this.#closed) throw new Error('MegaSynthOffline is closed'); }

  /** Cancel future notes and FX tails while retaining the configured patches/chain. */
  stop() {
    this.#assertOpen(); this.clearSchedule();
    for (let channel = 0; channel < 6; channel++) this.fm.noteOff(channel);
    this.#transport.dacPlayer?.reset();
    this.#transport.write(0, 0x2b, 0);
    this.#dsp.samples.clear(); this.#dsp.resetNoise(); this.#dsp.command({op: 'clear'});
  }

  clearSchedule() {this.#assertOpen(); this.#events.length = 0;}

  /** Apply the shared native FX command protocol without a Web Audio transport. */
  applyFX(command) { this.#assertOpen(); this.#dsp.command(structuredClone(command)); }

  /** Absolute output-frame timestamp; serializable FM commands, stable order. */
  schedule(frame, command) {
    this.#assertOpen();
    if (!Number.isSafeInteger(frame) || frame < this.#frame) throw new RangeError('Cannot schedule before currentFrame');
    if (!command || command.target !== 'fm' || !FM_METHODS.has(command.method) ||
        typeof this.fm[command.method] !== 'function' || !Array.isArray(command.args)) {
      throw new TypeError('Expected {target: "fm", method, args}');
    }
    this.#events.push({frame, command: structuredClone(command), order: this.#order++});
    this.#events.sort((a, b) => a.frame - b.frame || a.order - b.order);
  }

  /** Advance the sample clock, render the chip, then apply native FX. */
  render(frames) {
    this.#assertOpen();
    if (!Number.isSafeInteger(frames) || frames < 0 || frames > 10000000 || !Number.isSafeInteger(this.#frame + frames)) {
      throw new RangeError('frames must be an integer from 0 to 10000000');
    }
    const left = new Float32Array(frames), right = new Float32Array(frames);
    let offset = 0;
    while (true) {
      while (this.#events[0]?.frame === this.#frame) {
        const {command} = this.#events.shift();
        this.fm[command.method](...command.args);
      }
      if (offset === frames) break;
      // Match AudioWorklet's usual render quantum; split at event boundaries.
      const count = Math.min(128, frames - offset, (this.#events[0]?.frame ?? Infinity) - this.#frame);
      const nativeFrames = Math.floor((this.#phase + count * this.#chipRate) / this.sampleRate);
      const pcm = nativeFrames ? this.#transport.generateStereo(nativeFrames) : null;
      const input = [new Float32Array(count), new Float32Array(count)];
      let nativeOffset = 0;
      for (let i = 0; i < count; i++) {
        this.#phase += this.#chipRate;
        const consumed = Math.floor(this.#phase / this.sampleRate);
        this.#phase -= consumed * this.sampleRate;
        if (consumed) {
          let l = 0, r = 0;
          for (let j = 0; j < consumed; j++, nativeOffset++) {
            l += pcm.left[nativeOffset] - this.#idleLeft;
            r += pcm.right[nativeOffset] - this.#idleRight;
          }
          this.#lastLeft = l / consumed; this.#lastRight = r / consumed;
        }
        input[0][i] = this.#lastLeft; input[1][i] = this.#lastRight;
      }
      const output = [left.subarray(offset, offset + count), right.subarray(offset, offset + count)];
      this.#dsp.process(input, output);
      for (const channel of output) for (let i = 0; i < count; i++) channel[i] *= this.masterVolume;
      this.#frame += count; offset += count;
    }
    return {left, right, sampleRate: this.sampleRate};
  }

  close() {
    if (this.#closed) return;
    this.#closed = true; this.#events.length = 0;
    this.#chip.dispose(); this.#chip = null; this.#dsp = null;
  }
}
