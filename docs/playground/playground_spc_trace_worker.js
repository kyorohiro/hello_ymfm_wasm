import factory from '../generated/spc_wasm.js?v=spc-trace-filter-1';
import {captureSpcTrace} from '../js/spc_trace.js?v=spc-trace-filter-1';
import {buildSpcImportFiles} from './playground_spc_source.js?v=spc-trace-filter-1';

let busy = false;
self.onmessage = async ({data}) => {
  if (busy) return;
  busy = true;
  try {
    const response = await fetch(new URL('../generated/spc_wasm.wasm?v=spc-trace-filter-1', import.meta.url));
    if (!response.ok) throw new Error(`SPC conversion WASM HTTP ${response.status}`);
    const trace = await captureSpcTrace(data.bytes, {durationSeconds:data.durationSeconds, moduleFactory:factory,
      moduleOptions:{wasmBinary:await response.arrayBuffer()},
      onProgress:progress => self.postMessage({type:'progress', ...progress})});
    self.postMessage({type:'progress', ratio:1, stage:'source'});
    const plan = buildSpcImportFiles(data.prepared, {mode:'javascript', directory:data.directory, trace});
    self.postMessage({type:'result', plan}, plan.files.filter(file => file.type === 'binary').map(file => file.data.buffer));
  } catch (error) {self.postMessage({type:'error', message:error.message, name:error.name});}
};
