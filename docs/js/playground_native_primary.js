import {createNesClient} from './playground_nes.js?v=audio-stability-2';
import {createSnesClient} from './playground_snes.js?v=native-modes-3';
import {createYm2151Client} from './playground_ym2151.js?v=audio-stability-2';
import {createHuc6280Client} from './playground_huc6280.js?v=audio-stability-2';
import {createOki6258Client} from './playground_okim6258.js?v=audio-stability-2';

/** Primary controls borrow devices owned by the runtime. */
export function borrowNativeApi(raw, id, changed = () => {}, before = () => true) {
  const cache = new WeakMap();
  const wrap = (object, path = []) => {
    if (!object || typeof object !== 'object') return object;
    if (cache.has(object)) return cache.get(object);
    const proxy = new Proxy(object, {get(target, key) {
      if (key === 'then' || key === 'dispose' || key === 'transport' ||
          key === 'constructor' || (typeof key === 'string' && key.startsWith('_'))) return undefined;
      if (key === 'id' && target === raw) return id;
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value && typeof value === 'object' &&
        ['pulse','triangle','noise','dmc','fds','wave'].includes(key) ? wrap(value, [...path, key]) : value;
      return (...args) => {
        const method = [...path, key];
        if (before(method, args) === false) return;
        const result = value.apply(target, args);
        changed(method, args);
        if (result?.then) return result.then(value => {changed(method, args); return value;});
        return result;
      };
    }});
    cache.set(object, proxy);
    return proxy;
  };
  return wrap(raw);
}

export function createNativePrimaryClient(name, port, options = {}) {
  const client = name === 'nes' ? createNesClient(port, options)
    : name === 'snes' ? createSnesClient(port, options)
    : name === 'ym2151' ? createYm2151Client(port)
    : name === 'huc6280' ? createHuc6280Client(port, options)
    : name === 'okim6258' ? createOki6258Client(port, options)
    : null;
  if (!client) throw new Error(`Unsupported native primary: ${name}`);
  if (options.state) client._adoptState?.(options.state);
  else if (name === 'huc6280') client.initialize();
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
    apis[connection.globalName] = borrowNativeApi(client, connection.name, changed);
  }
  return {apis, raw,
    stop() {
      for (const [name,client] of raw) {
        client._cancelClockRequests?.('Run stopped');
        if (client.allNotesOff) client.allNotesOff();
        else if (client.pulse) {for (let ch = 0; ch < 6; ch++) client.keyOff(ch);}
        else for (let ch = 0; ch < 8; ch++) client.keyOff(ch);
        if(client._getState)observe(name,client._getState());
      }
    },
    adopt(name, state) {raw.get(name)?._adoptState?.(state);},
  };
}
