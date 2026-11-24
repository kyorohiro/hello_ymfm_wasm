// SPDX-License-Identifier: BSD-3-Clause
import { createNativeFXRack } from '../js/native_fx_rack.js?v=prepared-fx-rerun-2';

/** Switch the shared OPNB output between direct and Code FX before its mixer.
 * The independently rendered VGM connects upstream of the master only. */
export function createFm2610CodeRoute(chipOutput, mixerInput) {
  let effect = null, closed = false;
  chipOutput.connect(mixerInput);

  function disconnect() {
    chipOutput.disconnect(effect ?? mixerInput);
    effect?.disconnect(mixerInput);
  }

  return {
    setEffect(next) {
      if (closed || next === effect) return;
      if (next) {
        next.connect(mixerInput);
        try { chipOutput.connect(next); }
        catch (error) {
          next.disconnect(mixerInput);
          throw error;
        }
      } else chipOutput.connect(mixerInput);
      disconnect();
      effect = next;
    },
    dispose() {
      if (closed) return;
      closed = true;
      disconnect();
      effect = null;
    },
  };
}

/** Borrow one FX rack per Code Run. Apply shares the rack and named DSP state. */
export function createFm2610CodeEffects({createRack = createNativeFXRack, onLog = () => {}} = {}) {
  let session = null, bpm = 120;

  function stop() {
    const previous = session;
    session = null;
    if (!previous?.rack) return;
    const {audio, rack} = previous;
    try { audio.setCodeEffect(null); }
    finally {
      try { rack.stop(); }
      finally { rack.dispose(); }
    }
  }

  function prepare(audio) {
    if (typeof audio.setCodeEffect !== 'function') return;
    if (session?.audio === audio) return session.ready;
    stop();
    const next = {audio, rack: null, error: null, names: new Set()};
    session = next;
    next.ready = Promise.resolve().then(() => createRack(audio.context)).then(rack => {
      if (next !== session) {
        rack.dispose();
        return;
      }
      next.rack = rack;
      rack.getBeatSeconds = () => 60 / bpm;
      rack.onError = message => {
        if (next === session) onLog(`[liveFx] ${message}`);
      };
    }).catch(error => { next.error = error; });
    return next.ready;
  }

  const fx = new Proxy({}, {get(_target, method) {
    if (typeof method !== 'string' || method === 'then') return undefined;
    const current = session, rack = current?.rack, controller = rack?.controller;
    if (!controller) return () => {
      const message = current?.error?.message;
      throw new Error(message ? `Code effects are unavailable: ${message}` : 'Code effects are unavailable.');
    };
    if (typeof controller[method] !== 'function') return undefined;
    return (...args) => {
      if (current !== session) throw new DOMException('Code effects stopped', 'AbortError');
      const result = controller[method](...args);
      if (method === 'liveFx') current.names.add(args[0]);
      if (method === 'removeLiveFx') current.names.delete(args[0]);
      if (method === 'dispose' || (method === 'clear' && args[0]?.dispose)) current.names.clear();
      if (['liveFx', 'removeLiveFx', 'setChain', 'clear', 'dispose'].includes(method)) {
        const active = current.names.size > 0 || controller.getChain().length > 0;
        current.audio.setCodeEffect(active ? rack.node : null);
      }
      return result;
    };
  }});

  return {
    fx, prepare, stop,
    setBpm(next) {
      if (next === bpm) return;
      bpm = next;
      session?.rack?.controller.syncTempo();
    },
  };
}
