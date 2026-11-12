// SPDX-License-Identifier: BSD-3-Clause
import {lessonText} from './introduction-locale.js';
import {SID_FILTER_DEFAULTS, SID_FILTER_OUTPUT_GAIN, readSidFilterSettings,
  initializeSidFilterLesson, applySidFilterLesson, setSidFilterChord,
  stopSidFilterLesson, sidFilterLessonCode} from './sid-filter-lesson.js?sid-filter-intro-1';
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';

const root = document.querySelector('[data-sid-filter-lesson]');
const form = document.getElementById('sid-filter-controls');
const $ = id => document.getElementById(id);
const visualizer = createSpuOutputVisualizer({canvas: $('sid-filter-spectrum')});
visualizer.setMode('spectrum');
let active = null, sequence = 0;

// Dynamic imports cannot be cancelled, but they must not hold an AudioContext
// open after Stop. Late module completion never continues the aborted startup.
function waitForStartup(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve(promise).then(value => {
      signal.removeEventListener('abort', abort); resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort); reject(error);
    });
  });
}

function text(node, value) { if (node && node.textContent !== value) node.textContent = value; }
function status(japanese, english, error = false) {
  text($('sid-filter-status'), lessonText(japanese, english));
  $('sid-filter-status').dataset.error = String(error);
}
function settings() {
  return readSidFilterSettings({mode: form.elements.mode.value,
    cutoff: Number(form.elements.cutoff.value), resonance: Number(form.elements.resonance.value),
    routing: [1, 2, 3].reduce((mask, ch) => mask | (form.elements[`route${ch}`].checked ? 1 << (ch - 1) : 0), 0),
    chord: form.elements.chord.checked});
}
function phase(value) {
  root.dataset.phase = value;
  root.setAttribute('aria-busy', String(value === 'loading' || value === 'stopping'));
  $('sid-filter-start').disabled = value !== 'idle';
  $('sid-filter-stop').disabled = value === 'idle' || value === 'stopping';
  $('sid-filter-reset').disabled = value === 'loading' || value === 'stopping';
  for (const field of form.querySelectorAll('input,select')) field.disabled = value === 'loading' || value === 'stopping';
}
function updateSource() {
  const value = settings(), code = sidFilterLessonCode(value);
  text($('sid-filter-code'), code); text($('sid-filter-example'), code);
  text($('sid-filter-cutoff-value'), String(value.cutoff));
  text($('sid-filter-resonance-value'), String(value.resonance));
  const channels = value.chord ? [0, 1, 2] : [0];
  const mask = value.mode === 'bypass' ? 0 : value.routing;
  const names = list => list.length ? list.map(ch => `CH${ch + 1}`).join(' + ') : lessonText('なし', 'none');
  const routed = names(channels.filter(ch => mask & (1 << ch)));
  const dry = names(channels.filter(ch => !(mask & (1 << ch))));
  text($('sid-filter-routing-status'), lessonText(
    `保持する音の割当：共有Filterへ ${routed} ／ Dry（元の音） ${dry}。${value.chord ? '' : 'CH2・CH3は「重ねる」をチェックすると鳴ります。'}`,
    `Held-note routing: shared filter ${routed} / dry ${dry}.${value.chord ? '' : ' CH2 and CH3 sound when Add CH2 / CH3 is checked.'}`));
  document.dispatchEvent(new CustomEvent('playground-source-change', {detail: {id: 'sid-filter-example'}}));
  return value;
}

function retireContext(run) {
  if (!run.retireContext) {
    let pending = null, requested = false;
    // WebKit can report running again just after close() resolved closed.
    // Only this retired context is guarded; a newer Start owns another context.
    const close = () => {
      if (run.context.state === 'closed') return Promise.resolve();
      requested = true;
      if (pending) return pending;
      pending = (async () => {
        do {
          requested = false;
          if (run.context.state !== 'closed') await run.context.close();
        } while (requested && run.context.state !== 'closed');
      })().finally(() => { pending = null; });
      return pending;
    };
    run.retireContext = close;
    // Attach before the first close. The listener belongs to the retired
    // context itself and is collected with it, without a global run registry.
    run.context.addEventListener('statechange', () => {
      if (run.context.state !== 'closed') void close().catch(error => { run.failure ??= error; });
    });
  }
  return run.retireContext();
}

async function closeRun(run, reason = 'stop') {
  if (run.cleanup) return run.cleanup;
  run.closing = true;
  run.controller.abort(new DOMException('SID lesson stopped', 'AbortError'));
  if (active === run) phase('stopping');
  run.cleanup = (async () => {
    try {
      // Stop during module/WASM startup also owns and closes late resources.
      try { await run.initializing; } catch { /* The Start handler reports errors. */ }
      try { await run.queue; } catch { /* The initiating action reports errors. */ }
      if (run.gain && run.context.state === 'running') {
        const now = run.context.currentTime;
        run.gain.gain.cancelScheduledValues(now);
        run.gain.gain.setValueAtTime(run.gain.gain.value, now);
        run.gain.gain.linearRampToValueAtTime(0, now + 0.01);
        // This is a host transport fade, not a SID envelope or clock timer.
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (run.sid) {
        try { await stopSidFilterLesson(run.sid); }
        catch (error) { if (!run.failure) run.failure = error; }
      }
    } finally {
      try { run.sid?.dispose(); }
      catch (error) { run.failure ??= error; }
      finally {
        try { run.endpoint?.dispose(); }
        catch (error) { run.failure ??= error; }
        finally {
          if (active === run) visualizer.disconnect();
          run.gain?.disconnect();
          try { await retireContext(run); }
          catch (error) { run.failure ??= error; }
        }
      }
      if (active === run) {
        active = null; phase('idle');
        if (run.failure) status(`音を再生できませんでした：${run.failure.message}`, `Audio failed: ${run.failure.message}`, true);
        else if (reason === 'hidden') status('ページを離れたため停止しました。「音を鳴らす」で再開できます。', 'Stopped because the page was hidden. Press Start to play again.');
        else status('停止しました。「音を鳴らす」で同じ設定を再生できます。', 'Stopped. Press Start to play the same settings again.');
      }
    }
  })();
  return run.cleanup;
}

async function start() {
  if (active) return;
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) { status('このブラウザはWeb Audioに対応していません。', 'This browser does not support Web Audio.', true); return; }
  let context;
  try { context = new Context({latencyHint: 'interactive'}); }
  catch (error) { status(`音を準備できませんでした：${error.message}`, `Could not prepare audio: ${error.message}`, true); return; }
  const run = {id: ++sequence, context, controller: new AbortController(), endpoint: null, sid: null,
    gain: null, queue: Promise.resolve(), initializing: null, cleanup: null, closing: false, failure: null, settings: null};
  active = run; root.dataset.run = String(run.id); phase('loading');
  status('SIDを準備しています…', 'Preparing SID…');
  // Resume in the actual Start gesture, before loading any module or binary.
  let resumed;
  try { resumed = context.resume(); }
  catch (error) { run.failure = error; await closeRun(run); return; }
  // Do not make Stop wait for resume. A late settlement still retires its own
  // context, including engines that delay statechange delivery.
  void Promise.resolve(resumed).then(() => {
    if (run.closing) return retireContext(run);
  }).catch(error => { if (run.closing) run.failure ??= error; });
  run.initializing = (async () => {
    const [{createSidAudio}, {createSidClient}] = await waitForStartup(Promise.all([
      import('../js/playground_sid_audio.js'), import('../js/playground_sid.js'), resumed,
    ]), run.controller.signal);
    run.controller.signal.throwIfAborted();
    run.gain = context.createGain();
    run.gain.gain.value = SID_FILTER_OUTPUT_GAIN;
    run.gain.connect(context.destination);
    visualizer.connect(context, run.gain);
    run.endpoint = await createSidAudio(context, run.gain, {model: '6581', signal: run.controller.signal,
      onError(error) { run.failure = error; void closeRun(run).catch(() => {}); }});
    run.controller.signal.throwIfAborted();
    run.sid = createSidClient(run.endpoint.port, {clock: run.endpoint.clock, model: run.endpoint.model});
    run.settings = await initializeSidFilterLesson(run.sid, settings());
    run.controller.signal.throwIfAborted();
    phase('playing'); visualizer.setRunning(true);
    status('C3を鳴らしています。再発音せずにFilterを切り替えられます。', 'Holding C3. Change the filter without retriggering the note.');
  })();
  try { await run.initializing; }
  catch (error) {
    if (!run.controller.signal.aborted) run.failure = error;
    await closeRun(run);
  }
}

function update() {
  const value = updateSource(), run = active;
  if (!run?.sid || run.closing || root.dataset.phase !== 'playing') return;
  const task = run.queue.then(async () => {
    if (active !== run || run.closing) return;
    await applySidFilterLesson(run.sid, value);
    if (active !== run || run.closing) return;
    if (run.settings.chord !== value.chord) await setSidFilterChord(run.sid, value.chord);
    run.settings = value;
  });
  run.queue = task.catch(error => {
    if (active === run && !run.closing) { run.failure = error; void closeRun(run).catch(() => {}); }
  });
}

$('sid-filter-start').addEventListener('click', () => { void start().catch(error => status(error.message, error.message, true)); });
$('sid-filter-stop').addEventListener('click', () => { if (active) void closeRun(active).catch(error => status(error.message, error.message, true)); });
for (const input of form.querySelectorAll('input[type="range"]')) input.addEventListener('input', update);
for (const input of form.querySelectorAll('select,input[type="checkbox"]')) input.addEventListener('change', update);
form.addEventListener('submit', event => event.preventDefault());
$('sid-filter-reset').addEventListener('click', () => {
  for (const key of ['mode', 'cutoff', 'resonance']) form.elements[key].value = String(SID_FILTER_DEFAULTS[key]);
  for (let ch = 1; ch <= 3; ch++) form.elements[`route${ch}`].checked = Boolean(SID_FILTER_DEFAULTS.routing & (1 << (ch - 1)));
  form.elements.chord.checked = SID_FILTER_DEFAULTS.chord;
  update();
});
$('sid-filter-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(sidFilterLessonCode(settings())); status('コードをコピーしました。', 'Copied the code.'); }
  catch { status('下のコードを選択してコピーしてください。', 'Select and copy the code below.'); }
});
window.addEventListener('pagehide', () => { if (active) void closeRun(active, 'hidden').catch(() => {}); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && active) void closeRun(active, 'hidden').catch(() => {});
});
phase('idle'); updateSource();
status('「音を鳴らす」を押すまで音源と音声出力は作成しません。', 'The sound chip and audio output are created only when you press Start.');
