// license:BSD-3-Clause
/** 32X PWM using the shared Native/WASM C++ core. No audio device. */
import {PWM32X_CLOCK} from './pwm32x.js?v=pwm-wasm-1';

const framesValid = frames => {
  if (!Number.isSafeInteger(frames) || frames < 0 || frames > 10000000) throw new RangeError('Invalid PWM frame count');
};

async function load(options) {
  options.signal?.throwIfAborted();
  if (options.moduleFactory) return options;
  const base = new URL(options.assetBaseUrl ?? (import.meta.url.includes('/web/') ? '../docs/generated/' : '../generated/'), import.meta.url);
  const {default:moduleFactory} = await import(new URL('pwm32x_wasm.js?v=pwm-wasm-1', base).href);
  const moduleOptions = {...options.moduleOptions};
  if (moduleOptions.wasmBinary === undefined && !moduleOptions.locateFile) {
    const url = new URL('pwm32x_wasm.wasm', base);
    if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
      const {readFile} = await import('node:fs/promises');
      moduleOptions.wasmBinary = await readFile(url, {signal:options.signal});
    } else {
      const response = await fetch(url, {signal:options.signal});
      if (!response.ok) throw new Error(`Failed to load PWM WASM: HTTP ${response.status}`);
      moduleOptions.wasmBinary = new Uint8Array(await response.arrayBuffer());
    }
  }
  options.signal?.throwIfAborted();
  return {...options, moduleFactory, moduleOptions};
}

export class PWM32XWasm {
  #states = new WeakMap();
  /** @param {import('./pwm32x.js?v=pwm-wasm-1').PWM32XOptions} [options] */
  static async create(options = {}) {
    const {clock = PWM32X_CLOCK, sampleRate = 48000, gain = .4, outputMode = 'dac'} = options;
    if (!['dac','duty'].includes(outputMode)) throw new RangeError('Invalid PWM output mode');
    if (!Number.isFinite(clock) || clock <= 0 || clock > 100000000) throw new RangeError('Invalid PWM clock');
    if (!Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 1000000) throw new RangeError('Invalid PWM sample rate');
    if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('Invalid PWM gain');
    const loaded = await load(options), module = await loaded.moduleFactory({...loaded.moduleOptions});
    options.signal?.throwIfAborted();
    const api = {};
    for (const [name,result,count] of [['create','number',4],['destroy',null,1],['reset',null,1],
      ['write',null,3],['read','number',2],['generate',null,4],['get','number',2],['set',null,3],
      ['fifo_count','number',2],['fifo_get','number',3],['fifo_set',null,4],['tick',null,1],['configure_timer',null,1],
      ['state_size','number',0],['save_state',null,2],['load_state',null,2]]) {
      // Numeric Emscripten exports are callable directly; cwrap also supports
      // factories that expose the common wrapper interface only.
      api[name] = module[`_pwm32x_${name}`] ?? module.cwrap(`pwm32x_${name}`, result, Array(count).fill('number'));
    }
    const stateSize = api.state_size();
    if (!Number.isInteger(stateSize) || stateSize <= 0 || stateSize > 4096) throw new Error('Unsupported PWM WASM state ABI');
    const handle = api.create(clock, sampleRate, gain, outputMode === 'duty');
    if (!handle) throw new Error('Could not allocate PWM WASM core');
    let chip;
    try {
      chip = new PWM32XWasm(module, handle, api, stateSize);
      chip.statePtr = module._malloc(stateSize);
      chip.fifoPtr = module._malloc(6);
      if (!chip.statePtr || !chip.fifoPtr) throw new Error('PWM state buffer allocation failed');
      chip.reserveStereoFrames(128); options.signal?.throwIfAborted();
      return chip;
    } catch (error) { if (chip) chip.dispose(); else api.destroy(handle); throw error; }
  }
  constructor(module, handle, api, stateSize) {
    /** @type {'wasm'} */ this.backend = 'wasm'; this.module = module; this.handle = handle; this.api = api;
    /** @type {number} */ this.stateSize = stateSize; this.statePtr = this.fifoPtr = this.ptr = this.capacity = 0;
    this.buffer = null; this.views = new Map(); this.closed = false;
    this.leftFifoView=this.liveFifo(0);this.rightFifoView=this.liveFifo(1);
  }
  assertOpen() {if (!this.handle) throw new Error('PWM chip is disposed');}
  /** @returns {number} */
  getField(field) {this.assertOpen();return this.api.get(this.handle,field);}
  setField(field,value) {this.assertOpen();this.api.set(this.handle,field,value);}
  get clock() {return this.getField(0);}
  set clock(value) {this.setField(0,value);}
  get rate() {return this.getField(1);}
  set rate(value) {this.setField(1,value);}
  get gain() {return this.getField(2);}
  set gain(value) {this.setField(2,value);}
  /** @returns {'dac'|'duty'} */
  get outputMode() {return this.getField(3)?'duty':'dac';}
  set outputMode(value) {this.setField(3,Number(value==='duty'));}
  get muted() {return Boolean(this.getField(4));}
  set muted(value) {this.setField(4,Number(Boolean(value)));}
  get control() {return this.getField(5);}
  set control(value) {this.setField(5,value);}
  get cycle() {return this.getField(6);}
  set cycle(value) {this.setField(6,value);}
  get cycleRegister() {return this.getField(7);}
  set cycleRegister(value) {this.setField(7,value);}
  /** @returns {number|null} */
  get left() {const value=this.getField(8);return value<0?null:value;}
  set left(value) {this.setField(8,value===null?-1:value);}
  /** @returns {number|null} */
  get right() {const value=this.getField(9);return value<0?null:value;}
  set right(value) {this.setField(9,value===null?-1:value);}
  get timerTick() {return this.getField(10);}
  set timerTick(value) {this.setField(10,value);}
  get interruptCount() {return this.getField(11);}
  set interruptCount(value) {this.setField(11,value);}
  get untilTick() {return this.getField(12);}
  set untilTick(value) {this.setField(12,value);}
  sampleRate() {return this.rate;}
  reset() {this.assertOpen(); this.api.reset(this.handle);}
  active() {return this.cycle !== 1 && (this.control & 15) !== 0;}
  configureTimer() {this.assertOpen(); this.api.configure_timer(this.handle);}
  tick() {this.assertOpen(); this.api.tick(this.handle);}
  /** @param {number} register @param {number} value */
  write(register,value) {this.writeRegister(register,value);}
  /** @param {number} register @param {number} value */
  writeRegister(register,value) {
    this.assertOpen();
    if (!Number.isInteger(register) || register < 0 || register > 4 || !Number.isInteger(value)) throw new RangeError('Invalid PWM register write');
    this.api.write(this.handle, register, value & 65535);
  }
  /** @param {number} register @returns {number} */
  read(register) {this.assertOpen(); return Number.isInteger(register)&&register>=0&&register<=4 ? this.api.read(this.handle, register) : 65535;}
  output() {
    this.assertOpen(); const scale = this.outputMode === 'duty' ? (this.cycle || 4095) / 2 : 2048;
    const output = value => value === null || this.muted ? 0 : ((value & 4095) / scale - 1) * this.gain;
    return [output(this.left), output(this.right)];
  }
  /** @param {number} side @returns {number[]} */
  fifo(side) {this.assertOpen(); return Array.from({length:this.api.fifo_count(this.handle,side)}, (_,index) => this.api.fifo_get(this.handle,side,index));}
  // Public FIFO arrays remain live for synchronous observers and legacy tools.
  // The renderer never touches these proxies: FIFO work happens in C++.
  /** @param {number} side @returns {number[]} */
  liveFifo(side) {
    const target=[],sync=()=>{const values=this.fifo(side);target.splice(0,target.length,...values);};
    const mutators=new Set(['push','pop','shift','unshift','splice','sort','reverse','fill','copyWithin']);
    let proxy;
    proxy=new Proxy(target,{
      get:(_target,key)=>{
        sync();
        if(mutators.has(key))return(...args)=>{const values=this.fifo(side),result=Array.prototype[key].apply(values,args);this.setFifo(side,values);return result===values?proxy:result;};
        return Reflect.get(target,key,proxy);
      },
      set:(_target,key,value)=>{sync();Reflect.set(target,key,value);this.setFifo(side,target);return true;},
      ownKeys:()=>{sync();return Reflect.ownKeys(target);},
      getOwnPropertyDescriptor:(_target,key)=>{sync();return Reflect.getOwnPropertyDescriptor(target,key);},
    });
    return proxy;
  }
  /** @param {number} side @param {number[]} values */
  setFifo(side,values) {
    this.assertOpen(); if (!Array.isArray(values) || values.length > 3 || values.some(value => !Number.isInteger(value))) throw new RangeError('Invalid PWM FIFO');
    const view = new DataView(this.module.HEAPU8.buffer);
    for (let index=0; index<values.length; index++) view.setUint16(this.fifoPtr+index*2,values[index]&65535,true);
    this.api.fifo_set(this.handle,side,this.fifoPtr,values.length);
  }
  get leftFifo() {this.assertOpen();return this.leftFifoView;}
  set leftFifo(values) {this.setFifo(0,values);}
  get rightFifo() {this.assertOpen();return this.rightFifoView;}
  set rightFifo(values) {this.setFifo(1,values);}
  refreshViews() {
    const buffer = this.module.HEAPF32.buffer;
    if (buffer !== this.buffer) {this.buffer = buffer; this.views.clear();}
  }
  /** @param {number} frames @returns {{left:Float32Array,right:Float32Array}} */
  pcmView(frames) {
    this.refreshViews(); let pcm = this.views.get(frames);
    if (!pcm) {
      pcm = {left:new Float32Array(this.buffer,this.ptr,frames),right:new Float32Array(this.buffer,this.ptr+this.capacity*4,frames)};
      if (this.views.size >= 256) for (const key of this.views.keys()) if (key > 128) {this.views.delete(key); break;}
      this.views.set(frames,pcm);
    }
    return pcm;
  }
  /** @param {number} frames */
  reserveStereoFrames(frames) {
    this.assertOpen(); framesValid(frames);
    if (frames > this.capacity) {
      const capacity = Math.max(128,frames), ptr = this.module._malloc(capacity*8);
      if (!ptr) throw new Error('PWM PCM allocation failed');
      if (this.ptr) this.module._free(this.ptr);
      this.ptr = ptr; this.capacity = capacity; this.buffer = null;
    }
    this.refreshViews();
    for (let count=0; count<=Math.min(128,this.capacity); count++) this.pcmView(count);
  }
  /** Scratch views remain valid until generation, growth or disposal.
   * @param {number} frames @returns {{left:Float32Array,right:Float32Array}} */
  generateStereoView(frames) {
    this.assertOpen(); framesValid(frames);
    if (frames > this.capacity) this.reserveStereoFrames(frames);
    const pcm = this.pcmView(frames);
    this.api.generate(this.handle,this.ptr,this.ptr+this.capacity*4,frames);
    return pcm;
  }
  /** @param {number} frames */
  generateStereo(frames) {const pcm=this.generateStereoView(frames); return {left:pcm.left.slice(),right:pcm.right.slice()};}
  /** Fill an output span using the preallocated WASM scratch buffer.
   * @param {Float32Array} left @param {Float32Array} right @param {number} [offset] @param {number} [frames] */
  renderInto(left,right,offset=0,frames=left.length-offset) {
    if (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(frames) || frames<0 || frames>left.length-offset || frames>right.length-offset) throw new RangeError('Invalid PCM output span');
    const pcm=this.generateStereoView(frames); left.set(pcm.left,offset); right.set(pcm.right,offset);
  }
  supportsState() {return !this.closed;}
  /** @returns {Readonly<{byteLength:number}>} */
  saveState() {
    this.assertOpen(); this.api.save_state(this.handle,this.statePtr);
    const bytes=this.module.HEAPU8.slice(this.statePtr,this.statePtr+this.stateSize), state=Object.freeze({byteLength:this.stateSize});
    this.#states.set(state,bytes); return state;
  }
  /** @param {Readonly<{byteLength:number}>} state */
  validateState(state) {this.assertOpen(); if (!this.#states.has(state)) throw new Error('Incompatible PWM state');}
  /** @param {Readonly<{byteLength:number}>} state */
  loadState(state) {this.validateState(state); this.module.HEAPU8.set(this.#states.get(state),this.statePtr); this.api.load_state(this.handle,this.statePtr);}
  dispose() {
    if (this.ptr) this.module._free(this.ptr); if (this.statePtr) this.module._free(this.statePtr); if (this.fifoPtr) this.module._free(this.fifoPtr);
    if (this.handle) this.api.destroy(this.handle);
    this.handle=this.ptr=this.statePtr=this.fifoPtr=this.capacity=0; this.closed=true; this.views.clear(); this.buffer=null;
  }
}
