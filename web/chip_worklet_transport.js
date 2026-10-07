/** Register transports: Synth stays on the caller thread, chip runs in AudioWorklet. */
export class ChipWorkletTransport {
  /** @param {import("./soundchip_worklet.js").WorkletSoundChip | MessagePort} endpoint */
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
