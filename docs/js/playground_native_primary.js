import {createAy8910Client} from './playground_ay8910.js?v=audio-numeric-bindings-1';
import {createNesClient} from './playground_nes.js?v=audio-numeric-bindings-1';
import {createSnesClient} from './playground_snes.js?v=audio-numeric-bindings-1';
import {createYm2151Client} from './playground_ym2151.js?v=audio-numeric-bindings-1';
import {createHuc6280Client} from './playground_huc6280.js?v=audio-numeric-bindings-1';
import {createSegaPsgClient} from './playground_segapsg.js?v=audio-numeric-bindings-1';
import {createOki6258Client} from './playground_okim6258.js?v=audio-numeric-bindings-1';
import {createYm2413Client} from './playground_ym2413.js?v=audio-numeric-bindings-1';
import {createOplClient, OPL_CHIPS} from './playground_opl.js?v=audio-numeric-bindings-1';
import {createDx7Client} from './playground_dx7.js?v=audio-numeric-bindings-1';

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
  const client = name==='ay8910'?createAy8910Client(port,options):name==='ym2413'?createYm2413Client(port,options):OPL_CHIPS.includes(name) ? createOplClient(port, {...options,chip:name})
    : name === 'nes' ? createNesClient(port, options)
    : name === 'snes' ? createSnesClient(port, options)
    : name === 'ym2151' ? createYm2151Client(port)
    : name === 'segapsg' ? createSegaPsgClient(port, options)
    : name === 'huc6280' ? createHuc6280Client(port, options)
    : name === 'okim6258' ? createOki6258Client(port, options)
    : name === 'dx7' ? createDx7Client(port, {...options,...options.state})
    : null;
  if (!client) throw new Error(`Unsupported native primary: ${name}`);
  if (options.state) client._adoptState?.(options.state);
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
        else if (client.pulse) {for (let ch = 0; ch < 6; ch++) client.keyOff(ch);}
        else for (let ch = 0; ch < 8; ch++) client.keyOff(ch);
        if(client._getState)observe(name,client._getState());
      }
      return Promise.all(pending);
    },
    adopt(name, state) {raw.get(name)?._adoptState?.(state);},
  };
}
