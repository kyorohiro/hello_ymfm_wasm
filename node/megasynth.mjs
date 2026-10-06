/** Experimental Node controller. PCM stays in the owned Worker. */
import {Worker} from 'node:worker_threads';
import {EventEmitter} from 'node:events';
import {createNativeFXController} from '../web/native_fx.js';

const methods = ['setPreset', 'setOperator', 'setAlgo', 'setPan', 'setLfo',
  'setFrequency', 'noteOn', 'noteOff', 'write', 'reset', 'setDacEnabled', 'writeDac',
  'setChannel3SpecialMode', 'setChannel3SpecialFrequency'];
const aborted = () => new DOMException('MegaSynthNode was closed', 'AbortError');

export class MegaSynthNode extends EventEmitter {
  #options; #worker; #pending = new Map(); #id = 0; #generation = 0;
  #starting; #ready; #closing; #closed; #failure;
  state = 'idle'; fx;
  constructor(options = {}) {
    super();
    if (!Number.isInteger(options.queueBlocks ?? 4) || (options.queueBlocks ?? 4) < 2 || (options.queueBlocks ?? 4) > 16) throw new RangeError('queueBlocks must be from 2 to 16');
    if (!Number.isInteger(options.bufferFrames ?? 512) || (options.bufferFrames ?? 512) < 128 || (options.bufferFrames ?? 512) > 8192) throw new RangeError('bufferFrames must be from 128 to 8192');
    this.#options = structuredClone(options);
    this.fm = Object.fromEntries(methods.map(method => [method, (...args) => this.#request('fm', [method, args])]));
    this.recording = Object.fromEntries(['start', 'stop', 'export', 'import', 'play', 'stopPlayback', 'getState']
      .map(method => [method, (...args) => this.#request('recording', [method, args])]));
    this.looper = Object.fromEntries(['start', 'stop', 'clear', 'startRecording', 'finishRecording',
      'toggleRecord', 'undo', 'noteOn', 'noteOff', 'getState', 'getUnits']
      .map(method => [method, (...args) => this.#request('looper', [method, args])]));
  }
  start() {
    if (this.#closing) return this.#closing.then(() => this.start());
    if (this.#starting) return this.#starting;
    if (this.state === 'playing' || this.state === 'stopped') return Promise.resolve(this);
    this.state = 'starting'; this.#failure = null;
    const generation = ++this.#generation;
    let worker;
    try {worker = this.#worker = new Worker(new URL('./megasynth_worker.mjs', import.meta.url), {workerData: this.#options});}
    catch (error) {this.state = 'error'; return Promise.reject(error);}
    this.#starting = new Promise((resolve, reject) => {this.#ready = {resolve: () => resolve(this), reject};});
    this.#starting.catch(() => {});
    this.fx = createNativeFXController(command => {
      if (generation !== this.#generation) throw new Error('FX handle belongs to an earlier Worker');
      void this.#request('fx', [command]);
    });
    worker.on('message', message => {
      if (worker !== this.#worker) return;
      if (message.type === 'ready') {this.state = 'playing'; this.#ready?.resolve(); this.#ready = null;}
      else if (message.type === 'reply') {
        const pending = this.#pending.get(message.id); if (!pending) return;
        this.#pending.delete(message.id);
        if (message.error) {const error = new Error(message.error); this.#failure = error; pending.reject(error);}
        else pending.resolve(message.result);
      } else if (message.type === 'fatal') {this.#fail(new Error(message.error)); void this.close();}
      else if (message.type === 'closed') {this.#closed?.();}
    });
    worker.on('error', error => {this.#fail(error); void this.close();});
    worker.on('exit', code => {
      if (worker !== this.#worker) return;
      if (!this.#closing) this.#fail(new Error(`MegaSynth Worker exited unexpectedly (${code})`));
      this.#closed?.();
    });
    return this.#starting;
  }
  #fail(error) {
    this.state = 'error'; this.#failure = error;
    this.#ready?.reject(error); this.#ready = null;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    if (this.listenerCount('error')) this.emit('error', error);
  }
  get lastError() {return this.#failure;}
  #request(op, args = []) {
    if (!['playing', 'stopped'].includes(this.state) || !this.#worker) {
      const promise = Promise.reject(new Error('MegaSynthNode is not ready')); promise.catch(() => {}); return promise;
    }
    const id = ++this.#id;
    const promise = new Promise((resolve, reject) => {
      this.#pending.set(id, {resolve, reject});
      try {this.#worker.postMessage({id, op, args});}
      catch (error) {this.#pending.delete(id); reject(error);}
    });
    promise.catch(error => {this.#failure = error;});
    return promise;
  }
  async flush() {await this.#request('flush'); if (this.#failure) {const error = this.#failure; this.#failure = null; throw error;}}
  schedule(frame, command) {return this.#request('schedule', [frame, command]);}
  getState() {return this.#request('status');}
  async stop() {await this.#request('stop'); this.state = 'stopped';}
  async resume() {await this.#request('resume'); this.state = 'playing';}
  close() {
    if (this.#closing) return this.#closing;
    if (!this.#worker) {this.state = 'closed'; return Promise.resolve();}
    const worker = this.#worker; this.state = 'closing';
    this.#ready?.reject(aborted()); this.#ready = null;
    for (const pending of this.#pending.values()) pending.reject(aborted());
    this.#pending.clear();
    this.#closing = (async () => {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 5000);
        this.#closed = () => {clearTimeout(timer); resolve();};
        worker.postMessage({type: 'shutdown'});
      });
      await worker.terminate();
      if (this.#worker === worker) this.#worker = null;
      this.#starting = null; this.#closing = null; this.#closed = null; this.state = 'closed';
    })();
    return this.#closing;
  }
}
