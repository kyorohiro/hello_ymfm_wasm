import {watchAudioEndpoint} from './playground_audio_endpoint.js?v=native-extra-snes-1';
/** Browser setup; commands subsequently travel directly from Worker to Worklet. */
const nativeFetch = globalThis.fetch?.bind(globalThis);
/** @param {AudioContext} context
 * @param {AudioNode} destination */
export async function createGameboyAudio(context, destination) {
  const bytes = async path => {
    const response = await nativeFetch(new URL(path, import.meta.url));
    if (!response.ok) throw new Error(`Game Boy HTTP ${response.status}: ${path}`);
    return response.arrayBuffer();
  };
  const [wasmBinary] = await Promise.all([
    bytes('../generated/gameboy_apu_wasm.wasm'),
    context.audioWorklet.addModule(new URL('./playground_gameboy_worklet.js?v=nes-wasm-1', import.meta.url)),
  ]);
  const node = new AudioWorkletNode(context, 'tetorica-gameboy', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {wasmBinary},
  });
  try {
    await new Promise((resolve, reject) => {
      node.port.onmessage = ({data}) => { if(data.type==='chip-inspector-result')return; if (data.ready) resolve(); else if (data.error) reject(new Error(data.error)); };
      node.onprocessorerror = () => reject(new Error('Game Boy Worklet failed'));
    });
  } catch (error) { node.port.postMessage({method: 'dispose'}); node.disconnect(); node.port.close(); throw error; }
  node.connect(destination);
  const channel = new MessageChannel();
  node.port.postMessage({port: channel.port1}, [channel.port1]);
  let disposed = false;
  return watchAudioEndpoint({node, port:channel.port2, dispose() {
    if (disposed) return;
    disposed=true;node.port.onmessage=null;node.onprocessorerror=null;
    try {node.port.postMessage({method:'dispose'});} catch {}
    try {node.disconnect();} catch {}
    node.port.close();channel.port1.close();channel.port2.close();
  }}, {context,label:'Game Boy'});
}
