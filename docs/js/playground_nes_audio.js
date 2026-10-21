import {NES_APU_CLOCK, validateNesApuClock} from './nesapu.js';
/** @param {AudioContext} context
 * @param {AudioNode|null} destination
 * @param {{fds?:boolean,clock?:number,signal?:AbortSignal,workletUrl?:string|URL}} [options] */
export async function createNesAudio(context, destination, {fds = false, clock = NES_APU_CLOCK, signal, workletUrl} = {}) {
  validateNesApuClock(clock);
  signal?.throwIfAborted();
  await waitForInitialization(context.audioWorklet.addModule(workletUrl ?? new URL('./playground_nes_worklet.js?v=audio-numeric-bindings-1', import.meta.url)), signal);
  signal?.throwIfAborted();
  const node = new AudioWorkletNode(context, 'tetorica-nes', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {fds, clock},
  });
  const channel = new MessageChannel();
  let disposed = false, readyTimer;
  const dispose = () => {
    if (disposed) return;
    disposed = true; clearTimeout(readyTimer);
    node.onprocessorerror = null; node.port.onmessage = null;
    try { node.port.postMessage({method:'dispose'}); } catch {}
    node.disconnect(); node.port.close(); channel.port1.close(); channel.port2.close();
  };
  try {
    await waitForInitialization(new Promise((resolve, reject) => {
      readyTimer = setTimeout(() => reject(new Error('NES AudioWorklet initialization timed out')), 15000);
      readyTimer.unref?.();
      node.port.onmessage = ({data}) => {
        if(data.type==='chip-inspector-result')return;
        if (data.ready) resolve(); else if (data.error) reject(new Error(data.error));
      };
      node.onprocessorerror = () => reject(new Error('NES Worklet failed'));
    }), signal);
    clearTimeout(readyTimer); signal?.throwIfAborted();
    if (destination) node.connect(destination);
    node.port.postMessage({port: channel.port1}, [channel.port1]);
    return {node, port:channel.port2, clock, fdsEnabled:fds, dispose};
  } catch (error) { dispose(); throw error; }
}

async function waitForInitialization(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, {once:true});
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
