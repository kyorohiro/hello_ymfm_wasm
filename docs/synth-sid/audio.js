// SPDX-License-Identifier: BSD-3-Clause
import {noteToHz} from '../js/soundchip_pitch.js';
import {sidFrequency} from '../js/sid.js';
// Capture host deadlines before user Code installs its timer guards.
const nativeSetTimer=globalThis.setTimeout.bind(globalThis);
const nativeClearTimer=globalThis.clearTimeout.bind(globalThis);
export const SID_SYNTH_BALANCE = 1;
const DEADLINE_MS = 15000;
const COMMANDS = new Set(['read', 'observeCode', 'setPreset', 'loadPreset', 'setChannelSettings', 'loadChannelSettings', 'noteOn', 'noteOff', 'setPitch', 'stop', 'beginCode', 'code']);
const CODE_METHODS=['setNote','setFrequency','noteOn','noteOff','keyOn','keyOff','allNotesOff',
  'setVoice','setFilter','writeRegister','readRegister','getRegisterSnapshot','getState','initialize','reset','setClock'];
const codeCancelled=()=>new DOMException('SID Code session was stopped or its instrument changed','AbortError');

function validateVolume(value) {
  if (!Number.isFinite(value) || value < 0 || value > 3.8) throw new RangeError('SID Master must be from 0 to 3.8');
}

/** User-gesture-created mono SID, duplicated to stereo by the processor.
 * outputNode is after the user Master. Attach visualizers as passive branches;
 * do not connect their output to destination a second time.
 * @param {{volume?:number,model?:'6581'|'8580',onError?:(error:Error)=>void,signal?:AbortSignal}} [options]
 */
export async function createAudio({volume = .7, model = '6581', onError = () => {}, signal} = {}) {
  validateVolume(volume);
  if(!['6581','8580'].includes(model))throw new RangeError('SID model must be 6581 or 8580');
  if (signal?.aborted) throw new DOMException('SID audio startup cancelled', 'AbortError');
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) throw new Error('This browser does not support Web Audio');
  const context = new Context({latencyHint: 'interactive'}), controller = new AbortController(), pending = new Map();
  let node = null, balance = null, master = null, codeFade = null, disposed = false, closing = null, fatalError = null;
  let codeGeneration=0,codeOwner=null;
  const invalidateCode=()=>{codeGeneration++;codeOwner=null;};
  let nextId = 0, startupTimer, rejectStartup, resolveReady;
  const startupFailure = new Promise((_, reject) => { rejectStartup = reject; });
  void startupFailure.catch(() => {});
  const report = error => { try { onError(error); } catch {} };
  const rejectPending = error => {
    for (const request of pending.values()) { nativeClearTimer(request.timer); request.reject(error); }
    pending.clear();
  };
  function assertOpen() {
    if (fatalError) throw fatalError;
    if (disposed || context.state === 'closed') throw new Error('SID audio is closed. Enable audio to restart.');
  }
  function dispose() {
    if (closing) return closing;
    disposed = true; invalidateCode(); nativeClearTimer(startupTimer); controller.abort();
    context.removeEventListener('statechange', stateChanged);
    rejectPending(fatalError ?? new Error('SID audio was disposed'));
    if (node) {
      node.onprocessorerror = null; node.port.onmessage = null; node.port.onmessageerror = null;
      try { node.port.postMessage({method: 'dispose'}); } catch {}
      try { node.disconnect(); } catch {}
      node.port.close();
    }
    balance?.disconnect(); codeFade?.disconnect(); master?.disconnect();
    closing = (async () => { if (context.state !== 'closed') await context.close(); })();
    return closing;
  }
  function fail(error) {
    if (disposed || fatalError) return;
    fatalError = error instanceof Error ? error : new Error(String(error));
    rejectStartup(fatalError); rejectPending(fatalError); report(fatalError);
    void dispose().catch(() => {});
  }
  function stateChanged() {
    if (context.state === 'closed' && !disposed) fail(new Error('SID AudioContext was closed. Enable audio to restart.'));
  }
  const cancelled = () => {
    rejectStartup(new DOMException('SID audio startup cancelled', 'AbortError'));
    void dispose().catch(() => {});
  };
  context.addEventListener('statechange', stateChanged); signal?.addEventListener('abort', cancelled, {once: true});
  const boundedStartup = promise => Promise.race([promise, startupFailure]);
  try {
    if (signal?.aborted) throw new DOMException('SID audio startup cancelled', 'AbortError');
    if (!context.audioWorklet) throw new Error('SID Synth needs AudioWorklet. Open it over HTTPS or localhost.');
    if (!Number.isInteger(context.sampleRate) || context.sampleRate < 8000 || context.sampleRate > 96000) throw new RangeError('SID output sample rate must be 8000..96000 Hz');
    startupTimer = nativeSetTimer(() => fail(new Error('SID audio initialization timed out. Enable audio to retry.')), DEADLINE_MS);
    // Resume inside the user gesture, before awaiting either asset load.
    const resumed = context.resume();
    // Cache both model binaries for atomic model swaps in this same Worklet.
    // Neither binary is instantiated until its model is selected.
    const [wasmBinary,wasm8580Binary] = await boundedStartup(Promise.all([
      fetch(new URL('../generated/sid/sid.wasm', import.meta.url), {signal: controller.signal}).then(response => {
        if (!response.ok) throw new Error(`SID WASM could not load (HTTP ${response.status})`);
        return response.arrayBuffer();
      }),
      fetch(new URL('../generated/sid8580-machine/sid8580-endpoint.wasm', import.meta.url), {signal: controller.signal}).then(response => {
        if (!response.ok) throw new Error(`SID 8580 WASM could not load (HTTP ${response.status})`);
        return response.arrayBuffer();
      }),
      context.audioWorklet.addModule(new URL('./processor.js?sid-channels=3&sid-waves=1&sid-keys=1&sid-code-live=1&sid-live-preset=1', import.meta.url)), resumed,
    ]));
    assertOpen();
    const ready = new Promise(resolve => { resolveReady = resolve; });
    node = new AudioWorkletNode(context, 'tetorica-sid-synth', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {model,wasmBinary,wasm8580Binary},
    });
    node.onprocessorerror = () => fail(new Error('SID audio processor failed. Enable audio to restart.'));
    node.port.onmessageerror = () => fail(new Error('SID audio reply could not be read. Enable audio to restart.'));
    node.port.onmessage = ({data}) => {
      if (data?.fatal) { fail(new Error(data.error ?? 'SID audio processor failed')); return; }
      if (data?.ready) { resolveReady(); return; }
      const request = pending.get(data?.id); if (!request) return;
      pending.delete(data.id); nativeClearTimer(request.timer);
      if (data.error) { const error = new Error(data.error); error.name = data.name ?? 'Error'; request.reject(error); }
      else request.resolve(data.value);
    };
    await boundedStartup(ready); assertOpen(); nativeClearTimer(startupTimer);
    balance = context.createGain(); balance.gain.value = SID_SYNTH_BALANCE;
    codeFade = context.createGain(); codeFade.gain.value = 1;
    master = context.createGain(); master.gain.value = volume;
    node.connect(balance); balance.connect(codeFade); codeFade.connect(master); master.connect(context.destination);

    async function command(method, args = []) {
      assertOpen();
      if (!COMMANDS.has(method)) throw new Error(`Unknown SID command: ${method}`);
      if (!Array.isArray(args)) throw new TypeError('SID command arguments must be an array');
      if(method==='stop'&&args.length)throw new TypeError('SID Stop takes no arguments');
      if(method==='stop')invalidateCode();
      const requestOwner=codeOwner,requestGeneration=codeGeneration;
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = nativeSetTimer(() => fail(new Error(`SID command timed out (${method}). Enable audio to restart.`)), DEADLINE_MS);
        pending.set(id, {resolve, reject, timer});
        try { node.port.postMessage({id, method, args}); }
        catch (error) { pending.delete(id); nativeClearTimer(timer); reject(error); }
      }).then(value=>{
        const nextModel=value?.model??value?.preset?.model;
        if(['setPreset','loadPreset','setChannelSettings','loadChannelSettings'].includes(method)&&
          codeOwner===requestOwner&&codeGeneration===requestGeneration&&requestOwner?.metadata&&
          ['6581','8580'].includes(nextModel))requestOwner.metadata.model=nextModel;
        return value;
      });
    }
    function getSidClient() {
      assertOpen();
      if(codeOwner)return codeOwner.promise;
      const owner={generation:codeGeneration,promise:null};codeOwner=owner;
      const check=()=>{
        assertOpen();if(codeOwner!==owner||owner.generation!==codeGeneration)throw codeCancelled();
      };
      owner.promise=command('beginCode').then(metadata=>{
        check();
        if(!Number.isSafeInteger(metadata?.session)||!['6581','8580'].includes(metadata.model)||!Number.isFinite(metadata.clock))throw new Error('Invalid SID Code session');
        owner.metadata=metadata;
        const client={id:'sid:synth',chip:'sid',channels:3};
        Object.defineProperties(client,{clock:{enumerable:true,get:()=>metadata.clock},model:{enumerable:true,get:()=>metadata.model}});
        for(const method of CODE_METHODS)client[method]=(...args)=>{
          check();
          // Gate ownership is observed synchronously by the common Code host.
          // Reject a malformed note before it can take another loop's channel.
          if(['noteOn','noteOff','keyOn','keyOff','setNote','setFrequency','setVoice'].includes(method)&&
            (!Number.isInteger(args[0])||args[0]<0||args[0]>2))throw new RangeError('SID channel must be an integer 0..2');
          if(method==='noteOn'||method==='setNote'){
            if(!sidFrequency(noteToHz(args[1]),metadata.clock))throw new RangeError('SID frequency is below the representable range');
          }
          if(method==='setFrequency'){
            if(!Number.isFinite(args[1])||args[1]<=0||!sidFrequency(args[1],metadata.clock))throw new RangeError('SID frequency must be positive representable Hz');
          }
          return command('code',[metadata.session,method,args]).then(value=>{check();return value;});
        };
        // The shared core/context belong to the editor. A Code client can
        // release its sound, but cannot destroy that borrowed resource.
        client.dispose=(...args)=>client.initialize(...args);
        return client;
      }).catch(error=>{if(codeOwner===owner)codeOwner=null;throw error;});
      return owner.promise;
    }
    return {
      context, outputNode: master, codeInputNode:balance, codeOutputNode:codeFade, codeFadeNode:codeFade,
      sampleRate: context.sampleRate, command, read: () => command('read'),getSidClient,
      captureSoundEditGuard(){
        assertOpen();const owner=codeOwner,generation=codeGeneration;
        return ()=>!disposed&&!fatalError&&context.state!=='closed'&&codeOwner===owner&&codeGeneration===generation;
      },
      async resume() {
        assertOpen();
        try { await context.resume(); assertOpen(); } catch (error) { fail(error); throw error; }
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
    // Caller cancellation is silent; failures retire this engine and notify UI.
    if (signal?.aborted && !fatalError) error = new DOMException('SID audio startup cancelled', 'AbortError');
    if (error?.name !== 'AbortError') fail(error);
    await dispose().catch(() => {}); throw error;
  } finally { nativeClearTimer(startupTimer); signal?.removeEventListener('abort', cancelled); }
}
