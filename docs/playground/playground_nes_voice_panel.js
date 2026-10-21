/** NES/FDS voice controls. Snapshots only render; commands are sent on explicit edits. */
const CHANNEL_NAMES = ['Pulse 1', 'Pulse 2', 'Triangle', 'Noise', 'DMC', 'FDS'];
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const finite = (n, digits = 2) => Number.isFinite(n) ? Number(n.toFixed(digits)).toString() : '—';
const noteName = hz => hz > 0 && Number.isFinite(hz) ? (() => {const midi = Math.round(69 + 12 * Math.log2(hz / 440)); return `${NOTE_NAMES[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`;})() : '—';
let panelSequence = 0;

/**
 * @param {{root:HTMLElement,invoke:(method:string,args?:unknown[])=>Promise<unknown>,onKeyboardTargetChange?:(target:object|null)=>void,onError?:(error:Error)=>void}} options
 */
export function createPlaygroundNesVoicePanel({root, invoke, onKeyboardTargetChange, onError = () => {}}) {
  const doc = root.ownerDocument, win = doc.defaultView;
  let state = null, channel = 0, connected = false, visible = false, disposed = false, keyboardBound = false;
  let hold = null, held = new Map(), pressSequence = 0, drawing = null, bindingGeneration = 0, modulationDirty = false;
  const panelId = ++panelSequence;
  const make = (tag, cls, text) => {const node = doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node;};
  const status = make('p', 'chip-editor-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const channelList = make('div', 'chip-channel-list'); channelList.setAttribute('aria-label', 'NES / FDS channel'); root.appendChild(channelList);
  const body = make('fieldset', 'chip-editor-body'); body.disabled = true; root.appendChild(body);
  const summary = make('p', 'subtext'); body.appendChild(summary);
  const actions = make('div', 'chip-actions'); body.appendChild(actions);
  const playButton = button('Hold to play', null, 'audition');
  const keyboardButton = button('Use Keyboard', () => {if (!connected) return; keyboardBound = true; keyboardButton.setAttribute('aria-pressed', 'true'); onKeyboardTargetChange?.(getNoteTarget());}, 'keyboard');
  keyboardButton.setAttribute('aria-pressed', 'false');
  const offButton = button('Release', releaseAll, 'release'); actions.append(playButton, offButton, keyboardButton);
  const auditionNote = number(actions, 'Audition MIDI note', 'audition-midi', {min: 0, max: 127}); auditionNote.value = '60';
  root.appendChild(status);
  const cards = [];
  const channelButtons = CHANNEL_NAMES.map((name, index) => {
    const node = button(name, () => selectChannel(index)); node.dataset.nesChannel = String(index); channelList.appendChild(node); return node;
  });
  function button(text, handler, name) {const node = make('button', '', text); node.type = 'button'; if (name) node.dataset.nesAction = name; if (handler) node.addEventListener('click', handler); return node;}
  function row(parent, label) {const field = make('label', 'chip-field'); field.appendChild(make('span', 'chip-field-label', label)); parent.appendChild(field); return field;}
  function set(input, value) {if (doc.activeElement !== input) input.value = value === undefined || value === null || !Number.isFinite(value) && typeof value === 'number' ? '' : String(value);}
  function number(parent, label, name, {min, max, step = 1, change} = {}) {
    const input = make('input'); input.type = 'number'; input.dataset.nesControl = name; input.step = String(step);
    if (min !== undefined) input.min = String(min); if (max !== undefined) input.max = String(max); row(parent, label).appendChild(input);
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(value) || min !== undefined && value < min || max !== undefined && value > max || step === 1 && !Number.isInteger(value)) {input.setCustomValidity('Enter a value within the displayed range.'); input.reportValidity?.(); return;}
      input.setCustomValidity(''); change?.(value);
    }); return input;
  }
  function select(parent, label, name, values, change) {
    const input = make('select'); input.dataset.nesControl = name;
    for (const [value, text] of values) {const option = make('option', '', text); option.value = String(value); input.appendChild(option);}
    row(parent, label).appendChild(input); input.addEventListener('change', () => change?.(input.value)); return input;
  }
  function check(parent, label, name, change) {const input = make('input'); input.type = 'checkbox'; input.dataset.nesControl = name; row(parent, label).appendChild(input); input.addEventListener('change', () => change(input.checked)); return input;}
  function checked(input, value) {if (doc.activeElement !== input) input.checked = !!value;}
  function section(title) {const card = make('section', 'chip-section'); card.appendChild(make('h3', '', title)); const fields = make('div', 'chip-fields'); card.appendChild(fields); body.appendChild(card); cards.push(card); return {card, fields};}
  function report(error) {if (disposed) return; status.textContent = error?.message ?? String(error); status.dataset.error = 'true'; onError(error);}
  async function command(method, args = []) {
    if (disposed || !connected) return;
    try {await invoke(method, args); if (!disposed) {status.textContent = ''; delete status.dataset.error;}}
    catch (error) {report(error);}
  }
  function current(index = channel) {return state?.channels?.find(entry => entry.channel === index) ?? state?.channels?.[index] ?? {};}
  function selectChannel(index) {
    if (index === channel || index === 5 && !state?.fdsEnabled) return;
    releaseAll(); bindingGeneration++; channel = index; updateView();
    if (keyboardBound) onKeyboardTargetChange?.(getNoteTarget());
  }
  function nextId() {return `nes-panel-${panelId}-${++pressSequence}`;}
  function start(id, midi) {
    if (!connected || disposed || channel === 5 && !state?.fdsEnabled) return;
    const selected = channel; held.set(id, selected); return command('auditionOn', [selected, midi, id]);
  }
  function stop(id) {const selected = held.get(id); if (selected === undefined) return; held.delete(id); return command('auditionOff', [selected, id]);}
  function stopHold(event) {if (!hold || event?.pointerId !== undefined && event.pointerId !== hold.pointerId || event?.type === 'keyup' && event.key !== hold.key) return; const id = hold.id; hold = null; playButton.setAttribute('aria-pressed', 'false'); return stop(id);}
  function releaseAll() {
    hold = null; playButton.setAttribute('aria-pressed', 'false');
    // Release only voices acquired by this panel; a newer code or Keyboard voice is left alone.
    const notes = [...held]; held.clear();
    for (const [id, selected] of notes) void command('auditionOff', [selected, id]);
  }
  function beginHold(event) {
    if (!connected || !visible || hold || event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.(); hold = {id: nextId(), pointerId: event.pointerId, key: event.key}; playButton.setAttribute('aria-pressed', 'true');
    if (event.pointerId !== undefined) playButton.setPointerCapture?.(event.pointerId);
    const midi = Number(auditionNote.value);
    void start(hold.id, auditionNote.value.trim() && Number.isInteger(midi) && midi >= 0 && midi <= 127 ? midi : 60);
  }
  playButton.addEventListener('pointerdown', beginHold);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) playButton.addEventListener(event, stopHold);
  playButton.addEventListener('keydown', event => {if ([' ', 'Enter'].includes(event.key) && !event.repeat) beginHold(event);});
  playButton.addEventListener('keyup', event => {if ([' ', 'Enter'].includes(event.key)) {event.preventDefault(); stopHold();}});
  playButton.addEventListener('blur', stopHold);
  function getNoteTarget() {
    const generation = bindingGeneration;
    return {
      name: `NES / FDS · ${CHANNEL_NAMES[channel]}`,
      noteOn(event) {if (keyboardBound && generation === bindingGeneration) return start(event.id, event.midi);},
      noteOff(event) {return stop(event.id);},
      allNotesOff: releaseAll,
    };
  }

  const pulse = [0, 1].map(index => {
    const {card, fields} = section(`Pulse ${index + 1} voice`);
    const voice = patch => command('setPulseVoice', [index, patch]);
    const duty = select(fields, 'Duty', `pulse-${index}-duty`, [[0.125, '12.5%'], [0.25, '25%'], [0.5, '50%'], [0.75, '75%']], value => voice({duty: Number(value)}));
    const mode = select(fields, 'Volume mode', `pulse-${index}-mode`, [['fixed', 'Fixed volume'], ['envelope', 'Hardware envelope']], value => {
      const ch = current(index); voice(value === 'fixed' ? {volume: ch.volume ?? 8} : {envelope: {period: ch.envelope?.period ?? 8, loop: !!ch.envelope?.loop}});
    });
    const volume = number(fields, 'Volume / envelope period', `pulse-${index}-volume`, {min: 0, max: 15, change: value => voice(mode.value === 'fixed' ? {volume: value} : {envelope: {period: value, loop: loop.checked}})});
    const loop = check(fields, 'Envelope loop / length hold', `pulse-${index}-loop`, value => voice({lengthHalt: value}));
    const frequency = number(fields, 'Frequency (Hz)', `pulse-${index}-frequency`, {min: 0.001, step: 'any', change: value => command('setFrequency', [index, value])});
    const length = number(fields, 'Length table index', `pulse-${index}-length`, {min: 0, max: 31, change: value => voice({lengthIndex: value})});
    const sweep = check(fields, 'Sweep enabled', `pulse-${index}-sweep-enabled`, value => voice({sweep: {enabled: value}}));
    const sweepPeriod = number(fields, 'Sweep period', `pulse-${index}-sweep-period`, {min: 0, max: 7, change: value => voice({sweep: {period: value}})});
    const sweepShift = number(fields, 'Sweep shift', `pulse-${index}-sweep-shift`, {min: 0, max: 7, change: value => voice({sweep: {shift: value}})});
    const negate = check(fields, 'Sweep subtract', `pulse-${index}-sweep-negate`, value => voice({sweep: {negate: value}}));
    card.appendChild(make('p', 'subtext', 'Envelope and sweep are hardware settings. Length index changes reload the length counter; Pulse 1 and Pulse 2 subtract sweeps differ by one timer count.'));
    return {card, duty, mode, volume, loop, frequency, length, sweep, sweepPeriod, sweepShift, negate};
  });
  const triangle = section('Triangle voice');
  const linear = number(triangle.fields, 'Linear counter reload', 'triangle-linear', {min: 0, max: 127, change: value => command('setTriangleVoice', [{linearReload: value}])});
  const triangleHalt = check(triangle.fields, 'Linear control / length hold', 'triangle-halt', value => command('setTriangleVoice', [{lengthHalt: value}]));
  const triangleFrequency = number(triangle.fields, 'Frequency (Hz)', 'triangle-frequency', {min: 0.001, step: 'any', change: value => command('setFrequency', [2, value])});
  const triangleLength = number(triangle.fields, 'Length table index', 'triangle-length', {min: 0, max: 31, change: value => command('setTriangleVoice', [{lengthIndex: value}])});
  triangle.card.appendChild(make('p', 'subtext', 'The triangle has no hardware volume control. Both the length and linear counters gate its output.'));
  const noise = section('Noise voice');
  const noiseMode = select(noise.fields, 'Volume mode', 'noise-mode', [['fixed', 'Fixed volume'], ['envelope', 'Hardware envelope']], value => {
    const ch = current(3); command('setNoiseVoice', [value === 'fixed' ? {volume: ch.volume ?? 8} : {envelope: {period: ch.envelope?.period ?? 8, loop: !!ch.envelope?.loop}}]);
  });
  const noiseVolume = number(noise.fields, 'Volume / envelope period', 'noise-volume', {min: 0, max: 15, change: value => command('setNoiseVoice', [noiseMode.value === 'fixed' ? {volume: value} : {envelope: {period: value, loop: noiseLoop.checked}}])});
  const noiseLoop = check(noise.fields, 'Envelope loop / length hold', 'noise-loop', value => command('setNoiseVoice', [{lengthHalt: value}]));
  const noisePeriod = number(noise.fields, 'Period index', 'noise-period', {min: 0, max: 15, change: value => command('setNoiseVoice', [{period: value}])});
  const noiseShort = check(noise.fields, 'Short sequence', 'noise-short', value => command('setNoiseVoice', [{shortMode: value}]));
  const noiseLength = number(noise.fields, 'Length table index', 'noise-length', {min: 0, max: 31, change: value => command('setNoiseVoice', [{lengthIndex: value}])});
  noise.card.appendChild(make('p', 'subtext', 'Keyboard notes trigger the configured noise; they do not assign a chromatic pitch.'));
  const dmc = section('DMC sample voice');
  const dmcRate = number(dmc.fields, 'Rate index', 'dmc-rate', {min: 0, max: 15, change: value => command('setDmcVoice', [{rate: value}])});
  const dmcLoop = check(dmc.fields, 'Loop', 'dmc-loop', value => command('setDmcVoice', [{loop: value}]));
  const dmcLevel = number(dmc.fields, 'Initial DAC level', 'dmc-level', {min: 0, max: 127, change: value => command('setDmcVoice', [{level: value}])});
  const dmcSample = make('p', 'subtext'); dmc.card.appendChild(dmcSample);
  const fds = section('FDS wave voice');
  const waveCanvas = make('canvas', 'chip-sample-waveform'); waveCanvas.width = 768; waveCanvas.height = 160; waveCanvas.setAttribute('aria-label', 'FDS 64-sample wave; drag to edit'); waveCanvas.setAttribute('role', 'img'); fds.card.appendChild(waveCanvas);
  const waveActions = make('div', 'chip-actions'); fds.card.appendChild(waveActions);
  for (const shape of ['Sine', 'Triangle', 'Saw', 'Square']) waveActions.appendChild(button(shape, () => {
    const wave = Array.from({length: 64}, (_, i) => shape === 'Sine' ? Math.round(31.5 + 31.5 * Math.sin(i * Math.PI / 32)) : shape === 'Triangle' ? Math.round(63 * (1 - Math.abs(i / 16 - 2) / 2)) : shape === 'Saw' ? i : i < 32 ? 63 : 0);
    void command('setFdsWave', [wave]);
  }, `wave-${shape.toLowerCase()}`));
  const fdsGain = number(fds.fields, 'Fixed volume', 'fds-gain', {min: 0, max: 32, change: value => command('setFdsVolume', [{gain: value}])});
  const master = select(fds.fields, 'Master scale', 'fds-master', [[0, '100%'], [1, '2/3'], [2, '1/2'], [3, '2/5']], value => command('setFdsVolume', [{master: Number(value)}]));
  const fdsFrequency = number(fds.fields, 'Frequency (Hz)', 'fds-frequency', {min: 0.001, step: 'any', change: value => command('setFrequency', [5, value])});
  const modEnabled = check(fds.fields, 'Modulation enabled', 'fds-mod-enabled', value => command('setFdsModulation', [{enabled: value}]));
  const modRate = number(fds.fields, 'Modulation rate (12-bit)', 'fds-mod-rate', {min: 0, max: 4095, change: value => command('setFdsModulation', [{rate: value}])});
  const modDepth = number(fds.fields, 'Modulation depth', 'fds-mod-depth', {min: 0, max: 63, change: value => command('setFdsModulation', [{depth: value}])});
  const modBias = number(fds.fields, 'Modulation bias', 'fds-mod-bias', {min: -64, max: 63, change: value => command('setFdsModulation', [{bias: value}])});
  const modField = row(fds.card, 'Modulation table (32 entries, 0–7)'), modTable = make('textarea'); modTable.dataset.nesControl = 'fds-mod-table'; modTable.rows = 2; modTable.setAttribute('aria-label', 'FDS modulation table'); modField.appendChild(modTable);
  modTable.addEventListener('input', () => {modulationDirty = true;});
  fds.card.appendChild(button('Apply modulation table', () => {
    const table = modTable.value.trim().split(/[\s,]+/).map(Number);
    if (table.length !== 32 || table.some(n => !Number.isInteger(n) || n < 0 || n > 7)) {report(new RangeError('FDS modulation needs 32 values from 0 to 7.')); return;}
    modulationDirty = false; void command('setFdsModulation', [{table}]);
  }, 'apply-modulation'));
  fds.card.appendChild(make('p', 'subtext', 'Draw the 64 wave values above. A completed stroke is sent once; opening this view never writes a wave.'));
  function drawWave(wave) {
    const ctx = waveCanvas.getContext('2d'); if (!ctx) return;
    const w = waveCanvas.width, h = waveCanvas.height; ctx.clearRect(0, 0, w, h); ctx.strokeStyle = '#60717a'; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    ctx.strokeStyle = '#7bbcf7'; ctx.lineWidth = 2; ctx.beginPath();
    Array.from(wave ?? []).forEach((value, i) => {const x = (i + 0.5) * w / 64, y = h - 8 - value / 63 * (h - 16); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);}); ctx.stroke();
  }
  function drawAt(event) {
    if (!drawing) return; const rect = waveCanvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const point = Math.max(0, Math.min(63, Math.floor((event.clientX - rect.left) / rect.width * 64))), value = Math.max(0, Math.min(63, Math.round((1 - (event.clientY - rect.top) / rect.height) * 63)));
    if (drawing.last !== null) {const start = drawing.last, previous = drawing.wave[start], distance = point - start; if (distance) for (let i = Math.min(start, point); i <= Math.max(start, point); i++) drawing.wave[i] = Math.round(previous + (value - previous) * (i - start) / distance);}
    drawing.wave[point] = value; drawing.last = point; drawWave(drawing.wave);
  }
  waveCanvas.addEventListener('pointerdown', event => {if (!connected || !visible || channel !== 5 || event.button !== undefined && event.button !== 0) return; event.preventDefault?.(); drawing = {wave: Array.from(state?.fds?.wave ?? Array(64).fill(32)), last: null}; waveCanvas.setPointerCapture?.(event.pointerId); drawAt(event);});
  waveCanvas.addEventListener('pointermove', drawAt);
  waveCanvas.addEventListener('pointerup', event => {if (!drawing) return; drawAt(event); const wave = drawing.wave; drawing = null; void command('setFdsWave', [wave]);});
  const cancelDraw = () => {drawing = null; drawWave(state?.fds?.wave);};
  waveCanvas.addEventListener('pointercancel', cancelDraw); waveCanvas.addEventListener('lostpointercapture', cancelDraw);
  const advanced = make('details', 'chip-advanced'); advanced.appendChild(make('summary', '', 'Applied registers')); const registers = make('pre', 'chip-memory-ranges'); advanced.appendChild(registers); body.appendChild(advanced);
  const explanation = make('p', 'subtext', 'This panel edits the connected NES / FDS sound chip. Code and audition share its channels. Readbacks show applied register settings, not pending scheduled notes.'); root.appendChild(explanation);

  function updateView() {
    if (!state) return;
    channelButtons.forEach((node, index) => {node.disabled = !connected || index === 5 && !state.fdsEnabled; node.setAttribute('aria-pressed', String(channel === index)); node.dataset.sounding = String(!!current(index).active); node.textContent = `${CHANNEL_NAMES[index]}${current(index).active ? ' ▸' : ''}`;});
    cards.forEach((card, index) => {card.hidden = index !== channel;});
    const ch = current();
    summary.textContent = `${CHANNEL_NAMES[channel]} · ${ch.active ? 'Active' : ch.enabled ? 'Enabled' : 'Off'}${Number.isFinite(ch.frequency) ? ` · ${finite(ch.frequency)} Hz · ${noteName(ch.frequency)}` : ''}${Number.isFinite(ch.period) ? ` · Timer ${ch.period}` : ''} · Clock ${finite(state.clock, 0)} Hz`;
    body.disabled = !connected;
    const dmcReady = state.dmc?.loaded;
    playButton.disabled = channel === 4 && !dmcReady; keyboardButton.disabled = channel === 4 && !dmcReady;
    auditionNote.disabled = channel === 3 || channel === 4;
    pulse.forEach((ui, index) => {const c = current(index); set(ui.duty, c.duty); set(ui.mode, c.constantVolume ? 'fixed' : 'envelope'); set(ui.volume, c.constantVolume ? c.volume : c.envelope?.period); checked(ui.loop, c.envelope?.loop); set(ui.frequency, Number.isFinite(c.frequency) ? Number(c.frequency.toFixed(3)) : null); set(ui.length, c.lengthIndex); checked(ui.sweep, c.sweep?.enabled); set(ui.sweepPeriod, c.sweep?.period); set(ui.sweepShift, c.sweep?.shift); checked(ui.negate, c.sweep?.negate);});
    const t = current(2); set(linear, t.linearReload); checked(triangleHalt, t.lengthHalt); set(triangleFrequency, Number.isFinite(t.frequency) ? Number(t.frequency.toFixed(3)) : null); set(triangleLength, t.lengthIndex);
    const n = current(3); set(noiseMode, n.constantVolume ? 'fixed' : 'envelope'); set(noiseVolume, n.constantVolume ? n.volume : n.envelope?.period); checked(noiseLoop, n.envelope?.loop); set(noisePeriod, n.period); checked(noiseShort, n.shortMode); set(noiseLength, n.lengthIndex);
    const d = state.dmc ?? {}; set(dmcRate, d.rate); checked(dmcLoop, d.loop); set(dmcLevel, d.level);
    dmcSample.textContent = d.loaded ? `DPCM memory loaded · $${Number(d.address ?? 0).toString(16).toUpperCase()} · ${d.length ?? 0} bytes. Keyboard retriggers this sample at the selected rate.` : 'No DPCM memory loaded. Load a sample with nes.dmc.loadSample() first; this view does not generate replacement audio.';
    const f = state.fds ?? {}, mod = f.modulation ?? {}; set(fdsGain, f.gain); set(master, f.master); set(fdsFrequency, Number.isFinite(f.frequency) ? Number(f.frequency.toFixed(3)) : null); checked(modEnabled, mod.enabled); set(modRate, mod.rate); set(modDepth, mod.depth); set(modBias, mod.bias); if (!modulationDirty) set(modTable, mod.table?.join(' ')); if (!drawing) drawWave(f.wave);
    registers.textContent = (state.registers ?? []).map((value, i) => `$${(0x4000 + i).toString(16).toUpperCase()}: ${Number(value).toString(16).toUpperCase().padStart(2, '0')}`).join('  ');
  }
  const onBlur = () => {releaseAll(); cancelDraw();};
  const onVisibility = () => {if (doc.hidden) onBlur();};
  win?.addEventListener('blur', onBlur); doc.addEventListener('visibilitychange', onVisibility);
  return {
    update(snapshot) {if (disposed) return; state = snapshot; if (channel === 5 && !state.fdsEnabled) selectChannel(0); updateView();},
    setConnected(value) {if (disposed || connected === !!value) return; if (!value) {releaseAll(); bindingGeneration++; if (keyboardBound) onKeyboardTargetChange?.(null); keyboardBound = false; keyboardButton.setAttribute('aria-pressed', 'false'); drawing = null;} connected = !!value; body.disabled = !connected; updateView();},
    setKeyboardActive(value) {if (!value) {releaseAll(); bindingGeneration++;} keyboardBound = !!value; keyboardButton.setAttribute('aria-pressed', String(keyboardBound));},
    setVisible(value) {visible = !!value; if (!visible) {stopHold(); cancelDraw();}},
    releaseAll,
    getNoteTarget,
    getSelectedChannel: () => channel,
    dispose() {if (disposed) return; releaseAll(); if (keyboardBound) onKeyboardTargetChange?.(null); disposed = true; keyboardBound = false; win?.removeEventListener('blur', onBlur); doc.removeEventListener('visibilitychange', onVisibility);},
  };
}
