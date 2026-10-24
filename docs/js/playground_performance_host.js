import {validateWorkerLookahead} from './playground_performance_sender.js?v=y8950-adpcm-1';

// One module-wide sequence also fences a retired Runtime sharing the same node.
let nextSession = Date.now() * 1000;
export function createPerformanceHost({getContext, onSuspended = () => {}}) {
  let active = null, starting = null, sequence = 0, context = null;
  const ports = new Map(), pendingControls = new Map();
  function stateChanged() {
    if (active && context.state !== 'running') { stop(); onSuspended(); }
  }
  function control(port, message) {
    return new Promise((resolve, reject) => {
      const id = `performance:${message.session}:${++sequence}`;
      const listener = ({data}) => {
        if (data?.type !== 'performance-result' || data.id !== id) return;
        cleanup(); data.error ? reject(new Error(data.error)) : resolve();
      };
      const cancel = () => { cleanup(); reject(new DOMException('Run stopped', 'AbortError')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Audio performance clock did not acknowledge initialization')); }, 5000);
      function cleanup() { clearTimeout(timer); port.removeEventListener('message', listener); pendingControls.delete(cancel); }
      pendingControls.set(cancel,port);
      port.addEventListener('message', listener); port.start?.();
      try { port.postMessage({...message, id}); } catch (error) { cleanup(); reject(error); }
    });
  }
  async function attach(port) {
    const clock = active;
    if (!clock) return;
    if (ports.has(port)) return ports.get(port);
    if (!port?.addEventListener) throw new Error('Audio performance scheduling requires a MessagePort');
    const pending = control(port, {type: 'performance-start', session: clock.session}).then(() => {
      if (active !== clock) throw new DOMException('Run stopped', 'AbortError');
    });
    ports.set(port, pending);
    return pending;
  }
  function stop() {
    const clock = active; active = null; starting = null;
    if (clock) for (const port of ports.keys()) {
      try { port.postMessage({type: 'performance-stop', session: clock.session}); } catch { /* Disposed source. */ }
    }
    for (const cancel of [...pendingControls.keys()]) cancel();
    ports.clear();
    context?.removeEventListener?.('statechange', stateChanged); context = null;
  }
  return {
    async start(endpoints, lookaheadSeconds) {
      if (active) return starting ?? active;
      validateWorkerLookahead(lookaheadSeconds);
      const audio = getContext();
      // Runtime test doubles and custom non-Worklet hosts keep their existing
      // immediate path. Real MessagePorts always support addEventListener.
      if (!audio || !endpoints.length || endpoints.some(port => !port?.addEventListener)) return null;
      context = audio;
      const clock = {session: ++nextSession, audioSeconds: audio.currentTime,
        performanceEpochMs: (performance.timeOrigin ?? 0) + performance.now(), lookaheadSeconds};
      active = clock;
      context.addEventListener?.('statechange', stateChanged);
      const pending = Promise.all(endpoints.map(attach)).then(() => clock);
      starting = pending;
      try { return await pending; }
      catch (error) { if (active === clock) stop(); throw error; }
      finally { if (starting === pending) starting = null; }
    },
    attach,
    cancelOwner({session, owner}) {
      if (active?.session !== session || typeof owner !== 'string' || !owner) return;
      for (const port of ports.keys()) {
        try { port.postMessage({type: 'performance-cancel-owner', session, owner}); } catch { /* Disposed source. */ }
      }
    },
    detach(port) {
      ports.delete(port);
      for(const [cancel,target] of pendingControls)if(target===port)cancel();
    },
    stop,
    get clock() { return active; },
  };
}
