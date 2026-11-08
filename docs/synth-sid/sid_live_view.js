// SPDX-License-Identifier: BSD-3-Clause
// A passive view of one coherent Player observation. Reading this view never
// clocks a chip, changes the tune, or applies a keyboard instrument.
import {captureSidVoices} from '../sid-player/voice_snapshot.js';

const waveformFlags = [[0x10, 'Triangle'], [0x20, 'Saw'], [0x40, 'Pulse'], [0x80, 'Noise']];
const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const integer = (value, maximum, label) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new RangeError(`${label} must be an integer 0..${maximum}`);
  return value;
};
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function nearestNote(frequencyHz) {
  if (frequencyHz <= 0) return null;
  const exact = 69 + 12 * Math.log2(frequencyHz / 440), midi = Math.round(exact);
  if (midi < 0 || midi > 127) return null;
  return {midi, name: `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`, cents: (exact - midi) * 100};
}

/** Decode hardware register values without narrowing them to the portable
 * preset format. Combined/no waveforms, silent routing and TEST remain visible.
 * The result is detached and frozen. Envelope is null when unobservable;
 * the sustain register is never substituted for the current envelope level.
 */
export function readSidLiveVoice(state, voice) {
  integer(voice, 2, 'Live SID voice');
  if (!state || typeof state !== 'object') throw new TypeError('Live SID view needs a Player state');
  if (!['6581', '8580'].includes(state.model)) throw new RangeError('Live SID model must be 6581 or 8580');
  if (!Number.isFinite(state.clockHz) || state.clockHz <= 0) throw new RangeError('Live SID clock must be positive');
  const positionFrames = integer(state.positionFrames, Number.MAX_SAFE_INTEGER, 'Live SID position');
  const sampleRate = integer(state.sampleRate, 96000, 'Live SID sample rate');
  if (sampleRate < 8000) throw new RangeError('Live SID sample rate must be 8000..96000');
  const input = state.registers;
  if (!(Array.isArray(input) || ArrayBuffer.isView(input) && input.BYTES_PER_ELEMENT === 1) || input.length !== 32)
    throw new TypeError('Live SID view needs exactly 32 register bytes');
  const registers = Array.from(input, value => integer(value, 255, 'Live SID register'));
  const base = voice * 7, control = registers[base + 4], waveformMask = control & 0xf0;
  const frequencyRegister = registers[base] | registers[base + 1] << 8;
  const frequencyHz = frequencyRegister * state.clockHz / 16777216;
  const sourceVoice = (voice + 2) % 3, sourceBase = sourceVoice * 7;
  const sourceFrequencyRegister = registers[sourceBase] | registers[sourceBase + 1] << 8;
  const observedEnvelope = state.voices?.[voice]?.envelope;
  const envelope = Number.isInteger(observedEnvelope) && observedEnvelope >= 0 && observedEnvelope <= 255
    ? observedEnvelope : null;
  const modeMask = registers[24] >> 4 & 7;
  let importable;
  try {
    const row = captureSidVoices(state).voices[voice];
    importable = {available: row.available, reason: row.reason};
  } catch (cause) {
    importable = {available: false, reason: cause.message};
  }
  return freeze({
    model: state.model, voice, clockHz: state.clockHz, positionFrames, sampleRate,
    timeSeconds: positionFrames / sampleRate, registers,
    frequencyRegister, frequencyHz, note: nearestNote(frequencyHz),
    control, waveformMask, waveforms: waveformFlags.filter(([bit]) => waveformMask & bit).map(([, name]) => name),
    pulseWidth: registers[base + 2] | (registers[base + 3] & 15) << 8,
    attack: registers[base + 5] >> 4, decay: registers[base + 5] & 15,
    sustain: registers[base + 6] >> 4, release: registers[base + 6] & 15,
    gate: Boolean(control & 1), sync: Boolean(control & 2), ring: Boolean(control & 4), test: Boolean(control & 8), envelope,
    source: {voice: sourceVoice, frequencyRegister: sourceFrequencyRegister,
      frequencyHz: sourceFrequencyRegister * state.clockHz / 16777216,
      ratio: frequencyRegister ? sourceFrequencyRegister / frequencyRegister : null},
    filter: {cutoff: registers[22] << 3 | registers[21] & 7, resonance: registers[23] >> 4, modeMask,
      outputs: [[1, 'LP'], [2, 'BP'], [4, 'HP']].filter(([bit]) => modeMask & bit).map(([, name]) => name),
      routed: Boolean(registers[23] & 1 << voice), routingMask: registers[23] & 7,
      volume: registers[24] & 15, voice3off: Boolean(registers[24] & 0x80)},
    importable,
  });
}

const fieldDefinitions = [
  ['frequencyHz', 'Oscillator frequency'], ['frequencyRegister', 'Frequency code'],
  ['gate', 'Gate'], ['envelope', 'Live Envelope'], ['source', 'Modulation source'],
  ['voice3off', 'Voice 3 dry off'], ['import', 'Keyboard capture'], ['position', 'Observed position'],
];
const concise = value => Number(value.toPrecision(6)).toString();
const onOff = value => value ? 'On' : 'Off';

/** Compact supplementary readouts for the common editor. The host passes the
 * returned observation to that same editor's observe() method; waveform,
 * Pulse width, ADSR, filter and modulation controls are not duplicated here.
 * Polling never rebuilds controls, changes focus or reopens the help disclosure.
 */
export function createSidLiveView({root}) {
  const doc = root.ownerDocument, fields = new Map();
  let disposed = false;
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const view = make('div', 'sid-live-view');
  const head = make('div', 'sid-live-head');
  const heading = make('h3', 'sid-live-heading', 'Live CH 1');
  const status = make('p', 'sid-live-state', 'Play a SID to observe its channel.');
  const list = make('dl', 'sid-live-readouts');
  for (const [key, label] of fieldDefinitions) {
    const field = make('div', `sid-live-readout${key === 'import' ? ' sid-live-wide' : ''}`);
    const value = make('dd', '', '—');
    value.dataset.liveField = key;
    value.dataset.value = '';
    field.append(make('dt', '', label), value);
    list.append(field);
    fields.set(key, value);
  }
  const help = make('details', 'sid-live-help');
  help.open = false;
  const helpSummary = make('summary', '', '?');
  helpSummary.setAttribute('aria-label', 'About Live CH observations');
  const notice = make('p', 'sid-help sid-live-notice',
    'Read-only Player observations · up to 20 updates/s. Fast writes between observations may be missed. Frequency is the oscillator tuning, not necessarily the sound’s perceived pitch.');
  help.append(helpSummary, notice);
  const blurHelp = event => { if (event.detail) helpSummary.blur(); };
  const helpKey = event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); };
  helpSummary.addEventListener('click', blurHelp);
  helpSummary.addEventListener('keydown', helpKey);
  head.append(heading, help);
  view.append(head, status, list);
  root.append(view);
  // Polling values must not generate a screen-reader announcement every tick.
  view.setAttribute('aria-live', 'off');

  function setField(key, value, text = String(value)) {
    const node = fields.get(key), next = String(value);
    node.dataset.changed = String(node.dataset.value !== '' && node.dataset.value !== next);
    node.dataset.value = next;
    if (node.textContent !== text) node.textContent = text;
  }
  function clearFields() {
    for (const [key] of fields) setField(key, '', '—');
  }
  function update(state) {
    if (disposed) return null;
    const voice = Number.isInteger(state.liveVoice) && state.liveVoice >= 0 && state.liveVoice <= 2 ? state.liveVoice : 0;
    const enabled = state.liveEnabled !== false;
    const waiting = Boolean(state.liveWaiting && enabled);
    const active = Boolean(state.liveActive && enabled && !waiting);
    root.dataset.liveEnabled = String(enabled);
    root.dataset.liveVoice = String(voice);
    root.dataset.liveActive = String(active);
    root.dataset.liveWaiting = String(waiting);
    let observation = null;
    try {
      if (state.liveState) observation = readSidLiveVoice(state.liveState, voice);
    } catch (cause) {
      root.dataset.liveActive = 'false';
      root.dataset.liveWaiting = 'false';
      root.dataset.state = 'error';
      status.textContent = `Live display could not read this observation: ${cause.message}. Previous display kept.`;
      return null;
    }
    const liveSource = state.liveSource;
    const sourceLabel = liveSource && typeof liveSource.name === 'string'
      ? ` from ${liveSource.name}${Number.isInteger(liveSource.subtune) ? ` · subtune ${liveSource.subtune}` : ''}` : '';
    heading.textContent = `${active ? 'Live ' : ''}CH ${voice + 1}${observation ? ` · ${waiting ? 'last observed ' : ''}${observation.model}${observation.model === '8580' ? ' Preview' : ''}` : ''}`;
    root.dataset.liveFrames = observation ? String(observation.positionFrames) : '';
    root.dataset.liveModel = observation?.model ?? '';
    root.dataset.liveSourceName = observation && liveSource ? String(liveSource.name ?? '') : '';
    root.dataset.liveSourceSubtune = observation && Number.isInteger(liveSource?.subtune) ? String(liveSource.subtune) : '';
    root.dataset.state = state.liveError ? 'error' : waiting ? 'waiting' : active && observation ? 'live' : observation ? 'frozen' : 'idle';
    status.textContent = state.liveError
      ? state.liveMessage || 'Live observation failed. Last display kept.'
      : waiting ? `Waiting for current playback observation.${observation ? ` Previous observation${sourceLabel} remains shown.` : ''}`
      : active && observation ? `Live · selected CH follows the playing SID${sourceLabel}.`
      : observation ? `Frozen · ${enabled ? 'playback observation stopped' : 'Live display off'}. Last observed values${sourceLabel} are shown.`
      : enabled ? 'Play a SID to observe its selected CH.' : 'Live display off. Turn it on to observe a playing SID.';
    if (!observation) {
      clearFields();
      return null;
    }
    const o = observation;
    let frequency = `${o.frequencyHz.toFixed(2)} Hz`;
    if (o.note) frequency += ` · ≈ ${o.note.name} ${o.note.cents >= 0 ? '+' : ''}${Math.round(o.note.cents)}¢`;
    setField('frequencyHz', o.frequencyHz, frequency);
    setField('frequencyRegister', o.frequencyRegister, `${o.frequencyRegister} / 65535`);
    setField('gate', o.gate, onOff(o.gate));
    setField('envelope', o.envelope === null ? 'unavailable' : o.envelope,
      o.envelope === null ? 'Unavailable in this model' : `${o.envelope} / 255`);
    let source = `CH ${o.source.voice + 1} → CH ${voice + 1}`;
    if (o.sync || o.ring) {
      source += o.source.ratio === null ? ' · carrier frequency is zero'
        : ` · ${concise(o.source.ratio)}×${o.source.ratio < .125 || o.source.ratio > 8 ? ' (outside keyboard range)' : ''}`;
    } else source += ' · Sync / Ring off';
    setField('source', o.source.ratio === null ? 'zero-carrier' : o.source.ratio, source);
    setField('voice3off', o.filter.voice3off, onOff(o.filter.voice3off));
    setField('import', o.importable.available ? 'available' : o.importable.reason,
      o.importable.available ? 'Available · capture, then choose a Voice to edit' : `Observable here · ${o.importable.reason}`);
    setField('position', o.positionFrames, `${o.timeSeconds.toFixed(3)} s · frame ${o.positionFrames}`);
    return observation;
  }
  return {update, dispose() {
    if (disposed) return;
    disposed = true;
    helpSummary.removeEventListener('click', blurHelp);
    helpSummary.removeEventListener('keydown', helpKey);
  }};
}
