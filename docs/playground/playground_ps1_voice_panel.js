import {decodePs1Envelope, PS1_REVERB_PRESETS} from '../js/ps1_parameters.js?v=ps1-voice-editor-1';

/** Applied SPU voices. The owning tab supplies snapshots; this panel never polls. */
let panelSequence = 0;
export function createPlaygroundPs1VoicePanel({root, invoke, ensureAudioReady = () => {}, onKeyboardTargetChange = () => {}, onError = () => {}, onSelectedChannelChange = () => {}}) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc.defaultView ?? globalThis, panel = ++panelSequence;
  let state = null, selected = 0, connected = false, visible = true, disposed = false, epoch = 0, sequence = 0, targetEpoch = 0;
  let keyboardActive = false, target, timer = null, holdPress = null, commandSequence = 0, envelopeDraft = {};
  const held = new Map(), listeners = [];
  const make = (tag, cls, text) => {const node = doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node;};
  const voice = () => state?.channels?.[selected] ?? {};
  function listen(node, type, fn) {node.addEventListener(type, fn); listeners.push(() => node.removeEventListener(type, fn));}
  function button(parent, text, name, fn) {const node = make('button', '', text); node.type = 'button'; node.dataset.chipAction = name; if (fn) listen(node, 'click', fn); parent.appendChild(node); return node;}
  function field(parent, label) {const node = make('label', 'chip-field'); node.appendChild(make('span', 'chip-field-label', label)); parent.appendChild(node); return node;}
  function fields(parent) {const node = make('div', 'chip-fields'); parent.appendChild(node); return node;}
  function section(parent, label) {const node = make('section', 'chip-section'); node.appendChild(make('h3', '', label)); parent.appendChild(node); return node;}
  function set(node, value) {if (doc.activeElement !== node) node.value = value === null || value === undefined ? '' : String(value);}
  function checked(node, value) {if (doc.activeElement !== node) node.checked = Boolean(value);}
  function report(error) {status.textContent = error?.message ?? String(error); status.dataset.error = 'true'; onError(error);}
  async function command(method, args = []) {
    if (!connected || disposed) return;
    const token = epoch, request = ++commandSequence, auditionId = method === 'auditionOn' ? args[2] : null, entry = auditionId ? held.get(auditionId) : null;
    try {
      if (auditionId) {
        await ensureAudioReady();
        if (disposed || !connected || token !== epoch || !entry || held.get(auditionId) !== entry) return;
        entry.started = true;
      }
      const value = await invoke(method, args); if (!disposed && connected && token === epoch && request === commandSequence) {status.textContent = ''; delete status.dataset.error;} return value;
    } catch (error) {
      if (auditionId && held.get(auditionId) === entry) {
        held.delete(auditionId);
        if (holdPress?.id === auditionId) {holdPress = null; hold.setAttribute('aria-pressed', 'false');}
        if (entry?.source === 'sustain') sustain.setAttribute('aria-pressed', 'false');
        if (entry?.source === 'preview' && timer !== null) {win.clearTimeout(timer); timer = null;}
      }
      if (!disposed && connected && token === epoch && request === commandSequence) report(error);
    }
  }
  const patch = value => command('setPreset', [selected, value]);
  function number(parent, label, name, min, max, change, step = 1) {
    const node = make('input'); node.type = 'number'; node.min = String(min); node.max = String(max); node.step = String(step); node.dataset.chipControl = name; field(parent, label).appendChild(node);
    listen(node, 'change', () => {const value = Number(node.value); if (!node.value.trim() || !Number.isFinite(value) || step === 1 && !Number.isInteger(value) || value < min || value > max) {node.setCustomValidity('Enter a value within the displayed range.'); node.reportValidity?.(); return;} node.setCustomValidity(''); change?.(value);});
    return node;
  }
  function checkbox(parent, label, name, change) {const node = make('input'); node.type = 'checkbox'; node.dataset.chipControl = name; field(parent, label).appendChild(node); if (change) listen(node, 'change', () => change(node.checked)); return node;}

  const channels = make('div', 'chip-channel-list'); channels.setAttribute('aria-label', 'PS1 voice'); root.appendChild(channels);
  const buttons = Array.from({length:24}, (_, channel) => {
    const node = button(channels, `Voice ${channel + 1}`, `ps1-channel-${channel}`, () => {if (!connected || selected === channel) return; releaseAll(); selected = channel; envelopeDraft = {}; commandSequence++; updateTarget(); update(state); onSelectedChannelChange();});
    node.dataset.chipChannel = String(channel); return node;
  });
  root.appendChild(make('p', 'subtext', 'SPU · 44,100 Hz · 24 physical voices'));
  const instrument = make('fieldset', 'chip-editor-body'); instrument.disabled = true; root.appendChild(instrument);
  const card = section(instrument, 'Selected ADPCM voice'), common = fields(card);
  const gate = make('output'); gate.dataset.chipOutput = 'ps1-gate'; field(common, 'Gate (last KON / KOFF)').appendChild(gate);
  const sample = make('select'); sample.dataset.chipControl = 'ps1-sample'; field(common, 'Uploaded sample').appendChild(sample); let sampleSignature = '';
  listen(sample, 'change', () => {if (sample.value !== '') void patch({sample:Number(sample.value)});});
  const pitch = number(common, 'PITCH (4096 = source rate)', 'ps1-pitch', 0, 16383, value => patch({pitch:value}));
  const volumeLeft = number(common, 'Left volume', 'ps1-volume-left', -1, 1, value => patch({volumeLeft:value}), .01);
  const volumeRight = number(common, 'Right volume', 'ps1-volume-right', -1, 1, value => patch({volumeRight:value}), .01);
  const metadata = make('p', 'subtext'); metadata.dataset.chipOutput = 'ps1-sample'; card.appendChild(metadata);
  const audition = fields(card), midi = number(audition, 'Audition MIDI note', 'ps1-audition-midi', 0, 127); midi.value = '60';
  const actions = make('div', 'chip-actions'); audition.appendChild(actions);
  const hold = button(actions, 'Hold to play', 'ps1-hold');
  button(actions, 'Play 1 second', 'ps1-play', () => {if (!visible) return; releaseSource('preview'); const id = start(selected, Number(midi.value), 'preview'); if (id) timer = win.setTimeout(() => {timer = null; end(id);}, 1000);});
  const sustain = button(actions, 'Sustain play', 'ps1-sustain', () => {if (!visible || !connected) return; if ([...held.values()].some(entry => entry.source === 'sustain')) releaseSource('sustain'); else if (start(selected, Number(midi.value), 'sustain')) sustain.setAttribute('aria-pressed', 'true');});
  sustain.setAttribute('aria-pressed', 'false');
  button(actions, 'Release', 'ps1-release', releaseAll);
  const keyboard = button(actions, 'Use Keyboard', 'ps1-keyboard', () => {if (!connected || !visible) return; keyboardActive = true; updateTarget();});
  card.appendChild(make('p', 'subtext', 'Sustain play keeps this voice held while you edit with the mouse. Release, changing voice, hiding this tab, or leaving the window releases manual notes through their programmed release stage. Use transport Stop for immediate silence, including infinite-release notes and reverb tails. Keyboard uses the selected physical voice.'));

  const envelopeCard = section(instrument, 'ADSR envelope'), envelopeFields = fields(envelopeCard), envelopeInputs = {};
  const retrigger = checkbox(envelopeFields, 'Retrigger my held note after an ADSR edit', 'ps1-retrigger'); retrigger.checked = true;
  function editEnvelope(key, value) {if (!connected || disposed) return; envelopeDraft = {...envelopeDraft, [key]:value}; drawEnvelope(); void command('setEnvelope', [selected, {[key]:value}, {retrigger:retrigger.checked}]);}
  for (const [key, label, max] of [['attackRate','Attack rate · 0 fastest',127], ['decayRate','Decay rate · 0 fast / 15 slow',15], ['sustainLevel','Sustain level · 0–15',15], ['sustainRate','Sustain rate · 127 holds',127], ['releaseRate','Release rate · 27–31 hold',31]]) {
    envelopeInputs[key] = number(envelopeFields, label, `ps1-${key.replace(/[A-Z]/g, value => '-' + value.toLowerCase())}`, 0, max, value => editEnvelope(key, value));
  }
  for (const [key, label] of [['attackExponential','Exponential attack'], ['sustainDecrease','Sustain decreases'], ['sustainExponential','Exponential sustain'], ['releaseExponential','Exponential release']]) {
    envelopeInputs[key] = checkbox(envelopeFields, label, `ps1-${key.replace(/[A-Z]/g, value => '-' + value.toLowerCase())}`, value => editEnvelope(key, value));
  }
  const envelopeCanvas = make('canvas', 'chip-sample-waveform'); envelopeCanvas.width = 800; envelopeCanvas.height = 180; envelopeCanvas.dataset.chipControl = 'ps1-envelope';
  envelopeCanvas.setAttribute('role', 'img'); envelopeCanvas.setAttribute('aria-label', 'Schematic PS1 ADSR envelope. Stage widths are illustrative, not elapsed time.'); envelopeCard.appendChild(envelopeCanvas);
  const envelopeInfo = make('p', 'subtext'); envelopeInfo.dataset.chipOutput = 'ps1-envelope'; envelopeCard.appendChild(envelopeInfo);
  envelopeCard.appendChild(make('p', 'subtext', 'The graph shows envelope shape, not measured timing. This experimental core approximates ADSR curves; high rate codes can stop a stage. ADSR changes apply at key-on; retrigger restarts only a note held by this editor. Code-owned notes keep playing. Release rates 27–31 hold indefinitely in this core.'));

  const effectCard = section(instrument, 'SPU reverb'), effectFields = fields(effectCard);
  const reverbSend = checkbox(effectFields, 'Selected voice uses reverb', 'ps1-reverb-send', value => patch({reverb:value}));
  const reverbPreset = make('select'); reverbPreset.dataset.chipControl = 'ps1-reverb-preset'; field(effectFields, 'Shared reverb preset').appendChild(reverbPreset);
  for (const entry of PS1_REVERB_PRESETS) {const option = make('option', '', entry.name); option.value = entry.id; reverbPreset.appendChild(option);}
  listen(reverbPreset, 'change', () => {void command('setReverb', [{preset:reverbPreset.value}]);});
  const reverbLeft = number(effectFields, 'Shared return · left', 'ps1-reverb-left', 0, 1, value => command('setReverb', [{volumeLeft:value}]), .01);
  const reverbRight = number(effectFields, 'Shared return · right', 'ps1-reverb-right', 0, 1, value => command('setReverb', [{volumeRight:value}]), .01);
  effectCard.appendChild(make('p', 'subtext', 'Choose a reverb preset and enable “Selected voice uses reverb” to hear it. Preset and return levels affect all voices on this SPU; each voice has its own reverb switch. These are the core’s named reverb approximations.'));

  const advanced = make('details', 'chip-advanced'); advanced.appendChild(make('summary', '', 'Raw ADSR words and voice JavaScript')); instrument.appendChild(advanced);
  const rawFields = fields(advanced), rawPatch = value => {envelopeDraft = {}; void command('setPreset', [selected, value, {retrigger:retrigger.checked}]);};
  const adsr1 = number(rawFields, 'ADSR1 (raw word)', 'ps1-adsr1', 0, 65535, value => rawPatch({adsr1:value}));
  const adsr2 = number(rawFields, 'ADSR2 (raw word)', 'ps1-adsr2', 0, 65535, value => rawPatch({adsr2:value}));
  const code = make('pre', 'chip-memory-ranges'); code.dataset.chipOutput = 'ps1-code'; advanced.appendChild(code);
  button(advanced, 'Copy voice JavaScript', 'ps1-copy', async () => {try {await win.navigator.clipboard.writeText(code.textContent); if (!disposed) {status.textContent = 'Voice JavaScript copied.'; delete status.dataset.error;}} catch (error) {if (!disposed) report(error);}});
  const status = make('p', 'chip-editor-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.appendChild(status);
  root.appendChild(make('p', 'subtext', 'The original default waveform is ready on every voice. Upload ADPCM with loadADPCM() to add instruments. Values show applied SPU settings; the gate is not a measured audio level. Snapshots update on Refresh and edits. Opening this panel never starts audio, replaces samples, or polls the audio thread.'));

  function start(channel, note, source, externalId, token) {if (!connected || disposed || !Number.isInteger(note) || note < 0 || note > 127) return null; const id = `ps1-panel:${panel}:${++sequence}`; held.set(id, {channel, source, externalId, token, started:false}); void command('auditionOn', [channel, note, id]); return id;}
  function end(id) {const entry = held.get(id); if (!entry) return; held.delete(id); if (entry.started) void command('auditionOff', [entry.channel, id]);}
  function releaseSource(source) {for (const [id, entry] of held) if (entry.source === source) end(id); if (source === 'preview' && timer !== null) {win.clearTimeout(timer); timer = null;} if (source === 'hold') {holdPress = null; hold.setAttribute('aria-pressed', 'false');} if (source === 'sustain') sustain.setAttribute('aria-pressed', 'false');}
  function releaseAll() {for (const id of [...held.keys()]) end(id); if (timer !== null) {win.clearTimeout(timer); timer = null;} holdPress = null; hold.setAttribute('aria-pressed', 'false'); sustain.setAttribute('aria-pressed', 'false');}
  function updateTarget() {
    const channel = selected, token = ++targetEpoch;
    target = {owner:'ps1-voice-panel', name:`PS1 · Voice ${channel + 1}`,
      noteOn(event) {if (!keyboardActive || !connected || token !== targetEpoch || typeof event?.id !== 'string') return; for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.externalId === event.id && entry.token === token) end(id); start(channel, event.midi, 'keyboard', event.id, token);},
      noteOff(event) {for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.externalId === event?.id && entry.token === token) end(id);},
      allNotesOff() {for (const [id, entry] of held) if (entry.source === 'keyboard' && entry.token === token) end(id);},
    };
    keyboard.setAttribute('aria-pressed', String(keyboardActive)); if (keyboardActive) onKeyboardTargetChange(target);
  }
  function holdStart(event) {if (!visible || !connected || event.type === 'pointerdown' && event.button !== undefined && event.button !== 0 || event.type === 'keydown' && (event.repeat || ![' ', 'Enter'].includes(event.key))) return; event.preventDefault(); releaseSource('hold'); const id = start(selected, Number(midi.value), 'hold'); if (!id) return; holdPress = {id, pointerId:event.pointerId, key:event.key}; hold.setAttribute('aria-pressed', 'true'); if (event.pointerId !== undefined) try {hold.setPointerCapture(event.pointerId);} catch {}}
  function holdEnd(event) {if (!holdPress || event.pointerId !== undefined && event.pointerId !== holdPress.pointerId || event.type === 'keyup' && event.key !== holdPress.key) return; releaseSource('hold');}
  listen(hold, 'pointerdown', holdStart); listen(hold, 'keydown', holdStart); for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'keyup']) listen(hold, type, holdEnd);
  listen(hold, 'blur', () => releaseSource('hold')); listen(win, 'blur', releaseAll); listen(doc, 'visibilitychange', () => {if (doc.hidden) releaseAll();});

  function envelope() {return {...decodePs1Envelope(voice().adsr1 ?? 0, voice().adsr2 ?? 0), ...envelopeDraft};}
  function drawEnvelope() {
    const value = envelope();
    // The retained core has 108 linear/negative-exponential rates and 100
    // positive-exponential rates. Out-of-table codes return a zero increment.
    const attackStopped = value.attackRate >= (value.attackExponential ? 100 : 108);
    const sustainHeld = value.sustainRate >= (value.sustainExponential && !value.sustainDecrease ? 100 : 108);
    const peak = attackStopped ? 0 : 1, level = (value.sustainLevel + 1) / 16 * peak, endLevel = sustainHeld ? level : value.sustainDecrease ? 0 : peak;
    envelopeInfo.textContent = `A ${value.attackRate}${attackStopped ? ' (stopped at zero)' : ''} · D ${value.decayRate} · SL ${value.sustainLevel} · S ${value.sustainRate}${sustainHeld ? ' (hold)' : value.sustainDecrease ? ' ↓' : ' ↑'} · R ${value.releaseRate}${value.releaseRate >= 27 ? ' (infinite)' : ''} · illustrative stage widths`;
    if (!visible) return; const ctx = envelopeCanvas.getContext?.('2d'); if (!ctx) return;
    const w = envelopeCanvas.width, h = envelopeCanvas.height, top = 18, bottom = h - 32, y = gain => bottom - gain * (bottom - top);
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#101820'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#34444e'; ctx.lineWidth = 1;
    for (const gain of [0, .5, 1]) {ctx.beginPath(); ctx.moveTo(12, y(gain)); ctx.lineTo(w - 12, y(gain)); ctx.stroke();}
    const xs = [20, w * .22, w * .4, w * .68, w - 20]; ctx.strokeStyle = '#7bbcf7'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(xs[0], y(0));
    if (value.attackExponential) ctx.quadraticCurveTo(xs[0] + 12, y(.95 * peak), xs[1], y(peak)); else ctx.lineTo(xs[1], y(peak));
    ctx.quadraticCurveTo(xs[1] + 12, y(level), xs[2], y(level));
    if (sustainHeld) ctx.lineTo(xs[3], y(level)); else if (value.sustainExponential) ctx.quadraticCurveTo(xs[2] + 12, y(endLevel), xs[3], y(endLevel)); else ctx.lineTo(xs[3], y(endLevel));
    if (value.releaseRate >= 27) ctx.lineTo(xs[4], y(endLevel)); else if (value.releaseExponential) ctx.quadraticCurveTo(xs[3] + 15, y(0), xs[4], y(0)); else ctx.lineTo(xs[4], y(0));
    ctx.stroke(); ctx.fillStyle = '#b5c2cc'; ctx.font = '13px sans-serif'; for (const [index, name] of ['Attack', 'Decay', 'Sustain', 'Release'].entries()) ctx.fillText(name, (xs[index] + xs[index + 1]) / 2 - 20, h - 10);
  }
  function update(next) {
    if (disposed || !next) return; state = next; const v = voice(), samples = state.samples ?? []; envelopeDraft = {};
    // Transport Stop/reset retires manual leases in the audio owner. Clear only
    // local pressed indicators; never send a late KOFF to a replacement voice.
    if (Array.isArray(state.auditions)) {
      const owned = new Set(state.auditions.map(entry => entry.id));
      for (const [id, entry] of held) if (entry.started && !owned.has(id)) held.delete(id);
      if (holdPress && !held.has(holdPress.id)) {holdPress = null; hold.setAttribute('aria-pressed', 'false');}
      if (![...held.values()].some(entry => entry.source === 'sustain')) sustain.setAttribute('aria-pressed', 'false');
      if (timer !== null && ![...held.values()].some(entry => entry.source === 'preview')) {win.clearTimeout(timer); timer = null;}
    }
    instrument.disabled = !connected; buttons.forEach((node, channel) => {node.disabled = !connected; node.setAttribute('aria-pressed', String(channel === selected)); node.dataset.sounding = String(Boolean(state.channels?.[channel]?.gate));});
    const options = [['', 'Unassigned'], ...samples.map(entry => [String(entry.id), `Sample ${entry.id} · ${entry.decodedFrames} samples`])], signature = JSON.stringify(options);
    if (signature !== sampleSignature) {sampleSignature = signature; sample.replaceChildren(...options.map(([value, text]) => {const node = make('option', '', text); node.value = value; return node;}));}
    set(sample, v.sample); set(pitch, v.pitch); set(volumeLeft, v.volumeLeft); set(volumeRight, v.volumeRight); set(adsr1, v.adsr1); set(adsr2, v.adsr2); gate.textContent = v.gate ? 'On' : 'Off';
    const decoded = envelope(); for (const [key, node] of Object.entries(envelopeInputs)) {if (node.type === 'checkbox') checked(node, decoded[key]); else set(node, decoded[key]);}
    checked(reverbSend, v.reverb); set(reverbPreset, state.reverb?.preset ?? 'off'); set(reverbLeft, state.reverb?.volumeLeft ?? .25); set(reverbRight, state.reverb?.volumeRight ?? .25);
    const entry = samples.find(value => value.id === v.sample); metadata.textContent = entry ? `${entry.byteLength} ADPCM bytes · RAM ${entry.startAddress} · Root ${Number(entry.rootFrequencyHz).toFixed(3)} Hz · Base PITCH ${entry.basePitch} · ${entry.loop ? 'Loop' : 'One shot'}` : 'No ADPCM sample is assigned to this voice.';
    code.textContent = `spu.setPreset(${selected}, ${JSON.stringify({sample:v.sample, adsr1:v.adsr1, adsr2:v.adsr2, volumeLeft:v.volumeLeft, volumeRight:v.volumeRight, pitch:v.pitch, reverb:Boolean(v.reverb)})});\nspu.setReverb(${JSON.stringify(state.reverb ?? {preset:'off', volumeLeft:.25, volumeRight:.25})});`;
    drawEnvelope();
  }
  function setConnected(value) {if (disposed) return; const next = Boolean(value); if (!next) {releaseAll(); if (keyboardActive) onKeyboardTargetChange(null); keyboardActive = false; targetEpoch++; envelopeDraft = {}; keyboard.setAttribute('aria-pressed', 'false');} if (next !== connected) epoch++; connected = next; instrument.disabled = !next; for (const node of buttons) node.disabled = !next;}
  updateTarget();
  return {update, setConnected, releaseAll, getSelectedChannel:() => selected, getNoteTarget:() => target,
    setVisible(value) {visible = Boolean(value); if (!visible) {releaseSource('hold'); releaseSource('preview'); releaseSource('sustain');} else drawEnvelope();},
    setKeyboardActive(value) {if (!value && keyboardActive) {releaseSource('keyboard'); keyboardActive = false; targetEpoch++; keyboard.setAttribute('aria-pressed', 'false');}},
    dispose() {if (disposed) return; setConnected(false); disposed = true; for (const remove of listeners) remove();},
  };
}
