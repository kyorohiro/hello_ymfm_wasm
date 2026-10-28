import {decodePs1Envelope, PS1_REVERB_PRESETS} from '../js/ps1_parameters.js?v=ps1-voice-editor-1';
import {ps1EnvelopeGeometry, ps1EnvelopePointPatch} from './playground_ps1_envelope.js?v=ps1-envelope-drag-1';

const PCM_FRAMES = 112;
function appliedWaveform(voice) {
  const value = voice?.waveform;
  return value && value.sample === voice.sample && Array.isArray(value.pcm) && value.pcm.length === PCM_FRAMES && value.pcm.every(sample => Number.isFinite(sample) && sample >= -1 && sample <= 1) ? value.pcm : null;
}

/** PCM is included for editor-created cycles so copied code never relies on a
 * private sample ID from another live SPU instance. */
export function ps1VoiceCode(state, channel = 0) {
  const voice = state?.channels?.[channel]; if (!voice) return '';
  const pcm = appliedWaveform(voice), {sample, ...preset} = {sample:voice.sample, adsr1:voice.adsr1, adsr2:voice.adsr2, volumeLeft:voice.volumeLeft, volumeRight:voice.volumeRight, pitch:voice.pitch, reverb:Boolean(voice.reverb)};
  const lines = pcm ? [
    `const ps1WavePcm = new Float32Array(${JSON.stringify(pcm)});`,
    'const ps1WaveEncoded = encodePs1Adpcm(ps1WavePcm, {loopStartSamples:0});',
    'const ps1WaveSample = await spu.loadADPCM(ps1WaveEncoded.adpcm, {baseFrequencyHz:44100 / 112, loopStartSamples:0});',
    `spu.setPreset(${channel}, {sample:ps1WaveSample, ...${JSON.stringify(preset)}});`,
  ] : [`spu.setPreset(${channel}, ${JSON.stringify({sample, ...preset})});`];
  lines.push(`spu.setReverb(${JSON.stringify(state.reverb ?? {preset:'off', volumeLeft:.25, volumeRight:.25})});`);
  return lines.join('\n');
}

/** Applied SPU voices. The owning tab supplies snapshots; this panel never polls. */
let panelSequence = 0;
export function createPlaygroundPs1VoicePanel({root, invoke, ensureAudioReady = () => {}, onKeyboardTargetChange = () => {}, onError = () => {}, onSelectedChannelChange = () => {}}) {
  const doc = root.ownerDocument ?? globalThis.document, win = doc.defaultView ?? globalThis, panel = ++panelSequence;
  let state = null, selected = 0, connected = false, visible = true, disposed = false, epoch = 0, sequence = 0, targetEpoch = 0;
  let keyboardActive = false, target, timer = null, holdPress = null, commandSequence = 0, envelopeDraft = {};
  let waveDrag = null, waveDraft = null, waveSignature = '';
  let envelopeDrag = null, envelopeFrame = null, envelopePending = null, envelopeInFlight = null;
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
  async function command(method, args = [], onFailure) {
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
      if (!disposed && connected && token === epoch) {onFailure?.(); if (request === commandSequence) report(error);}
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
    const node = button(channels, `Voice ${channel + 1}`, `ps1-channel-${channel}`, () => {if (!connected || selected === channel) return; releaseAll(); cancelWave(); cancelEnvelope(); selected = channel; envelopeDraft = {}; commandSequence++; updateTarget(); update(state); onSelectedChannelChange();});
    node.dataset.chipChannel = String(channel); return node;
  });
  root.appendChild(make('p', 'subtext', 'SPU · 44,100 Hz · 24 physical voices'));
  const instrument = make('fieldset', 'chip-editor-body'); instrument.disabled = true; root.appendChild(instrument);
  const card = section(instrument, 'Selected ADPCM voice'), common = fields(card);
  const gate = make('output'); gate.dataset.chipOutput = 'ps1-gate'; field(common, 'Gate (last KON / KOFF)').appendChild(gate);
  const sample = make('select'); sample.dataset.chipControl = 'ps1-sample'; field(common, 'Assigned sample').appendChild(sample); let sampleSignature = '';
  listen(sample, 'change', () => {if (!connected || sample.value === '') return; const entry = state?.samples?.find(value => value.id === Number(sample.value)); if (!entry || entry.editorChannel !== undefined && entry.editorChannel !== selected) return; cancelWave(); void patch({sample:entry.id});});
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

  const waveCard = section(instrument, 'PCM cycle → SPU ADPCM'), waveActions = make('div', 'chip-actions'); waveCard.appendChild(waveActions);
  for (const name of ['Sine', 'Triangle', 'Saw', 'Square']) button(waveActions, name, `ps1-wave-${name.toLowerCase()}`, () => {
    const pcm = Array.from({length:PCM_FRAMES}, (_, index) => {
      const phase = index / PCM_FRAMES;
      return .65 * (name === 'Sine' ? Math.sin(2 * Math.PI * phase) : name === 'Triangle' ? 1 - 4 * Math.abs(phase - .5) : name === 'Saw' ? 2 * phase - 1 : phase < .5 ? 1 : -1);
    });
    setWave(pcm);
  });
  const waveCanvas = make('canvas', 'chip-sample-waveform'); waveCanvas.width = 800; waveCanvas.height = 180; waveCanvas.dataset.chipControl = 'ps1-waveform';
  waveCanvas.setAttribute('role', 'img'); waveCanvas.setAttribute('aria-label', 'PS1 PCM cycle, 112 signed samples from -1 to 1. Drag to edit; apply once on release.'); waveCard.appendChild(waveCanvas);
  const waveFields = fields(waveCard);
  const waveIndex = number(waveFields, 'PCM sample index', 'ps1-wave-index', 0, PCM_FRAMES - 1, value => set(waveValue, appliedWaveform(voice())?.[value])); waveIndex.value = '0';
  const waveValue = number(waveFields, 'PCM sample value', 'ps1-wave-value', -1, 1, value => {
    const pcm = appliedWaveform(voice()), index = Number(waveIndex.value);
    if (!pcm || !Number.isInteger(index) || index < 0 || index >= PCM_FRAMES) return;
    const copy = pcm.slice(); copy[index] = value; setWave(copy);
  }, .01);
  const waveInfo = make('p', 'subtext'); waveInfo.dataset.chipOutput = 'ps1-wave-info'; waveCard.appendChild(waveInfo);
  waveCard.appendChild(make('p', 'subtext', 'One cycle uses 112 PCM samples, encoded as four ADPCM packets (64 bytes), with a loop from sample 0. At PITCH 4096 its fundamental is 393.75 Hz. Shapes and completed strokes affect only this voice; other voices keep their samples. ADPCM quantization changes the resulting sound. Use Sample Editor for recordings and longer samples.'));

  const envelopeCard = section(instrument, 'ADSR envelope'), envelopeFields = fields(envelopeCard), envelopeInputs = {};
  const retrigger = checkbox(envelopeFields, 'Retrigger my held note after an ADSR or PCM edit', 'ps1-retrigger'); retrigger.checked = true;
  function editEnvelope(key, value) {if (!connected || disposed) return; cancelEnvelope(); envelopeDraft = {...envelopeDraft, [key]:value}; drawEnvelope(); void command('setEnvelope', [selected, {[key]:value}, {retrigger:retrigger.checked}]);}
  for (const [key, label, max] of [['attackRate','Attack rate · 0 fastest',127], ['decayRate','Decay rate · 0 fast / 15 slow',15], ['sustainLevel','Sustain level · 0–15',15], ['sustainRate','Sustain rate · 127 holds',127], ['releaseRate','Release rate · 27–31 hold',31]]) {
    envelopeInputs[key] = number(envelopeFields, label, `ps1-${key.replace(/[A-Z]/g, value => '-' + value.toLowerCase())}`, 0, max, value => editEnvelope(key, value));
  }
  for (const [key, label] of [['attackExponential','Exponential attack'], ['sustainDecrease','Sustain decreases'], ['sustainExponential','Exponential sustain'], ['releaseExponential','Exponential release']]) {
    envelopeInputs[key] = checkbox(envelopeFields, label, `ps1-${key.replace(/[A-Z]/g, value => '-' + value.toLowerCase())}`, value => editEnvelope(key, value));
  }
  const envelopeEditor = make('div', 'chip-envelope-editor'); envelopeEditor.dataset.chipControl = 'ps1-envelope-editor';
  envelopeEditor.setAttribute('role', 'group'); envelopeEditor.setAttribute('aria-label', 'Edit PS1 ADSR envelope'); envelopeCard.appendChild(envelopeEditor);
  const envelopeCanvas = make('canvas', 'chip-sample-waveform'); envelopeCanvas.width = 800; envelopeCanvas.height = 180; envelopeCanvas.dataset.chipControl = 'ps1-envelope';
  envelopeCanvas.setAttribute('role', 'img'); envelopeCanvas.setAttribute('aria-label', 'Editable PS1 ADSR envelope. Stage widths are illustrative, not elapsed time. Drag A, D, S or R; right increases the rate code (slower). Drag D up to increase sustain level.'); envelopeEditor.appendChild(envelopeCanvas);
  const envelopeHandles = Object.fromEntries(['attack', 'decay', 'sustain', 'release'].map(name => {
    const node = button(envelopeEditor, name[0].toUpperCase(), `ps1-envelope-${name}`); node.className = 'chip-envelope-handle'; node.dataset.chipEnvelopeHandle = name;
    listen(node, 'pointerdown', event => envelopeDown(event, name)); listen(node, 'keydown', event => envelopeKey(event, name));
    return [name, node];
  }));
  const envelopeInfo = make('p', 'subtext'); envelopeInfo.dataset.chipOutput = 'ps1-envelope'; envelopeCard.appendChild(envelopeInfo);
  envelopeCard.appendChild(make('p', 'subtext', 'Drag A / D / S / R left or right: faster / slower rate codes. Drag D up or down: sustain level. Focus a point and use arrow keys for one-step adjustments.'));
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
  const rawFields = fields(advanced), rawPatch = value => {cancelEnvelope(); envelopeDraft = {}; void command('setPreset', [selected, value, {retrigger:retrigger.checked}]);};
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
  listen(hold, 'blur', () => releaseSource('hold')); listen(win, 'blur', () => {releaseAll(); cancelWave(); cancelEnvelope();}); listen(doc, 'visibilitychange', () => {if (doc.hidden) {releaseAll(); cancelWave(); cancelEnvelope();}});

  function waveIdentity() {const value = voice(); return JSON.stringify([selected, value.sample, appliedWaveform(value)]);}
  function setWave(pcm) {
    if (!connected || !visible || disposed) return;
    cancelWave();
    void command('setWaveform', [selected, pcm.slice(), {retrigger:retrigger.checked}]);
  }
  function drawWave() {
    const pcm = waveDraft ?? appliedWaveform(voice()), signature = JSON.stringify(pcm);
    waveIndex.disabled = waveValue.disabled = !connected || !pcm;
    if (!waveDrag) set(waveValue, pcm?.[Number(waveIndex.value)]);
    waveInfo.textContent = pcm ? 'Editable original PCM · 112 signed samples. Drag or set individual samples numerically. A completed stroke is applied once; cancelled strokes do not write.' : 'Original editable PCM is unavailable for this ADPCM sample. Choose a shape to create a new cycle for this voice.';
    if (!visible || signature === waveSignature) return; waveSignature = signature;
    const ctx = waveCanvas.getContext?.('2d'); if (!ctx) return;
    const w = waveCanvas.width, h = waveCanvas.height, y = value => 8 + (1 - value) * (h - 16) / 2;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#101820'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#34444e'; ctx.lineWidth = 1;
    for (const value of [-1, 0, 1]) {ctx.beginPath(); ctx.moveTo(0, y(value)); ctx.lineTo(w, y(value)); ctx.stroke();}
    if (!pcm) {ctx.fillStyle = '#b5c2cc'; ctx.font = '13px sans-serif'; ctx.fillText('Choose a shape to create editable PCM for this voice.', 12, 25); return;}
    ctx.strokeStyle = '#7bbcf7'; ctx.lineWidth = 2; ctx.beginPath();
    pcm.forEach((value, index) => {const x = index * w / (PCM_FRAMES - 1); if (index) ctx.lineTo(x, y(value)); else ctx.moveTo(x, y(value));}); ctx.stroke();
  }
  function drawPoint(event) {
    const rect = waveCanvas.getBoundingClientRect();
    if (!waveDrag || !waveDraft || !rect.width || !rect.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const index = Math.max(0, Math.min(PCM_FRAMES - 1, Math.floor((event.clientX - rect.left) / rect.width * PCM_FRAMES)));
    const value = Math.max(-1, Math.min(1, 1 - 2 * (event.clientY - rect.top) / rect.height));
    const from = waveDrag.lastIndex ?? index, previous = waveDrag.lastValue ?? value;
    for (let at = Math.min(from, index); at <= Math.max(from, index); at++) waveDraft[at] = from === index ? value : previous + (value - previous) * (at - from) / (index - from);
    waveDrag.lastIndex = index; waveDrag.lastValue = value; set(waveIndex, index); set(waveValue, value); drawWave();
  }
  function cancelWave(event) {
    if (event?.pointerId !== undefined && waveDrag?.pointerId !== event.pointerId) return;
    waveDrag = null; waveDraft = null; waveSignature = ''; drawWave();
  }
  listen(waveCanvas, 'pointerdown', event => {
    const pcm = appliedWaveform(voice());
    if (!connected || !visible || disposed || waveDrag || !pcm || event.button !== undefined && event.button !== 0) return;
    event.preventDefault(); waveDraft = pcm.slice(); waveDrag = {pointerId:event.pointerId, channel:selected, epoch, identity:waveIdentity()};
    try {waveCanvas.setPointerCapture(event.pointerId);} catch {} drawPoint(event);
  });
  listen(waveCanvas, 'pointermove', event => {if (waveDrag?.pointerId === event.pointerId) {event.preventDefault(); drawPoint(event);}});
  listen(waveCanvas, 'pointerup', event => {
    if (!waveDrag || waveDrag.pointerId !== event.pointerId) return; drawPoint(event);
    const drag = waveDrag, pcm = waveDraft; waveDrag = null; waveDraft = null; waveSignature = ''; drawWave();
    if (drag.channel === selected && drag.epoch === epoch && drag.identity === waveIdentity()) setWave(pcm);
  });
  listen(waveCanvas, 'pointercancel', cancelWave); listen(waveCanvas, 'lostpointercapture', cancelWave);

  function envelope() {return {...decodePs1Envelope(voice().adsr1 ?? 0, voice().adsr2 ?? 0), ...envelopeDraft};}
  function syncEnvelopeInputs() {
    const value = envelope();
    for (const [key, node] of Object.entries(envelopeInputs)) {if (node.type === 'checkbox') checked(node, value[key]); else set(node, value[key]);}
  }
  function scheduleEnvelope() {
    if (envelopeFrame !== null || envelopeInFlight || !envelopePending || !connected || !visible || disposed) return;
    envelopeFrame = win.requestAnimationFrame(() => {envelopeFrame = null; flushEnvelope();});
  }
  function flushEnvelope() {
    if (envelopeFrame !== null) {win.cancelAnimationFrame(envelopeFrame); envelopeFrame = null;}
    if (envelopeInFlight || !envelopePending || !connected || !visible || disposed) return;
    const pending = envelopePending; envelopePending = null; envelopeInFlight = pending;
    // Coalesce pointer events and wait for the previous inspector write instead
    // of flooding Main/Worker/Native with retriggers and state-read requests.
    void command('setEnvelope', [pending.channel, pending.patch, {retrigger:pending.retrigger}], () => {
      if (selected !== pending.channel) return;
      for (const [key, value] of Object.entries(pending.patch)) if (envelopeDraft[key] === value && !Object.hasOwn(envelopePending?.patch ?? {}, key)) delete envelopeDraft[key];
      syncEnvelopeInputs(); drawEnvelope();
    }).finally(() => {
      if (envelopeInFlight === pending) envelopeInFlight = null;
      scheduleEnvelope();
    });
  }
  function queueEnvelope(patch) {
    const current = envelope(), changed = Object.fromEntries(Object.entries(patch ?? {}).filter(([key, value]) => current[key] !== value));
    if (!Object.keys(changed).length) return;
    envelopeDraft = {...envelopeDraft, ...changed};
    envelopePending = {channel:selected, patch:{...envelopePending?.patch, ...changed}, retrigger:retrigger.checked};
    syncEnvelopeInputs(); drawEnvelope(); scheduleEnvelope();
  }
  function endEnvelopeDrag() {
    const id = envelopeDrag?.pointerId; envelopeDrag = null;
    if (id !== undefined && envelopeCanvas.hasPointerCapture?.(id)) envelopeCanvas.releasePointerCapture(id);
  }
  function cancelEnvelope(event) {
    if (event?.pointerId !== undefined && envelopeDrag?.pointerId !== event.pointerId) return;
    endEnvelopeDrag(); envelopePending = null;
    if (envelopeFrame !== null) {win.cancelAnimationFrame(envelopeFrame); envelopeFrame = null;}
    envelopeDraft = {}; syncEnvelopeInputs(); drawEnvelope();
  }
  function envelopePoint(event) {
    const rect = envelopeCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
    return {x:(event.clientX - rect.left) * envelopeCanvas.width / rect.width, y:(event.clientY - rect.top) * envelopeCanvas.height / rect.height};
  }
  function envelopeDown(event, handle) {
    if (!connected || !visible || disposed || doc.hidden || envelopeDrag || event.button !== undefined && event.button !== 0 || event.isPrimary === false) return;
    const origin = envelopePoint(event); if (!origin) return;
    event.preventDefault(); // Keep a sounding PC-keyboard note's focus.
    const point = ps1EnvelopeGeometry(envelope(), envelopeCanvas.width, envelopeCanvas.height).handles.find(value => value.id === handle);
    envelopeDrag = {handle, pointerId:event.pointerId, channel:selected, epoch, origin, point};
    try {envelopeCanvas.setPointerCapture(event.pointerId);} catch {}
  }
  function envelopeMove(event) {
    if (!envelopeDrag || event.pointerId !== envelopeDrag.pointerId) return;
    if (!connected || !visible || disposed || doc.hidden || envelopeDrag.channel !== selected || envelopeDrag.epoch !== epoch) {cancelEnvelope(); return;}
    const point = envelopePoint(event); if (!point) return;
    event.preventDefault();
    queueEnvelope(ps1EnvelopePointPatch(envelope(), envelopeDrag.handle,
      envelopeDrag.point.x + point.x - envelopeDrag.origin.x, envelopeDrag.point.y + point.y - envelopeDrag.origin.y,
      envelopeCanvas.width, envelopeCanvas.height));
  }
  function envelopeKey(event, handle) {
    if (!connected || !visible || disposed || doc.hidden || event.ctrlKey || event.metaKey || event.altKey) return;
    const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key), vertical = ['ArrowUp', 'ArrowDown'].includes(event.key);
    if (!horizontal && !(vertical && handle === 'decay')) return;
    event.preventDefault(); event.stopPropagation();
    const value = envelope(), point = ps1EnvelopeGeometry(value).handles.find(entry => entry.id === handle);
    const key = vertical ? 'sustainLevel' : point.key, max = vertical ? 15 : point.max;
    queueEnvelope({[key]:Math.max(0, Math.min(max, value[key] + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1)))});
  }
  listen(envelopeCanvas, 'pointermove', envelopeMove);
  listen(envelopeCanvas, 'pointerup', event => {if (!envelopeDrag || event.pointerId !== envelopeDrag.pointerId) return; envelopeMove(event); endEnvelopeDrag(); flushEnvelope();});
  listen(envelopeCanvas, 'pointercancel', cancelEnvelope); listen(envelopeCanvas, 'lostpointercapture', cancelEnvelope);
  function drawEnvelope() {
    const value = envelope();
    // The retained core has 108 linear/negative-exponential rates and 100
    // positive-exponential rates. Out-of-table codes return a zero increment.
    const geometry = ps1EnvelopeGeometry(value, envelopeCanvas.width, envelopeCanvas.height);
    const {attackStopped, sustainHeld, level, endLevel, handles, y, bottom} = geometry, peak = 1;
    envelopeInfo.textContent = `A ${value.attackRate}${attackStopped ? ' (stopped at zero)' : ''} · D ${value.decayRate} · SL ${value.sustainLevel} · S ${value.sustainRate}${sustainHeld ? ' (hold)' : value.sustainDecrease ? ' ↓' : ' ↑'} · R ${value.releaseRate}${value.releaseRate >= 27 ? ' (infinite)' : ''} · illustrative stage widths`;
    for (const point of handles) {
      const node = envelopeHandles[point.id]; node.style.left = `${point.x / envelopeCanvas.width * 100}%`; node.style.top = `${point.y / envelopeCanvas.height * 100}%`; node.disabled = !connected;
      const label = `Voice ${selected + 1} · ${point.id} rate ${value[point.key]}${point.id === 'decay' ? ` · sustain level ${value.sustainLevel}` : ''}`;
      node.setAttribute('aria-label', label); node.title = label;
    }
    if (!visible) return; const ctx = envelopeCanvas.getContext?.('2d'); if (!ctx) return;
    const w = envelopeCanvas.width, h = envelopeCanvas.height;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#101820'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#34444e'; ctx.lineWidth = 1;
    for (const gain of [0, .5, 1]) {ctx.beginPath(); ctx.moveTo(12, y(gain)); ctx.lineTo(w - 12, y(gain)); ctx.stroke();}
    const xs = [20, ...handles.map(point => point.x)]; ctx.strokeStyle = '#7bbcf7'; ctx.lineWidth = 3; ctx.setLineDash?.(attackStopped ? [5, 5] : []); ctx.beginPath(); ctx.moveTo(xs[0], y(0));
    if (value.attackExponential) ctx.quadraticCurveTo(xs[0] + 12, y(.95 * peak), xs[1], y(peak)); else ctx.lineTo(xs[1], y(peak));
    ctx.quadraticCurveTo(xs[1] + 12, y(level), xs[2], y(level));
    if (sustainHeld) ctx.lineTo(xs[3], y(level)); else if (value.sustainExponential) ctx.quadraticCurveTo(xs[2] + 12, y(endLevel), xs[3], y(endLevel)); else ctx.lineTo(xs[3], y(endLevel));
    if (value.releaseRate >= 27) ctx.lineTo(xs[4], y(endLevel)); else if (value.releaseExponential) ctx.quadraticCurveTo(xs[3] + 15, y(0), xs[4], y(0)); else ctx.lineTo(xs[4], y(0));
    ctx.stroke(); ctx.setLineDash?.([]);
    if (attackStopped) {ctx.strokeStyle = '#7bbcf7'; ctx.beginPath(); ctx.moveTo(20, bottom); ctx.lineTo(w - 12, bottom); ctx.stroke();}
    ctx.fillStyle = '#b5c2cc'; ctx.font = '13px sans-serif'; for (const [index, name] of ['Attack', 'Decay', 'Sustain', 'Release'].entries()) ctx.fillText(name, (xs[index] + xs[index + 1]) / 2 - 20, h - 10);
  }
  function update(next) {
    if (disposed || !next) return; state = next; const v = voice(), samples = state.samples ?? [];
    if (!envelopeDrag && !envelopePending && !envelopeInFlight) envelopeDraft = {};
    if (waveDrag && waveDrag.identity !== waveIdentity()) cancelWave();
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
    const options = [['', 'Unassigned'], ...samples.filter(entry => entry.editorChannel === undefined || entry.editorChannel === selected).map(entry => [String(entry.id), `Sample ${entry.id} · ${entry.decodedFrames} samples${entry.editorChannel === selected ? ' · editable PCM' : ''}`])], signature = JSON.stringify(options);
    if (signature !== sampleSignature) {sampleSignature = signature; sample.replaceChildren(...options.map(([value, text]) => {const node = make('option', '', text); node.value = value; return node;}));}
    set(sample, v.sample); set(pitch, v.pitch); set(volumeLeft, v.volumeLeft); set(volumeRight, v.volumeRight); set(adsr1, v.adsr1); set(adsr2, v.adsr2); gate.textContent = v.gate ? 'On' : 'Off';
    syncEnvelopeInputs();
    checked(reverbSend, v.reverb); set(reverbPreset, state.reverb?.preset ?? 'off'); set(reverbLeft, state.reverb?.volumeLeft ?? .25); set(reverbRight, state.reverb?.volumeRight ?? .25);
    const entry = samples.find(value => value.id === v.sample); metadata.textContent = entry ? `${entry.byteLength} ADPCM bytes · RAM ${entry.startAddress} · Root ${Number(entry.rootFrequencyHz).toFixed(3)} Hz · Base PITCH ${entry.basePitch} · ${entry.loop ? 'Loop' : 'One shot'}` : 'No ADPCM sample is assigned to this voice.';
    code.textContent = ps1VoiceCode(state, selected);
    drawEnvelope(); drawWave();
  }
  function setConnected(value) {if (disposed) return; const next = Boolean(value); if (!next) {releaseAll(); cancelWave(); cancelEnvelope(); if (keyboardActive) onKeyboardTargetChange(null); keyboardActive = false; targetEpoch++; envelopeDraft = {}; keyboard.setAttribute('aria-pressed', 'false');} if (next !== connected) epoch++; connected = next; instrument.disabled = !next; for (const node of buttons) node.disabled = !next; drawEnvelope(); drawWave();}
  updateTarget();
  return {update, setConnected, releaseAll, getSelectedChannel:() => selected, getNoteTarget:() => target,
    setVisible(value) {visible = Boolean(value); if (!visible) {releaseSource('hold'); releaseSource('preview'); releaseSource('sustain'); cancelWave(); cancelEnvelope();} else {waveSignature = ''; drawEnvelope(); drawWave();}},
    setKeyboardActive(value) {if (!value && keyboardActive) {releaseSource('keyboard'); keyboardActive = false; targetEpoch++; keyboard.setAttribute('aria-pressed', 'false');}},
    dispose() {if (disposed) return; setConnected(false); disposed = true; for (const remove of listeners) remove();},
  };
}
