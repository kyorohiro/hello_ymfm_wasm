/** YM2151/OPM controls. Snapshots render applied settings; only explicit edits write. */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OP_NAMES = ['OP1 · M1', 'OP2 · M2', 'OP3 · C1', 'OP4 · C2'];
const REGISTER_OPERATORS = [0, 2, 1, 3];
const OP_FIELDS = [
  ['dt1', 'DT1', 7], ['dt2', 'DT2', 3], ['mul', 'MUL', 15], ['tl', 'TL', 127],
  ['ks', 'KS', 3], ['ar', 'AR', 31], ['d1r', 'D1R', 31], ['d2r', 'D2R', 31],
  ['d1l', 'D1L', 15], ['rr', 'RR', 15], ['am', 'AM', 1],
];
const ROUTING = [
  'OP1 → OP2 → OP3 → OP4 → OUT',
  '(OP1 + OP2) → OP3 → OP4 → OUT',
  '(OP1 + (OP2 → OP3)) → OP4 → OUT',
  '((OP1 → OP2) + OP3) → OP4 → OUT',
  '(OP1 → OP2) + (OP3 → OP4) → OUT',
  '(OP1 → OP2) + (OP1 → OP3) + (OP1 → OP4) → OUT',
  '(OP1 → OP2) + OP3 + OP4 → OUT',
  'OP1 + OP2 + OP3 + OP4 → OUT',
];
let panelSequence = 0;

export function ym2151FrequencyNote(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return '—';
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${NOTE_NAMES[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

export function ym2151NoteMidi(note) {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(note).trim());
  if (!match) throw new RangeError('Use a note name such as C4 or F#4.');
  const semitone = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11}[match[1].toUpperCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
  const midi = (Number(match[3]) + 1) * 12 + semitone;
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) throw new RangeError('Use a note within MIDI 0–127 and the YM2151 pitch range.');
  return midi;
}

/** The existing opm client numbers operators in register order M1/C1/M2/C2. */
export function ym2151VoiceCode(state, channel = 0) {
  const voice = state?.channels?.[channel];
  if (!voice) return '';
  const lines = [
    `opm.setAlgo(${channel}, ${voice.algorithm}, ${voice.feedback});`,
    `opm.setPan(${channel}, ${Boolean(voice.pan?.left)}, ${Boolean(voice.pan?.right)});`,
    `opm.writeRegister(0x${(0x38 + channel).toString(16)}, ${(voice.pms << 4) | voice.ams}); // PMS / AMS`,
    '// Display OP1/M1, OP2/M2, OP3/C1, OP4/C2; opm uses M1/C1/M2/C2 register order.',
  ];
  voice.operators?.forEach((operator, index) => {
    const settings = Object.fromEntries(OP_FIELDS.map(([key]) => [key, key === 'am' ? Number(Boolean(operator[key])) : operator[key]]));
    lines.push(`opm.setOperator(${channel}, ${REGISTER_OPERATORS[index]}, ${JSON.stringify(settings)}); // ${OP_NAMES[index]}`);
  });
  if (Number.isInteger(voice.keyCode) && Number.isInteger(voice.keyFraction)) lines.push(`opm.setPitch(${channel}, ${voice.keyCode}, ${voice.keyFraction});`);
  const lfo = state.lfo;
  if (lfo) lines.push(
    `opm.writeRegister(0x18, ${lfo.frequency}); // Global LFO frequency`,
    `opm.writeRegister(0x19, ${lfo.amDepth}); // AM depth`,
    `opm.writeRegister(0x19, ${128 | lfo.pmDepth}); // PM depth`,
    `opm.writeRegister(0x1b, ${((state.registers?.[0x1b] ?? 0) & 0xc0) | lfo.waveform}); // LFO waveform; preserve CT pins`,
  );
  if (state.noise) lines.push(`opm.setNoise(${Boolean(state.noise.enabled)}, ${state.noise.frequency}); // Global noise replaces CH8 OP4`);
  lines.push(`// Trigger with opm.keyOn(${channel}); release with opm.keyOff(${channel}).`);
  return lines.join('\n');
}

export function createPlaygroundYm2151VoicePanel({root, invoke, onKeyboardTargetChange = () => {}, onError = () => {}}) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc.defaultView ?? globalThis;
  const panelId = ++panelSequence, listeners = [], held = new Map();
  let state = null, channel = 0, connected = false, visible = true, disposed = false, keyboardActive = false;
  let connectionEpoch = 0, bindingEpoch = 0, pressSequence = 0, target, holdPress = null, previewTimer = null, envelopeSignature = '';
  const make = (tag, className, text) => {const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;};
  function listen(node, type, handler) {node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler));}
  function button(parent, label, action, name) {const node = make('button', '', label); node.type = 'button'; if (name) node.dataset.chipAction = `ym2151-${name}`; if (action) listen(node, 'click', action); parent.appendChild(node); return node;}
  function field(parent, label) {const node = make('label', 'chip-field'); node.appendChild(make('span', 'chip-field-label', label)); parent.appendChild(node); return node;}
  function output(parent, label, name) {const node = make('output'); node.dataset.chipOutput = `ym2151-${name}`; field(parent, label).appendChild(node); return node;}
  function setValue(node, value) {if (doc.activeElement !== node) node.value = value === undefined || value === null || typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);}
  function checked(node, value) {if (doc.activeElement !== node) node.checked = Boolean(value);}
  function report(error) {if (disposed) return; status.textContent = error?.message ?? String(error); status.dataset.error = 'true'; onError(error);}
  async function command(method, args = []) {
    if (disposed || !connected) return;
    const epoch = connectionEpoch;
    try {const value = await invoke(method, args); if (!disposed && connected && epoch === connectionEpoch) {status.textContent = ''; delete status.dataset.error;} return value;}
    catch (error) {if (!disposed && connected && epoch === connectionEpoch) report(error);}
  }
  const patch = value => command('setVoice', [channel, value]);
  function number(parent, label, name, {min = 0, max, step = 1, change, cell = false} = {}) {
    const node = make('input'); node.type = 'number'; node.dataset.chipControl = `ym2151-${name}`;
    node.min = String(min); if (max !== undefined) node.max = String(max); node.step = String(step);
    if (cell) {node.setAttribute('aria-label', label); parent.appendChild(node);} else field(parent, label).appendChild(node);
    listen(node, 'change', () => {
      const value = Number(node.value);
      if (!node.value.trim() || !Number.isFinite(value) || value < min || max !== undefined && value > max || step === 1 && !Number.isInteger(value)) {node.setCustomValidity('Enter a value within the displayed range.'); node.reportValidity?.(); return;}
      node.setCustomValidity(''); change?.(value);
    }); return node;
  }
  function checkbox(parent, label, name, change, cell = false) {
    const node = make('input'); node.type = 'checkbox'; node.dataset.chipControl = `ym2151-${name}`;
    if (cell) {node.setAttribute('aria-label', label); parent.appendChild(node);} else field(parent, label).appendChild(node);
    listen(node, 'change', () => change(node.checked)); return node;
  }
  function select(parent, label, name, values, change) {
    const node = make('select'); node.dataset.chipControl = `ym2151-${name}`;
    for (const [value, label] of values) {const option = make('option', '', label); option.value = String(value); node.appendChild(option);}
    field(parent, label).appendChild(node); listen(node, 'change', () => change(Number(node.value))); return node;
  }
  function section(title) {const card = make('section', 'chip-section'); card.appendChild(make('h3', '', title)); body.appendChild(card); return card;}
  function fields(parent) {const node = make('div', 'chip-fields'); parent.appendChild(node); return node;}

  const body = make('fieldset', 'chip-editor-body'); body.disabled = true; root.appendChild(body);
  const channelList = make('div', 'chip-channel-list'); channelList.setAttribute('aria-label', 'YM2151 channel'); body.appendChild(channelList);
  const channelButtons = Array.from({length: 8}, (_, index) => {const node = button(channelList, `CH${index + 1}`, () => selectChannel(index)); node.dataset.chipChannel = String(index); return node;});
  const selected = section('Selected FM voice'), common = fields(selected);
  const gate = output(common, 'Gate (last key write)', 'gate'), clock = output(common, 'Master clock (Hz)', 'clock');
  const frequency = number(common, 'Frequency (Hz)', 'frequency', {min: 0.001, step: 'any', change: value => command('setFrequency', [channel, value])});
  const note = make('input'); note.type = 'text'; note.placeholder = 'A4'; note.dataset.chipControl = 'ym2151-note'; field(common, 'Note').appendChild(note);
  listen(note, 'change', () => {try {const midi = ym2151NoteMidi(note.value); note.setCustomValidity(''); void command('setNote', [channel, midi]);} catch (error) {note.setCustomValidity(error.message); note.reportValidity?.();}});
  const keyCode = number(common, 'Key code (KC)', 'key-code', {max: 127, change: value => patch({keyCode: value})});
  const keyFraction = number(common, 'Key fraction (KF)', 'key-fraction', {max: 63, change: value => patch({keyFraction: value})});
  const routingFields = fields(selected);
  const algorithm = select(routingFields, 'Algorithm', 'algorithm', Array.from({length: 8}, (_, i) => [i, String(i)]), value => patch({algorithm: value}));
  const feedback = number(routingFields, 'Feedback (OP1)', 'feedback', {max: 7, change: value => patch({feedback: value})});
  const panLeft = checkbox(routingFields, 'Left', 'pan-left', value => patch({pan: {left: value}}));
  const panRight = checkbox(routingFields, 'Right', 'pan-right', value => patch({pan: {right: value}}));
  const ams = number(routingFields, 'AMS', 'ams', {max: 3, change: value => patch({ams: value})});
  const pms = number(routingFields, 'PMS', 'pms', {max: 7, change: value => patch({pms: value})});
  const routing = make('p', 'chip-opm-routing'); routing.dataset.chipOutput = 'ym2151-routing'; selected.appendChild(routing);
  const audition = fields(selected), auditionNote = number(audition, 'Audition MIDI note', 'audition-midi', {max: 127}); auditionNote.value = '69';
  const actions = make('div', 'chip-actions'); audition.appendChild(actions);
  const hold = button(actions, 'Hold to play', null, 'hold');
  button(actions, 'Play 1 second', () => {if (!visible) return; releaseSource('preview'); const id = startNote(channel, Number(auditionNote.value), 'preview'); if (id) previewTimer = win.setTimeout(() => {previewTimer = null; endNote(id);}, 1000);}, 'play');
  button(actions, 'Release', () => releaseAll(), 'release');
  const keyboardButton = button(actions, 'Use Keyboard', () => {
    if (!connected) return; keyboardActive = true; updateTarget(); status.textContent = `YM2151 CH${channel + 1} is connected to the Guitar Keyboard.`; delete status.dataset.error;
  }, 'keyboard');
  button(actions, 'Load basic voice', () => {
    releaseAll();
    void patch({algorithm: 7, feedback: 0, pan: {left: true, right: true}, ams: 0, pms: 0, operators: Array.from({length: 4}, (_, i) => ({dt1: 0, dt2: 0, mul: 1, tl: i === 3 ? 32 : 127, ks: 0, ar: 31, am: false, d1r: 0, d2r: 0, d1l: 0, rr: 15}))});
  }, 'basic');
  selected.appendChild(make('p', 'subtext', 'Audition borrows this channel and uses its current voice. Load basic voice explicitly to start from a simple sine. Keyboard changes pitch without changing operator settings.'));

  const operatorsCard = section('Operators · logical M1 / M2 / C1 / C2 order');
  const tableScroll = make('div', 'chip-opm-table-scroll'), table = make('table', 'chip-opm-table'); tableScroll.appendChild(table); operatorsCard.appendChild(tableScroll);
  const head = make('thead'), headerRow = make('tr'); head.appendChild(headerRow); table.appendChild(head);
  for (const label of ['Operator', ...OP_FIELDS.map(([, label]) => label)]) {const cell = make('th', '', label); cell.setAttribute('scope', 'col'); headerRow.appendChild(cell);}
  const tableBody = make('tbody'); table.appendChild(tableBody);
  const operatorControls = OP_NAMES.map((label, index) => {
    const row = make('tr'), name = make('th', '', label); name.setAttribute('scope', 'row'); row.appendChild(name); tableBody.appendChild(row);
    return Object.fromEntries(OP_FIELDS.map(([key, title, max]) => {
      const cell = make('td'); row.appendChild(cell);
      const change = value => command('setOperator', [channel, index, {[key]: value}]);
      const node = key === 'am' ? checkbox(cell, `${label} ${title}`, `op-${index}-${key}`, change, true) : number(cell, `${label} ${title}`, `op-${index}-${key}`, {max, change, cell: true});
      return [key, node];
    }));
  });
  operatorsCard.appendChild(make('p', 'subtext', 'DT1 is signed detune code (0–3 positive, 4–7 negative); DT2 adds coarse detune. MUL 0 = ×½. TL 127 = quietest. KS scales envelope rates. D1L 15 is the lowest sustain level. AM needs global AM depth and channel AMS.'));
  const envelope = make('canvas', 'chip-sample-waveform chip-opm-envelope'); envelope.width = 800; envelope.height = 180; envelope.setAttribute('role', 'img'); envelope.setAttribute('aria-label', 'Configured operator envelope guides; relative shape, not a measured waveform or time scale.'); operatorsCard.appendChild(envelope);
  operatorsCard.appendChild(make('p', 'subtext', 'Envelope guides compare the configured attack, decay, sustain and release. Actual timing also depends on note, KS and the chip clock. AR/D1R/D2R 0 hold their stage; RR 0 gives the slowest release.'));

  const lfoCard = section('Global LFO'), lfoFields = fields(lfoCard);
  const lfoFrequency = number(lfoFields, 'Frequency register', 'lfo-frequency', {max: 255, change: value => command('setLFO', [{frequency: value}])});
  const amDepth = number(lfoFields, 'AM depth', 'lfo-am-depth', {max: 127, change: value => command('setLFO', [{amDepth: value}])});
  const pmDepth = number(lfoFields, 'PM depth', 'lfo-pm-depth', {max: 127, change: value => command('setLFO', [{pmDepth: value}])});
  const lfoWaveform = select(lfoFields, 'Waveform', 'lfo-waveform', [[0, 'Saw'], [1, 'Square'], [2, 'Triangle'], [3, 'Noise']], value => command('setLFO', [{waveform: value}]));
  lfoCard.appendChild(make('p', 'subtext', 'Shared by all eight channels. AM depth and PM depth use separate latches on the same register. AMS/PMS decide each channel’s sensitivity.'));
  const noiseCard = section('Global noise · CH8 OP4'), noiseFields = fields(noiseCard);
  const noiseEnabled = checkbox(noiseFields, 'Replace CH8 OP4 with noise', 'noise-enabled', value => command('setNoise', [{enabled: value}]));
  const noiseFrequency = number(noiseFields, 'Noise frequency register', 'noise-frequency', {max: 31, change: value => command('setNoise', [{frequency: value}])});
  noiseCard.appendChild(make('p', 'subtext', 'Noise replaces CH8’s last operator. It does not replace every channel and does not follow the audition MIDI note.'));

  const details = make('details', 'chip-advanced'); details.appendChild(make('summary', '', 'Voice JavaScript and applied registers')); body.appendChild(details);
  const code = make('textarea', 'chip-voice-code'); code.readOnly = true; code.rows = 10; code.dataset.chipControl = 'ym2151-code'; code.setAttribute('aria-label', 'YM2151 configured voice JavaScript'); details.appendChild(code);
  button(details, 'Copy voice JavaScript', async () => {
    try {await win.navigator.clipboard.writeText(code.value); if (!disposed) {status.textContent = 'Voice JavaScript copied.'; delete status.dataset.error;}}
    catch {if (!disposed) {code.focus(); code.select(); status.textContent = 'Code selected. Copy it with your keyboard.';}}
  }, 'copy');
  const registers = make('pre', 'chip-memory-ranges'); registers.dataset.chipOutput = 'ym2151-registers'; details.appendChild(registers);
  const status = make('p', 'chip-editor-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.appendChild(status);
  root.appendChild(make('p', 'subtext', 'Values show applied YM2151 registers. Gate indicators record key writes, not the changing envelope amplitude. Code, audition and Keyboard share the same sound chip.'));

  function startNote(selectedChannel, midi, source, externalId, epoch) {
    if (!connected || disposed || !Number.isInteger(midi) || midi < 0 || midi > 127) return null;
    const id = `ym2151-panel:${panelId}:${++pressSequence}`; held.set(id, {channel: selectedChannel, source, externalId, epoch});
    void command('auditionOn', [selectedChannel, midi, id]); return id;
  }
  function endNote(id) {const entry = held.get(id); if (!entry) return; held.delete(id); void command('auditionOff', [entry.channel, id]);}
  function releaseSource(source) {
    for (const [id, entry] of held) if (entry.source === source) endNote(id);
    if (source === 'preview' && previewTimer !== null) {win.clearTimeout(previewTimer); previewTimer = null;}
    if (source === 'hold') {holdPress = null; hold.setAttribute('aria-pressed', 'false');}
  }
  function releaseAll() {for (const id of [...held.keys()]) endNote(id); if (previewTimer !== null) {win.clearTimeout(previewTimer); previewTimer = null;} holdPress = null; hold.setAttribute('aria-pressed', 'false');}
  function updateTarget() {
    const selectedChannel = channel, epoch = ++bindingEpoch;
    target = {
      owner: 'ym2151-voice-panel', name: `YM2151 · CH${selectedChannel + 1}`,
      noteOn(event) {
        if (!keyboardActive || !connected || epoch !== bindingEpoch || typeof event?.id !== 'string') return;
        for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.externalId === event.id && entry.epoch === epoch) endNote(id);
        startNote(selectedChannel, event.midi, 'keyboard', event.id, epoch);
      },
      noteOff(event) {for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.externalId === event?.id && entry.epoch === epoch) endNote(id);},
      allNotesOff() {for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.epoch === epoch) endNote(id);},
    };
    keyboardButton.setAttribute('aria-pressed', String(keyboardActive)); if (keyboardActive) onKeyboardTargetChange(target);
  }
  function selectChannel(next) {if (channel === next) return; releaseAll(); channel = next; updateTarget(); if (state) update(state);}
  function holdStart(event) {
    if (!visible || !connected || event.type === 'pointerdown' && event.button !== undefined && event.button !== 0 || event.type === 'keydown' && (event.repeat || ![' ', 'Enter'].includes(event.key))) return;
    event.preventDefault(); releaseSource('hold'); const id = startNote(channel, Number(auditionNote.value), 'hold'); if (!id) return;
    holdPress = {id, pointerId: event.pointerId, key: event.key}; hold.setAttribute('aria-pressed', 'true');
    if (event.pointerId !== undefined) try {hold.setPointerCapture(event.pointerId);} catch {}
  }
  function holdEnd(event) {if (!holdPress || event.pointerId !== undefined && event.pointerId !== holdPress.pointerId || event.type === 'keyup' && event.key !== holdPress.key) return; releaseSource('hold');}
  listen(hold, 'pointerdown', holdStart); listen(hold, 'keydown', holdStart);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture', 'keyup']) listen(hold, name, holdEnd);
  listen(hold, 'blur', () => releaseSource('hold')); listen(win, 'blur', releaseAll); listen(doc, 'visibilitychange', () => {if (doc.hidden) releaseAll();});

  function drawEnvelope(operators) {
    if (!visible) return;
    const signature = JSON.stringify(operators?.map(operator => OP_FIELDS.map(([key]) => operator[key])));
    if (envelopeSignature === signature) return; envelopeSignature = signature;
    const context = envelope.getContext?.('2d'); if (!context) return;
    const w = envelope.width, h = envelope.height, left = 38, top = 16, bottom = h - 25, span = w - left - 20;
    context.clearRect(0, 0, w, h); context.fillStyle = '#101820'; context.fillRect(0, 0, w, h);
    context.strokeStyle = '#34444e'; context.lineWidth = 1;
    for (const fraction of [0, 0.5, 1]) {const y = bottom - fraction * (bottom - top); context.beginPath(); context.moveTo(left, y); context.lineTo(w - 15, y); context.stroke();}
    context.font = '12px sans-serif'; context.fillStyle = '#b5c2cc'; context.fillText('key on', left, h - 7); context.fillText('key off', left + span * 0.76, h - 7);
    const colors = ['#ffb58d', '#b3dc88', '#7bbcf7', '#d2a5ed'];
    operators?.forEach((operator, index) => {
      const amplitude = (127 - operator.tl) / 127, sustain = operator.d1l === 15 ? 0 : amplitude * (1 - operator.d1l / 15);
      const attackX = left + span * (0.03 + (31 - operator.ar) / 31 * 0.23), decayX = attackX + span * (0.05 + (31 - operator.d1r) / 31 * 0.22), offX = left + span * 0.78;
      const attack = operator.ar === 0 ? 0 : amplitude, decay = operator.ar === 0 ? 0 : operator.d1r === 0 ? attack : sustain;
      const reachesSustain = operator.ar !== 0 && (operator.d1r !== 0 || operator.d1l === 0), heldLevel = !reachesSustain || operator.d2r === 0 ? decay : decay * (1 - operator.d2r / 31 * 0.8);
      const y = level => bottom - level * (bottom - top), endX = offX + span * (0.03 + (15 - operator.rr) / 15 * 0.17);
      context.strokeStyle = colors[index]; context.lineWidth = 2; context.beginPath(); context.moveTo(left, bottom); context.lineTo(attackX, y(attack)); context.lineTo(decayX, y(decay)); context.lineTo(offX, y(heldLevel)); context.lineTo(endX, operator.rr === 0 ? y(heldLevel * 0.7) : bottom); context.stroke();
      context.fillStyle = colors[index]; context.fillText(`OP${index + 1}`, w - 58, 16 + index * 15);
    });
  }
  function update(snapshot) {
    if (disposed || !snapshot) return; state = snapshot; const voice = snapshot.channels?.[channel] ?? {};
    channelButtons.forEach((node, index) => {const c = snapshot.channels?.[index] ?? {}; node.setAttribute('aria-pressed', String(index === channel)); node.dataset.sounding = String(Boolean(c.active)); node.textContent = `CH${index + 1}${c.active ? ' ▸' : ''}`; node.title = `${ym2151FrequencyNote(c.frequency)} · ${Number.isFinite(c.frequency) ? c.frequency.toFixed(2) : '—'} Hz`;});
    gate.textContent = `${voice.active ? 'Triggered' : 'Released'} · OP mask ${(voice.keyMask ?? 0).toString(2).padStart(4, '0')}`;
    clock.textContent = Number.isFinite(snapshot.clock) ? Number(snapshot.clock).toLocaleString('en-US') : '—';
    setValue(frequency, Number.isFinite(voice.frequency) ? Number(voice.frequency.toFixed(6)) : null);
    setValue(note, ym2151FrequencyNote(voice.frequency) === '—' ? '' : ym2151FrequencyNote(voice.frequency)); setValue(keyCode, voice.keyCode); setValue(keyFraction, voice.keyFraction);
    setValue(algorithm, voice.algorithm); setValue(feedback, voice.feedback); checked(panLeft, voice.pan?.left); checked(panRight, voice.pan?.right); setValue(ams, voice.ams); setValue(pms, voice.pms);
    routing.textContent = `Algorithm ${voice.algorithm ?? '—'} · ${ROUTING[voice.algorithm] ?? '—'}\nFeedback returns to OP1.`;
    operatorControls.forEach((controls, index) => OP_FIELDS.forEach(([key]) => key === 'am' ? checked(controls[key], voice.operators?.[index]?.[key]) : setValue(controls[key], voice.operators?.[index]?.[key])));
    setValue(lfoFrequency, snapshot.lfo?.frequency); setValue(amDepth, snapshot.lfo?.amDepth); setValue(pmDepth, snapshot.lfo?.pmDepth); setValue(lfoWaveform, snapshot.lfo?.waveform);
    checked(noiseEnabled, snapshot.noise?.enabled); setValue(noiseFrequency, snapshot.noise?.frequency); setValue(code, ym2151VoiceCode(snapshot, channel));
    registers.textContent = Array.from(snapshot.registers ?? [], (value, index) => `${index.toString(16).toUpperCase().padStart(2, '0')}: ${Number(value).toString(16).toUpperCase().padStart(2, '0')}`).join('  ');
    drawEnvelope(voice.operators);
  }
  function setConnected(value) {
    if (disposed) return; const next = Boolean(value);
    if (!next) {releaseAll(); if (keyboardActive) {keyboardActive = false; onKeyboardTargetChange(null);} bindingEpoch++; keyboardButton.setAttribute('aria-pressed', 'false');}
    if (connected !== next) connectionEpoch++; connected = next; body.disabled = !next;
  }
  updateTarget();
  return {
    update, setConnected, releaseAll, getSelectedChannel: () => channel, getNoteTarget: () => target,
    setVisible(value) {visible = Boolean(value); if (!visible) {releaseSource('hold'); releaseSource('preview');} else if (state) {envelopeSignature = ''; drawEnvelope(state.channels?.[channel]?.operators);}},
    setKeyboardActive(value) {if (!value && keyboardActive) {keyboardActive = false; releaseSource('keyboard'); bindingEpoch++; keyboardButton.setAttribute('aria-pressed', 'false');}},
    dispose() {if (disposed) return; setConnected(false); disposed = true; for (const remove of listeners) remove();},
  };
}
