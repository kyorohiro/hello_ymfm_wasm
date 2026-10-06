import {parentPort, workerData} from 'node:worker_threads';
import {createMegaSynthSession} from '../web/megasynth_session.js';

const options = workerData;
const abort = new AbortController();
let synth, output, state = 'starting', closing, draining;
let rampFrame = 0, maxQueuedFrames = 0, peak = 0;
let pumping, stopping;
const sampleRate = options.sampleRate ?? 48000;
const queueBlocks = options.queueBlocks ?? 4;
const fadeFrames = Math.round(sampleRate * .02);
function status() {
  return {state, sampleRate, currentFrame: synth?.currentFrame ?? 0,
    currentTime: synth?.currentTime ?? 0, maxQueuedFrames, peak,
    output: output?.getState() ?? null, pendingTimers: synth?.pendingTimers ?? 0,
    recording: synth?.recording.getState() ?? null, looper: synth?.looper.getState() ?? null};
}
async function write(pcm) {
  for (const channel of [pcm.left, pcm.right]) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  await output.write(pcm); maxQueuedFrames = Math.max(maxQueuedFrames, output.queuedFrames);
}
function pump() {
  if (pumping) return pumping;
  if (state !== 'playing') return Promise.resolve();
  pumping = (async () => {
    while (state === 'playing' && output.queuedFrames < output.frames * queueBlocks) {
      const pcm = await synth.render(output.frames);
      for (let i = 0; i < output.frames; i++) {
        const gain = Math.min(1, ++rampFrame / fadeFrames);
        pcm.left[i] *= gain; pcm.right[i] *= gain;
      }
      await write(pcm);
    }
  })().catch(error => {void fail(error).catch(() => {});}).finally(() => {pumping = null;});
  return pumping;
}
function onDrain() {
  if (draining && output.queuedFrames === 0) {draining(); draining = null;}
  pump();
}
async function connectOutput(config = {}) {
  if (output) throw new Error('Disconnect the current output before connecting another');
  const bufferFrames = config.bufferFrames ?? options.bufferFrames ?? 512;
  if (!Number.isInteger(bufferFrames) || bufferFrames < 128 || bufferFrames > 8192) throw new RangeError('bufferFrames must be from 128 to 8192');
  const module = config.outputModule ?? new URL('./output_audify.mjs', import.meta.url).href;
  const {createOutput} = await import(module);
  let candidate;
  try {
    candidate = await createOutput({...config.outputOptions, sampleRate, bufferFrames,
      onDrain: () => {if (output === candidate) onDrain();},
      onError: error => {if (!closing && output === candidate) void fail(error).catch(() => {});}});
    abort.signal.throwIfAborted();
    if (!Number.isSafeInteger(candidate.frames) || candidate.frames < 1 || candidate.frames > 8192 ||
        !Number.isFinite(candidate.queuedFrames) || candidate.queuedFrames < 0 ||
        ['write', 'start', 'stop', 'close', 'getState'].some(method => typeof candidate[method] !== 'function')) throw new Error('Invalid audio output adapter');
  } catch (error) {await candidate?.close(); throw error;}
  output = candidate;
  try {await resume();} catch (error) {output = null; state = 'ready'; await candidate.close(); throw error;}
  return status();
}
async function disconnectOutput() {
  if (output) {
    await stop();
    const previous = output; output = null; await previous.close();
  }
  state = 'ready'; return status();
}
function stop() {
  if (stopping) return stopping;
  if (!output && ['ready', 'stopped'].includes(state)) {
    return synth.stop().then(() => {state = 'stopped';});
  }
  if (state !== 'playing') return Promise.resolve();
  state = 'stopping';
  stopping = (async () => {
  await pumping;
  await synth.stopEvents();
  // Append a short fade after already-buffered audio, then clear future commands.
  const blocks = Math.ceil(fadeFrames / output.frames);
  for (let block = 0; block < blocks; block++) {
    const pcm = await synth.render(output.frames);
    for (let i = 0; i < output.frames; i++) {
      const gain = Math.max(0, 1 - (block * output.frames + i + 1) / fadeFrames);
      pcm.left[i] *= gain; pcm.right[i] *= gain;
    }
    await write(pcm);
  }
  await new Promise(resolve => {
    const timer = setTimeout(() => {draining = null; resolve();}, output.queuedFrames * 1000 / sampleRate + 250);
    draining = () => {clearTimeout(timer); resolve();};
  });
  await output.stop(); await synth.stop(); state = 'stopped';
  })().finally(() => {stopping = null;});
  return stopping;
}
async function resume() {
  if (state === 'playing') return;
  if (!output) throw new Error('No audio output connected; use render() or connectOutput()');
  state = 'playing'; rampFrame = 0; await pump(); if (!closing) await output.start();
}
async function fail(error) {
  parentPort.postMessage({type: 'fatal', error: error.message});
  await shutdown();
}
async function shutdown() {
  if (closing) return closing;
  abort.abort();
  closing = (async () => {
    await initialized.catch(() => {});
    try {await stop();} catch (error) {
      parentPort.postMessage({type: 'fatal', error: error.message});
    } finally {
      state = 'closed';
      try {await output?.close();} finally {await synth?.close(); parentPort.postMessage({type: 'closed'});}
      // The owner terminates this Worker after native stream cleanup. Some
      // native addons retain callback references even after closeStream().
    }
  })();
  return closing;
}
let commands = Promise.resolve();
parentPort.on('message', message => {
  if (message.type === 'shutdown') {void shutdown().catch(error => parentPort.postMessage({type: 'fatal', error: error.message})); return;}
  commands = commands.then(async () => {
    try {
      await initialized;
      if (closing) throw new Error('MegaSynthNode is closing');
      let result;
      const {op, args = []} = message;
      if (op === 'fm') {
        const [method, parameters] = args;
        result = synth.callFM(method, parameters);
      } else if (op === 'fx') synth.applyFX(args[0]);
      else if (op === 'recording') {
        const [method, parameters] = args;
        if (!['start', 'stop', 'export', 'import', 'play', 'stopPlayback', 'getState'].includes(method)) throw new Error('Invalid recording command');
        result = synth.recording[method](...parameters);
      } else if (op === 'looper') result = await synth.callLooper(...args);
      else if (op === 'schedule') synth.schedule(...args);
      else if (op === 'stop') await stop();
      else if (op === 'resume') await resume();
      else if (op === 'status') result = status();
      else if (op === 'flush') result = status();
      else if (op === 'render') {
        if (output) throw new Error('Disconnect audio output before offline rendering');
        result = await synth.render(args[0]);
      } else if (op === 'connectOutput') result = await connectOutput(args[0]);
      else if (op === 'disconnectOutput') result = await disconnectOutput();
      else throw new Error(`Unknown operation: ${op}`);
      parentPort.postMessage({type: 'reply', id: message.id, result});
    } catch (error) {parentPort.postMessage({type: 'reply', id: message.id, error: error.message});}
  });
});
const initialized = (async () => {
  synth = await createMegaSynthSession({...options.engineOptions, sampleRate,
    masterVolume: options.masterVolume ?? .25, signal: abort.signal});
  abort.signal.throwIfAborted();
  // null explicitly selects offline mode. With no selection, only a missing
  // audify package falls back to offline; device/native-addon errors stay visible.
  let connect = options.outputModule !== null;
  if (options.outputModule === undefined && !options.outputOptions?.moduleUrl) {
    try {import.meta.resolve('audify');}
    catch (error) {if (error.code === 'ERR_MODULE_NOT_FOUND') connect = false; else throw error;}
  }
  state = 'ready';
  if (connect) await connectOutput({outputModule: options.outputModule, outputOptions: options.outputOptions});
  abort.signal.throwIfAborted(); parentPort.postMessage({type: 'ready', result: status()});
})();
initialized.catch(error => {if (!closing) void fail(error).catch(() => {});});
