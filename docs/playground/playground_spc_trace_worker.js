import factory from '../generated/spc_wasm.js?v=spc-events-1';
import {captureSpcTrace} from '../js/spc_trace.js?v=spc-events-1';
import {captureSpcPerformance} from '../js/spc_performance.js?v=spc-events-1';
import {estimateBrrPitch} from '../js/spc_pitch.js?v=spc-pitch-comments-1';
import {buildSpcImportFiles} from './playground_spc_source.js?v=spc-reference-tuning-1';

let busy = false;
self.onmessage = async ({data}) => {
  if (busy) return;
  busy = true;
  try {
    if (data.action === 'generate') {
      const plan = buildSpcImportFiles(data.prepared, {mode:'javascript', directory:data.directory,
        performance:data.performance, annotations:data.annotations});
      self.postMessage({type:'result', result:plan}, plan.files.filter(file => file.type === 'binary').map(file => file.data.buffer));
      return;
    }
    const response = await fetch(new URL('../generated/spc_wasm.wasm?v=spc-events-1', import.meta.url));
    if (!response.ok) throw new Error(`SPC conversion WASM HTTP ${response.status}`);
    const mode = data.mode ?? 'javascript';
    if (!['javascript','trace'].includes(mode)) throw new TypeError('Unsupported SPC conversion mode');
    const result = await (mode === 'javascript' ? captureSpcPerformance : captureSpcTrace)(data.bytes, {durationSeconds:data.durationSeconds, controlStepMs:data.controlStepMs, moduleFactory:factory,
      moduleOptions:{wasmBinary:await response.arrayBuffer()},
      onProgress:progress => self.postMessage({type:'progress', ...progress})});
    if (data.action === 'analyze') {
      const estimates = result.samples.map((sample, index) => {
        self.postMessage({type:'progress', stage:'pitch', ratio:index / Math.max(1,result.samples.length), completed:index, total:result.samples.length});
        return {sampleId:sample.id, ...estimateBrrPitch(sample)};
      });
      self.postMessage({type:'result', result:{performance:result, estimates}},
        [result.initialDsp.buffer, ...result.samples.map(sample => sample.brr.buffer)]);
      return;
    }
    self.postMessage({type:'progress', ratio:1, stage:'source'});
    const plan = buildSpcImportFiles(data.prepared, {mode, directory:data.directory,
      ...(mode === 'javascript' ? {performance:result} : {trace:result})});
    self.postMessage({type:'result', result:plan}, plan.files.filter(file => file.type === 'binary').map(file => file.data.buffer));
  } catch (error) {self.postMessage({type:'error', message:error.message, name:error.name});}
};
