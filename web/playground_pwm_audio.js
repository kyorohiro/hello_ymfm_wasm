/** Commands travel directly from Main or logic Worker to the PWM AudioWorklet. */
export async function createPWM32XAudio(context, destination, options = {}) {
  options.signal?.throwIfAborted();
  await context.audioWorklet.addModule(new URL('./playground_pwm_worklet.js', import.meta.url));
  options.signal?.throwIfAborted();
  const node = new AudioWorkletNode(context, 'tetorica-pwm32x', {
    numberOfInputs: 0, outputChannelCount: [2],
    processorOptions: Object.fromEntries(['clock', 'gain', 'outputMode'].filter(key => options[key] !== undefined).map(key => [key, options[key]])),
  });
  try {
    await new Promise((resolve, reject) => {
      node.port.onmessage = ({data}) => {if (data.ready) resolve(); else if (data.error) reject(new Error(data.error));};
      node.onprocessorerror = () => reject(new Error('PWM AudioWorklet failed'));
    });
    options.signal?.throwIfAborted();
  } catch (error) {node.port.postMessage({method: 'dispose'}); node.disconnect(); node.port.close(); throw error;}
  node.connect(destination);
  const channel = new MessageChannel(); node.port.postMessage({port: channel.port1}, [channel.port1]);
  let disposed = false;
  return {node, port: channel.port2, dispose() {
    if (disposed) return;
    disposed = true; node.port.postMessage({method: 'dispose'}); node.disconnect(); node.port.close();
  }};
}
