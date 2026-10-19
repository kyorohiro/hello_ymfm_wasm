/** One OKIM6258 ADPCM stream. Reads render only; explicit commands own playback. */
const AUDIO_FILE = /\.(?:wav|wave|aif|aiff|mp3|ogg|flac|m4a|aac|webm)$/i;
const DIVIDERS = [1024, 768, 512];
const finiteText = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)).toLocaleString('en-US', {maximumFractionDigits: digits}) : '—';
let panelSequence = 0;

export function oki6258PlaybackCode(state) {
  if (!state) return '';
  return [
    '// Uses the sample already loaded with adpcm.loadSample(...) or adpcm.loadMemory(...).',
    `await adpcm.setClock(${state.clock});`,
    `adpcm.setDivider(${state.divider});`,
    `adpcm.setPan(${Boolean(state.pan?.left)}, ${Boolean(state.pan?.right)});`,
    `// Play with adpcm.play({repeat: ${Boolean(state.repeat)}}); stop with adpcm.stop().`,
    '// OKIM6258 is a single ADPCM stream. Guitar keys retrigger the same sample at this rate.',
  ].join('\n');
}

export function createPlaygroundOki6258VoicePanel({root, invoke, listFiles = () => [], readFile, loadSample,
  onKeyboardTargetChange = () => {}, onError = () => {}}) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc.defaultView ?? globalThis;
  const panelId = ++panelSequence, listeners = [], held = new Map();
  let state = null, connected = false, visible = true, disposed = false, keyboardActive = false;
  let connectionEpoch = 0, bindingEpoch = 0, pressSequence = 0, target, holdPress = null, previewTimer = null;
  let loading = false, loadSequence = 0, loadController = null, waveSignature = '', fileSignature = '';
  const make = (tag, className, text) => {const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;};
  function listen(node, type, handler) {node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler));}
  function button(parent, label, action, name) {const node = make('button', '', label); node.type = 'button'; if (name) node.dataset.chipAction = `oki6258-${name}`; if (action) listen(node, 'click', action); parent.appendChild(node); return node;}
  function field(parent, label) {const node = make('label', 'chip-field'); node.appendChild(make('span', 'chip-field-label', label)); parent.appendChild(node); return node;}
  function output(parent, label, name) {const node = make('output'); node.dataset.chipOutput = `oki6258-${name}`; field(parent, label).appendChild(node); return node;}
  function setValue(node, value) {if (doc.activeElement !== node) node.value = value === undefined || value === null || typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);}
  function checked(node, value) {if (doc.activeElement !== node) node.checked = Boolean(value);}
  function report(error) {if (disposed) return; status.textContent = error?.message ?? String(error); status.dataset.error = 'true'; onError(error);}
  async function command(method, args = []) {
    if (disposed || !connected) return;
    const epoch = connectionEpoch;
    try {const value = await invoke(method, args); if (!disposed && connected && epoch === connectionEpoch) {status.textContent = ''; delete status.dataset.error;} return value;}
    catch (error) {if (!disposed && connected && epoch === connectionEpoch) report(error);}
  }
  const patch = value => command('setVoice', [value]);
  function number(parent, label, name, {min = 0, max, change} = {}) {
    const node = make('input'); node.type = 'number'; node.dataset.chipControl = `oki6258-${name}`; node.min = String(min); node.step = '1'; if (max !== undefined) node.max = String(max); field(parent, label).appendChild(node);
    listen(node, 'change', () => {const value = Number(node.value); if (!node.value.trim() || !Number.isInteger(value) || value < min || max !== undefined && value > max) {node.setCustomValidity('Enter a value within the displayed range.'); node.reportValidity?.(); return;} node.setCustomValidity(''); change?.(value);}); return node;
  }
  function checkbox(parent, label, name, change) {const node = make('input'); node.type = 'checkbox'; node.dataset.chipControl = `oki6258-${name}`; field(parent, label).appendChild(node); listen(node, 'change', () => change(node.checked)); return node;}
  function section(title) {const card = make('section', 'chip-section'); card.appendChild(make('h3', '', title)); body.appendChild(card); return card;}
  function fields(parent) {const node = make('div', 'chip-fields'); parent.appendChild(node); return node;}
  function syncEnabled() {
    body.disabled = !connected || loading;
    const ready = Boolean(state?.sample?.bytes);
    hold.disabled = play.disabled = keyboardButton.disabled = !ready;
    load.disabled = loading || !files.value || !readFile || !loadSample;
  }

  const body = make('fieldset', 'chip-editor-body'); body.disabled = true; root.appendChild(body);
  const sampleCard = section('ADPCM sample · one stream'), sampleFields = fields(sampleCard);
  const sampleInfo = output(sampleFields, 'Loaded material', 'sample'), duration = output(sampleFields, 'Duration at this rate', 'duration');
  const playbackState = output(sampleFields, 'Playback', 'playback-state'), position = output(sampleFields, 'Position', 'position');
  const chooser = fields(sampleCard), files = make('select'); files.dataset.chipControl = 'oki6258-file'; field(chooser, 'Cassette audio file').appendChild(files);
  const load = button(chooser, 'Load audio file', async () => {
    const path = files.value;
    if (!connected || disposed || loading || !path || !readFile || !loadSample) return;
    releaseAll(); const token = ++loadSequence, epoch = connectionEpoch, controller = loadController = new AbortController();
    loading = true; syncEnabled(); status.textContent = `Loading ${path}…`; delete status.dataset.error;
    try {
      let bytes = await readFile(path, {signal: controller.signal}); if (bytes?.data !== undefined) bytes = bytes.data;
      controller.signal.throwIfAborted();
      if (disposed || !connected || epoch !== connectionEpoch || token !== loadSequence) return;
      if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes)) throw new TypeError('The selected file has no audio bytes.');
      await loadSample(bytes, {name: path, signal: controller.signal}); controller.signal.throwIfAborted();
      if (!disposed && connected && epoch === connectionEpoch && token === loadSequence) {status.textContent = 'Sample loaded. Press Hold to play or Use Keyboard to retrigger it.'; delete status.dataset.error;}
    } catch (error) {if (!disposed && connected && epoch === connectionEpoch && token === loadSequence && !controller.signal.aborted) report(error);}
    finally {if (token === loadSequence) {loading = false; loadController = null; syncEnabled();}}
  }, 'load');
  const wave = make('canvas', 'chip-sample-waveform chip-oki-waveform'); wave.width = 800; wave.height = 150; wave.dataset.chipControl = 'oki6258-waveform'; wave.setAttribute('role', 'img'); wave.setAttribute('aria-label', 'Decoded OKI ADPCM sample waveform and playback position'); sampleCard.appendChild(wave);
  sampleCard.appendChild(make('p', 'subtext', 'The waveform summarizes the decoded 4-bit OKI ADPCM bytes, low nibble first. The complete stream plays from its beginning; edits to the original audio belong in Sample Editor.'));

  const voiceCard = section('Playback settings'), voiceFields = fields(voiceCard);
  const divider = make('select'); divider.dataset.chipControl = 'oki6258-divider'; field(voiceFields, 'Clock divider / sample rate').appendChild(divider);
  const dividerOptions = DIVIDERS.map(value => {const option = make('option'); option.value = String(value); divider.appendChild(option); return option;});
  listen(divider, 'change', () => {const value = Number(divider.value); if (DIVIDERS.includes(value)) void patch({divider: value});});
  const rate = output(voiceFields, 'Current VCLK rate (Hz)', 'rate');
  const panLeft = checkbox(voiceFields, 'Left', 'pan-left', value => patch({pan: {left: value}}));
  const panRight = checkbox(voiceFields, 'Right', 'pan-right', value => patch({pan: {right: value}}));
  const repeat = checkbox(voiceFields, 'Repeat whole sample', 'repeat', value => patch({repeat: value}));
  const actions = make('div', 'chip-actions'); voiceCard.appendChild(actions);
  const hold = button(actions, 'Hold to play', null, 'hold');
  const play = button(actions, 'Play 1 second', () => {if (!visible) return; releaseSource('preview'); const id = startNote(60, 'preview'); if (id) previewTimer = win.setTimeout(() => {previewTimer = null; endNote(id);}, 1000);}, 'play');
  button(actions, 'Release', () => releaseAll(), 'release');
  const keyboardButton = button(actions, 'Use Keyboard', () => {if (!connected || !state?.sample?.bytes || loading) return; keyboardActive = true; updateTarget(); status.textContent = 'OKIM6258 is connected to the Guitar Keyboard. Every key retriggers this sample at the selected rate.'; delete status.dataset.error;}, 'keyboard');
  voiceCard.appendChild(make('p', 'subtext', 'One voice only: a new press replaces the previous press. Guitar keys are sample pads at the same playback rate. Hold ends on release or at the sample end; enable Repeat to keep it playing. Divider changes alter pitch and duration together. The chip has no hardware volume control.'));
  const advanced = make('details', 'chip-advanced'); advanced.appendChild(make('summary', '', 'Master clock and playback JavaScript')); body.appendChild(advanced);
  const clockFields = fields(advanced);
  const clock = number(clockFields, 'Master clock (Hz)', 'clock', {min: 100000, max: 100000000, change: value => command('setClock', [value])});
  advanced.appendChild(make('p', 'subtext', 'The X68000 normally supplies 8,000,000 Hz. Changing the master clock affects this entire ADPCM stream. The three hardware rates are clock / 1024, / 768 and / 512.'));
  const code = make('textarea', 'chip-voice-code'); code.readOnly = true; code.rows = 6; code.dataset.chipControl = 'oki6258-code'; code.setAttribute('aria-label', 'OKIM6258 playback settings JavaScript'); advanced.appendChild(code);
  button(advanced, 'Copy playback JavaScript', async () => {
    try {await win.navigator.clipboard.writeText(code.value); if (!disposed) {status.textContent = 'Playback settings copied.'; delete status.dataset.error;}}
    catch {if (!disposed) {code.focus(); code.select(); status.textContent = 'Code selected. Copy it with your keyboard.';}}
  }, 'copy');
  const status = make('p', 'chip-editor-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.appendChild(status);
  root.appendChild(make('p', 'subtext', 'This panel shows the connected chip’s applied stream state. Code and manual playback use the same uploaded sample. Opening this view never loads or starts audio.'));

  function cancelLoad() {if (loadController) {loadController.abort(); loadController = null; loadSequence++; loading = false; syncEnabled(); if (!disposed) status.textContent = 'Sample loading cancelled.';}}
  function startNote(midi, source, externalId, epoch) {
    if (!connected || disposed || loading || !state?.sample?.bytes || !Number.isInteger(midi) || midi < 0 || midi > 127) return null;
    const id = `oki6258-panel:${panelId}:${++pressSequence}`; held.set(id, {source, externalId, epoch}); void command('auditionOn', [0, midi, id]); return id;
  }
  function endNote(id) {if (!held.has(id)) return; held.delete(id); void command('auditionOff', [0, id]);}
  function releaseSource(source) {
    for (const [id, entry] of held) if (entry.source === source) endNote(id);
    if (source === 'preview' && previewTimer !== null) {win.clearTimeout(previewTimer); previewTimer = null;}
    if (source === 'hold') {holdPress = null; hold.setAttribute('aria-pressed', 'false');}
  }
  function releaseAll() {cancelLoad(); for (const id of [...held.keys()]) endNote(id); if (previewTimer !== null) {win.clearTimeout(previewTimer); previewTimer = null;} holdPress = null; hold.setAttribute('aria-pressed', 'false');}
  function updateTarget() {
    const epoch = ++bindingEpoch;
    target = {
      owner: 'okim6258-voice-panel', name: 'OKIM6258 · Sample trigger',
      noteOn(event) {if (!keyboardActive || !connected || epoch !== bindingEpoch || typeof event?.id !== 'string') return; for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.externalId === event.id && entry.epoch === epoch) endNote(id); startNote(event.midi, 'keyboard', event.id, epoch);},
      noteOff(event) {for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.externalId === event?.id && entry.epoch === epoch) endNote(id);},
      allNotesOff() {for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.epoch === epoch) endNote(id);},
    };
    keyboardButton.setAttribute('aria-pressed', String(keyboardActive)); if (keyboardActive) onKeyboardTargetChange(target);
  }
  function holdStart(event) {
    if (!visible || !connected || event.type === 'pointerdown' && event.button !== undefined && event.button !== 0 || event.type === 'keydown' && (event.repeat || ![' ', 'Enter'].includes(event.key))) return;
    event.preventDefault(); releaseSource('hold'); const id = startNote(60, 'hold'); if (!id) return;
    holdPress = {id, pointerId: event.pointerId, key: event.key}; hold.setAttribute('aria-pressed', 'true'); if (event.pointerId !== undefined) try {hold.setPointerCapture(event.pointerId);} catch {}
  }
  function holdEnd(event) {if (!holdPress || event.pointerId !== undefined && event.pointerId !== holdPress.pointerId || event.type === 'keyup' && event.key !== holdPress.key) return; releaseSource('hold');}
  listen(hold, 'pointerdown', holdStart); listen(hold, 'keydown', holdStart); for (const name of ['pointerup', 'pointercancel', 'lostpointercapture', 'keyup']) listen(hold, name, holdEnd);
  listen(hold, 'blur', () => releaseSource('hold')); listen(win, 'blur', releaseAll); listen(doc, 'visibilitychange', () => {if (doc.hidden) releaseAll();});

  function syncFiles() {
    const paths = Array.from(listFiles() ?? []).map(entry => typeof entry === 'string' ? entry : entry.path).filter(path => AUDIO_FILE.test(path ?? '') && !path.startsWith('/.tet.'));
    const signature = JSON.stringify(paths);
    if (signature === fileSignature) return; fileSignature = signature;
    const previous = files.value; while (files.firstChild) files.removeChild(files.firstChild);
    for (const path of paths.length ? paths : ['']) {const option = make('option', '', path || 'No audio files in this Cassette'); option.value = path; files.appendChild(option);}
    files.value = paths.includes(previous) ? previous : paths[0] ?? '';
  }
  function drawWaveform() {
    if (!visible || !state) return;
    const sample = state.sample, points = sample?.waveform;
    const signature = JSON.stringify([points, sample?.bytes, state.positionFrames, state.playing]); if (signature === waveSignature) return; waveSignature = signature;
    const context = wave.getContext?.('2d'); if (!context) return; const w = wave.width, h = wave.height;
    context.clearRect(0, 0, w, h); context.fillStyle = '#101820'; context.fillRect(0, 0, w, h); context.strokeStyle = '#34444e'; context.lineWidth = 1; context.beginPath(); context.moveTo(0, h / 2); context.lineTo(w, h / 2); context.stroke();
    if (!points?.length) {context.fillStyle = '#b5c2cc'; context.font = '13px sans-serif'; context.fillText(sample ? 'Waveform unavailable for this loaded stream' : 'Load a sample or run an ADPCM example to inspect its waveform', 12, 25); return;}
    context.strokeStyle = '#7bbcf7'; context.lineWidth = 2; context.beginPath();
    points.forEach((point, index) => {const value = Number.isFinite(point) ? Math.max(-1, Math.min(1, point)) : 0, x = index / Math.max(1, points.length - 1) * w, y = h / 2 - value * (h / 2 - 14); index ? context.lineTo(x, y) : context.moveTo(x, y);}); context.stroke();
    if (sample?.frames > 0 && Number.isFinite(state.positionFrames)) {const x = Math.max(0, Math.min(1, state.positionFrames / sample.frames)) * w; context.strokeStyle = '#9bdac7'; context.beginPath(); context.moveTo(x, 0); context.lineTo(x, h); context.stroke();}
  }
  function update(snapshot) {
    if (disposed || !snapshot) return; state = snapshot;
    const sample = snapshot.sample;
    sampleInfo.textContent = sample ? `${sample.name || 'Loaded ADPCM'} · ${finiteText(sample.bytes, 0)} bytes · ${finiteText(sample.frames, 0)} frames` : 'No sample loaded';
    duration.textContent = sample?.frames && snapshot.playbackRate > 0 ? `${finiteText(sample.frames / snapshot.playbackRate, 3)} s` : '—';
    playbackState.textContent = snapshot.playing ? snapshot.streaming ? 'Playing uploaded sample' : 'Playing raw FIFO data' : 'Stopped';
    position.textContent = sample ? `${finiteText(Math.min(snapshot.positionFrames ?? 0, sample.frames), 0)} / ${finiteText(sample.frames, 0)} frames · ${snapshot.repeat ? 'Repeat' : 'One shot'}` : '—';
    dividerOptions.forEach((option, index) => {option.textContent = `÷ ${DIVIDERS[index]} · ${finiteText(snapshot.clock / DIVIDERS[index])} Hz`;});
    setValue(divider, snapshot.divider); rate.textContent = finiteText(snapshot.playbackRate, 3); checked(panLeft, snapshot.pan?.left); checked(panRight, snapshot.pan?.right); checked(repeat, snapshot.repeat); setValue(clock, snapshot.clock); setValue(code, oki6258PlaybackCode(snapshot));
    syncFiles(); syncEnabled(); drawWaveform();
  }
  function setConnected(value) {
    if (disposed) return; const next = Boolean(value);
    if (!next) {releaseAll(); if (keyboardActive) {keyboardActive = false; onKeyboardTargetChange(null);} bindingEpoch++; keyboardButton.setAttribute('aria-pressed', 'false');}
    if (connected !== next) connectionEpoch++; connected = next; syncFiles(); syncEnabled();
  }
  updateTarget(); syncFiles(); syncEnabled();
  return {
    update, setConnected, releaseAll, getNoteTarget: () => target,
    setVisible(value) {visible = Boolean(value); if (!visible) {releaseSource('hold'); releaseSource('preview');} else {waveSignature = ''; drawWaveform();}},
    setKeyboardActive(value) {if (!value && keyboardActive) {keyboardActive = false; releaseSource('keyboard'); bindingEpoch++; keyboardButton.setAttribute('aria-pressed', 'false');}},
    dispose() {if (disposed) return; setConnected(false); disposed = true; for (const remove of listeners) remove();},
  };
}
