import factory from '../generated/spc_wasm.js?v=spc-events-1';
import {captureSpcTrace} from '../js/spc_trace.js?v=spc-events-1';
import {captureSpcPerformance} from '../js/spc_performance.js?v=spc-events-1';
import {buildSpcImportFiles} from './playground_spc_source.js?v=spc-song-timing-1';

let busy = false;
self.onmessage = async ({data}) => {
  if (busy) return;
  busy = true;
  try {
    const response = await fetch(new URL('../generated/spc_wasm.wasm?v=spc-events-1', import.meta.url));
    if (!response.ok) throw new Error(`SPC conversion WASM HTTP ${response.status}`);
    const mode = data.mode ?? 'javascript';
    if (!['javascript','trace'].includes(mode)) throw new TypeError('Unsupported SPC conversion mode');
    const result = await (mode === 'javascript' ? captureSpcPerformance : captureSpcTrace)(data.bytes, {durationSeconds:data.durationSeconds, controlStepMs:data.controlStepMs, moduleFactory:factory,
      moduleOptions:{wasmBinary:await response.arrayBuffer()},
      onProgress:progress => self.postMessage({type:'progress', ...progress})});
    self.postMessage({type:'progress', ratio:1, stage:'source'});
    const plan = buildSpcImportFiles(data.prepared, {mode, directory:data.directory,
      ...(mode === 'javascript' ? {performance:result} : {trace:result})});
    self.postMessage({type:'result', plan}, plan.files.filter(file => file.type === 'binary').map(file => file.data.buffer));
  } catch (error) {self.postMessage({type:'error', message:error.message, name:error.name});}
};
