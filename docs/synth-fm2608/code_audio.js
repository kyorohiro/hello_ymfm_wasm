// SPDX-License-Identifier: BSD-3-Clause
// Code effects and Stop fade borrow the upper editor's single OPNA output.
import {createNativeFXRack} from '../js/native_fx_rack.js?v=prepared-fx-rerun-2';
import {createSynthCodeOutput} from '../synth/synth_code_output.js';
import {createFm2608CodeClient} from './code_client.js?v=opna-pcm-release-1';

const cancelled = () => new DOMException('FM2608 Code audio stopped', 'AbortError');

export function createFm2608CodeAudio({ensureReady, getAudio, onLog = () => {},
  createFxRack = createNativeFXRack, createOutput = createSynthCodeOutput} = {}) {
  let epoch = 0, owner = null, disposed = false, stopping = null;
  const output = createOutput({getContext:() => getAudio()?.context, getGain:() => getAudio()?.codeFadeNode});
  function check(token) {
    if (disposed || token !== epoch) throw cancelled();
  }
  function restoreDirect(item) {
    if (!item?.routed) return;
    try { item.input.disconnect(item.rack.node); } catch {}
    try { item.rack.node.disconnect(item.destination); } catch {}
    if (item.context.state !== 'closed') item.input.connect(item.destination);
    item.routed = false;
  }
  function retire(item) {
    if (!item || item.closed) return;
    restoreDirect(item);
    item.closed = true;
    try { item.borrowed?.release(); } catch {}
    try { item.rack?.stop(); item.rack?.dispose(); }
    catch (error) { onLog(`[cleanup] ${error?.message ?? String(error)}`); }
  }
  function activate(item) {
    if (item !== owner || item.closed || !item.rack) throw cancelled();
    if (item.routed) return;
    item.input.disconnect(item.destination);
    item.input.connect(item.rack.node);
    item.rack.node.connect(item.destination);
    item.routed = true;
  }

  async function prepare() {
    const token = epoch;
    check(token);
    if (stopping) await stopping;
    check(token);
    await ensureReady();
    check(token);
    const engine = getAudio(), context = engine?.context;
    const input = engine?.codeInputNode, destination = engine?.codeOutputNode;
    if (!context || context.state === 'closed' || !input || !destination || typeof engine.getChip !== 'function') {
      throw new Error('FM2608 Code needs the editor audio route');
    }
    if (owner?.engine === engine && !owner.closed) return owner.promise;
    retire(owner);
    const item = owner = {engine, context, input, destination,
      borrowed:null, rack:null, names:new Set(), routed:false, closed:false, promise:null};
    const current = () => !disposed && token === epoch && owner === item && !item.closed && getAudio() === engine;
    item.borrowed = createFm2608CodeClient(engine.getChip(), {isCurrent:current});
    item.promise = Promise.resolve().then(() => createFxRack(context)).then(rack => {
      if (!current()) { rack.dispose(); throw cancelled(); }
      item.rack = rack;
      rack.onError = message => onLog(`[liveFx] ${message}`);
      return item;
    }).catch(error => {
      retire(item);
      if (owner === item) owner = null;
      throw error;
    });
    return item.promise;
  }

  async function useSoundChip(name) {
    if (name !== 'ym2608') throw new Error('FM2608 Synth Code supports useSoundChip("ym2608")');
    const token = epoch, item = await prepare();
    check(token);
    return item.borrowed.client;
  }

  const fx = new Proxy({}, {get(_target, key) {
    if (key === 'then') return undefined;
    const item = owner, controller = item?.rack?.controller;
    if (typeof controller?.[key] !== 'function') return controller?.[key];
    return (...args) => {
      if (item !== owner || item.closed || disposed) throw cancelled();
      const result = controller[key](...args);
      if (key === 'liveFx') { item.names.add(args[0]); activate(item); }
      else if (key === 'removeLiveFx') {
        item.names.delete(args[0]);
        if (!item.names.size && !controller.getChain().length) restoreDirect(item);
      } else if (key === 'setChain') {
        if (item.names.size || controller.getChain().length) activate(item);
        else restoreDirect(item);
      } else if (key === 'clear' || key === 'dispose') {
        if (key === 'dispose') item.names.clear();
        if (!item.names.size) restoreDirect(item);
      }
      return result;
    };
  }});

  function stop() {
    if (stopping) return stopping;
    epoch++;
    const item = owner;
    owner = null;
    retire(item);
    const engine = item?.engine ?? getAudio();
    const task = Promise.resolve().then(() => engine?.stopAll()).then(() => undefined);
    const result = stopping = task.finally(() => { if (stopping === result) stopping = null; });
    return result;
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    output.dispose();
    await stop();
  }
  return {prepare, useSoundChip, fx, beforeStop:() => output.fadeOut(), open:() => output.open(), stop, dispose};
}
