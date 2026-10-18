/** One disposable worker per import keeps conversion and cancellation off the UI. */
export function convertSpcImport(prepared, {directory, durationSeconds, signal, onProgress} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./playground_spc_trace_worker.js?v=spc-trace-filter-1', import.meta.url), {type:'module'});
    const cleanup = () => {clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate();};
    const finish = (fn, value) => {cleanup(); fn(value);};
    const abort = () => finish(reject, signal.reason ?? new DOMException('SPC conversion cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(reject, new Error('SPC conversion timed out. Try a shorter interval.')), 180000);
    signal?.addEventListener('abort', abort, {once:true});
    worker.onmessage = ({data}) => {
      if (data.type === 'progress') onProgress?.(data);
      else if (data.type === 'result') finish(resolve, data.plan);
      else if (data.type === 'error') {
        const error = new Error(data.message); error.name = data.name ?? 'Error'; finish(reject, error);
      }
    };
    worker.onerror = event => {event.preventDefault(); finish(reject, new Error(event.message || 'SPC conversion worker failed'));};
    worker.onmessageerror = () => finish(reject, new Error('Invalid SPC conversion worker result'));
    // Conversion needs the original bytes and provenance; omit the scanned BRR
    // arrays, which are only used by the separate Instruments mode.
    const source = {name:prepared.name, spc:{originalBytes:prepared.spc.originalBytes}, candidates:[],
      scan:{directory:prepared.scan.directory, summary:prepared.scan.summary, rejected:prepared.scan.rejected},
      metadata:prepared.metadata, warnings:prepared.warnings};
    try {worker.postMessage({bytes:source.spc.originalBytes, prepared:source, directory, durationSeconds});}
    catch (error) {finish(reject, error);}
  });
}
