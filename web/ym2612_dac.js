/**
 * @typedef {Uint8Array | ArrayBuffer | number[]} DacPcm
 * @typedef {{sampleRate: number}} DacSampleOptions
 * @typedef {{when?: number, offset?: number, size?: number, pan?: 'both' | 'left' | 'right'}} DacPlayOptions
 */
/** Unsigned 8-bit mono PCM. 128 is silence; this is not WAV or packed VGM data. */
/** @param {DacPcm} data */
export function copyDacPcm(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  if (data instanceof Uint8Array) return new Uint8Array(data);
  if (Array.isArray(data) && data.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
    return Uint8Array.from(data);
  }
  throw new TypeError('DAC PCM must be an ArrayBuffer, Uint8Array or array of bytes');
}

function rate(value) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('sampleRate must be positive');
  return value;
}
function name(value) {
  if (typeof value !== 'string' || !value.length) throw new TypeError('Sample name must be nonempty');
  return value;
}

/**
 * Shared Synth API. Promises acknowledge preparation/scheduling, not playback completion.
 * when is absolute seconds on the transport clock; omit it to start at the next rendered frame.
 */
export class YM2612Dac {
  constructor(transport) {
    this.transport = transport;
    this.enabled = false;
    this.value = 128;
  }
  _send(command) {
    if (typeof this.transport.dacCommand !== 'function') {
      return Promise.reject(new Error('PCM DAC playback requires YM2612DirectTransport or YM2612WorkletTransport'));
    }
    try { return Promise.resolve(this.transport.dacCommand(command)); }
    catch (error) { return Promise.reject(error); }
  }
  /**
   * Register a private copy; resolves when the playback backend has stored it.
   * @param {string} sampleName
   * @param {DacPcm} data
   * @param {DacSampleOptions} options
   * @returns {Promise<void>}
   */
  setSample(sampleName, data, {sampleRate}) {
    return this._send({action: 'load', name: name(sampleName), data: copyDacPcm(data), sampleRate: rate(sampleRate)});
  }
  /**
   * offset/size count PCM bytes. One DAC voice: a new start replaces the playing sample.
   * @param {string} sampleName
   * @param {DacPlayOptions} [options]
   * @returns {Promise<void>}
   */
  playFromSample(sampleName, options = {}) {
    return this._send({action: 'play', name: name(sampleName), ...playOptions(options)});
  }
  /**
   * Convenience playback without registering a reusable name.
   * @param {DacPcm} data
   * @param {DacSampleOptions & DacPlayOptions} options
   * @returns {Promise<void>}
   */
  play(data, {sampleRate, ...options}) {
    return this._send({action: 'play', data: copyDacPcm(data), sampleRate: rate(sampleRate), ...playOptions(options)});
  }
  /** Cancel pending starts, silence DAC and release CH6 for FM. Registered samples remain. */
  stop() { return this._send({action: 'stop'}); }
  /** Release a registered sample. Already accepted playback retains its data until it ends. */
  removeSample(sampleName) { return this._send({action: 'remove', name: name(sampleName)}); }
}

/** @param {DacPlayOptions} [options] */
function playOptions({when, offset = 0, size, pan = 'both'} = {}) {
  if (when !== undefined && (!Number.isFinite(when) || when < 0)) throw new RangeError('when must be nonnegative seconds');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('offset must be a nonnegative integer');
  if (size !== undefined && (!Number.isSafeInteger(size) || size <= 0)) throw new RangeError('size must be a positive integer');
  if (!['both', 'left', 'right'].includes(pan)) throw new RangeError('pan must be both, left or right');
  return {when, offset, size, pan};
}

/** Sample-clock scheduler shared by Node rendering and both YM2612 AudioWorklets. */
export class YM2612DacPlayer {
  constructor(sampleRate, write) {
    this.sampleRate = rate(sampleRate);
    this.write = write;
    this.samples = new Map();
    this.queue = [];
    this.active = null;
    this.panRegister = 0;
  }
  observeWrite(port, register, value) {
    if (port === 1 && register === 0xb6) this.panRegister = value;
  }
  command(command, frame) {
    if (command.action === 'load') {
      this.samples.set(name(command.name), {data: command.data, sampleRate: rate(command.sampleRate)});
      return;
    }
    if (command.action === 'remove') { this.samples.delete(command.name); return; }
    if (command.action === 'stop') { this.stop(); return; }
    if (command.action !== 'play') throw new Error('Unknown PCM DAC command');
    const sample = command.data ? command : this.samples.get(command.name);
    if (!sample) throw new Error(`Unknown PCM sample: ${command.name}`);
    const options = playOptions(command);
    const size = options.size ?? sample.data.length - options.offset;
    if (size <= 0 || options.offset + size > sample.data.length) throw new RangeError('PCM range is outside sample');
    const start = options.when === undefined ? frame : Math.ceil(options.when * this.sampleRate);
    // A late reservation starts now, without dropping the beginning of the sample.
    this.queue.push({...options, data: sample.data, sampleRate: sample.sampleRate, size, start: Math.max(frame, start), index: 0});
    this.queue.sort((a, b) => a.start - b.start);
  }
  nextFrame() {
    const activeFrame = this.active ? this.active.start + Math.ceil(this.active.index * this.sampleRate / this.active.sampleRate) : Infinity;
    return Math.min(this.queue[0]?.start ?? Infinity, activeFrame);
  }
  advance(frame) {
    while (this.nextFrame() <= frame) {
      const next = this.nextFrame();
      if (this.queue[0]?.start === next) {
        this.active = this.queue.shift();
        const pan = this.active.pan;
        this.write(1, 0xb6, (this.panRegister & 0x3f) | (pan === 'right' ? 0 : 0x80) | (pan === 'left' ? 0 : 0x40));
        this.write(0, 0x2a, 128);
        this.write(0, 0x2b, 0x80);
      } else if (this.active.index === this.active.size) {
        this.write(0, 0x2a, 128);
        this.write(0, 0x2b, 0);
        this.active = null;
      } else {
        this.write(0, 0x2a, this.active.data[this.active.offset + this.active.index++]);
      }
    }
  }
  stop() {
    this.queue.length = 0;
    if (this.active) {
      this.write(0, 0x2a, 128);
      this.write(0, 0x2b, 0);
    }
    this.active = null;
  }
  reset() { this.stop(); this.panRegister = 0; }
}

/** Receiver acknowledges only after the PCM is installed in the audio backend. */
export function receiveDacCommand(player, command, frame, reply) {
  if (command.type !== 'pcm-dac') return false;
  try {
    player.command(command.command, frame);
    reply({type: 'pcm-dac-result', id: command.id});
  } catch (error) {
    reply({type: 'pcm-dac-result', id: command.id, error: String(error.message ?? error)});
  }
  return true;
}
