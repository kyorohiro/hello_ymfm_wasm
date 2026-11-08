// SPDX-License-Identifier: BSD-3-Clause
import {PSID_MAX_FILE_BYTES} from '../js/sid_psid.js';
import {validatePlayerSid, createPlayerCore} from './models.js';
import {copyRomSet, readRomFile} from './roms.js';
import {createAudio} from './audio.js';
import {createVoiceCapture} from './voice_capture.js';
import {SNAPSHOT_NOTICE} from './voice_snapshot.js';
import {prepareSidPresetHandoff} from '../synth-sid/handoff.js';
import {createSpuOutputVisualizer} from '../synth-spu/spu_synth_visualizer.js';

const $ = id => document.getElementById(id);
const demos = new Set(['tone', 'pulse', 'noise', 'melody-filter', 'rsid-irq']);
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
let sidAttempt = null;
let voiceCapture = null;
const roms = {chars: null, basic: null, kernal: null}, romSequence = {chars: 0, basic: 0, kernal: 0};
const pendingRoms = new Map();
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
  $('sidModel').disabled = !!loading || !!starting;
  $('loadDemo').disabled = !!loading;
  const retryUsesMachine = sidAttempt?.format === 'RSID' || sidAttempt?.timing === 'cia'
    || sidAttempt?.format === 'PSID' && $('vbiBackend').value === 'c64';
  $('applyRsidEnvironment').disabled = !sidAttempt || !!loading || !!starting || (retryUsesMachine && $('rsidEnvironment').value === 'rom' && pendingRoms.size > 0);
  $('transport').setAttribute('aria-busy', String(!!loading || !!starting));
  $('play').textContent = starting ? 'Preparing…' : 'Play';
  updateCaptureAvailability();
}
const synthDestination = new URL($('openSnapshotSynth').href, location.href);
const sameSynthOrigin = location.origin !== 'null' && synthDestination.origin === location.origin;
const handoffs = new Map();
function updateCaptureAvailability() {
  const state = voiceCapture?.read();
  $('captureVoiceNow').disabled = !audio || !playing || !!loading || !!starting || !!state?.busy;
  const available = !!state?.selected?.preset && !state.busy;
  $('saveVoicePreset').disabled = !available;
  $('openSnapshotSynth').setAttribute('aria-disabled', String(!available || !sameSynthOrigin));
  $('openSnapshotSynth').title = sameSynthOrigin ? '' : 'Save the preset, then load it in the Synth on its separate host.';
}
function showCapture(state) {
  const {snapshot,selected:row} = state;
  for (const button of $('captureVoiceChoices').querySelectorAll('[data-snapshot-voice]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.snapshotVoice) === state.voice));
  }
  $('captureVoiceNow').textContent = state.busy ? 'Capturing…' : 'Capture now';
  $('captureVoiceStatus').textContent = state.message;
  $('captureVoiceStatus').dataset.error = String(state.error);
  $('captureVoicePreview').dataset.unavailable = String(!!row && !row.available);
  if (!snapshot) {
    $('captureVoiceInfo').textContent = 'No snapshot captured.';
    $('captureVoicePreview').textContent = '';
  } else {
    const seconds = snapshot.positionFrames / snapshot.sampleRate;
    $('captureVoiceInfo').textContent = `${snapshot.name} · Subtune ${snapshot.subtune} · ${snapshot.model}${snapshot.model === '8580' ? ' Preview' : ''} · ${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')} · Voice ${state.voice + 1}`;
    const preset = row.preset;
    const pair = row.pair;
    const connection = pair
      ? `Voice ${pair.sourceVoice + 1} → Voice ${pair.carrierVoice + 1} · ${[pair.sync && 'Sync',pair.ring && 'Ring'].filter(Boolean).join(' + ')} · Ratio ≈${Number(pair.ratio.toPrecision(8))}×\nFrequency-code ratio ${pair.sourceFrequencyRegister} / ${pair.carrierFrequencyRegister} · Synth remaps to silent voice 3 → carrier 1 (one note)\n`
      : '';
    $('captureVoicePreview').textContent = preset
      ? `${connection}${preset.voice.waveform} · Pulse width ${preset.voice.pulseWidth} · ADSR ${[preset.voice.attack,preset.voice.decay,preset.voice.sustain,preset.voice.release].join(' / ')}\nFilter ${preset.filter.enabled ? preset.filter.mode : 'bypassed for this voice'} · Cutoff ${preset.filter.cutoff} · Resonance ${preset.filter.resonance} · Volume ${preset.filter.volume}\nRecorded pitch ${row.frequencyHz.toFixed(1)} Hz (reference only)${row.warnings.length ? '\n' + row.warnings.join(' ') : ''}`
      : row.reason;
  }
  updateCaptureAvailability();
}
voiceCapture = createVoiceCapture({
  getSource: () => !disposed && audio && playing && !loading && !starting ? {
    engine: audio, tune: selected, generation, sequence: loadSequence,
    name: selected.parsed.metadata.name || selected.name, subtune: selected.parsed.subtune,
  } : null,
  isCurrent: source => !disposed && playing && !loading && !starting && audio === source.engine
    && selected === source.tune && generation === source.generation && loadSequence === source.sequence,
  onUpdate: showCapture,
});
$('captureVoiceNotice').textContent = SNAPSHOT_NOTICE;
$('captureVoiceNow').addEventListener('click', () => {$('captureVoiceNow').blur(); void voiceCapture.capture();});
for (const button of $('captureVoiceChoices').querySelectorAll('[data-snapshot-voice]')) {
  button.addEventListener('click', () => {button.blur(); voiceCapture.selectVoice(Number(button.dataset.snapshotVoice));});
}
$('saveVoicePreset').addEventListener('click', () => {
  $('saveVoicePreset').blur(); const state = voiceCapture.read(), preset = state.selected?.preset;
  if (!preset || state.busy) return;
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 2) + '\n'], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'tetorica-sid-voice.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    voiceCapture.notify('Preset saved. Use Load preset… in SID Synth to audition it.');
  } catch (error) {voiceCapture.notify(`Preset could not save: ${error.message}. Snapshot kept.`, true);}
});
$('openSnapshotSynth').addEventListener('click', event => {
  const state = voiceCapture.read(), preset = state.selected?.preset;
  if (!preset || state.busy || !sameSynthOrigin) {
    event.preventDefault();
    if (preset && !sameSynthOrigin) voiceCapture.notify('Use Save preset… here, then Load preset… in SID Synth. Automatic transfer needs the same host.');
    return;
  }
  try {
    const transfer = prepareSidPresetHandoff(preset), destination = new URL(synthDestination);
    destination.hash = transfer.fragment; $('openSnapshotSynth').href = destination.href;
    const timer = setTimeout(() => {transfer.dispose(); handoffs.delete(transfer);}, 301000);
    handoffs.set(transfer, timer);
    voiceCapture.notify('Opening the captured preset in SID Synth. Enable audio or play a key there.');
  } catch (error) {
    event.preventDefault(); voiceCapture.notify(`Automatic transfer unavailable: ${error.message}. Use Save preset… and Load preset… instead.`, true);
  }
});
const hex = value => '$' + value.toString(16).toUpperCase().padStart(4, '0');
function showSelection() {
  const parsed = selected.parsed;
  $('title').textContent = parsed.metadata.name || selected.name;
  $('author').textContent = parsed.metadata.author || 'Author not specified';
  $('released').textContent = parsed.metadata.released;
  const machine = parsed.format === 'RSID' || parsed.playbackBackend === 'c64';
  const environment = machine ? ` · ${selected.loadOptions.environment === 'rom' ? 'Your C64 ROMs' : 'Built-in IRQ environment'}${parsed.basic ? ' · BASIC' : ''}` : '';
  const model = parsed.selectedModel;
  const assumptions = ` · Header ${parsed.clock} / ${parsed.model} → PAL / ${model}`;
  const entry = parsed.format === 'RSID' ? (parsed.basic ? ' · BASIC RUN' : ` · Init ${hex(parsed.initAddress)} · Hardware interrupts`) : ` · Init ${hex(parsed.initAddress)} · Play ${hex(parsed.playAddress)} · ${parsed.timing === 'cia' ? 'CIA timer' : machine ? 'VBI · C64 machine' : 'VBI · Direct'}`;
  const relocation = parsed.format === 'PSID' && parsed.relocation.startPage
    ? parsed.relocation.startPage === 255 ? ' · No free driver pages'
      : ` · Free driver RAM ${hex(parsed.relocation.startPage * 256)}–${hex((parsed.relocation.startPage + parsed.relocation.pageLength) * 256 - 1)}${machine ? ` · Driver ${hex(parsed.driverPage * 256)}` : ''}`
    : '';
  $('fileInfo').textContent = `${selected.name} · ${parsed.fileSize.toLocaleString()} bytes · ${parsed.format} v${parsed.version} · Target PAL / ${model}${model === '8580' ? ' Preview' : ''} · Load ${hex(parsed.loadAddress)}${entry}${environment}${assumptions}${relocation}`;
  $('subtune').replaceChildren();
  for (let song = 1; song <= parsed.songs; song++) {
    const option = document.createElement('option'); option.value = String(song); option.textContent = `${song} / ${parsed.songs}`;
    $('subtune').append(option);
  }
  $('subtune').value = String(parsed.subtune);
  $('sidModel').value = selected.loadOptions.modelSelection ?? 'auto';
  showState(null);
}
function showState(state) {
  const model = state?.model ?? selected?.parsed.selectedModel;
  $('runningModel').textContent = model ?? 'Auto';
  $('modelNote').textContent = model === '8580' ? 'PAL · PREVIEW' : model === '6581' ? 'PAL · APPROXIMATION' : 'PAL · SINGLE SID';
  $('voiceObservation').textContent = model === '8580'
    ? '8580 Preview: live Envelope values are unavailable and shown as a dash.'
    : 'The tune\'s program controls these registers. This display does not change them.';
  const registers = state?.registers ?? Array(32).fill(0);
  for (let voice = 0; voice < 3; voice++) {
    const base = voice * 7, control = registers[base + 4], cells = voiceCells[voice];
    const waves = [[16, 'Tri'], [32, 'Saw'], [64, 'Pulse'], [128, 'Noise']].filter(([mask]) => control & mask).map(([, label]) => label);
    if (control & 2) waves.push('Sync'); if (control & 4) waves.push('Ring'); if (control & 8) waves.push('TEST');
    cells[1].textContent = waves.join(' + ') || '—';
    cells[2].textContent = `${((registers[base] | registers[base + 1] << 8) * 985248 / 16777216).toFixed(1)} Hz`;
    cells[3].textContent = String(registers[base + 2] | (registers[base + 3] & 15) << 8);
    cells[4].textContent = control & 1 ? 'On' : 'Off'; cells[4].dataset.on = String(!!(control & 1));
    const envelope = state?.voices?.[voice]?.envelope;
    cells[5].textContent = Number.isFinite(envelope) ? String(envelope) : '—';
    cells[6].textContent = [registers[base + 5] >> 4, registers[base + 5] & 15, registers[base + 6] >> 4, registers[base + 6] & 15].join(' / ');
  }
  const modes = [[16, 'LP'], [32, 'BP'], [64, 'HP']].filter(([mask]) => registers[24] & mask).map(([, name]) => name);
  const route = [0, 1, 2].filter(voice => registers[23] & (1 << voice)).map(voice => voice + 1);
  $('filterState').textContent = `Filter ${modes.join(' + ') || 'Off'} · Cutoff ${(registers[22] << 3) | (registers[21] & 7)} · Resonance ${registers[23] >> 4} · Routed voices ${route.join(', ') || 'none'} · Volume ${registers[24] & 15}`;
  const seconds = Math.floor((state?.positionFrames ?? 0) / (state?.sampleRate ?? 48000));
  $('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  $('engineInfo').textContent = !state ? `Audio idle · PAL 985,248 Hz${model ? ` · ${model}` : ''}`
    : state.backend === 'c64' ? `${state.sampleRate.toLocaleString()} Hz output · C64 PAL${state.format === 'PSID' ? ` · ${state.timing === 'cia' ? 'CIA timer' : 'VIC raster'} · ${state.playCalls.toLocaleString()} play calls` : ''} · IRQ ${state.irqCount.toLocaleString()} · NMI ${state.nmiCount.toLocaleString()} · Init ${state.initPending ? 'in progress' : state.initReturned ? 'returned' : 'not returned'} · ${state.environment === 'rom' ? 'Your ROMs' : 'Limited IRQ environment'}`
    : `${state.sampleRate.toLocaleString()} Hz output · PAL 985,248 Hz · ${state.playCalls.toLocaleString()} play calls · Init ${state.initCycles.toLocaleString()} cycles`;
  if (state) $('engineInfo').textContent += ` · ${model}${model === '8580' ? ' Preview' : ''}`;
}

function targetOptions() {
  return {modelSelection: $('sidModel').value, assumeUnknown: $('assumeRsid').checked};
}
async function preflight(core, signal) {
  // A VBI init may outlive the native 100k-cycle preflight. Drain only this
  // disposable candidate until RTS/deadline; the accepted audio stays live.
  // Playback loads a fresh instance and retains all of its initialization PCM.
  let state = core.getState();
  while (state.initPending) {
    signal.throwIfAborted();
    core.render(2048);
    state = core.getState();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  core.render(12000);
}
function machineOptions(options) {
  // A subtune switch keeps the environment of an accepted machine tune.
  // A VBI-to-CIA switch reads the draft environment only when it first needs it.
  if (options.environment) return options;
  const environment = $('rsidEnvironment').value;
  if (environment === 'rom' && pendingRoms.size) {
    const error = new Error('Wait for the selected ROM files to finish reading, then press Apply');
    error.code = 'RSID_ROM_PENDING'; throw error;
  }
  return {...options, environment, ...(environment === 'rom' ? {roms: copyRomSet(roms)} : {})};
}
function sidSignature(bytes) {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = String.fromCharCode(...view.subarray(0, 4));
  return signature === 'PSID' || signature === 'RSID' ? signature : null;
}
function retireAudio() {
  voiceCapture.invalidate();
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
  voiceCapture.invalidate();
  loadSequence++; const old = loading; loading = null; old?.controller.abort();
  // A select shows its draft before preflight finishes. Keep it aligned with
  // the accepted tune when that draft is cancelled or superseded.
  if (selected) $('subtune').value = String(selected.parsed.subtune);
}
function stop() {
  cancelLoad(); retireAudio(); updateButtons();
  if (selected) $('sidModel').value = selected.loadOptions.modelSelection ?? 'auto';
  status(selected ? 'Stopped. Press Play to start this subtune again.' : 'Stopped. Load a demo or open a SID.', 'stopped');
}

/** Parse, then execute a short, bounded silent preflight. The playing file is
 * untouched until this candidate succeeds; failed or superseded loads keep it.
 * The preflight is not proof that a whole tune is ROM independent.
 */
async function loadSource(getBytes, name, {subtune, loadOptions: acceptedOptions, machineSettings: acceptedMachineSettings} = {}) {
  cancelLoad();
  const owner = {sequence: loadSequence, controller: new AbortController()}; loading = owner;
  status(`Checking ${name}…`, 'loading'); updateButtons();
  let candidate, attempt = null;
  try {
    const bytes = await getBytes(owner.controller.signal);
    owner.controller.signal.throwIfAborted();
    const format = sidSignature(bytes), isRsid = format === 'RSID';
    if (format) attempt = {format, bytes, name, subtune};
    let options = acceptedOptions ? {...acceptedOptions, ...acceptedMachineSettings, subtune}
      : {subtune, vbiBackend: $('vbiBackend').value, ...targetOptions()};
    if (isRsid) options = machineOptions(options);
    const parsed = validatePlayerSid(bytes, options);
    options = {...options, ...parsed.playerOptions};
    if (attempt) attempt.timing = parsed.timing;
    const machine = isRsid || parsed.playbackBackend === 'c64';
    if (machine) options = machineOptions(options);
    else {delete options.environment; delete options.roms;}
    // Keep an accepted CIA environment across intermediate VBI songs without
    // sending firmware to the VBI backend. Apply starts a new selection and
    // reads the draft controls instead of retaining this snapshot.
    const machineSettings = machine
      ? {environment: options.environment, ...(options.roms ? {roms: options.roms} : {})}
      : acceptedMachineSettings;
    const backend = isRsid ? 'rsid' : machine ? parsed.timing === 'cia' ? 'psid-cia' : 'psid-vbi' : 'psid';
    candidate = await createPlayerCore({model: parsed.selectedModel, backend, sampleRate: 48000, signal: owner.controller.signal});
    candidate.load(parsed.originalBytes, {...options, subtune: parsed.subtune});
    await preflight(candidate, owner.controller.signal);
    if (disposed || loading !== owner || owner.sequence !== loadSequence) return;
    retireAudio(); selected = {bytes: parsed.originalBytes, parsed, name, machineSettings, loadOptions: {...options, subtune: parsed.subtune}};
    sidAttempt = {format: parsed.format, timing: parsed.timing, bytes: parsed.originalBytes, name, subtune: parsed.subtune};
    showSelection();
    status(`Ready. Press Play · subtune ${parsed.subtune} / ${parsed.songs}.`, 'ready');
  } catch (error) {
    if (!disposed && loading === owner && error.name !== 'AbortError') {
      if (attempt) sidAttempt = attempt;
      if (selected) $('subtune').value = String(selected.parsed.subtune);
      if (attempt && (typeof error.code === 'string' && (error.code === 'PSID_CHOICE_REQUIRED' || error.code.startsWith('RSID_') || error.code.startsWith('SID_')) || error.message.includes('ROM') || error.message.includes('Direct VBI'))) $('rsidSettings').open = true;
      status(`Load failed: ${name}: ${error.message}. ${selected ? 'Current file kept.' : 'Try one of the demos.'}`, 'error', true);
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
    const backend = tune.parsed.selectedModel === '8580' ? '8580' : tune.parsed.format === 'RSID' ? 'rsid' : tune.parsed.playbackBackend === 'c64'
      ? tune.parsed.timing === 'cia' ? 'psid-cia' : 'psid-vbi' : 'psid';
    const engine = await createAudio({volume: Number($('master').value), backend, signal: owner.controller.signal, onError: error => audioFailed(error, owner)});
    owner.engine = engine;
    const current = () => !disposed && starting === owner && generation === owner.generation && selected === tune;
    if (!current()) throw new DOMException('SID start cancelled', 'AbortError');
    await engine.command('load', [tune.bytes, tune.loadOptions]);
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
    const response = await fetch(new URL(demo === 'rsid-irq' ? './demos/rsid/irq.sid' : `./demos/${demo}.sid`, import.meta.url), {signal});
    if (!response.ok) throw new Error(`Demo could not load (HTTP ${response.status})`);
    return response.arrayBuffer();
  }, `${demo}.sid`);
});
$('subtune').addEventListener('change', () => {
  if (!selected) return;
  const tune = selected, subtune = Number($('subtune').value);
  void loadSource(async () => tune.bytes, tune.name, {subtune, loadOptions: tune.loadOptions, machineSettings: tune.machineSettings});
});
$('rsidEnvironment').addEventListener('change', () => {$('romFiles').hidden = $('rsidEnvironment').value !== 'rom'; updateButtons();});
$('vbiBackend').addEventListener('change', updateButtons);
$('sidModel').addEventListener('change', () => {
  // Model changes preflight the latest file, just like a subtune change. A
  // successful choice requires Play; failed choices keep the accepted sound.
  if (!sidAttempt) return;
  const attempt = sidAttempt;
  void loadSource(async () => attempt.bytes, attempt.name, {subtune: attempt.subtune});
});
$('applyRsidEnvironment').addEventListener('click', () => {
  if (!sidAttempt) return;
  const attempt = sidAttempt;
  void loadSource(async () => attempt.bytes, attempt.name, {subtune: attempt.subtune});
});
for (const [kind, suffix] of [['chars', 'Chars'], ['basic', 'Basic'], ['kernal', 'Kernal']]) {
  $('rom' + suffix).addEventListener('change', async () => {
    const file = $('rom' + suffix).files?.[0]; $('rom' + suffix).value = ''; if (!file) return;
    const sequence = ++romSequence[kind];
    pendingRoms.set(kind, sequence); updateButtons();
    $('romStatus').textContent = `Reading ${file.name}…`;
    try {
      const bytes = await readRomFile(file, kind);
      if (disposed || sequence !== romSequence[kind]) return;
      roms[kind] = bytes; $('rom' + suffix + 'Info').textContent = `${file.name} · ${bytes.length.toLocaleString()} bytes`;
      $('romStatus').textContent = 'ROM selected in memory. Open a SID or press Apply / retry SID to use these settings.';
    } catch (error) {
      if (!disposed && sequence === romSequence[kind]) $('romStatus').textContent = `${error.message}. Previous ROM kept.`;
    } finally {
      if (pendingRoms.get(kind) === sequence) pendingRoms.delete(kind);
      if (!disposed) updateButtons();
    }
  });
}
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
  voiceCapture.dispose();
  // A user can close this tab before the explicitly opened Synth has loaded.
  // Its one-time transfer must survive; the receiver enforces the five-minute
  // expiry. Only stop this realm's timers, never revoke a child tab's preset.
  for (const timer of handoffs.values()) clearTimeout(timer);
  handoffs.clear();
});
showState(null); updateButtons();
