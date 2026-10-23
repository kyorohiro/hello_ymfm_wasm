import {attachChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {Huc6280Synth, HUC6280_CLOCK} from './huc6280synth.js?v=audio-stability-2';

/** Immediate, ordered register commands shared by Main and Worker runtimes.
 * @param {MessagePort} port
 * @param {{clock?:number}} [options] */
export function createHuc6280Client(port, options = {}, lifecycle = {}) {
  const {clock=HUC6280_CLOCK}=options;let disposed=false;
  const check=context=>{if(disposed||options.native&&lifecycle.isStopped?.(context))throw new Error('HuC6280 disposed or Run stopped');};
  const send=(method,args=[],metadata={})=>{check(lifecycle.captureContext?.());port.postMessage({method,args,...metadata});};
  const synth = new Huc6280Synth({clock, transport:{
    writeRegister(register, value, channel) { send('writeRegister',[register,value],{channel}); },
    reset() { send('reset'); },
    dispose() { if(disposed)return;port.postMessage({method:'dispose',args:[]});disposed=true;port.close(); },
  }});
  const controlled=attachChipClock(synth,port,clock);
  Object.defineProperty(synth,'_stopVoices',{value:()=>{
    const state=synth._getState();for(const registers of state.registers)registers[4]&=127;
    synth._adoptState(state);return controlled._requestControl('stopVoices');
  }});
  if(options.native){
    Object.defineProperty(synth,'_applyAuthorEdit',{value:patch=>{
      if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['clock','globals','registers','waveforms','indices'].includes(key)))throw new TypeError('Invalid HuC6280 author edit');
      const state=synth._getState(),integer=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max;
      for(const key of ['globals','registers','indices'])if(patch[key]!==undefined){
        if(!Array.isArray(patch[key])||patch[key].length>512)throw new TypeError('Invalid HuC6280 register edit');
        for(const entry of patch[key]){
          if(!Array.isArray(entry))throw new TypeError('Invalid HuC6280 register edit');
          if(key==='registers'){const [channel,address,value,mask=255]=entry;if(entry.length<3||entry.length>4||!integer(channel,7)||!integer(address,7)||!integer(value,255)||!integer(mask,255))throw new TypeError('Invalid HuC6280 register edit');state.registers[channel][address]=(state.registers[channel][address]&~mask)|(value&mask);}
          else{const [address,value,mask=255]=entry;if(entry.length<2||entry.length>3||!integer(address,key==='globals'?9:7)||!integer(value,key==='globals'?255:31)||!integer(mask,255))throw new TypeError('Invalid HuC6280 register edit');state[key][address]=(state[key][address]&~mask)|(value&mask);}
        }
      }
      if(patch.waveforms!==undefined){if(!Array.isArray(patch.waveforms)||patch.waveforms.length>8)throw new TypeError('Invalid HuC6280 waveform edit');for(const entry of patch.waveforms){if(!Array.isArray(entry)||entry.length!==2||!integer(entry[0],7)||!Array.isArray(entry[1])||entry[1].length!==32||entry[1].some(value=>!integer(value,31)))throw new TypeError('Invalid HuC6280 waveform edit');state.waveforms[entry[0]]=entry[1].slice();}}
      if(patch.clock!==undefined){if(!Number.isInteger(patch.clock)||patch.clock<100000||patch.clock>100000000)throw new RangeError('Invalid HuC6280 clock edit');state.clock=patch.clock;}
      synth._adoptState(state);
    }});
    const setClock=synth.setClock.bind(synth),resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{check(context);lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    synth.setClock=hz=>{const context=lifecycle.captureContext?.();check(context);return setClock(hz).then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;}));};
  }
  return controlled;
}

/** Builtin controls borrow the primary device; the runtime owns its lifetime. */
export function createPrimaryHuc6280Api(raw) {
  const api = {};
  for (const method of Object.getOwnPropertyNames(Huc6280Synth.prototype)) {
    if (method === 'constructor' || method === 'dispose' || method.startsWith('_')) continue;
    api[method] = (...args) => raw[method](...args);
  }
  api.setClock = (...args) => raw.setClock(...args);
  Object.defineProperties(api, {
    id:{value:'huc6280', enumerable:true},
    clock:{get:() => raw.clock, enumerable:true},
  });
  return api;
}
