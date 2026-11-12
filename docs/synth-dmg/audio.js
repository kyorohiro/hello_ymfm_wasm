// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createGameboyCodeClient,gameboyCodeCancelled} from './code_endpoint.js';
import {readPreset} from './preset.js';

const nativeSetTimer = globalThis.setTimeout.bind(globalThis);
const nativeClearTimer = globalThis.clearTimeout.bind(globalThis);

export const GAMEBOY_SYNTH_BALANCE = .28;
const DEADLINE_MS = 15000;
const COMMANDS = new Set(['read', 'observeCode', 'setPreset', 'loadPreset', 'applyCodePreset', 'noteOn', 'noteOff', 'setPitch', 'stop', 'beginCode', 'code']);

function validateVolume(value) {
  if (!Number.isFinite(value) || value < 0 || value > 3.8) throw new RangeError('Game Boy Master must be from 0 to 3.8');
}

/** A user-gesture-created, single-APU audio engine. Importing this module starts
 * no audio. outputNode carries the final, Master-scaled signal; attach meters
 * there as passive branches, without connecting them to destination again.
 * @param {{volume?:number,onError?:(error:Error)=>void}} [options]
 */
export async function createAudio({volume = .7, onError = () => {}, signal} = {}) {
  validateVolume(volume);
  signal?.throwIfAborted();
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error('This browser does not support Web Audio');
  const context = new Context({latencyHint:'interactive'});
  const controller = new AbortController(), pending = new Map();
  let node = null, balance = null, codeFade = null, master = null, songInput = null, disposed = false, closing = null;
  let codeGeneration = 0, codeOwner = null;
  const invalidateCode = () => { codeGeneration++; codeOwner = null; };
  let fatalError = null, nextId = 0, startupTimer = null, rejectStartup, readyResolve;
  const startupFailure = new Promise((_, reject) => { rejectStartup = reject; });
  // A fatal error can also occur after startup has returned to the UI.
  void startupFailure.catch(() => {});

  const report = error => { try { onError(error); } catch {} };
  function rejectPending(error) {
    for (const {reject, timer} of pending.values()) { nativeClearTimer(timer); reject(error); }
    pending.clear();
  }
  function assertOpen() {
    if (fatalError) throw fatalError;
    if (disposed || context.state === 'closed') throw new Error('Game Boy audio is closed. Enable audio to restart.');
  }
  function dispose() {
    if (closing) return closing;
    disposed = true; invalidateCode();
    nativeClearTimer(startupTimer);
    controller.abort();
    context.removeEventListener('statechange', stateChanged);
    rejectPending(fatalError ?? new Error('Game Boy audio was disposed'));
    if (node) {
      node.onprocessorerror = null;
      node.port.onmessage = null;
      node.port.onmessageerror = null;
      try { node.port.postMessage({method:'dispose'}); } catch {}
      try { node.disconnect(); } catch {}
      node.port.close();
    }
    balance?.disconnect();
    codeFade?.disconnect();
    songInput?.disconnect();
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
    if (context.state === 'closed' && !disposed) fail(new Error('Game Boy AudioContext was closed. Enable audio to restart.'));
  }
  context.addEventListener('statechange', stateChanged);
  const cancelled = () => {
    rejectStartup(new DOMException('Game Boy audio startup cancelled','AbortError'));
    void dispose().catch(() => {});
  };
  signal?.addEventListener('abort',cancelled,{once:true});
  const boundedStartup = task => Promise.race([task, startupFailure]);

  try {
    if (!context.audioWorklet) throw new Error('DMG Synth needs AudioWorklet. Open it over HTTPS or localhost.');
    signal?.throwIfAborted();
    startupTimer = nativeSetTimer(() => fail(new Error('Game Boy audio initialization timed out. Enable audio to retry.')), DEADLINE_MS);
    // Invoke resume before awaiting fetch/addModule so a pointer gesture can
    // authorize playback on browsers that require transient activation.
    const resumed = context.resume();
    const [wasmBinary] = await boundedStartup(Promise.all([
      fetch(new URL('../generated/gameboy_apu_wasm.wasm', import.meta.url), {signal:controller.signal}).then(response => {
        if (!response.ok) throw new Error(`Game Boy WASM could not load (HTTP ${response.status})`);
        return response.arrayBuffer();
      }),
      context.audioWorklet.addModule(new URL('./processor.js?v=dmg-live-preset-1', import.meta.url)),
      resumed,
    ]));
    assertOpen();
    const ready = new Promise(resolve => { readyResolve = resolve; });
    node = new AudioWorkletNode(context, 'tetorica-gameboy-synth', {
      numberOfInputs:0, numberOfOutputs:1, outputChannelCount:[2], processorOptions:{wasmBinary},
    });
    node.onprocessorerror = () => fail(new Error('Game Boy audio processor failed. Enable audio to restart.'));
    node.port.onmessageerror = () => fail(new Error('Game Boy audio reply could not be read. Enable audio to restart.'));
    node.port.onmessage = ({data}) => {
      if (data?.fatal) { fail(new Error(data.error ?? 'Game Boy audio processor failed')); return; }
      if (data?.ready) { readyResolve(); return; }
      const request = pending.get(data?.id);
      if (!request) return;
      pending.delete(data.id); nativeClearTimer(request.timer);
      if (data.error) {
        const error = new Error(data.error); error.name = data.name ?? 'Error'; request.reject(error);
      } else request.resolve(data.value);
    };
    await boundedStartup(ready);
    assertOpen();
    nativeClearTimer(startupTimer);
    balance = context.createGain(); balance.gain.value = GAMEBOY_SYNTH_BALANCE;
    codeFade = context.createGain(); codeFade.gain.value = 1;
    master = context.createGain(); master.gain.value = volume;
    node.connect(balance); balance.connect(codeFade); codeFade.connect(master); master.connect(context.destination);
    // Reference VGM PCM has its own APU and bypasses Code's FX/fade, then
    // shares this one post-balance Master bus and passive output monitor.
    songInput = context.createGain(); songInput.gain.value = GAMEBOY_SYNTH_BALANCE;
    songInput.connect(master);

    async function command(method, args = []) {
      assertOpen();
      if (!COMMANDS.has(method)) throw new Error(`Unknown Game Boy command: ${method}`);
      if (!Array.isArray(args)) throw new TypeError('Game Boy command arguments must be an array');
      if (method === 'stop') {
        if (args.length) throw new TypeError('Game Boy Stop takes no arguments');
        invalidateCode();
      }
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = nativeSetTimer(() => fail(new Error(`Game Boy command timed out (${method}). Enable audio to restart.`)), DEADLINE_MS);
        pending.set(id, {resolve, reject, timer});
        try { node.port.postMessage({id, method, args}); }
        catch (error) { pending.delete(id); nativeClearTimer(timer); reject(error); }
      }).then(value => {
        if (method === 'setPreset' || method === 'loadPreset') invalidateCode();
        return value;
      });
    }
    function getGameboyClient() {
      assertOpen();
      if (codeOwner?.closed) return codeOwner.ending.then(() => getGameboyClient());
      if (codeOwner) return codeOwner.promise;
      const owner = {generation:codeGeneration,promise:null,closed:false,ending:null,releasedGeneration:null};
      codeOwner = owner;
      const current = () => !disposed && !fatalError && codeOwner === owner && owner.generation === codeGeneration && !owner.closed;
      const check = () => {assertOpen(); if (!current()) throw gameboyCodeCancelled();};
      owner.promise = command('beginCode').then(metadata => {
        check();
        owner.session = metadata.session;
        return createGameboyCodeClient({metadata,isCurrent:current,
          ownsOutput:()=>current() || !disposed&&!fatalError&&codeOwner===null&&owner.releasedGeneration===codeGeneration,
          invoke(method,args) {check(); return command('code',[metadata.session,method,args]);},
          dispose() {
            check(); owner.closed = true;
            owner.ending = command('code',[metadata.session,'dispose',[]]).then(value => {
              if (codeOwner === owner) {invalidateCode();owner.releasedGeneration=codeGeneration;}
              return value;
            },error => {if (codeOwner === owner) invalidateCode();throw error;});
            return owner.ending;
          },
        });
      }).catch(error => {if (codeOwner === owner) codeOwner = null;throw error;});
      return owner.promise;
    }
    async function applyCodePreset(value,{isCurrent=()=>true}={}) {
      assertOpen();const next=readPreset(value);
      if(typeof isCurrent!=='function')throw new TypeError('Game Boy preset ownership must be a function');
      const owner=codeOwner;
      const check=()=>{assertOpen();if(!owner||codeOwner!==owner||owner.closed||owner.generation!==codeGeneration||!isCurrent())throw gameboyCodeCancelled();};
      check();await owner.promise;check();
      const result=await command('applyCodePreset',[owner.session,next]);check();return result;
    }
    return {
      context, outputNode:master, codeInputNode:balance, codeOutputNode:codeFade, codeFadeNode:codeFade, songInputNode:songInput,
      sampleRate:context.sampleRate, command, read:() => command('read'), getGameboyClient, applyCodePreset,
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
    if (signal?.aborted && !fatalError) error = new DOMException('Game Boy audio startup cancelled','AbortError');
    if (error?.name !== 'AbortError') fail(error);
    await dispose().catch(() => {});
    throw error;
  } finally { nativeClearTimer(startupTimer); signal?.removeEventListener('abort',cancelled); }
}
