// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

export const NES_SYNTH_BALANCE = 1;
const DEADLINE_MS = 15000;
const COMMANDS = new Set(['read', 'setPreset', 'loadPreset', 'noteOn', 'noteOff', 'setPitch', 'stop', 'setClickGuard']);

function validateVolume(value) {
  if (!Number.isFinite(value) || value < 0 || value > 3.8) throw new RangeError('NES + FDS Master must be from 0 to 3.8');
}

/** A user-gesture-created, single-APU audio engine. Importing this module starts
 * no audio. outputNode carries the final, Master-scaled signal; attach meters
 * there as passive branches, without connecting them to destination again.
 * @param {{volume?:number,onError?:(error:Error)=>void}} [options]
 */
export async function createAudio({volume = .7, onError = () => {}} = {}) {
  validateVolume(volume);
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error('This browser does not support Web Audio');
  const context = new Context({latencyHint:'interactive'});
  const controller = new AbortController(), pending = new Map();
  let node = null, balance = null, master = null, disposed = false, closing = null;
  let fatalError = null, nextId = 0, startupTimer = null, rejectStartup, readyResolve;
  const startupFailure = new Promise((_, reject) => { rejectStartup = reject; });
  // A fatal error can also occur after startup has returned to the UI.
  void startupFailure.catch(() => {});

  const report = error => { try { onError(error); } catch {} };
  function rejectPending(error) {
    for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  }
  function assertOpen() {
    if (fatalError) throw fatalError;
    if (disposed || context.state === 'closed') throw new Error('NES + FDS audio is closed. Enable audio to restart.');
  }
  function dispose() {
    if (closing) return closing;
    disposed = true;
    clearTimeout(startupTimer);
    controller.abort();
    context.removeEventListener('statechange', stateChanged);
    rejectPending(fatalError ?? new Error('NES + FDS audio was disposed'));
    if (node) {
      node.onprocessorerror = null;
      node.port.onmessage = null;
      node.port.onmessageerror = null;
      try { node.port.postMessage({method:'dispose'}); } catch {}
      try { node.disconnect(); } catch {}
      node.port.close();
    }
    balance?.disconnect();
    master?.disconnect();
    closing = (async () => { if (context.state !== 'closed') await context.close(); })();
    return closing;
  }
  function fail(error) {
    if (disposed || fatalError) return;
    fatalError = error instanceof Error ? error : new Error(String(error));
    rejectStartup(fatalError);
    rejectPending(fatalError);
    report(fatalError);
    void dispose().catch(() => {});
  }
  function stateChanged() {
    if (context.state === 'closed' && !disposed) fail(new Error('NES + FDS AudioContext was closed. Enable audio to restart.'));
  }
  context.addEventListener('statechange', stateChanged);
  const boundedStartup = task => Promise.race([task, startupFailure]);

  try {
    if (!context.audioWorklet) throw new Error('2A03 Synth needs AudioWorklet. Open it over HTTPS or localhost.');
    startupTimer = setTimeout(() => fail(new Error('NES + FDS audio initialization timed out. Enable audio to retry.')), DEADLINE_MS);
    // Invoke resume before awaiting fetch/addModule so a pointer gesture can
    // authorize playback on browsers that require transient activation.
    const resumed = context.resume();
    const [wasmBinary] = await boundedStartup(Promise.all([
      fetch(new URL('../generated/nesapu_wasm.wasm', import.meta.url), {signal:controller.signal}).then(response => {
        if (!response.ok) throw new Error(`NES + FDS WASM could not load (HTTP ${response.status})`);
        return response.arrayBuffer();
      }),
      context.audioWorklet.addModule(new URL('./processor.js', import.meta.url)),
      resumed,
    ]));
    assertOpen();
    const ready = new Promise(resolve => { readyResolve = resolve; });
    node = new AudioWorkletNode(context, 'tetorica-nes-fds-synth', {
      numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2], processorOptions:{wasmBinary},
    });
    node.onprocessorerror = () => fail(new Error('NES + FDS audio processor failed. Enable audio to restart.'));
    node.port.onmessageerror = () => fail(new Error('NES + FDS audio reply could not be read. Enable audio to restart.'));
    node.port.onmessage = ({data}) => {
      if (data?.fatal) { fail(new Error(data.error ?? 'NES + FDS audio processor failed')); return; }
      if (data?.ready) { readyResolve(); return; }
      const request = pending.get(data?.id);
      if (!request) return;
      pending.delete(data.id); clearTimeout(request.timer);
      if (data.error) {
        const error = new Error(data.error); error.name = data.name ?? 'Error'; request.reject(error);
      } else request.resolve(data.value);
    };
    await boundedStartup(ready);
    assertOpen();
    clearTimeout(startupTimer);
    balance = context.createGain(); balance.gain.value = NES_SYNTH_BALANCE;
    master = context.createGain(); master.gain.value = volume;
    node.connect(balance); balance.connect(master); master.connect(context.destination);

    async function command(method, args = []) {
      assertOpen();
      if (!COMMANDS.has(method)) throw new Error(`Unknown NES + FDS command: ${method}`);
      if (!Array.isArray(args)) throw new TypeError('NES + FDS command arguments must be an array');
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error(`NES + FDS command timed out (${method}). Enable audio to restart.`)), DEADLINE_MS);
        pending.set(id, {resolve, reject, timer});
        try { node.port.postMessage({id, method, args}); }
        catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
      });
    }
    return {
      context, outputNode:master, command, read:() => command('read'),
      async resume() {
        assertOpen();
        try { await context.resume(); assertOpen(); }
        catch (error) { fail(error); throw error; }
      },
      setVolume(value) {
        assertOpen(); validateVolume(value);
        const parameter = master.gain, now = context.currentTime;
        if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
        else { const current = parameter.value; parameter.cancelScheduledValues(now); parameter.setValueAtTime(current, now); }
        parameter.linearRampToValueAtTime(value, now + .01);
      },
      dispose,
    };
  } catch (error) {
    fail(error);
    await dispose().catch(() => {});
    throw error;
  } finally { clearTimeout(startupTimer); }
}
