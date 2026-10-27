/** Register transports: Synth stays on the caller thread, chip runs in AudioWorklet. */
export class ChipWorkletTransport {
  /** @param {import("./soundchip_worklet.js?v=pokey-prepare-1").WorkletSoundChip | MessagePort} endpoint */
  constructor(endpoint) {
    this.endpoint = endpoint?.execution === 'worklet' ? endpoint : null;
    this.port = endpoint?.port ?? endpoint;
    if (!this.port?.postMessage) throw new TypeError('Expected worklet chip endpoint or MessagePort');
    this.disposed = false;
  }
  send(method, args) {if (this.disposed) throw new Error('Transport disposed'); this.port.postMessage({method, args});}
  reset() {this.send('reset', []);}
  write(...args) {this.send('write', args);}
  writeRegister(...args) {this.send('writeRegister', args);}
  start() {if (!this.endpoint) return Promise.reject(new Error('start() requires a worklet chip endpoint')); return this.endpoint.start();}
  stop() {return this.endpoint?.stop() ?? Promise.resolve();}
  flush() {return this.endpoint?.request('barrier') ?? Promise.resolve();}
  dispose() {this.disposed = true;}
  async close() {this.dispose(); await this.endpoint?.dispose();}
}
export class GameboyWorkletTransport extends ChipWorkletTransport {}
export class SegaPSGWorkletTransport extends ChipWorkletTransport {}
export class YM2151WorkletTransport extends ChipWorkletTransport {}
export class YM2413WorkletTransport extends ChipWorkletTransport {}
export class OPLWorkletTransport extends ChipWorkletTransport {}
export class YM3526WorkletTransport extends OPLWorkletTransport {}
export class YM3812WorkletTransport extends OPLWorkletTransport {}
export class Y8950WorkletTransport extends OPLWorkletTransport {}
export class YMF262WorkletTransport extends OPLWorkletTransport {}

export class AY8910WorkletTransport extends ChipWorkletTransport {}

let wonderSwanRequestSequence = 0;
function wonderSwanInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid WonderSwan ${label}`);
  return value;
}
/** A register write scheduled in absolute AudioContext seconds.
 * @typedef {{time:number,register?:number,address?:number,value:number,port?:0}} WonderSwanScheduledWrite
 */
/** Borrow a WonderSwan AudioWorklet endpoint or transferred transport port.
 * Reads and RAM uploads acknowledge work on the audio thread. Disposing this
 * transport releases its requests/listeners, without destroying a borrowed chip.
 */
export class WonderSwanWorkletTransport extends ChipWorkletTransport {
  #pending = new Map(); #failure; #message; #messageError;
  /** @param {import('./soundchip_worklet.js?v=pokey-prepare-1').WorkletSoundChip | MessagePort} endpoint */
  constructor(endpoint) {
    super(endpoint);
    if (this.endpoint && this.endpoint.name !== 'wonderswan') throw new TypeError('Expected WonderSwan worklet endpoint');
    if (!this.endpoint) {
      if (typeof this.port.addEventListener !== 'function') throw new TypeError('Expected a MessagePort with event listeners');
      this.#message = ({data}) => {
        if (data?.type === 'disposed') {this.#fail(new Error(data.error ?? 'Worklet chip is disposed')); return;}
        const pending = this.#pending.get(data?.id);
        if (!pending) return;
        this.#pending.delete(data.id);
        data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.value);
      };
      this.#messageError = () => this.#fail(new Error('WonderSwan transport message could not be decoded'));
      this.port.addEventListener('message', this.#message);
      this.port.addEventListener('messageerror', this.#messageError);
      this.port.start?.();
    }
  }
  #alive() {if (this.disposed) throw new Error('Transport disposed'); if (this.#failure) throw this.#failure;}
  #fail(error) {this.#failure = error; for (const request of this.#pending.values()) request.reject(error); this.#pending.clear();}
  /** @returns {Promise<unknown>} */
  #request(method, args = []) {
    this.#alive();
    const id = `wonderswan-transport:${++wonderSwanRequestSequence}`;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, {resolve, reject});
      try {
        if (this.endpoint) {
          this.endpoint.request(method, args).then(value => {
            const pending = this.#pending.get(id); if (!pending) return;
            this.#pending.delete(id); pending.resolve(value);
          }, error => {
            const pending = this.#pending.get(id); if (!pending) return;
            this.#pending.delete(id); pending.reject(error);
          });
        } else this.port.postMessage({method, args, id});
      } catch (error) {this.#pending.delete(id); reject(error);}
    });
  }
  /** Absolute hardware register 0x80..0x9f. Optional ownership metadata is used by Synth.
   * @param {number} address
   * @param {number} value
   * @param {number} [channel]
   * @param {number} [controlMask]
   */
  writeRegister(address, value, channel, controlMask) {
    this.#alive(); wonderSwanInteger(address, 0x80, 0x9f, 'register address'); wonderSwanInteger(value, 0, 255, 'register byte');
    if (channel !== undefined) wonderSwanInteger(channel, 0, 3, 'channel');
    if (controlMask !== undefined) wonderSwanInteger(controlMask, 0, 255, 'control mask');
    this.port.postMessage({method:'writeRegister', args:[address, value], ...(channel === undefined ? {} : {channel}), ...(controlMask === undefined ? {} : {controlMask})});
  }
  /** Write one packed byte in the 16 KiB wave RAM.
   * @param {number} address
   * @param {number} value
   * @param {number} [channel]
   */
  writeMemory(address, value, channel) {
    this.#alive(); wonderSwanInteger(address, 0, 0x3fff, 'RAM address'); wonderSwanInteger(value, 0, 255, 'RAM byte');
    if (channel !== undefined) wonderSwanInteger(channel, 0, 3, 'channel');
    this.port.postMessage({method:'writeMemory', args:[address, value], ...(channel === undefined ? {} : {channel})});
  }
  reset() {this.#alive(); this.send('reset', []);}
  /** Copy and upload packed wave RAM, resolving after the audio thread applies it.
   * @param {Uint8Array} bytes
   * @param {number} [offset=0]
   * @returns {Promise<void>}
   */
  loadMemory(bytes, offset = 0) {
    this.#alive();
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected WonderSwan RAM Uint8Array');
    wonderSwanInteger(offset, 0, 0x4000, 'RAM offset');
    if (bytes.length > 0x4000 - offset) throw new RangeError('WonderSwan RAM upload exceeds 16 KiB');
    return /** @type {Promise<void>} */ (this.#request('loadMemory', [bytes.slice(), offset]));
  }
  /** @param {number} address @returns {Promise<number>} */
  readRegister(address) {wonderSwanInteger(address, 0x80, 0x9f, 'register address'); return /** @type {Promise<number>} */ (this.#request('readRegister', [address]));}
  /** @param {number} address @returns {Promise<number>} */
  readMemory(address) {wonderSwanInteger(address, 0, 0x3fff, 'RAM address'); return /** @type {Promise<number>} */ (this.#request('readMemory', [address]));}
  /** @param {number} channel @param {boolean} muted @returns {Promise<void>} */
  setChannelMuted(channel, muted) {
    wonderSwanInteger(channel, 0, 3, 'channel'); if (typeof muted !== 'boolean') throw new TypeError('Expected boolean WonderSwan mute');
    return /** @type {Promise<void>} */ (this.#request('setChannelMuted', [channel, muted]));
  }
  /** Queue at most 65536 pending writes before playback. The input is copied.
   * @param {WonderSwanScheduledWrite[]} entries
   * @returns {Promise<number>} Number of accepted writes.
   */
  scheduleWrites(entries) {
    this.#alive();
    if (!Array.isArray(entries)) throw new TypeError('Expected WonderSwan scheduled write array');
    if (entries.length > 65536) throw new RangeError('WonderSwan schedule exceeds 65536 writes');
    const copied = entries.map(entry => {
      if (!entry || typeof entry !== 'object' || !Number.isFinite(entry.time) || entry.time < 0) throw new RangeError('Invalid WonderSwan scheduled write time');
      if (entry.port !== undefined && entry.port !== 0) throw new RangeError('Invalid WonderSwan scheduled write port');
      const register = entry.register ?? entry.address;
      if (entry.register !== undefined && entry.address !== undefined && entry.register !== entry.address) throw new RangeError('Conflicting WonderSwan scheduled register address');
      wonderSwanInteger(register, 0x80, 0x9f, 'register address'); wonderSwanInteger(entry.value, 0, 255, 'register byte');
      return {time:entry.time, port:0, register, value:entry.value};
    });
    return /** @type {Promise<number>} */ (this.#request('schedule-writes', [copied]));
  }
  /** @returns {Promise<void>} */
  clearScheduledWrites() {return /** @type {Promise<void>} */ (this.#request('clear-scheduled-writes'));}
  /** Resolve only after all prior messages on this transport port were applied. */
  flush() {return this.#request('barrier').then(() => {});}
  dispose() {
    if (this.disposed) return;
    super.dispose(); this.#fail(new Error('Transport disposed'));
    if (this.#message) this.port.removeEventListener('message', this.#message);
    if (this.#messageError) this.port.removeEventListener('messageerror', this.#messageError);
  }
}

let pokeyRequestSequence = 0;
function pokeyInteger(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`Invalid Pokey ${label}`);
  return value;
}
/** A register write scheduled in absolute AudioContext seconds.
 * @typedef {{time:number,register?:number,address?:number,value:number,port?:0}} PokeyScheduledWrite
 */
/** Borrow a Pokey AudioWorklet endpoint or transferred transport port.
 * Reads acknowledge work on the audio thread. Disposing this
 * transport releases its requests/listeners, without destroying a borrowed chip.
 */
export class PokeyWorkletTransport extends ChipWorkletTransport {
  #pending = new Map(); #failure; #message; #messageError;
  /** @param {import('./soundchip_worklet.js?v=pokey-prepare-1').WorkletSoundChip | MessagePort} endpoint */
  constructor(endpoint) {
    super(endpoint);
    if (this.endpoint && this.endpoint.name !== 'pokey') throw new TypeError('Expected Pokey worklet endpoint');
    if (!this.endpoint) {
      if (typeof this.port.addEventListener !== 'function') throw new TypeError('Expected a MessagePort with event listeners');
      this.#message = ({data}) => {
        if (data?.type === 'disposed') {this.#fail(new Error(data.error ?? 'Worklet chip is disposed')); return;}
        const pending = this.#pending.get(data?.id);
        if (!pending) return;
        this.#pending.delete(data.id);
        data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.value);
      };
      this.#messageError = () => this.#fail(new Error('Pokey transport message could not be decoded'));
      this.port.addEventListener('message', this.#message);
      this.port.addEventListener('messageerror', this.#messageError);
      this.port.start?.();
    }
  }
  #alive() {if (this.disposed) throw new Error('Transport disposed'); if (this.#failure) throw this.#failure;}
  #fail(error) {this.#failure = error; for (const request of this.#pending.values()) request.reject(error); this.#pending.clear();}
  /** @returns {Promise<unknown>} */
  #request(method, args = []) {
    this.#alive();
    const id = `pokey-transport:${++pokeyRequestSequence}`;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, {resolve, reject});
      try {
        if (this.endpoint) {
          this.endpoint.request(method, args).then(value => {
            const pending = this.#pending.get(id); if (!pending) return;
            this.#pending.delete(id); pending.resolve(value);
          }, error => {
            const pending = this.#pending.get(id); if (!pending) return;
            this.#pending.delete(id); pending.reject(error);
          });
        } else this.port.postMessage({method, args, id});
      } catch (error) {this.#pending.delete(id); reject(error);}
    });
  }
  /** Absolute hardware register 0x00..0x0f. Optional ownership metadata is used by Synth.
   * @param {number} address
   * @param {number} value
   * @param {number} [channel]
   */
  writeRegister(address, value, channel) {
    this.#alive(); pokeyInteger(address, 0, 15, 'register address'); pokeyInteger(value, 0, 255, 'register byte');
    if (channel !== undefined) pokeyInteger(channel, 0, 3, 'channel');
    this.port.postMessage({method:'writeRegister', args:[address, value], ...(channel === undefined ? {} : {channel})});
  }
  get clock() {return this.endpoint?.clock;}
  reset() {this.#alive(); this.send('reset', []);}
  /** Hardware read map, not the write-only authored register bank.
   * @param {number} address @returns {Promise<number>} */
  readRegister(address) {pokeyInteger(address, 0, 15, 'register address'); return /** @type {Promise<number>} */ (this.#request('readRegister', [address]));}
  /** Authored write bank and monitoring mutes, never hardware read aliases.
   * @returns {Promise<{clock:number,registers:number[],mutedChannels:number[]}>} */
  getState() {return /** @type {Promise<{clock:number,registers:number[],mutedChannels:number[]}>} */ (this.#request('getState'));}
  /** @param {number} channel @param {boolean} muted @returns {Promise<void>} */
  setChannelMuted(channel, muted) {
    pokeyInteger(channel, 0, 3, 'channel'); if (typeof muted !== 'boolean') throw new TypeError('Expected boolean Pokey mute');
    return /** @type {Promise<void>} */ (this.#request('setChannelMuted', [channel, muted]));
  }
  /** Queue at most 65536 pending writes before playback. The input is copied.
   * @param {PokeyScheduledWrite[]} entries
   * @returns {Promise<number>} Number of accepted writes.
   */
  scheduleWrites(entries) {
    this.#alive();
    if (!Array.isArray(entries)) throw new TypeError('Expected Pokey scheduled write array');
    if (entries.length > 65536) throw new RangeError('Pokey schedule exceeds 65536 writes');
    const copied = entries.map(entry => {
      if (!entry || typeof entry !== 'object' || !Number.isFinite(entry.time) || entry.time < 0) throw new RangeError('Invalid Pokey scheduled write time');
      if (entry.port !== undefined && entry.port !== 0) throw new RangeError('Invalid Pokey scheduled write port');
      const register = entry.register ?? entry.address;
      if (entry.register !== undefined && entry.address !== undefined && entry.register !== entry.address) throw new RangeError('Conflicting Pokey scheduled register address');
      pokeyInteger(register, 0, 15, 'register address'); pokeyInteger(entry.value, 0, 255, 'register byte');
      return {time:entry.time, port:0, register, value:entry.value};
    });
    return /** @type {Promise<number>} */ (this.#request('schedule-writes', [copied]));
  }
  /** @returns {Promise<void>} */
  clearScheduledWrites() {return /** @type {Promise<void>} */ (this.#request('clear-scheduled-writes'));}
  /** Resolve only after all prior messages on this transport port were applied. */
  flush() {return this.#request('barrier').then(() => {});}
  dispose() {
    if (this.disposed) return;
    super.dispose(); this.#fail(new Error('Transport disposed'));
    if (this.#message) this.port.removeEventListener('message', this.#message);
    if (this.#messageError) this.port.removeEventListener('messageerror', this.#messageError);
  }
}
