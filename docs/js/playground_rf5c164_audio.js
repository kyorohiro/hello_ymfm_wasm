import {watchAudioEndpoint} from './playground_audio_endpoint.js?v=native-extra-snes-1';
/** Browser setup shared by Playground and MegaSynth. PCM generation stays in the Worklet. */
const nativeFetch = globalThis.fetch?.bind(globalThis);
/** @param {AudioContext} context
 * @param {AudioNode} destination
 * @param {{signal?:AbortSignal,wasmUrl?:string|URL,workletUrl?:string|URL,fetch?:typeof globalThis.fetch}} [options] */
export async function createRf5c164Audio(context, destination, options = {}) {
  const {signal} = options;
  const wait = promise => {
    signal?.throwIfAborted();
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, {once: true});
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  };
  signal?.throwIfAborted();
  const [wasmBinary] = await wait(Promise.all([
    (options.fetch ?? nativeFetch)(options.wasmUrl ?? new URL('../generated/rf5c164_wasm.wasm', import.meta.url), {signal})
      .then(response => {
        if (!response.ok) throw new Error(`RF5C164 HTTP ${response.status}`);
        return response.arrayBuffer();
      }),
    context.audioWorklet.addModule(options.workletUrl ?? new URL('./rf5c164-worklet.js?v=native-extra-snes-1', import.meta.url)),
  ]));
  signal?.throwIfAborted();
  const node = new AudioWorkletNode(context, 'tetorica-rf5c164', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {wasmBinary},
  });
  let channel, disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    node.port.onmessage=null;node.onprocessorerror=null;
    try {node.port.postMessage({method:'dispose'});} catch {}
    try {node.disconnect();} catch {}
    node.port.close();channel?.port1.close();channel?.port2.close();
  };
  try {
    await wait(new Promise((resolve, reject) => {
      node.port.onmessage = ({data}) => {
        if(data.type==='chip-inspector-result')return;
        if (data.ready) resolve();
        else if (data.error) reject(new Error(data.error));
      };
      node.onprocessorerror = () => reject(new Error('RF5C164 Worklet failed'));
    }));
    signal?.throwIfAborted();
    node.connect(destination);
    channel = new MessageChannel();
    node.port.postMessage({port: channel.port1}, [channel.port1]);
    return watchAudioEndpoint({node, port:channel.port2, dispose}, {context,label:'RF5C164',onError:options.onError});
  } catch (error) {
    dispose();
    throw error;
  }
}
