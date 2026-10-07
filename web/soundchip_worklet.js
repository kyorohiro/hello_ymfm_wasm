/** Main-side chip endpoint. The actual WASM chip is created inside AudioWorklet. */
const supported = new Set(['ym2612', 'ym2608', 'gameboy', 'segapsg', 'ym2151', 'pwm']);
export async function createWorkletSoundChip(name, options, loadBinary) {
  if (!supported.has(name)) throw new Error(`Worklet chip not supported: ${name}`);
  options.signal?.throwIfAborted();
  if (!Number.isFinite(options.gain ?? .25) || (options.gain ?? .25) < 0 || (options.gain ?? .25) > 4) throw new RangeError('Invalid worklet output gain');
  if (!options.audioContext && typeof AudioContext === 'undefined') throw new Error('Worklet execution requires a browser AudioContext');
  const ownsContext = !options.audioContext;
  const context = options.audioContext ?? new AudioContext(options.sampleRate ? {sampleRate: options.sampleRate} : undefined);
  let node, gain, closed = false, closing, failure;
  const requests = new Map(); let sequence = 0;
  const request = (method, args = []) => {
    if (closed) return Promise.reject(new Error('Worklet chip is disposed'));
    if (failure) return Promise.reject(failure);
    const id = `chip:${++sequence}`;
    return new Promise((resolve, reject) => {
      requests.set(id, {resolve, reject}); node.port.postMessage({method, args, id});
    });
  };
  const dispose = () => {
    if (closing) return closing;
    closed = true;
    for (const pending of requests.values()) pending.reject(new Error('Worklet chip is disposed'));
    requests.clear();
    closing = (async () => {
      if (gain && context.state === 'running') {
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
        gain.gain.linearRampToValueAtTime(0, context.currentTime + .02);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      node?.port.postMessage({method: 'dispose'}); node?.disconnect(); gain?.disconnect();
      if (ownsContext && context.state !== 'closed') await context.close();
    })();
    return closing;
  };
  const abort = () => {void dispose();};
  options.signal?.addEventListener('abort', abort, {once: true});
  try {
    options.signal?.throwIfAborted();
    await context.resume();
    const wasmBinary = await loadBinary();
    await context.audioWorklet.addModule(new URL('./soundchip-output-worklet.js', import.meta.url).href);
    options.signal?.throwIfAborted();
    const chipOptions = Object.fromEntries(['clock', 'sampleRate', 'flags', 'variant', 'outputMode'].filter(key => options[key] !== undefined).map(key => [key, options[key]]));
    node = new AudioWorkletNode(context, 'tetorica-soundchip', {
      numberOfInputs: 0, outputChannelCount: [2],
      processorOptions: {name, chipOptions, wasmBinary},
    });
    const ready = await new Promise((resolve, reject) => {
      requests.set(0, {resolve, reject});
      node.onprocessorerror = () => {
        const error = new Error('Sound-chip AudioWorklet failed');
        failure = error;
        for (const pending of requests.values()) pending.reject(error);
        requests.clear(); reject(error);
      };
      node.port.onmessage = ({data}) => {
        if (data.type === 'ready') {requests.delete(0); resolve(data); return;}
        if (data.error && data.id === undefined) {
          failure = new Error(data.error);
          for (const pending of requests.values()) pending.reject(failure);
          requests.clear(); reject(failure); return;
        }
        const pending = requests.get(data.id);
        if (pending) {requests.delete(data.id); data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.value);}
      };
    });
    options.signal?.throwIfAborted();
    gain = context.createGain(); gain.gain.value = options.gain ?? .25; node.connect(gain);
    return {
      execution: 'worklet', name, port: node.port, node, audioContext: context,
      sampleRate: () => ready.sampleRate,
      request,
      createTransportPort() {
        if (closed) throw new Error('Worklet chip is disposed');
        const channel = new MessageChannel();
        node.port.postMessage({method: 'attachPort', port: channel.port1}, [channel.port1]);
        return channel.port2;
      },
      async start() {await request('start'); gain.gain.setValueAtTime(options.gain ?? .25, context.currentTime); gain.connect(options.outputNode ?? context.destination); await context.resume();},
      async stop() {await request('stop'); gain.disconnect();},
      dispose,
    };
  } catch (error) {await dispose(); throw error;}
  finally {options.signal?.removeEventListener('abort', abort);}
}
