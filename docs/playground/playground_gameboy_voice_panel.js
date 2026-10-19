/** Game Boy voice controls. The owning chip tab supplies snapshots; this panel never polls. */

const CHANNEL_NAMES = ['Pulse 1', 'Pulse 2', 'Wave', 'Noise'];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
let panelSequence = 0;

export function gameboyFrequencyNote(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return '—';
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function gameboyNoteMidi(note) {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(note).trim());
  if (!match) throw new RangeError('Use a note name such as C4 or F#4.');
  const semitone = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}[match[1].toUpperCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  const midi = (Number(match[3]) + 1) * 12 + semitone;
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Use a note within MIDI 0–127.');
  return midi;
}

/** Configured register values, rather than the hardware envelope's changing amplitude. */
export function gameboyVoiceCode(state, channel = 0) {
  const voice = state?.channels?.[channel];
  if (!voice) return '';
  const json = value => JSON.stringify(value);
  const lines = [];
  if (channel < 2) {
    lines.push(`gameboy.pulse.setVoice(${channel}, ${json({duty: voice.duty, volume: voice.volume, envelope: voice.envelope})});`);
    if (channel === 0) lines.push(`gameboy.pulse.setSweep(${json(voice.sweep)});`);
  } else if (channel === 2) {
    lines.push(`gameboy.wave.stopAndSetWaveform(${json(voice.waveform)});`);
    lines.push(`gameboy.wave.setLevel(${voice.level});`);
  } else lines.push(`gameboy.noise.setVoice(${json({volume: voice.volume, envelope: voice.envelope, divisor: voice.divisor, shift: voice.shift, width: voice.width})});`);
  if (channel < 3 && Number.isFinite(voice.frequency)) lines.push(`gameboy.setFrequency(${channel}, ${Number(voice.frequency.toFixed(6))});`);
  if (voice.pan) lines.push(`gameboy.setPan(${channel}, ${Boolean(voice.pan.left)}, ${Boolean(voice.pan.right)});`);
  lines.push(`// Trigger with gameboy.keyOn(${channel}); release with gameboy.keyOff(${channel}).`);
  if (voice.lengthEnabled) lines.push('// High-level keyOn disables hardware length; the panel audition preserves the length setting.');
  return lines.join('\n');
}

export function createPlaygroundGameboyVoicePanel({root, invoke, onKeyboardTargetChange = () => {}, onError = () => {}}) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc.defaultView ?? globalThis;
  const panelId = ++panelSequence;
  let snapshot = null, selected = 0, connected = false, visible = true, disposed = false, keyboardActive = false, connectionEpoch = 0;
  let pressSequence = 0, targetSequence = 0, target, waveDrag = null, waveDraft = null, previewTimer = null, holdPress = null;
  const held = new Map();
  const listeners = [];
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function listen(node, type, handler, options) { node.addEventListener(type, handler, options); listeners.push(() => node.removeEventListener(type, handler, options)); }
  function button(parent, label, handler, name) {
    const node = make('button', '', label); node.type = 'button';
    if (name) node.dataset.chipAction = name;
    if (handler) listen(node, 'click', handler);
    parent.appendChild(node); return node;
  }
  function field(parent, label) {
    const node = make('label', 'chip-field'); node.appendChild(make('span', 'chip-field-label', label)); parent.appendChild(node); return node;
  }
  function output(parent, label, name) {
    const row = field(parent, label), node = make('output'); if (name) node.dataset.chipOutput = name; row.appendChild(node); return node;
  }
  function setValue(node, value) {
    if (doc.activeElement === node) return;
    node.value = value === undefined || value === null || !Number.isFinite(value) && typeof value === 'number' ? '' : String(value);
  }
  function setChecked(node, value) { if (doc.activeElement !== node) node.checked = Boolean(value); }
  function report(error) {
    if (disposed) return;
    status.textContent = error?.message ?? String(error); status.dataset.error = 'true'; onError(error);
  }
  async function command(method, args = []) {
    if (disposed || !connected) return;
    const epoch = connectionEpoch;
    try {
      const result = await invoke(method, args);
      if (!disposed && connected && epoch === connectionEpoch && status.dataset.error) { status.textContent = ''; delete status.dataset.error; }
      return result;
    } catch (error) { if (!disposed && connected && epoch === connectionEpoch) report(error); }
  }
  const patch = value => command('setVoice', [selected, value]);
  function number(parent, label, name, {min, max, step = 1, range = false, change} = {}) {
    const row = field(parent, label), node = make('input'); node.type = range ? 'range' : 'number'; node.dataset.chipControl = name;
    if (min !== undefined) node.min = String(min); if (max !== undefined) node.max = String(max); node.step = String(step); row.appendChild(node);
    listen(node, range ? 'input' : 'change', () => {
      const value = Number(node.value);
      const currentMax = node.max === '' || node.max === undefined ? undefined : Number(node.max);
      if (!node.value.trim() || !Number.isFinite(value) || min !== undefined && value < min || currentMax !== undefined && value > currentMax || step === 1 && !Number.isInteger(value)) {
        node.setCustomValidity('Enter a value within the displayed range.'); node.reportValidity?.(); return;
      }
      node.setCustomValidity(''); change?.(value);
    }); return node;
  }
  function select(parent, label, name, choices, change) {
    const row = field(parent, label), node = make('select'); node.dataset.chipControl = name;
    for (const [value, label] of choices) { const option = make('option', '', label); option.value = String(value); node.appendChild(option); }
    row.appendChild(node); listen(node, 'change', () => change(node.value)); return node;
  }
  function checkbox(parent, label, name, change) {
    const row = field(parent, label), node = make('input'); node.type = 'checkbox'; node.dataset.chipControl = name; row.appendChild(node);
    listen(node, 'change', () => change(node.checked)); return node;
  }
  function section(parent, title) { const node = make('section', 'chip-section'); node.appendChild(make('h3', '', title)); parent.appendChild(node); return node; }
  function fields(parent) { const node = make('div', 'chip-fields'); parent.appendChild(node); return node; }

  const body = make('fieldset', 'chip-editor-body'); body.disabled = true; root.appendChild(body);
  const channels = make('div', 'chip-channel-list'); channels.setAttribute('aria-label', 'Game Boy channel'); body.appendChild(channels);
  const channelButtons = CHANNEL_NAMES.map((name, channel) => {
    const node = button(channels, `CH${channel + 1} ${name}`, () => selectChannel(channel)); node.dataset.chipChannel = String(channel); return node;
  });
  const overview = make('div', 'chip-fields'); body.appendChild(overview);
  const summaries = CHANNEL_NAMES.map((name, channel) => output(overview, `CH${channel + 1} ${name}`, `gb-channel-${channel}`));
  const voiceCard = section(body, 'Selected voice'), common = fields(voiceCard);
  const gate = output(common, 'Gate (last trigger / DAC write)', 'gb-gate');
  const frequency = number(common, 'Frequency (Hz)', 'gb-frequency', {min: 0.001, step: 'any', change: value => patch({frequency: value})});
  const noteField = field(common, 'Note'), note = make('input'); note.type = 'text'; note.placeholder = 'A4'; note.dataset.chipControl = 'gb-note'; noteField.appendChild(note);
  listen(note, 'change', () => {
    try { const midi = gameboyNoteMidi(note.value); note.setCustomValidity(''); void patch({frequency: 440 * 2 ** ((midi - 69) / 12)}); }
    catch (error) { note.setCustomValidity(error.message); note.reportValidity?.(); }
  });
  const panLeft = checkbox(common, 'Left', 'gb-pan-left', value => patch({pan: {left: value, right: panRight.checked}}));
  const panRight = checkbox(common, 'Right', 'gb-pan-right', value => patch({pan: {left: panLeft.checked, right: value}}));
  const audition = fields(voiceCard);
  const testNote = number(audition, 'Audition MIDI note', 'gb-audition-midi', {min: 0, max: 127}); testNote.value = '69';
  const actions = make('div', 'chip-actions'); audition.appendChild(actions);
  const hold = button(actions, 'Hold to play', null, 'gb-hold');
  button(actions, 'Play 1 second', () => {
    releaseSource('preview');
    const id = startNote(selected, Number(testNote.value), 'preview');
    if (id) previewTimer = win.setTimeout(() => { previewTimer = null; endNote(id); }, 1000);
  }, 'gb-play');
  button(actions, 'Release', () => releaseAll(), 'gb-release');
  const keyboardButton = button(actions, 'Use Keyboard', () => {
    if (!connected) return;
    keyboardActive = true; updateTarget();
    status.textContent = `${CHANNEL_NAMES[selected]} is connected to the Guitar Keyboard.`; delete status.dataset.error;
  }, 'gb-keyboard');
  const noteHelp = make('p', 'subtext', 'Audition borrows the selected hardware channel. Noise uses its clock settings instead of the MIDI note.'); voiceCard.appendChild(noteHelp);

  const pulseCard = section(body, 'Pulse'), pulseFields = fields(pulseCard);
  const duty = select(pulseFields, 'Duty', 'gb-duty', [[0.125, '12.5%'], [0.25, '25%'], [0.5, '50%'], [0.75, '75%']], value => patch({duty: Number(value)}));
  const volume = number(pulseFields, 'Initial volume', 'gb-volume', {min: 0, max: 15, range: true, change: value => patch({volume: value})});
  const volumeValue = make('output'); volume.parentNode.appendChild(volumeValue);
  const envelopeDirection = select(pulseFields, 'Envelope direction', 'gb-envelope-direction', [['down', 'Down'], ['up', 'Up']], value => patch({envelope: {direction: value}}));
  const envelopePeriod = number(pulseFields, 'Envelope pace (0 = fixed)', 'gb-envelope-period', {min: 0, max: 7, change: value => patch({envelope: {period: value}})});
  const sweepCard = section(body, 'Pulse 1 sweep'), sweepFields = fields(sweepCard);
  const sweepDirection = select(sweepFields, 'Direction', 'gb-sweep-direction', [['up', 'Up'], ['down', 'Down']], value => patch({sweep: {direction: value}}));
  const sweepPeriod = number(sweepFields, 'Pace', 'gb-sweep-period', {min: 0, max: 7, change: value => patch({sweep: {period: value}})});
  const sweepShift = number(sweepFields, 'Shift', 'gb-sweep-shift', {min: 0, max: 7, change: value => patch({sweep: {shift: value}})});

  const waveCard = section(body, 'Wave RAM · 32 × 4-bit'), waveFields = fields(waveCard);
  const level = select(waveFields, 'Output level', 'gb-wave-level', [[0, 'Mute'], [1, '100%'], [0.5, '50%'], [0.25, '25%']], value => patch({level: Number(value)}));
  const waveActions = make('div', 'chip-actions'); waveFields.appendChild(waveActions);
  button(waveActions, 'Triangle', () => setWave(Array.from({length: 32}, (_, i) => i < 16 ? i : 31 - i)), 'gb-wave-triangle');
  button(waveActions, 'Saw', () => setWave(Array.from({length: 32}, (_, i) => i >> 1)), 'gb-wave-saw');
  const canvas = make('canvas', 'chip-sample-waveform chip-voice-waveform'); canvas.width = 640; canvas.height = 160;
  canvas.dataset.chipControl = 'gb-waveform'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Game Boy waveform, 32 samples from 0 to 15. Drag to edit.'); waveCard.appendChild(canvas);
  const waveSampleFields = fields(waveCard);
  const waveIndex = number(waveSampleFields, 'Sample index', 'gb-wave-index', {min: 0, max: 31, change: value => setValue(waveValue, (waveDraft ?? snapshot?.channels?.[2]?.waveform ?? [])[value])}); waveIndex.value = '0';
  const waveValue = number(waveSampleFields, 'Sample value', 'gb-wave-value', {min: 0, max: 15, change: value => {
    const next = Array.from(waveDraft ?? snapshot?.channels?.[2]?.waveform ?? Array(32).fill(8)); next[Number(waveIndex.value)] = value; setWave(next);
  }});
  waveCard.appendChild(make('p', 'subtext', 'Drag to draw, or edit a sample numerically. Updating Wave RAM stops the Wave DAC; press Play or a key to hear the new waveform.'));

  const noiseCard = section(body, 'Noise clock'), noiseFields = fields(noiseCard);
  const noiseDivisor = number(noiseFields, 'Divisor code', 'gb-noise-divisor', {min: 0, max: 7, change: value => patch({divisor: value})});
  const noiseShift = number(noiseFields, 'Clock shift', 'gb-noise-shift', {min: 0, max: 15, change: value => patch({shift: value})});
  const noiseWidth = select(noiseFields, 'LFSR width', 'gb-noise-width', [[15, '15-bit'], [7, '7-bit']], value => patch({width: Number(value)}));
  const noiseClock = output(noiseFields, 'Clock (Hz)', 'gb-noise-clock');

  const lengthCard = section(body, 'Hardware length'), lengthFields = fields(lengthCard);
  const lengthEnabled = checkbox(lengthFields, 'Length enabled', 'gb-length-enabled', value => patch({lengthEnabled: value}));
  const lengthCount = number(lengthFields, 'Length register', 'gb-length-count', {min: 0, max: 63, change: value => patch({lengthCount: value})});
  const lengthInfo = make('p', 'subtext'); lengthCard.appendChild(lengthInfo);
  const masterCard = section(body, 'APU output'), masterFields = fields(masterCard);
  const powerEnabled = checkbox(masterFields, 'APU power', 'gb-power', value => command('setPower', [value]));
  const powered = output(masterFields, 'Power state', 'gb-power');
  const masterLeft = number(masterFields, 'Master left', 'gb-master-left', {min: 0, max: 7, change: value => command('setMasterVolume', [value, Number(masterRight.value)])});
  const masterRight = number(masterFields, 'Master right', 'gb-master-right', {min: 0, max: 7, change: value => command('setMasterVolume', [Number(masterLeft.value), value])});
  masterCard.appendChild(make('p', 'subtext', 'Power off clears hardware voice and routing settings. Turning power on does not restore the previous voice.'));
  const details = make('details', 'chip-advanced'); details.appendChild(make('summary', '', 'Voice JavaScript and registers')); body.appendChild(details);
  const code = make('textarea', 'chip-voice-code'); code.readOnly = true; code.rows = 8; code.dataset.chipControl = 'gb-code'; code.setAttribute('aria-label', 'Game Boy configured voice JavaScript'); details.appendChild(code);
  button(details, 'Copy voice JavaScript', async () => {
    try { await win.navigator.clipboard.writeText(code.value); status.textContent = 'Voice JavaScript copied.'; delete status.dataset.error; }
    catch { code.focus(); code.select(); status.textContent = 'Code selected. Copy it with your keyboard.'; }
  }, 'gb-copy');
  const registers = make('pre', 'chip-memory-ranges'); registers.dataset.chipOutput = 'gb-registers'; details.appendChild(registers);
  const status = make('p', 'chip-editor-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.appendChild(status);
  const explanation = make('p', 'subtext', 'Values show applied register settings. Envelope, sweep and length evolve inside the APU; the gate indicator records observed trigger / DAC writes and is not a measured audible level.'); root.appendChild(explanation);

  function startNote(channel, midi, source, externalId, epoch) {
    if (!connected || disposed || !Number.isInteger(midi) || midi < 0 || midi > 127) return null;
    const id = `gb-panel:${panelId}:${++pressSequence}`;
    held.set(id, {channel, source, externalId, epoch});
    void command('auditionOn', [channel, midi, id]);
    return id;
  }
  function endNote(id) {
    const entry = held.get(id); if (!entry) return;
    held.delete(id); void command('auditionOff', [entry.channel, id]);
  }
  function releaseSource(source) {
    for (const [id, entry] of held) if (entry.source === source) endNote(id);
    if (source === 'preview' && previewTimer !== null) { win.clearTimeout(previewTimer); previewTimer = null; }
    if (source === 'hold') { holdPress = null; hold.setAttribute('aria-pressed', 'false'); }
  }
  function releaseAll() {
    for (const id of [...held.keys()]) endNote(id);
    if (previewTimer !== null) { win.clearTimeout(previewTimer); previewTimer = null; }
    holdPress = null; hold.setAttribute('aria-pressed', 'false');
  }
  function updateTarget() {
    const channel = selected, epoch = ++targetSequence;
    target = {
      owner: 'gameboy-voice-panel', name: `Game Boy · ${CHANNEL_NAMES[channel]}`,
      noteOn(event) {
        if (!keyboardActive || !connected || epoch !== targetSequence) return;
        if (!event || typeof event.id !== 'string') return;
        for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.externalId === event.id && entry.epoch === epoch) endNote(id);
        startNote(channel, event.midi, 'keyboard', event.id, epoch);
      },
      noteOff(event) {
        for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.externalId === event?.id && entry.epoch === epoch) endNote(id);
      },
      allNotesOff() { for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.epoch === epoch) endNote(id); },
    };
    keyboardButton.setAttribute('aria-pressed', keyboardActive ? 'true' : 'false');
    if (keyboardActive) onKeyboardTargetChange(target);
  }
  function selectChannel(channel) {
    if (selected === channel) return;
    releaseAll(); waveDrag = null; waveDraft = null; selected = channel; updateTarget(); if (snapshot) update(snapshot);
  }
  function holdStart(event) {
    if (!visible || !connected || event.type === 'pointerdown' && event.button !== undefined && event.button !== 0 || event.type === 'keydown' && (event.repeat || ![' ', 'Enter'].includes(event.key))) return;
    event.preventDefault();
    releaseSource('hold');
    const id = startNote(selected, Number(testNote.value), 'hold');
    if (!id) return;
    holdPress = {id, pointerId: event.pointerId, key: event.key}; hold.setAttribute('aria-pressed', 'true');
    if (event.pointerId !== undefined) try { hold.setPointerCapture(event.pointerId); } catch {}
  }
  function holdEnd(event) {
    if (!holdPress || event.pointerId !== undefined && event.pointerId !== holdPress.pointerId || event.type === 'keyup' && event.key !== holdPress.key) return;
    releaseSource('hold');
  }
  listen(hold, 'pointerdown', holdStart); listen(hold, 'keydown', holdStart);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture', 'keyup']) listen(hold, name, holdEnd);
  listen(hold, 'blur', () => releaseSource('hold'));
  listen(win, 'blur', releaseAll);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) releaseAll(); });

  function setWave(values) {
    if (disposed || !connected) return;
    waveDraft = Array.from(values); drawWave(); setValue(waveValue, waveDraft[Number(waveIndex.value)]);
    void patch({waveform: waveDraft.slice()});
  }
  function drawWave() {
    const ctx = canvas.getContext?.('2d'); if (!ctx) return;
    const values = waveDraft ?? snapshot?.channels?.[2]?.waveform ?? Array(32).fill(8), width = canvas.width, height = canvas.height;
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#101820'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#34444e'; ctx.lineWidth = 1;
    for (let i = 0; i <= 16; i++) { const y = 8 + i / 16 * (height - 16); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.fillStyle = '#9bdac7'; ctx.strokeStyle = '#d7fff1'; ctx.lineWidth = 2; ctx.beginPath();
    values.forEach((value, i) => {
      const x = i * width / 32, next = (i + 1) * width / 32, y = height - 8 - value / 15 * (height - 16);
      ctx.fillRect(x + 1, y, Math.max(1, width / 32 - 2), height - 8 - y);
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); ctx.lineTo(next, y);
    }); ctx.stroke();
    canvas.setAttribute('aria-label', `Game Boy waveform, 32 four-bit samples: ${values.join(', ')}. Drag to edit.`);
  }
  function drawPoint(event) {
    const rect = canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    const index = Math.max(0, Math.min(31, Math.floor((event.clientX - rect.left) / rect.width * 32)));
    const value = Math.max(0, Math.min(15, Math.round((1 - (event.clientY - rect.top) / rect.height) * 15)));
    const from = waveDrag?.lastIndex ?? index, oldValue = waveDrag?.lastValue ?? value;
    for (let i = Math.min(from, index); i <= Math.max(from, index); i++) waveDraft[i] = from === index ? value : Math.round(oldValue + (value - oldValue) * ((i - from) / (index - from)));
    waveDrag.lastIndex = index; waveDrag.lastValue = value; setValue(waveIndex, index); setValue(waveValue, value); drawWave();
  }
  listen(canvas, 'pointerdown', event => {
    if (!connected || !visible || selected !== 2 || event.button !== undefined && event.button !== 0) return;
    event.preventDefault(); waveDraft = Array.from(snapshot?.channels?.[2]?.waveform ?? Array(32).fill(8)); waveDrag = {pointerId: event.pointerId};
    try { canvas.setPointerCapture(event.pointerId); } catch {} drawPoint(event);
  });
  listen(canvas, 'pointermove', event => { if (waveDrag?.pointerId === event.pointerId) { event.preventDefault(); drawPoint(event); } });
  function finishWave(event) {
    if (!waveDrag || event?.pointerId !== undefined && waveDrag.pointerId !== event.pointerId) return;
    waveDrag = null; if (event?.type !== 'pointercancel') setWave(waveDraft);
    else { waveDraft = null; drawWave(); }
  }
  listen(canvas, 'pointerup', finishWave); listen(canvas, 'pointercancel', finishWave); listen(canvas, 'lostpointercapture', finishWave);

  function update(state) {
    if (disposed || !state) return; snapshot = state;
    const voice = state.channels?.[selected] ?? {};
    channelButtons.forEach((node, channel) => {
      node.setAttribute('aria-pressed', String(channel === selected)); node.dataset.sounding = String(Boolean(state.channels?.[channel]?.active));
      const channelState = state.channels?.[channel] ?? {}, pitch = channel < 3 ? `${gameboyFrequencyNote(channelState.frequency)} · ${Number.isFinite(channelState.frequency) ? channelState.frequency.toFixed(1) : '—'} Hz` : `${channelState.width ?? '—'}-bit noise`;
      summaries[channel].textContent = `${pitch} · ${channelState.active ? 'Triggered' : 'Released'}`;
    });
    gate.textContent = voice.active ? 'Triggered' : 'Released';
    frequency.parentNode.hidden = selected === 3; noteField.hidden = selected === 3; testNote.parentNode.hidden = selected === 3;
    setValue(frequency, Number.isFinite(voice.frequency) ? Number(voice.frequency.toFixed(3)) : null);
    setValue(note, gameboyFrequencyNote(voice.frequency) === '—' ? '' : gameboyFrequencyNote(voice.frequency));
    setChecked(panLeft, voice.pan?.left); setChecked(panRight, voice.pan?.right);
    pulseCard.hidden = selected === 2; pulseCard.children[0].textContent = selected === 3 ? 'Noise envelope' : 'Pulse'; sweepCard.hidden = selected !== 0; duty.parentNode.hidden = selected === 3;
    setValue(duty, voice.duty); setValue(volume, voice.volume); volumeValue.textContent = Number.isInteger(voice.volume) ? `${voice.volume} / 15` : '—';
    setValue(envelopeDirection, voice.envelope?.direction); setValue(envelopePeriod, voice.envelope?.period);
    setValue(sweepDirection, voice.sweep?.direction); setValue(sweepPeriod, voice.sweep?.period); setValue(sweepShift, voice.sweep?.shift);
    waveCard.hidden = selected !== 2; setValue(level, voice.level);
    if (!waveDrag) { waveDraft = Array.from(state.channels?.[2]?.waveform ?? Array(32).fill(8)); drawWave(); }
    setValue(waveValue, waveDraft?.[Number(waveIndex.value)]);
    noiseCard.hidden = selected !== 3; setValue(noiseDivisor, voice.divisor); setValue(noiseShift, voice.shift); setValue(noiseWidth, voice.width);
    const divisor = voice.divisor === 0 ? 0.5 : voice.divisor;
    const noiseHz = Number.isFinite(divisor) && Number.isFinite(voice.shift) && Number.isFinite(state.clock) ? state.clock / (8 * divisor * 2 ** (voice.shift + 1)) : NaN;
    noiseClock.textContent = Number.isFinite(noiseHz) ? noiseHz.toFixed(2) : '—';
    setChecked(lengthEnabled, voice.lengthEnabled); lengthCount.max = selected === 2 ? '255' : '63'; setValue(lengthCount, voice.lengthCount);
    const lengthMax = selected === 2 ? 256 : 64;
    const lengthClock = Number.isFinite(state.clock) ? `${Number((state.clock / 16384).toFixed(3))} Hz` : 'the APU length clock';
    lengthInfo.textContent = `Register 0–${lengthMax - 1} sets ${lengthMax} minus the register value length steps (clocked at ${lengthClock}). Audition preserves length enable. The running counter is not read back.`;
    setChecked(powerEnabled, state.powered); powered.textContent = state.powered ? 'On' : 'Off'; setValue(masterLeft, state.masterVolume?.left); setValue(masterRight, state.masterVolume?.right);
    setValue(code, gameboyVoiceCode(state, selected));
    registers.textContent = Array.from(state.registers ?? [], (value, index) => `0x${index.toString(16).toUpperCase().padStart(2, '0')}: ${Number(value).toString(16).toUpperCase().padStart(2, '0')}`).join('  ');
  }
  function setConnected(value) {
    if (disposed) return;
    const next = Boolean(value);
    if (!next) {
      releaseAll(); waveDrag = null;
      if (keyboardActive) { keyboardActive = false; onKeyboardTargetChange(null); }
      targetSequence++; keyboardButton.setAttribute('aria-pressed', 'false');
    }
    if (connected !== next) connectionEpoch++;
    connected = next; body.disabled = !next;
  }
  updateTarget();
  return {
    update, setConnected, releaseAll,
    setVisible(value) { visible = Boolean(value); if (!visible) { releaseSource('hold'); releaseSource('preview'); waveDrag = null; } },
    setKeyboardActive(value) { if (!value && keyboardActive) { keyboardActive = false; releaseSource('keyboard'); keyboardButton.setAttribute('aria-pressed', 'false'); targetSequence++; } },
    getNoteTarget() { return target; },
    getSelectedChannel() { return selected; },
    dispose() {
      if (disposed) return; setConnected(false); disposed = true; for (const remove of listeners) remove();
    },
  };
}
