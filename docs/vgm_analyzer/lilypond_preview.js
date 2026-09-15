// Run each engraving in its own worker so closing/cancelling releases WASM memory.
export function renderLilyPond(source, { onProgress = () => {}, onDiagnostic = () => {}, signal,
  workerFactory = () => new Worker(new URL('./vendor/lilypond/lilypond.worker.js?v=locals-4', import.meta.url), { type: 'module' }),
  timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Rendering cancelled')); return; }
    const worker = workerFactory();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => finish(new Error('Rendering cancelled'));
    const timer = setTimeout(() => finish(new Error('Rendering timed out; select fewer channels and try again')), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    const diagnostics = [];
    worker.addEventListener('messageerror', () => finish(new Error('Could not receive LilyPond worker output')));
    worker.addEventListener('error', event => finish(new Error(event.message || 'LilyPond worker failed')));
    worker.addEventListener('message', ({ data }) => {
      if (settled || data.requestId !== 1) return;
      if (data.type === 'progress') onProgress(data.message);
      if (data.type === 'diagnostic') {
        if (diagnostics.length === 200) diagnostics.shift();
        diagnostics.push(data.message);
        onDiagnostic(data.message);
      }
      if (data.type === 'error') {
        if (data.stack) onDiagnostic(data.stack);
        const hint = /Maximum call stack size exceeded/.test(data.message) && /wasm/i.test(data.stack ?? '')
          ? ' LilyPond reached the WebAssembly call-stack limit. If browser developer tools are open, close them, reload the page, and retry. The .ly export is still available.' : '';
        finish(new Error(data.message + hint));
      }
      if (data.type === 'result') {
        if (data.exitCode !== 0 || !data.svgs?.length) finish(new Error(diagnostics.join('\n') || `LilyPond exited with code ${data.exitCode}`));
        else finish(null, { svgs: data.svgs, files: data.files, diagnostics });
      }
    });
    try { worker.postMessage({ type: 'render', requestId: 1, source }); }
    catch (error) { finish(error); }
  });
}

export function createLilyPondPreview(dialog) {
  const status = dialog.querySelector('[data-status]');
  const pages = dialog.querySelector('[data-pages]');
  const cancel = dialog.querySelector('[data-cancel]');
  const logs = dialog.querySelector('[data-logs]');
  let controller = null, generation = 0, urls = [], ticker = null;
  function clear() { for (const url of urls) URL.revokeObjectURL(url); urls = []; pages.replaceChildren(); }
  function stop() { clearInterval(ticker); ticker = null; generation++; controller?.abort(); controller = null; cancel.disabled = true; cancel.hidden = true; }
  cancel.addEventListener('click', () => { stop(); status.textContent = 'Rendering cancelled. You can close this window and try again.'; });
  dialog.addEventListener('close', () => { stop(); clear(); });
  return {
    async show(source) {
      stop(); clear(); logs.textContent = '';
      const current = generation;
      controller = new AbortController(); cancel.disabled = false; cancel.hidden = false;
      let phase = 'Loading LilyPond… First preview loads about 72 MiB.';
      const started = Date.now();
      const refresh = () => { status.textContent = `${phase} (${Math.floor((Date.now() - started) / 1000)} s)`; };
      refresh(); ticker = setInterval(refresh, 1000);
      const messages = [];
      if (!dialog.open) dialog.showModal();
      try {
        const result = await renderLilyPond(source, { signal: controller.signal, onProgress: text => { if (current === generation) { phase = text; refresh(); } },
          onDiagnostic: text => {
            if (current !== generation) return;
            if (messages.length === 200) messages.shift();
            messages.push(text); logs.textContent = messages.join('\n');
            phase = text; refresh();
          } });
        if (current !== generation) return;
        result.svgs.forEach((svg, i) => {
          // An image document isolates SVG scripts and external resources from the app.
          const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); urls.push(url);
          const figure = document.createElement('figure');
          const img = document.createElement('img'); img.src = url; img.alt = `Score page ${i+1}`;
          img.style.cssText = 'display:block;width:100%;height:auto;background:white';
          const link = document.createElement('a'); link.href = url; link.download = `score-${i+1}.svg`; link.textContent = `Save SVG · Page ${i+1}`;
          figure.append(img, link); pages.append(figure);
        });
        logs.textContent = result.diagnostics.join('\n');
        status.textContent = `${result.svgs.length} page(s). Rendered locally with LilyPond.`;
      } catch (error) { if (current === generation) status.textContent = `Preview failed: ${error.message}`; }
      finally { if (current === generation) { clearInterval(ticker); ticker = null; controller = null; cancel.disabled = true; cancel.hidden = true; } }
    },
    close() { stop(); clear(); if (dialog.open) dialog.close(); },
  };
}
