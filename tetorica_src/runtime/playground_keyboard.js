/** Run-owned musical input. DOM keys and instrument/channel allocation stay outside. */
let nextSession = 0;
const keyboardScopes = new WeakMap();
/** Private adapter plumbing: retain a lease when a voice FIFO queues work. */
export function registerKeyboardScope(pg, getContext, setContext) {
  keyboardScopes.set(pg,{getContext,setContext});
}
export function captureKeyboardCallback(pg, callback) {
  const scope = keyboardScopes.get(pg), context = scope?.getContext();
  if (!context?.keyboard) return callback;
  return (...args) => {
    if (context.stopped) return;
    const previous = scope.getContext(); scope.setContext(context);
    try {return callback(...args);}
    finally {if (scope.getContext() === context) scope.setContext(previous);}
  };
}
export function keyboardBinding(name, handlers) {
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('keyboard.bind requires a nonempty name');
  if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers) ||
      ['noteOn','noteOff','allNotesOff'].some(method => typeof handlers[method] !== 'function')) {
    throw new TypeError('keyboard.bind requires noteOn, noteOff and allNotesOff callbacks');
  }
  return {name, handlers:{noteOn:handlers.noteOn,noteOff:handlers.noteOff,allNotesOff:handlers.allNotesOff}};
}
export function musicalKeyboardEvent(event) {
  if (!event || typeof event.id !== 'string' || !event.id ||
      !Number.isInteger(event.midi) || event.midi < 0 || event.midi > 127 ||
      event.velocity !== undefined && (!Number.isInteger(event.velocity) || event.velocity < 0 || event.velocity > 127)) {
    throw new TypeError('Keyboard events require {id: string, midi: 0..127, velocity?: 0..127}');
  }
  return {id:event.id,midi:event.midi,velocity:event.velocity ?? 100};
}
export function createMusicalKeyboard({getContext, setContext, invoke = callback => callback(), onChange = () => {}, onError = () => {}}) {
  let active = null, revision = 0, retiring = Promise.resolve();
  function execute(entry, method, event, context) {
    const previous = getContext(); setContext(context);
    let result;
    try {result = invoke(() => method === 'allNotesOff' ? entry.handlers[method]() : entry.handlers[method](event));}
    catch (error) {result = Promise.reject(error);}
    finally {if (getContext() === context) setContext(previous);}
    return Promise.resolve(result).catch(error => {
      if (context.stopped && (error?.name === 'AbortError' || error?.message === 'Run stopped')) return;
      onError(error); throw error;
    }).finally(() => {if (getContext() === context) setContext(previous);});
  }
  function context(entry, suffix, cleanup = false) {
    const value = {keyboard:true,keyboardOwner:entry.session,keyboardCleanup:cleanup,stopped:false,performanceOwner:`keyboard:${entry.session}:${suffix}`};
    entry.contexts.add(value);return value;
  }
  function release(entry) {
    for (const context of entry.contexts) context.stopped = true;
    entry.contexts.clear(); entry.held.clear();
    const cleanup = context(entry, 'release', true);
    const pending = entry.release.then(() => execute(entry,'allNotesOff',undefined,cleanup));
    entry.release = pending.catch(() => {}).finally(() => {cleanup.stopped=true;entry.contexts.delete(cleanup);});
    return entry.release;
  }
  function retire() {
    const previous = active; active = null; onChange(null);
    if (previous) retiring = Promise.all([retiring,release(previous)]).then(() => {});
    return retiring;
  }
  function event(entry, method, input) {
    const received = musicalKeyboardEvent(input);
    if (active !== entry) return Promise.resolve();
    const previous = entry.held.get(received.id);
    if (method === 'noteOn') {
      if (previous) return Promise.resolve();
      const lease = context(entry, received.id);
      const value = {...received,id:`${entry.session}:${++entry.noteSequence}:${received.id}`};
      entry.held.set(received.id,{event:value,context:lease});
      return entry.release.then(() => {
        if (active !== entry || lease.stopped) return;
        return execute(entry,method,value,lease);
      });
    }
    if (!previous) return Promise.resolve();
    previous.context.stopped = true;entry.contexts.delete(previous.context);entry.held.delete(received.id);
    const lease = context(entry,received.id+':off');
    return execute(entry,method,previous.event,lease).finally(() => {lease.stopped=true;entry.contexts.delete(lease);});
  }
  return {
    async commit(definition, current = () => true) {
      const epoch = ++revision; await retire();
      if (epoch !== revision || !current() || !definition) return;
      const entry = {...definition,session:`musical:${++nextSession}`,noteSequence:0,held:new Map(),contexts:new Set(),release:Promise.resolve()};
      active = entry;
      entry.target = Object.freeze({name:entry.name,noteOn:input => event(entry,'noteOn',input),noteOff:input => event(entry,'noteOff',input),
        allNotesOff:() => active === entry ? release(entry) : Promise.resolve()});
      onChange(entry.target);
    },
    clear() {revision++;return retire();},
    get target() {return active?.target ?? null;},
    get session() {return active?.session ?? null;},
    settled:() => retiring,
  };
}

/** Restore an interactive lease after awaited chip RPCs without making sibling
 * liveLoops immediate. A retired lease cannot issue a late note or release. */
export function createKeyboardApiGuard(getContext, setContext) {
  const cache = new WeakMap();
  const nested = new Set(['dac','ssg','rhythm','adpcm','adpcmA','adpcmB','pulse','triangle','noise','dmc','fds','wave']);
  function wrap(object) {
    if (!object || typeof object !== 'object') return object;
    if (cache.has(object)) return cache.get(object);
    // Chip sections can be frozen. An extensible facade can guard their public
    // functions without violating the wrapped object's Proxy invariants.
    const proxy = new Proxy(Object.create(null),{get(_target,key) {
      const value = Reflect.get(object,key,object);
      if (typeof value !== 'function') return nested.has(key) ? wrap(value) : value;
      if (typeof key === 'string' && key.startsWith('_')) return value;
      return (...args) => {
        const context = getContext();
        if (context?.keyboard && context.stopped) throw new DOMException('Run stopped','AbortError');
        const result = value.apply(object,args);
        if (!context?.keyboard || !result?.then) return result;
        return result.then(value => {
          setContext(context);
          if (context.stopped) throw new DOMException('Run stopped','AbortError');
          return value;
        },error => {
          setContext(context);
          if (context.stopped) throw new DOMException('Run stopped','AbortError');
          throw error;
        });
      };
    },set:(_target,key,value)=>Reflect.set(object,key,value,object),has:(_target,key)=>key in object,
      ownKeys:()=>Reflect.ownKeys(object),getOwnPropertyDescriptor:(_target,key)=>{
        const descriptor=Reflect.getOwnPropertyDescriptor(object,key);
        return descriptor?{...descriptor,configurable:true}:undefined;
      }});
    cache.set(object,proxy);cache.set(proxy,proxy);return proxy;
  }
  return wrap;
}
