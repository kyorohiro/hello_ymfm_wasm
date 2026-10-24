import {watchAudioEndpoint} from './playground_audio_endpoint.js?v=y8950-adpcm-1';
import {validateYm2612Engine} from './playground_soundchip_options.js?v=y8950-adpcm-1';
/** Browser setup; commands subsequently travel directly from Worker to Worklet. */
const nativeFetch = globalThis.fetch?.bind(globalThis);
/** @param {AudioContext} context
 * @param {AudioNode} destination
 * @param {'ym2612'|'ym2203'|'ym2610'|'ym2610b'} name */
export async function createOpnAudio(context, destination, name, options = {}) {
  if (!['ym2612', 'ym2203', 'ym2610', 'ym2610b'].includes(name)) throw new Error(`Unsupported OPN chip: ${name}`);
  const engine = name === 'ym2612' ? validateYm2612Engine(options.engine) : undefined;
  const backend = name === 'ym2610' ? 'ym2610b' : name;
  const bytes = async path => {
    const response = await nativeFetch(new URL(path, import.meta.url));
    if (!response.ok) throw new Error(`OPN HTTP ${response.status}: ${path}`);
    return response.arrayBuffer();
  };
  const [wasmBinary] = await Promise.all([
    bytes(engine === 'nuked' ? '../generated/nuked_opn2_wasm.wasm' : {ym2612:'../generated/ym2612_wasm.wasm',ym2203:'../generated/ym2203_wasm.wasm',ym2610b:'../generated/ym2610b_wasm.wasm'}[backend]),
    context.audioWorklet.addModule(new URL('./playground_opn_worklet.js?v=y8950-adpcm-1', import.meta.url)),
  ]);
  const node = new AudioWorkletNode(context, 'tetorica-opn', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {wasmBinary, name, ...(engine ? {engine} : {})},
  });
  try {
    await new Promise((resolve, reject) => {
      node.port.onmessage = ({data}) => { if(data.type==='chip-inspector-result')return; if (data.ready) resolve(); else if (data.error) reject(new Error(data.error)); };
      node.onprocessorerror = () => reject(new Error('OPN Worklet failed'));
    });
  } catch (error) { node.port.postMessage({method: 'dispose'}); node.disconnect(); node.port.close(); throw error; }
  node.connect(destination);
  const channel = new MessageChannel();
  node.port.postMessage({port: channel.port1}, [channel.port1]);
  let disposed = false;
  const endpoint = {node, port:channel.port2, dispose() {
    if (disposed) return;
    disposed=true;node.port.onmessage=null;node.onprocessorerror=null;
    try {node.port.postMessage({method:'dispose'});} catch {}
    try {node.disconnect();} catch {}
    node.port.close();channel.port1.close();channel.port2.close();
  }};
  if (engine) Object.defineProperty(endpoint, 'engine', {value:engine, enumerable:true});
  return watchAudioEndpoint(endpoint, {context,label:'OPN'});
}
