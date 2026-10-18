import {SpcCore, SPC_TRACE_MAX_EVENTS} from './spc.js?v=spc-song-js-1';

export const SPC_TRACE_MAX_SECONDS = 600;
export {SPC_TRACE_MAX_EVENTS};

/** Execute a bounded SPC interval offline. Events retain the native DSP clock;
 * no AudioContext, BPM, output sample-rate conversion or audio playback is used.
 * @param {ArrayBuffer|ArrayBufferView} bytes
 * @param {{durationSeconds:number,moduleFactory:Function,moduleOptions?:object,
 * signal?:AbortSignal,onProgress?:(progress:{renderedSeconds:number,durationSeconds:number,ratio:number})=>void,
 * maxEvents?:number}} options
 */
export async function captureSpcTrace(bytes, {durationSeconds, moduleFactory, moduleOptions,
  signal, onProgress, maxEvents = SPC_TRACE_MAX_EVENTS} = {}) {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.1 || durationSeconds > SPC_TRACE_MAX_SECONDS) {
    throw new RangeError(`Conversion seconds must be between 0.1 and ${SPC_TRACE_MAX_SECONDS}`);
  }
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > SPC_TRACE_MAX_EVENTS) {
    throw new RangeError(`maxEvents must be between 1 and ${SPC_TRACE_MAX_EVENTS}`);
  }
  signal?.throwIfAborted();
  const core = await SpcCore.create({moduleFactory, moduleOptions});
  try {
    signal?.throwIfAborted();
    core.load(bytes);
    core.beginTrace({maxEvents});
    const frames = Math.round(durationSeconds * 32000);
    // Match file playback's native fetch size. The upstream core defers DSP
    // catch-up: CPU writes into live BRR RAM can depend on that fetch boundary.
    const blockFrames = 128, left = new Float32Array(blockFrames), right = new Float32Array(blockFrames);
    for (let rendered = 0, blocks = 0; rendered < frames;) {
      signal?.throwIfAborted();
      core.renderInto(left, right, blockFrames); rendered += blockFrames;
      if (++blocks % 128 === 0 || rendered >= frames) {
        onProgress?.({renderedSeconds:Math.min(rendered, frames) / 32000, durationSeconds:frames / 32000, ratio:Math.min(rendered / frames, 1)});
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    signal?.throwIfAborted();
    const trace = core.endTrace();
    trace.durationClocks = frames * 32;
    // The player fetches complete blocks even at the chosen interval's end.
    // Retain that observed prefix, discarding only events beyond its duration.
    let words = trace.events.length;
    while (words && trace.events[words - 4] > trace.durationClocks) words -= 4;
    if (words !== trace.events.length) trace.events = trace.events.slice(0, words);
    return trace;
  } finally {core.dispose();}
}
