// SPDX-License-Identifier: BSD-3-Clause
import {validateBrowserPsid, PSID_MAX_FILE_BYTES} from '../js/sid_psid.js';
import {SidPlayerCore} from './core.js';
import {createAudio} from './audio.js';
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';

const $ = id => document.getElementById(id);
const demos = new Set(['tone', 'pulse', 'noise', 'melody-filter']);
const visualizer = createSpuOutputVisualizer({canvas: $('outputCanvas')});
visualizer.setMode('waveform');
function resizeMonitor() {
  const canvas = $('outputCanvas');
  const width = Math.max(160, Math.round(canvas.clientWidth)), height = Math.max(100, Math.round(canvas.clientHeight));
  if (canvas.width === width && canvas.height === height) return;
  // The shared visualizer draws in canvas pixels. Match its logical surface
  // to CSS pixels so a mobile viewport does not squeeze every label to 4 px.
  canvas.width = width; canvas.height = height;
  visualizer.setMode(document.querySelector('[data-view][aria-pressed="true"]').dataset.view);
}
window.addEventListener('resize', resizeMonitor);
resizeMonitor();
let selected = null, audio = null, starting = null, loading = null;
let loadSequence = 0, generation = 0, playing = false, disposed = false, polling = false;
const voiceCells = [];

for (let voice = 0; voice < 3; voice++) {
  const row = document.createElement('tr'), cells = [];
  for (let column = 0; column < 7; column++) {const cell = document.createElement('td'); row.append(cell); cells.push(cell);}
  cells[0].textContent = String(voice + 1); $('voices').append(row); voiceCells.push(cells);
}
function status(message, state = 'ready', error = false) {
  if (disposed) return;
  $('status').textContent = message; $('status').dataset.state = state; $('status').dataset.error = String(error);
}
function updateButtons() {
  $('play').disabled = !selected || !!loading || !!starting || playing;
  $('stop').disabled = !loading && !starting && !playing;
  $('subtune').disabled = !selected || selected.parsed.songs < 2 || !!loading || !!starting;
  $('loadDemo').disabled = !!loading;
  $('transport').setAttribute('aria-busy', String(!!loading || !!starting));
  $('play').textContent = starting ? 'Preparing…' : 'Play';
}
const hex = value => '$' + value.toString(16).toUpperCase().padStart(4, '0');
function showSelection() {
  const parsed = selected.parsed;
  $('title').textContent = parsed.metadata.name || selected.name;
  $('author').textContent = parsed.metadata.author || 'Author not specified';
  $('released').textContent = parsed.metadata.released;
  $('fileInfo').textContent = `${selected.name} · ${parsed.fileSize.toLocaleString()} bytes · PSID v2 · PAL / 6581 · Load ${hex(parsed.loadAddress)} · Init ${hex(parsed.initAddress)} · Play ${hex(parsed.playAddress)}`;
  $('subtune').replaceChildren();
  for (let song = 1; song <= parsed.songs; song++) {
    const option = document.createElement('option'); option.value = String(song); option.textContent = `${song} / ${parsed.songs}`;
    $('subtune').append(option);
  }
  $('subtune').value = String(parsed.subtune);
}
function showState(state) {
  const registers = state?.registers ?? Array(32).fill(0);
  for (let voice = 0; voice < 3; voice++) {
    const base = voice * 7, control = registers[base + 4], cells = voiceCells[voice];
    const waves = [[16, 'Tri'], [32, 'Saw'], [64, 'Pulse'], [128, 'Noise']].filter(([mask]) => control & mask).map(([, label]) => label);
    if (control & 2) waves.push('Sync'); if (control & 4) waves.push('Ring'); if (control & 8) waves.push('TEST');
    cells[1].textContent = waves.join(' + ') || '—';
    cells[2].textContent = `${((registers[base] | registers[base + 1] << 8) * 985248 / 16777216).toFixed(1)} Hz`;
    cells[3].textContent = String(registers[base + 2] | (registers[base + 3] & 15) << 8);
    cells[4].textContent = control & 1 ? 'On' : 'Off'; cells[4].dataset.on = String(!!(control & 1));
    cells[5].textContent = String(state?.voices?.[voice]?.envelope ?? 0);
    cells[6].textContent = [registers[base + 5] >> 4, registers[base + 5] & 15, registers[base + 6] >> 4, registers[base + 6] & 15].join(' / ');
  }
  const modes = [[16, 'LP'], [32, 'BP'], [64, 'HP']].filter(([mask]) => registers[24] & mask).map(([, name]) => name);
  const route = [0, 1, 2].filter(voice => registers[23] & (1 << voice)).map(voice => voice + 1);
  $('filterState').textContent = `Filter ${modes.join(' + ') || 'Off'} · Cutoff ${(registers[22] << 3) | (registers[21] & 7)} · Resonance ${registers[23] >> 4} · Routed voices ${route.join(', ') || 'none'} · Volume ${registers[24] & 15}`;
  const seconds = Math.floor((state?.positionFrames ?? 0) / (state?.sampleRate ?? 48000));
  $('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('engineInfo').textContent = state ? `${state.sampleRate.toLocaleString()} Hz output · PAL 985,248 Hz · ${state.playCalls.toLocaleString()} play calls · Init ${state.initCycles.toLocaleString()} cycles` : 'Audio idle · PAL 985,248 Hz';
}
function retireAudio() {
  generation++;
  const old = audio; audio = null;
  const pending = starting; starting = null; pending?.controller.abort();
  // After audio startup resolves, its AbortSignal no longer owns the engine.
  // A pending load/start ACK must not keep that connected engine alive.
  if (pending?.engine && pending.engine !== old) void pending.engine.dispose().catch(() => {});
  playing = false; visualizer.setRunning(false); visualizer.disconnect();
  if (old) void old.dispose().catch(() => {});
  showState(null); updateButtons();
}
function audioFailed(error, owner) {
  if (disposed || starting !== owner && audio !== owner.engine) return;
  retireAudio();
  status(`Playback stopped: ${error.message}. Selected file kept.`, 'error', true);
}
function cancelLoad() {
  loadSequence++; const old = loading; loading = null; old?.controller.abort();
  // A select shows its draft before preflight finishes. Keep it aligned with
  // the accepted tune when that draft is cancelled or superseded.
  if (selected) $('subtune').value = String(selected.parsed.subtune);
}
function stop() {
  cancelLoad(); retireAudio(); updateButtons();
  status(selected ? 'Stopped. Press Play to start this subtune again.' : 'Stopped. Load a demo or open a SID.', 'stopped');
}

/** Parse, then execute a short, bounded silent preflight. The playing file is
 * untouched until this candidate succeeds; failed or superseded loads keep it.
 * The preflight is not proof that a whole tune is ROM independent.
 */
async function loadSource(getBytes, name, {subtune} = {}) {
  cancelLoad();
  const owner = {sequence: loadSequence, controller: new AbortController()}; loading = owner;
  status(`Checking ${name}…`, 'loading'); updateButtons();
  let candidate;
  try {
    const bytes = await getBytes(owner.controller.signal);
    owner.controller.signal.throwIfAborted();
    const parsed = validateBrowserPsid(bytes, {subtune});
    candidate = await SidPlayerCore.create({sampleRate: 48000, signal: owner.controller.signal});
    candidate.load(parsed.originalBytes, {subtune: parsed.subtune});
    candidate.render(12000);
    if (disposed || loading !== owner || owner.sequence !== loadSequence) return;
    retireAudio(); selected = {bytes: parsed.originalBytes, parsed, name}; showSelection();
    status(`Ready. Press Play · subtune ${parsed.subtune} / ${parsed.songs}.`, 'ready');
  } catch (error) {
    if (!disposed && loading === owner && error.name !== 'AbortError') {
      if (selected) $('subtune').value = String(selected.parsed.subtune);
      status(`Load failed: ${error.message}. ${selected ? 'Current file kept.' : 'Try one of the demos.'}`, 'error', true);
    }
  } finally {
    candidate?.dispose();
    if (loading === owner) {loading = null; updateButtons();}
  }
}
async function play() {
  if (disposed || !selected || loading || starting || playing) return;
  const tune = selected, owner = {controller: new AbortController(), generation: ++generation, engine: null};
  starting = owner; status('Preparing SID playback…', 'starting'); updateButtons();
  try {
    // createAudio resumes immediately, while this click is still a user gesture.
    const engine = await createAudio({volume: Number($('master').value), signal: owner.controller.signal, onError: error => audioFailed(error, owner)});
    owner.engine = engine;
    const current = () => !disposed && starting === owner && generation === owner.generation && selected === tune;
    if (!current()) throw new DOMException('SID start cancelled', 'AbortError');
    await engine.command('load', [tune.bytes, {subtune: tune.parsed.subtune}]);
    if (!current()) throw new DOMException('SID start cancelled', 'AbortError');
    const state = await engine.command('start');
    if (!current()) throw new DOMException('SID start cancelled', 'AbortError');
    engine.setVolume(Number($('master').value)); audio = engine; starting = null; playing = true;
    visualizer.connect(engine.context, engine.outputNode); visualizer.setRunning(true);
    showState(state); status(`Playing · subtune ${tune.parsed.subtune} / ${tune.parsed.songs}.`, 'playing'); updateButtons();
  } catch (error) {
    if (owner.engine) void owner.engine.dispose().catch(() => {});
    if (!disposed && starting === owner) {
      starting = null; playing = false; updateButtons();
      if (error.name !== 'AbortError') status(`Playback failed: ${error.message}. Selected file kept.`, 'error', true);
    }
  }
}
async function poll() {
  if (disposed || polling || !audio || !playing || document.hidden) return;
  const target = audio; polling = true;
  try {const state = await target.read(); if (!disposed && audio === target) showState(state);}
  catch (error) {if (audio === target) {retireAudio(); status(`Playback stopped: ${error.message}. Selected file kept.`, 'error', true);}}
  finally {polling = false;}
}

$('loadSid').addEventListener('click', () => $('sidFile').click());
$('sidFile').addEventListener('change', () => {
  const file = $('sidFile').files?.[0]; $('sidFile').value = ''; if (!file) return;
  void loadSource(async () => {
    if (file.size > PSID_MAX_FILE_BYTES) throw new RangeError(`SID file exceeds the ${PSID_MAX_FILE_BYTES.toLocaleString()}-byte limit`);
    return file.arrayBuffer();
  }, file.name);
});
$('loadDemo').addEventListener('click', () => {
  const demo = $('demo').value; if (!demos.has(demo)) return;
  void loadSource(async signal => {
    const response = await fetch(new URL(`./demos/${demo}.sid`, import.meta.url), {signal});
    if (!response.ok) throw new Error(`Demo could not load (HTTP ${response.status})`);
    return response.arrayBuffer();
  }, `${demo}.sid`);
});
$('subtune').addEventListener('change', () => {
  if (!selected) return;
  const tune = selected, subtune = Number($('subtune').value);
  void loadSource(async () => tune.bytes, tune.name, {subtune});
});
$('play').addEventListener('click', () => {void play();});
$('stop').addEventListener('click', stop);
$('master').addEventListener('input', () => {
  const value = Number($('master').value); $('masterValue').textContent = `${Math.round(value * 100)}%`;
  $('master').closest('label').classList.toggle('is-boost', value > 1);
  try {audio?.setVolume(value);} catch {}
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  for (const peer of document.querySelectorAll('[data-view]')) peer.setAttribute('aria-pressed', String(peer === button));
  visualizer.setMode(button.dataset.view);
});
const timer = setInterval(() => {void poll();}, 200);
window.addEventListener('pagehide', event => {
  if (disposed) return;
  stop();
  // A back/forward-cache entry keeps this JS realm. Retire its audio, but keep
  // the selected tune and live controls so returning can start a new engine.
  if (event.persisted) return;
  disposed = true; clearInterval(timer); window.removeEventListener('resize', resizeMonitor); visualizer.dispose();
});
showState(null); updateButtons();
