import factory from '../generated/spc_wasm.js?v=spc-events-1';
import {captureSpcPerformance} from '../js/spc_performance.js?v=spc-events-1';
import {estimateBrrPitch} from '../js/spc_pitch.js?v=spc-pitch-comments-1';

// An independent, disposable emulator observes the chosen interval. No port or
// state from the audible SPC player is accepted by this worker.
let busy = false;
self.onmessage = async ({data}) => {
  if (busy) return;
  busy = true;
  try {
    if (data?.action !== 'analyze') throw new TypeError('Unknown SPC note analysis action');
    const response = await fetch(new URL('../generated/spc_wasm.wasm?v=spc-events-1', import.meta.url));
    if (!response.ok) throw new Error(`SPC note analysis WASM HTTP ${response.status}`);
    const performance = await captureSpcPerformance(data.bytes, {
      durationSeconds:data.durationSeconds, controlStepMs:data.controlStepMs,
      moduleFactory:factory, moduleOptions:{wasmBinary:await response.arrayBuffer()},
      onProgress:progress => self.postMessage({type:'progress', ...progress}),
    });
    const estimates = performance.samples.map((sample,index) => {
      self.postMessage({type:'progress',stage:'pitch',completed:index,total:performance.samples.length});
      return {sampleId:sample.id,...estimateBrrPitch(sample)};
    });
    self.postMessage({type:'result',result:{performance,estimates}},
      [performance.initialDsp.buffer,...performance.samples.map(sample => sample.brr.buffer)]);
  } catch (error) {
    self.postMessage({type:'error',message:error.message,name:error.name});
  }
};
