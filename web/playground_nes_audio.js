import {NES_APU_CLOCK} from './nesapu.js';
/** @param {AudioContext} context
 * @param {AudioNode} destination
 * @param {{fds?:boolean}} [options] */
export async function createNesAudio(context, destination, {fds = false} = {}) {
  await context.audioWorklet.addModule(new URL('./playground_nes_worklet.js', import.meta.url));
  const node = new AudioWorkletNode(context, 'tetorica-nes', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: {fds},
  });
  try {
    await new Promise((resolve, reject) => {
      node.port.onmessage = ({data}) => {
        if (data.ready) resolve(); else if (data.error) reject(new Error(data.error));
      };
      node.onprocessorerror = () => reject(new Error('NES Worklet failed'));
    });
  } catch (error) { node.port.postMessage({method: 'dispose'}); node.disconnect(); node.port.close(); throw error; }
  node.connect(destination);
  const channel = new MessageChannel();
  node.port.postMessage({port: channel.port1}, [channel.port1]);
  let disposed = false;
  return {node, port: channel.port2, clock: NES_APU_CLOCK, fdsEnabled: fds, dispose() {
    if (disposed) return;
    disposed = true; node.port.postMessage({method: 'dispose'}); node.disconnect(); node.port.close();
  }};
}
