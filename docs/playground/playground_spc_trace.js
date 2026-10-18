/** Disposable workers keep both analysis and source formatting off the UI.
 * Analysis results can be reused after editing comment-only reference notes.
 */
function runSpcWorker(prepared, options) {
  const {signal, onProgress, ...parameters} = options;
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./playground_spc_trace_worker.js?v=spc-reference-tuning-1', import.meta.url), {type:'module'});
    const cleanup = () => {clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate();};
    const finish = (fn, value) => {cleanup(); fn(value);};
    const abort = () => finish(reject, signal.reason ?? new DOMException('SPC conversion cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(reject, new Error('SPC conversion timed out. Try a shorter interval.')), 180000);
    signal?.addEventListener('abort', abort, {once:true});
    worker.onmessage = ({data}) => {
      if (data.type === 'progress') onProgress?.(data);
      else if (data.type === 'result') finish(resolve, data.result);
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
    try {worker.postMessage({bytes:source.spc.originalBytes, prepared:source, ...parameters});}
    catch (error) {finish(reject, error);}
  });
}

export function analyzeSpcImport(prepared, {durationSeconds, controlStepMs = 20, signal, onProgress} = {}) {
  return runSpcWorker(prepared, {action:'analyze', mode:'javascript', durationSeconds, controlStepMs, signal, onProgress});
}

export function generateSpcImport(prepared, {directory, performance, annotations = [], signal, onProgress} = {}) {
  return runSpcWorker(prepared, {action:'generate', mode:'javascript', directory, performance, annotations, signal, onProgress});
}

export function convertSpcImport(prepared, {directory, durationSeconds, mode = 'javascript', controlStepMs = 20, signal, onProgress} = {}) {
  if (!['javascript','trace'].includes(mode)) throw new TypeError('SPC conversion mode must be javascript or trace');
  return runSpcWorker(prepared, {action:'convert', directory, durationSeconds, mode, controlStepMs, signal, onProgress});
}
