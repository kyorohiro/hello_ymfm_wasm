import {createAy8910Client} from './playground_ay8910.js?v=extra-ym2612-nuked-1';
import {createPWM32XClient} from './pwm32x_playback.js?v=extra-ym2612-nuked-1';
import {createNesClient} from './playground_nes.js?v=extra-ym2612-nuked-1';
import {createSnesClient} from './playground_snes.js?v=extra-ym2612-nuked-1';
import {createYm2151Client} from './playground_ym2151.js?v=extra-ym2612-nuked-1';
import {createHuc6280Client} from './playground_huc6280.js?v=extra-ym2612-nuked-1';
import {createSegaPsgClient} from './playground_segapsg.js?v=audio-numeric-bindings-1';
import {createOki6258Client} from './playground_okim6258.js?v=extra-ym2612-nuked-1';
import {createYm2413Client} from './playground_ym2413.js?v=extra-ym2612-nuked-1';
import {createOplClient, OPL_CHIPS} from './playground_opl.js?v=extra-ym2612-nuked-1';
import {createDx7Client} from './playground_dx7.js?v=extra-ym2612-nuked-1';
import {createGameboyClient} from './playground_gameboy.js?v=extra-ym2612-nuked-1';

/** Primary controls borrow devices owned by the runtime. */
export function borrowNativeApi(raw, id, changed = () => {}, before = () => true) {
  const cache = new WeakMap();
  const wrap = (object, path = []) => {
    if (!object || typeof object !== 'object') return object;
    if (cache.has(object)) return cache.get(object);
    // Frozen chip sections still need guarded functions. The facade has no
    // frozen own properties, so returning wrappers respects Proxy invariants.
    const proxy = new Proxy(Object.create(Object.getPrototypeOf(object)), {get(_target, key) {
      if (key === 'then' || key === 'dispose' || key === 'transport' ||
          key === 'constructor' || (typeof key === 'string' && key.startsWith('_'))) return undefined;
      if (key === 'id' && object === raw) return id;
      const value = Reflect.get(object, key, object);
      if (typeof value !== 'function') return value && typeof value === 'object' &&
        ['pulse','triangle','noise','dmc','fds','wave'].includes(key) ? wrap(value, [...path, key]) : value;
      return (...args) => {
        const method = [...path, key];
        if (before(method, args) === false) return;
        const result = value.apply(object, args);
        changed(method, args);
        if (result?.then) return result.then(value => {changed(method, args); return value;});
        return result;
      };
    },has:(_target,key)=>Reflect.has(object,key),ownKeys:()=>Reflect.ownKeys(object),
      getOwnPropertyDescriptor(_target,key){
        const descriptor=Reflect.getOwnPropertyDescriptor(object,key);
        return descriptor?{configurable:true,enumerable:descriptor.enumerable,
          writable:'writable'in descriptor?descriptor.writable:!!descriptor.set,value:proxy[key]}:undefined;
      },set:(_target,key,value)=>Reflect.set(object,key,value,object),
      deleteProperty:(_target,key)=>Reflect.deleteProperty(object,key),
      defineProperty(_target,key,descriptor){
        // A nonconfigurable facade property would prevent function wrapping.
        if(descriptor.configurable!==true)return false;
        return Reflect.defineProperty(object,key,descriptor);
      },preventExtensions:()=>false,
      getPrototypeOf:()=>Object.getPrototypeOf(object),
      setPrototypeOf:(_target,prototype)=>Reflect.setPrototypeOf(object,prototype),
    });
    cache.set(object, proxy);
    return proxy;
  };
  return wrap(raw);
}

export function createNativePrimaryClient(name, port, options = {}, lifecycle = {}) {
  const client = name==='pwm'?createPWM32XClient(port,{native:true},lifecycle):name==='ay8910'?createAy8910Client(port,options,lifecycle):name==='ym2413'?createYm2413Client(port,options,lifecycle):OPL_CHIPS.includes(name) ? createOplClient(port, {...options,chip:name},lifecycle)
    : name === 'nes' ? createNesClient(port, options,lifecycle)
    : name === 'gameboy' ? createGameboyClient(port,options,lifecycle)
    : name === 'snes' ? createSnesClient(port, options,lifecycle)
    : name === 'ym2151' ? createYm2151Client(port)
    : name === 'segapsg' ? createSegaPsgClient(port, options)
    : name === 'huc6280' ? createHuc6280Client(port, options,lifecycle)
    : name === 'okim6258' ? createOki6258Client(port, options,lifecycle)
    : name === 'dx7' ? createDx7Client(port, {...options,...options.state},lifecycle)
    : null;
  if(name==='pwm'){client._stopVoices=()=>client.stopVoices();if(options.clock!==undefined)client._adoptClock(options.clock);}
  if (!client) throw new Error(`Unsupported native primary: ${name}`);
  if (options.state && name!=='nes') client._adoptState?.(options.state);
  else if (name === 'huc6280' || name==='ay8910' || name==='ym2413' || OPL_CHIPS.includes(name)) client.initialize();
  return client;
}

/** Each endpoint keeps a direct Worker -> Worklet performance port. */
export function createNativeWorkerApis(connections, performance, observe) {
  const raw = new Map(), apis = {};
  for (const connection of connections) {
    const port = performance.port(connection.port, 'independent');
    const client = createNativePrimaryClient(connection.name, port, connection);
    raw.set(connection.globalName, client);
    let queued = false;
    const changed = () => {
      if (queued || !client._getState) return;
      queued = true;
      queueMicrotask(() => {queued = false; observe(connection.globalName, client._getState());});
    };
    client._onStateChange?.(changed);
    apis[connection.globalName] = borrowNativeApi(client, connection.name, changed);
  }
  return {apis, raw,
    stop() {
      const pending=[];
      for (const [name,client] of raw) {
        client._cancelClockRequests?.('Run stopped');
        if (client._stopVoices) {
          const result=client._stopVoices();
          if(result?.then)pending.push(result.then(()=>{if(client._getState)observe(name,client._getState());}));
        }
        else if (client.allNotesOff) client.allNotesOff();
        else if (name === 'gameboy') {for (let ch = 0; ch < 4; ch++) client.keyOff(ch);}
        else if (client.pulse) {for (let ch = 0; ch < 6; ch++) client.keyOff(ch);}
        else for (let ch = 0; ch < 8; ch++) client.keyOff(ch);
        if(client._getState)observe(name,client._getState());
      }
      return Promise.all(pending);
    },
    adopt(name, state) {raw.get(name)?._adoptState?.(state);},
  };
}
