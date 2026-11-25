// SPDX-License-Identifier: BSD-3-Clause
import {validRegister, integer} from './fm21290.js';
import {watchAudioEndpoint} from './playground_audio_endpoint.js';

export function createFm21290Client(port) {
  let disposed = false;
  return {
    writeRegister(address, value) {
      if (disposed) throw new Error('FM21290 is disposed');
      validRegister(address);
      integer(value, 0, 255, 'register data');
      port.postMessage({method:'writeRegister', args:[address, value]});
    },
    dispose() { disposed = true; port.close(); },
  };
}

export async function createFm21290Audio(context, destination) {
  await context.audioWorklet.addModule(new URL('./soundchip-output-worklet.js', import.meta.url).href);
  const node = new AudioWorkletNode(context, 'tetorica-soundchip', {
    numberOfInputs:0, outputChannelCount:[2], processorOptions:{name:'fm21290', chipOptions:{}},
  });
  const channel = new MessageChannel();
  const dispose = () => {
    node.port.postMessage({method:'dispose'});
    node.disconnect();
    node.port.close();
    channel.port1.close();
    channel.port2.close();
  };
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('FM21290 worklet timed out')), 15000);
      node.onprocessorerror = () => reject(new Error('FM21290 processor failed'));
      node.port.onmessage = ({data}) => {
        if (data.type === 'ready') resolve();
        else if (data.error) reject(new Error(data.error));
      };
    });
    node.port.postMessage({method:'attachPort', port:channel.port1}, [channel.port1]);
    node.port.postMessage({method:'start'});
    node.connect(destination);
    return watchAudioEndpoint({node, port:channel.port2, dispose}, {context, label:'FM21290'});
  } catch (error) { dispose(); throw error; }
  finally { clearTimeout(timer); }
}
