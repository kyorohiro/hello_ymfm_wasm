/** Browser setup; commands subsequently travel directly from Worker to Worklet. */
const nativeFetch = globalThis.fetch?.bind(globalThis);
/** @param {AudioContext} context
 * @param {AudioNode} destination */
export async function createYm2608Audio(context, destination) {
  const bytes = async path => {
    const response = await nativeFetch(new URL(path, import.meta.url));
    if (!response.ok) throw new Error(`YM2608 HTTP ${response.status}: ${path}`);
    return response.arrayBuffer();
  };
  const [wasmBinary, rom] = await Promise.all([
    bytes('../generated/ym2608_wasm.wasm'), bytes('./tetorica_ym2608_adpcm_rom.bin'),
    context.audioWorklet.addModule(new URL('./playground_ym2608_worklet.js?v=ym2608-modes-1', import.meta.url)),
  ]);
  const node = new AudioWorkletNode(context, 'tetorica-ym2608', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {wasmBinary, rom},
  });
  try {
    await new Promise((resolve, reject) => {
      node.port.onmessage = ({data}) => { if (data.ready) resolve(); else if (data.error) reject(new Error(data.error)); };
      node.onprocessorerror = () => reject(new Error('YM2608 Worklet failed'));
    });
  } catch (error) { node.port.postMessage({method: 'dispose'}); node.disconnect(); node.port.close(); throw error; }
  node.connect(destination);
  const channel = new MessageChannel();
  node.port.postMessage({port: channel.port1}, [channel.port1]);
  let disposed = false;
  return {node, port: channel.port2, dispose() {
    if (disposed) return;
    disposed = true; node.port.postMessage({method: 'dispose'}); node.disconnect(); node.port.close();
  }};
}
