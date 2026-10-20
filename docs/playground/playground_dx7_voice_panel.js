/** Applied DX7 voice controls. Reading and rendering never edit the instrument. */
let panelSequence = 0;
const OP_FIELDS = [
  ['coarse', 'Coarse', 31], ['fine', 'Fine', 99], ['detune', 'Detune · 7 = neutral', 14],
  ['outputLevel', 'Output level · larger = louder', 99], ['rateScaling', 'Rate scaling', 7],
  ['velocitySensitivity', 'Velocity sensitivity', 7], ['ampModSensitivity', 'AM sensitivity · retained', 3],
];
const SCALE_FIELDS = [['breakpoint', 'Breakpoint · raw', 99], ['leftDepth', 'Left depth', 99], ['rightDepth', 'Right depth', 99]];
const CURVES = [[0, '− Linear'], [1, '− Exponential'], [2, '+ Exponential'], [3, '+ Linear']];
// MSFA fm_core.cc algorithms[].ops: OUT_BUS_ADD to bus 0 is a carrier.
// Its six slots are OP6..OP1; these masks use public OP1 at bit 0.
const CARRIER_MASKS = [5, 5, 9, 9, 21, 21, 5, 5, 5, 9, 9, 5, 5, 5, 5, 1, 1, 1, 25, 11, 27, 29, 27, 31, 31, 11, 11, 37, 23, 39, 31, 63];

export function dx7CarrierOperators(algorithm) {
  if (!Number.isInteger(algorithm) || algorithm < 0 || algorithm > 31) return [];
  return Array.from({length: 6}, (_, i) => i + 1).filter(op => CARRIER_MASKS[algorithm] & (1 << (op - 1)));
}

/** Nominal tuning, before detune, pitch envelope and LFO. */
export function dx7OperatorTuning(operator) {
  if (!operator || !Number.isInteger(operator.coarse) || !Number.isInteger(operator.fine)) return '—';
  const value = operator.mode === 'fixed' ? 10 ** ((operator.coarse & 3) + operator.fine / 100)
    : (operator.coarse || 0.5) * (1 + operator.fine / 100);
  return operator.mode === 'fixed' ? `${Number(value.toFixed(3))} Hz` : `×${Number(value.toFixed(3))}`;
}

export function dx7VoiceCode(snapshot) {
  if (!snapshot?.preset) return '';
  return `// Applied DX7 voice. Algorithm is zero-based; operators are OP1..OP6.\nawait dx7.setPreset(${JSON.stringify(snapshot.preset, null, 2)});\n// dx7.noteOn(60, 100); dx7.noteOff(60);`;
}

export function createPlaygroundDx7VoicePanel({root, invoke, onKeyboardTargetChange = () => {}, onError = () => {}}) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc.defaultView ?? globalThis;
  const panelId = ++panelSequence, listeners = [], held = new Map();
  let state = null, operator = 1, connected = false, visible = true, disposed = false, keyboardActive = false;
  let connectionEpoch = 0, bindingEpoch = 0, pressSequence = 0, target, holdPress = null, previewTimer = null, bankSignature = '';
  const make = (tag, className, text) => {const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node;};
  function listen(node, type, callback) {node.addEventListener(type, callback); listeners.push(() => node.removeEventListener(type, callback));}
  function button(parent, label, action, name) {const node = make('button', '', label); node.type = 'button'; if (name) node.dataset.chipAction = `dx7-${name}`; if (action) listen(node, 'click', action); parent.appendChild(node); return node;}
  function field(parent, label) {const node = make('label', 'chip-field'); node.appendChild(make('span', 'chip-field-label', label)); parent.appendChild(node); return node;}
  function fields(parent) {const node = make('div', 'chip-fields'); parent.appendChild(node); return node;}
  function section(title, parent = body) {const node = make('section', 'chip-section'); node.appendChild(make('h3', '', title)); parent.appendChild(node); return node;}
  function setValue(node, value) {if (doc.activeElement !== node) node.value = value == null || typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);}
  function checked(node, value) {if (doc.activeElement !== node) node.checked = Boolean(value);}
  function report(error) {status.textContent = error?.message ?? String(error); status.dataset.error = 'true'; onError(error);}
  async function command(method, args = []) {
    if (!connected || disposed) return;
    const epoch = connectionEpoch;
    try {
      const result = await invoke(method, args);
      if (!disposed && connected && epoch === connectionEpoch) {
        status.textContent = ''; delete status.dataset.error;
        // Keep tuple edits based on the latest applied acknowledgement. The
        // host's visible refresh owns DOM updates, independently of audio events.
        if (result?.kind === 'dx7') state = result;
      }
      return result;
    } catch (error) {if (!disposed && connected && epoch === connectionEpoch) report(error);}
  }
  const patch = value => command('setPreset', [value]);
  const patchOperator = value => command('setOperator', [operator, value]);
  function number(parent, label, name, max, change, min = 0) {
    const node = make('input'); node.type = 'number'; node.min = String(min); node.max = String(max); node.step = '1'; node.dataset.chipControl = `dx7-${name}`;
    field(parent, label).appendChild(node);
    listen(node, 'change', () => {
      const value = Number(node.value);
      if (!node.value.trim() || !Number.isInteger(value) || value < min || value > max) {node.setCustomValidity(`Enter an integer from ${min} to ${max}.`); node.reportValidity?.(); return;}
      node.setCustomValidity(''); change?.(value);
    }); return node;
  }
  function select(parent, label, name, values, change, numeric = true) {
    const node = make('select'); node.dataset.chipControl = `dx7-${name}`;
    for (const [value, label] of values) {const option = make('option', '', label); option.value = String(value); node.appendChild(option);}
    field(parent, label).appendChild(node); listen(node, 'change', () => change(numeric ? Number(node.value) : node.value)); return node;
  }
  function checkbox(parent, label, name, change) {
    const node = make('input'); node.type = 'checkbox'; node.dataset.chipControl = `dx7-${name}`; field(parent, label).appendChild(node); listen(node, 'change', () => change(node.checked)); return node;
  }
  function output(parent, label, name) {const node = make('output'); node.dataset.chipOutput = `dx7-${name}`; field(parent, label).appendChild(node); return node;}
  function envelopeFields(parent, prefix, getEnvelope, apply) {
    const rows = fields(parent), controls = {rates: [], levels: []};
    for (const [kind, stem] of [['rates', 'rate'], ['levels', 'level']]) for (let index = 0; index < 4; index++) {
      controls[kind].push(number(rows, `${stem === 'rate' ? 'Rate' : 'Level'} ${index + 1}`, `${prefix}-${stem}-${index + 1}`, 99, value => {
        const current = getEnvelope()?.[kind];
        if (!Array.isArray(current) || current.length !== 4) return;
        const next = [...current]; next[index] = value; void apply({[kind]: next});
      }));
    }
    return controls;
  }
  function renderEnvelope(controls, envelope) {for (const kind of ['rates', 'levels']) controls[kind].forEach((node, index) => setValue(node, envelope?.[kind]?.[index]));}

  const body = make('fieldset', 'chip-editor-body'); body.disabled = true; root.appendChild(body);
  const voiceCard = section('DX7 voice'), voiceFields = fields(voiceCard);
  const bank = select(voiceFields, 'Bank voice', 'voice', [], value => {releaseAll(); void command('selectVoice', [value]);});
  const name = make('input'); name.type = 'text'; name.maxLength = 10; name.dataset.chipControl = 'dx7-name'; field(voiceFields, 'Voice name · 10 ASCII characters').appendChild(name);
  listen(name, 'change', () => {
    if (name.value.length > 10 || /[^\x20-\x7e]/.test(name.value)) {name.setCustomValidity('Use at most ten printable ASCII characters.'); name.reportValidity?.(); return;}
    name.setCustomValidity(''); void patch({name: name.value});
  });
  const algorithm = select(voiceFields, 'Algorithm · 1–32', 'algorithm', Array.from({length: 32}, (_, i) => [i, String(i + 1)]), value => patch({algorithm: value}));
  const feedback = number(voiceFields, 'Feedback', 'feedback', 7, value => command('setFeedback', [value]));
  const sampleRate = output(voiceFields, 'Output / engine rate (Hz)', 'sample-rate');
  const activity = output(voiceFields, 'Applied note gates', 'activity');
  const pending = make('p', 'subtext'); pending.dataset.chipOutput = 'dx7-pending'; voiceCard.appendChild(pending);

  const audition = fields(voiceCard);
  const midi = number(audition, 'Audition MIDI note', 'audition-midi', 127); midi.value = '69';
  const velocity = number(audition, 'Velocity', 'audition-velocity', 127, undefined, 1); velocity.value = '100';
  const actions = make('div', 'chip-actions'); audition.appendChild(actions);
  const hold = button(actions, 'Hold to play', null, 'hold');
  button(actions, 'Play 1 second', () => {
    if (!visible) return; releaseSource('preview'); const id = startNote(Number(midi.value), Number(velocity.value), 'preview');
    if (id) previewTimer = win.setTimeout(() => {previewTimer = null; endNote(id);}, 1000);
  }, 'play');
  button(actions, 'Release', releaseAll, 'release');
  const keyboardButton = button(actions, 'Use Keyboard', () => {
    if (!connected) return; keyboardActive = true; updateTarget(); status.textContent = 'DX7 is connected to the Guitar Keyboard.'; delete status.dataset.error;
  }, 'keyboard');
  button(actions, 'Load basic voice', () => {
    releaseAll();
    void patch({name: 'INIT SINE', algorithm: 31, feedback: 0, oscillatorSync: true, transpose: 24,
      pitchEnvelope: {rates: [99, 99, 99, 99], levels: [50, 50, 50, 50]},
      lfo: {speed: 0, delay: 0, pitchModDepth: 0, ampModDepth: 0, waveform: 0, sync: false, pitchModSensitivity: 0},
      operators: Object.fromEntries(Array.from({length: 6}, (_, i) => [i + 1, {mode: 'ratio', coarse: 1, fine: 0, detune: 7, outputLevel: i === 0 ? 85 : 0,
        rateScaling: 0, velocitySensitivity: 0, ampModSensitivity: 0,
        envelope: {rates: [99, 99, 99, 70], levels: [99, 99, 99, 0]},
        keyboardScaling: {breakpoint: 0, leftDepth: 0, rightDepth: 0, leftCurve: 0, rightCurve: 0}}])),
    });
  }, 'basic');
  voiceCard.appendChild(make('p', 'subtext', 'Audition and Keyboard share the 16-voice DX7 and use the selected applied voice. Release follows its envelope; Stop clears all voices. Changing the bank does not rewrite other slots.'));

  const overview = section('Six operators · OP1–OP6');
  const scroll = make('div', 'chip-opm-table-scroll'), table = make('table', 'chip-opm-table'), head = make('thead'), row = make('tr'), tableBody = make('tbody');
  scroll.appendChild(table); overview.appendChild(scroll); head.appendChild(row); table.appendChild(head); table.appendChild(tableBody);
  for (const title of ['Operator', 'Role', 'Nominal tuning', 'Output', 'Envelope rates', 'Envelope levels']) {const cell = make('th', '', title); cell.setAttribute('scope', 'col'); row.appendChild(cell);}
  const opButtons = [], opRows = [];
  for (let op = 1; op <= 6; op++) {
    const row = make('tr'), label = make('th'); label.setAttribute('scope', 'row'); row.appendChild(label); tableBody.appendChild(row);
    const buttonNode = button(label, `OP${op}`, () => {operator = op; renderOperator();}); buttonNode.dataset.chipOperator = String(op); opButtons.push(buttonNode);
    const cells = Array.from({length: 5}, () => {const cell = make('td'); row.appendChild(cell); return cell;}); opRows.push(cells);
  }
  overview.appendChild(make('p', 'subtext', 'An output carrier changes loudness; a modulator changes timbre according to the algorithm. Output level 0 is quietest, 99 loudest. Operators use public OP1–OP6 labels, independent of reversed SysEx byte order.'));

  const operatorCard = section('Selected operator'), operatorTitle = operatorCard.children[0], opFields = fields(operatorCard);
  const opMode = select(opFields, 'Frequency mode', 'op-mode', [['ratio', 'Ratio'], ['fixed', 'Fixed Hz']], value => patchOperator({mode: value}), false);
  const opControls = Object.fromEntries(OP_FIELDS.map(([key, label, max]) => [key,
    number(opFields, label, `op-${key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}`, max, value => patchOperator({[key]: value})),
  ]));
  const tuning = output(opFields, 'Nominal tuning · before detune', 'op-tuning');
  operatorCard.appendChild(make('p', 'subtext', 'Ratio mode follows the MIDI note; coarse 0 = ×½. Fixed mode uses coarse modulo 4 for decades. Detune is raw 0–14, neutral 7. Level/frequency edits affect held notes and release tails; envelope and scaling edits apply to subsequent notes.'));
  const opEnvelope = envelopeFields(operatorCard, 'op', () => state?.preset?.operators?.[operator]?.envelope, value => patchOperator({envelope: value}));
  operatorCard.appendChild(make('p', 'subtext', 'Envelope rates and levels are DX7 values 0–99, not seconds. Stages progress L4 → L1 → L2 → L3 while held, then return to L4 at release using R4. Higher rates are faster; a nonzero L4 can leave an audible release tail.'));
  const scaling = fields(operatorCard);
  const scaleControls = Object.fromEntries(SCALE_FIELDS.map(([key, title, max]) => [key, number(scaling, title, `op-${key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}`, max, value => patchOperator({keyboardScaling: {[key]: value}}))]));
  scaleControls.leftCurve = select(scaling, 'Left curve', 'op-left-curve', CURVES, value => patchOperator({keyboardScaling: {leftCurve: value}}));
  scaleControls.rightCurve = select(scaling, 'Right curve', 'op-right-curve', CURVES, value => patchOperator({keyboardScaling: {rightCurve: value}}));
  operatorCard.appendChild(make('p', 'subtext', 'Keyboard scaling changes operator level on either side of its breakpoint. Breakpoint is raw 0–99, not a MIDI note. Rate scaling changes envelope speed by note; velocity sensitivity changes the response to key strength.'));

  const advanced = make('details', 'chip-advanced'); advanced.appendChild(make('summary', '', 'LFO, pitch envelope and retained settings')); body.appendChild(advanced);
  const lfoCard = section('Shared LFO', advanced), lfoFields = fields(lfoCard);
  const lfoControls = Object.fromEntries([
    ['speed', 'Speed', 'speed', 99], ['delay', 'Delay', 'delay', 99], ['pitchModDepth', 'Pitch depth', 'pitch-depth', 99],
    ['ampModDepth', 'AM depth · retained', 'amp-depth', 99], ['pitchModSensitivity', 'Pitch sensitivity', 'pitch-sensitivity', 7],
  ].map(([key, label, id, max]) => [key, number(lfoFields, label, `lfo-${id}`, max, value => patch({lfo: {[key]: value}}))]));
  lfoControls.waveform = select(lfoFields, 'Waveform', 'lfo-waveform', [[0, 'Triangle'], [1, 'Saw down'], [2, 'Saw up'], [3, 'Square'], [4, 'Sine'], [5, 'Sample and hold']], value => patch({lfo: {waveform: value}}));
  lfoControls.sync = checkbox(lfoFields, 'LFO key sync', 'lfo-sync', value => patch({lfo: {sync: value}}));
  lfoCard.appendChild(make('p', 'subtext', 'The LFO is shared across voices. Pitch modulation needs both depth and sensitivity. MSFA retains operator AM sensitivity and AM depth in the patch but does not implement operator AM.'));
  const pitchCard = section('Pitch envelope', advanced);
  const pitchEnvelope = envelopeFields(pitchCard, 'pitch', () => state?.preset?.pitchEnvelope, value => patch({pitchEnvelope: value}));
  pitchCard.appendChild(make('p', 'subtext', 'Pitch levels use 50 as the neutral pitch; they are not amplitude levels or semitone counts.'));
  const retainedCard = section('Stored patch settings', advanced), retainedFields = fields(retainedCard);
  const transpose = number(retainedFields, 'Transpose · 24 = neutral', 'transpose', 48, value => patch({transpose: value}));
  const oscillatorSync = checkbox(retainedFields, 'Oscillator key sync', 'oscillator-sync', value => patch({oscillatorSync: value}));
  retainedCard.appendChild(make('p', 'subtext', 'Transpose and oscillator key sync are preserved for SysEx compatibility. The current MSFA engine does not apply these two settings to audio.'));

  const codeDetails = make('details', 'chip-advanced'); codeDetails.appendChild(make('summary', '', 'Applied voice JavaScript')); body.appendChild(codeDetails);
  const code = make('textarea', 'chip-voice-code'); code.rows = 12; code.readOnly = true; code.dataset.chipControl = 'dx7-code'; code.setAttribute('aria-label', 'DX7 applied voice JavaScript'); codeDetails.appendChild(code);
  button(codeDetails, 'Copy voice JavaScript', async () => {
    const epoch = connectionEpoch;
    try {await win.navigator.clipboard.writeText(code.value); if (!disposed && epoch === connectionEpoch) status.textContent = 'Voice JavaScript copied.';}
    catch {if (!disposed && epoch === connectionEpoch) {code.focus(); code.select(); status.textContent = 'Code selected. Copy it with your keyboard.';}}
  }, 'copy');
  const status = make('p', 'chip-editor-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.appendChild(status);
  root.appendChild(make('p', 'subtext', 'Values describe the applied patch, not a measured waveform. Held notes can retain an earlier patch identity after a bank change. Opening this view never creates or rewrites a voice.'));

  function startNote(note, strength, source, externalId, epoch) {
    if (!connected || disposed || !Number.isInteger(note) || note < 0 || note > 127 || !Number.isInteger(strength) || strength < 1 || strength > 127) return null;
    const id = `dx7-panel:${panelId}:${++pressSequence}`; held.set(id, {source, externalId, epoch});
    void command('auditionOn', [0, note, id, strength]); return id;
  }
  function endNote(id) {if (!held.has(id)) return; held.delete(id); void command('auditionOff', [0, id]);}
  function releaseSource(source) {
    for (const [id, entry] of held) if (entry.source === source) endNote(id);
    if (source === 'preview' && previewTimer !== null) {win.clearTimeout(previewTimer); previewTimer = null;}
    if (source === 'hold') {holdPress = null; hold.setAttribute('aria-pressed', 'false');}
  }
  function releaseAll() {for (const id of [...held.keys()]) endNote(id); if (previewTimer !== null) {win.clearTimeout(previewTimer); previewTimer = null;} holdPress = null; hold.setAttribute('aria-pressed', 'false');}
  function updateTarget() {
    const epoch = ++bindingEpoch;
    target = {owner: 'dx7-voice-panel', name: 'DX7 · selected voice',
      noteOn(event) {
        if (!keyboardActive || !connected || disposed || epoch !== bindingEpoch || typeof event?.id !== 'string') return;
        for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.externalId === event.id && entry.epoch === epoch) endNote(id);
        startNote(event.midi, event.velocity ?? 100, 'keyboard', event.id, epoch);
      },
      noteOff(event) {for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.externalId === event?.id && entry.epoch === epoch) endNote(id);},
      allNotesOff() {for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.epoch === epoch) endNote(id);},
    };
    keyboardButton.setAttribute('aria-pressed', String(keyboardActive)); if (keyboardActive) onKeyboardTargetChange(target);
  }
  function holdStart(event) {
    if (!visible || !connected || event.type === 'pointerdown' && event.button !== undefined && event.button !== 0 || event.type === 'keydown' && (event.repeat || ![' ', 'Enter'].includes(event.key))) return;
    event.preventDefault(); releaseSource('hold'); const id = startNote(Number(midi.value), Number(velocity.value), 'hold'); if (!id) return;
    holdPress = {id, pointerId: event.pointerId, key: event.key}; hold.setAttribute('aria-pressed', 'true');
    if (event.pointerId !== undefined) try {hold.setPointerCapture(event.pointerId);} catch {}
  }
  function holdEnd(event) {if (!holdPress || event.pointerId !== undefined && event.pointerId !== holdPress.pointerId || event.type === 'keyup' && event.key !== holdPress.key) return; releaseSource('hold');}
  listen(hold, 'pointerdown', holdStart); listen(hold, 'keydown', holdStart);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'keyup']) listen(hold, type, holdEnd);
  listen(hold, 'blur', () => releaseSource('hold')); listen(win, 'blur', releaseAll); listen(doc, 'visibilitychange', () => {if (doc.hidden) releaseAll();});

  function renderOperator() {
    const current = state?.preset?.operators?.[operator]; operatorTitle.textContent = `Selected operator · OP${operator}`;
    opButtons.forEach((node, index) => node.setAttribute('aria-pressed', String(index + 1 === operator)));
    setValue(opMode, current?.mode); for (const [key, node] of Object.entries(opControls)) setValue(node, current?.[key]);
    tuning.textContent = dx7OperatorTuning(current); renderEnvelope(opEnvelope, current?.envelope);
    for (const [key, node] of Object.entries(scaleControls)) setValue(node, current?.keyboardScaling?.[key]);
  }
  function update(snapshot) {
    if (disposed || !snapshot) return; state = snapshot; const preset = snapshot.preset ?? {};
    const voices = snapshot.voices ?? [], signature = JSON.stringify(voices);
    if (signature !== bankSignature && doc.activeElement !== bank) {
      bankSignature = signature;
      bank.replaceChildren(...voices.map(voice => {const node = make('option', '', `${voice.index + 1}. ${voice.name || '(unnamed)'}`); node.value = String(voice.index); return node;}));
    }
    setValue(bank, snapshot.selectedVoice); setValue(name, preset.name); setValue(algorithm, preset.algorithm); setValue(feedback, preset.feedback);
    sampleRate.textContent = `${snapshot.sampleRate ?? '—'} / ${snapshot.internalSampleRate ?? '—'}`;
    activity.textContent = `${snapshot.activeNotes?.length ?? 0} held / ${snapshot.polyphony ?? 16} voices${snapshot.activeNotes?.length ? ' · MIDI ' + snapshot.activeNotes.map(note => note.midi).join(', ') : ''}`;
    pending.textContent = snapshot.logical?.pendingCommands ? `${snapshot.logical.pendingCommands} reserved command(s). Controls edit the applied voice; pending script edits may apply later.` : 'Algorithm, envelope and scaling edits apply to subsequent notes; output, frequency and feedback also affect this patch’s held notes.';
    const carriers = dx7CarrierOperators(preset.algorithm);
    opRows.forEach((cells, index) => {const op = preset.operators?.[index + 1]; [carriers.includes(index + 1) ? 'Carrier' : 'Modulator', dx7OperatorTuning(op), op?.outputLevel ?? '—', op?.envelope?.rates?.join(' / ') ?? '—', op?.envelope?.levels?.join(' / ') ?? '—'].forEach((value, i) => {cells[i].textContent = String(value);});});
    renderOperator(); for (const [key, node] of Object.entries(lfoControls)) key === 'sync' ? checked(node, preset.lfo?.[key]) : setValue(node, preset.lfo?.[key]);
    renderEnvelope(pitchEnvelope, preset.pitchEnvelope); setValue(transpose, preset.transpose); checked(oscillatorSync, preset.oscillatorSync); setValue(code, dx7VoiceCode(snapshot));
  }
  function setConnected(value) {
    if (disposed) return; const next = Boolean(value);
    if (!next) {releaseAll(); if (keyboardActive) {keyboardActive = false; onKeyboardTargetChange(null);} bindingEpoch++; keyboardButton.setAttribute('aria-pressed', 'false');}
    if (connected !== next) connectionEpoch++; connected = next; body.disabled = !next;
  }
  updateTarget();
  return {update, setConnected, releaseAll, getNoteTarget: () => target,
    setVisible(value) {visible = Boolean(value); if (!visible) {releaseSource('hold'); releaseSource('preview');}},
    setKeyboardActive(value) {if (!value && keyboardActive) {keyboardActive = false; releaseSource('keyboard'); bindingEpoch++; keyboardButton.setAttribute('aria-pressed', 'false');}},
    dispose() {if (disposed) return; setConnected(false); disposed = true; for (const remove of listeners) remove();},
  };
}
