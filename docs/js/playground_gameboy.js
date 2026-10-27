import {attachChipClock, CHIP_CLOCKS} from './playground_chip_clock.js?v=wonderswan-pcm-timeline-1';
import {GameboySynth} from './gameboysynth.js?v=audio-stability-2';
/** Same immediate, ordered port writes for both raw and high-level APIs. */
/** @param {MessagePort} port */
export function createGameboyClient(port, options = {}, lifecycle = {}) {
  let disposed=false;
  const check=context=>{if(disposed||options.native&&lifecycle.isStopped?.(context))throw new Error('Game Boy disposed or Run stopped');};
  const send=(method,args=[])=>{check(lifecycle.captureContext?.());port.postMessage({method,args});};
  const client=attachChipClock(new GameboySynth({clock:options.clock??CHIP_CLOCKS.gameboy,transport: {
    writeRegister(offset, value) { send('writeRegister',[offset,value]); },
    reset() { send('reset'); },
    dispose() { if(disposed)return;port.postMessage({method:'dispose',args:[]});disposed=true;port.close(); },
  }}), port, options.clock??CHIP_CLOCKS.gameboy);
  if(options.native){
    Object.defineProperties(client,{
      _stopVoices:{value:()=>client._requestControl('stopVoices')},
      _applyAuthorEdit:{value:patch=>{
        if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['clock','initialized','registers','voice'].includes(key)))throw new TypeError('Invalid Game Boy author edit');
        const state=client._getState();
        if(patch.initialized!==undefined){if(typeof patch.initialized!=='boolean')throw new TypeError('Invalid Game Boy initialization edit');state.initialized=patch.initialized;}
        for(const key of ['registers','voice'])if(patch[key]!==undefined){
          if(!Array.isArray(patch[key])||patch[key].length>96)throw new TypeError('Invalid Game Boy register edit');
          for(const entry of patch[key]){if(!Array.isArray(entry)||entry.length<2||entry.length>3||!Number.isInteger(entry[0])||entry[0]<0||entry[0]>=48||!Number.isInteger(entry[1])||entry[1]<0||entry[1]>255||entry[2]!==undefined&&(!Number.isInteger(entry[2])||entry[2]<0||entry[2]>255))throw new TypeError('Invalid Game Boy register edit');const [address,value,mask=255]=entry;state[key][address]=(state[key][address]&~mask)|(value&mask);}
        }
        // Validate the clock before adopting any part of the patch.
        if(patch.clock!==undefined){if(!Number.isInteger(patch.clock)||patch.clock<100000||patch.clock>100000000)throw new RangeError('Invalid Game Boy clock edit');state.clock=patch.clock;}
        client._adoptState(state);
      }},
    });
    const setClock=client.setClock.bind(client);
    const resume=(context,callback)=>new Promise((resolve,reject)=>setTimeout(()=>{try{check(context);lifecycle.restoreContext?.(context);resolve(callback());}catch(error){reject(error);}},0));
    client.setClock=hz=>{const context=lifecycle.captureContext?.();check(context);return setClock(hz).then(value=>resume(context,()=>value),error=>resume(context,()=>{throw error;}));};
  }
  return client;
}

/** Safe builtin controls borrow the primary device, whose lifetime belongs to the runtime. */
export function createPrimaryGameboyApi(raw) {
  const api = {pulse:raw.pulse, wave:raw.wave, noise:raw.noise};
  for (const method of Object.getOwnPropertyNames(GameboySynth.prototype)) {
    if (method === 'constructor' || method === 'dispose' || method.startsWith('_')) continue;
    api[method] = (...args) => raw[method](...args);
  }
  api.setClock = (...args) => raw.setClock(...args);
  Object.defineProperties(api, {
    id:{value:'gameboy', enumerable:true},
    clock:{get:() => raw.clock, enumerable:true},
  });
  return api;
}
