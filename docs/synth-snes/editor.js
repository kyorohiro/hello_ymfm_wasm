// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createDefaultPreset, readPreset, waveShape, envelopeRegisters,
  modulatorEnvelopeRegisters, pmonActive, pmonSampleBytes, sampleBudget, presetBankKey} from './preset.js';
import {decodeBase64, encodeBase64} from './sample.js';
import {decodeBrr} from '../js/snes_brr.js';

/** Passive sound editor: drawing and file conversion do not open an audio device. */
export function createEditor({root, onChange = () => {}, onError = () => {},
  onLoadAudio = async () => {throw new Error('Audio loading is not connected');},
  onLoadBrr = async () => {throw new Error('BRR loading is not connected');}}) {
  const doc = root.ownerDocument, win = doc.defaultView ?? globalThis;
  const cleanups = [], fields = new Map(), pointerControls = new WeakSet();
  let preset = createDefaultPreset(), disposed = false, stroke = null, waveTarget = 'carrier';
  let importRate = 16000, loadRequest = 0, loadController = null, committingImport = false;
  const previews = new Map();let previewBins = null;
  const make = (tag, className, text) => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const listen = (element, type, listener, options) => {
    element.addEventListener(type, listener, options);
    cleanups.push(() => element.removeEventListener(type, listener, options));
  };
  const report = error => { if (!disposed) onError(error); };
  function commit(mutator) {
    if (disposed) return;
    try {
      cancelLoad('Conversion cancelled after editing the instrument. Current sample kept.');
      const next = readPreset(preset); mutator(next);
      const checked = readPreset(next);
      if (checked.source !== preset.source || checked.pmon.enabled !== preset.pmon.enabled ||
        presetBankKey(checked) !== presetBankKey(preset)) cancelStroke();
      preset = checked; render();
      Promise.resolve(onChange(readPreset(preset))).catch(report);
    } catch (error) { render(); report(error); }
  }
  function performanceFocus(input) {
    listen(input, 'pointerdown', () => pointerControls.add(input));
    listen(input, 'keydown', event => {
      pointerControls.delete(input);
      if (event.key === 'Enter' || event.key === 'Escape') {
        // Native select navigation is allowed to finish before returning to keys.
        queueMicrotask(() => input.blur());
      }
    });
    listen(input, 'change', () => {
      if (pointerControls.has(input)) {
        pointerControls.delete(input); queueMicrotask(() => input.blur());
      }
    });
    listen(input, 'blur', () => pointerControls.delete(input));
  }
  function field(parent, label, id) {
    const row = make('label', 'sdsp-field'); row.htmlFor = id;
    row.append(make('span', '', label)); parent.append(row); return row;
  }
  function select(parent, label, id, choices, get, set, {local = false} = {}) {
    const row = make('div', 'sdsp-field sdsp-choice-field'), title = make('span', '', label);
    title.id = `${id}Label`; row.dataset.choice = id; row.append(title); parent.append(row);
    const group = make('div', 'sdsp-choice-group'); group.id = id;
    group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-labelledby', title.id); row.append(group);
    let disabled = false;
    const buttons = choices.map(([value, text]) => {
      const button = make('button', 'sdsp-choice', text); button.type = 'button';
      button.dataset.choiceFor = id; button.dataset.choiceValue = String(value); button.dataset.value = String(value);
      button.setAttribute('role', 'radio');
      listen(button, 'pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); doc.activeElement?.blur();
      });
      listen(button, 'click', () => choose(String(value)));
      group.append(button); return button;
    });
    function refresh() {
      const selected = String(get(preset));
      group.setAttribute('aria-disabled', String(disabled));
      for (const button of buttons) {
        const checked = button.dataset.choiceValue === selected;
        button.setAttribute('aria-checked', String(checked)); button.disabled = disabled;
        button.tabIndex = checked && !disabled ? 0 : -1;
      }
    }
    function choose(value, focus = false) {
      if (disabled) return;
      if (value !== String(get(preset))) {
        if (local) {set(preset, value);render();}
        else commit(preset => set(preset, value));
      }
      if (focus) buttons.find(button => button.dataset.choiceValue === value)?.focus();
    }
    listen(group, 'keydown', event => {
      if (disabled) return;
      const current = Math.max(0, buttons.findIndex(button => button.dataset.choiceValue === String(get(preset))));
      let index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (current + 1) % buttons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') index = (current + buttons.length - 1) % buttons.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = buttons.length - 1;
      else return;
      event.preventDefault(); event.stopPropagation(); choose(buttons[index].dataset.choiceValue, true);
    });
    fields.set(id, {input: group, get, update: refresh});
    return {setDisabled(value) {disabled = value;refresh();}};
  }
  function number(parent, label, id, min, max, get, set, step = 1, {fractional = false} = {}) {
    const row = make('div', 'sdsp-field'), title = make('span', '', label);
    title.id = `${id}Label`; row.append(title); parent.append(row);
    const group = make('div', 'sdsp-stepper'); group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', title.id); row.append(group);
    const minus = make('button', 'sdsp-stepper-button', '−'), plus = make('button', 'sdsp-stepper-button', '+');
    const output = make('output', 'sdsp-stepper-value'); output.id = id;
    output.tabIndex = 0; output.setAttribute('role', 'spinbutton');
    output.setAttribute('aria-labelledby', title.id); output.setAttribute('aria-valuemin', String(min)); output.setAttribute('aria-valuemax', String(typeof max === 'function' ? max(preset) : max));
    output.title = 'Drag left or right, or use the arrow keys.';
    let disabled = false, drag = null;
    for (const [button, delta, verb] of [[minus, -1, 'Decrease'], [plus, 1, 'Increase']]) {
      button.type = 'button'; button.dataset.stepperFor = id; button.dataset.stepperDelta = String(delta);
      button.setAttribute('aria-label', `${verb} ${label}`);
      listen(button, 'pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault(); doc.activeElement?.blur();
      });
      listen(button, 'click', () => adjust(get(preset) + delta * step));
    }
    group.append(minus, output, plus);
    function refresh() {
      const value = get(preset), shown = fractional ? value.toLocaleString('en-US', {useGrouping:false, maximumFractionDigits:3}) : String(value);
      output.setAttribute('aria-valuemax', String(typeof max === 'function' ? max(preset) : max));
      output.textContent = fractional && Number(shown) !== value ? `≈${shown}` : shown;
      output.title = `${value} · Drag left or right, or use the arrow keys.`;
      output.setAttribute('aria-valuenow', String(value)); output.setAttribute('aria-disabled', String(disabled));
      group.setAttribute('aria-disabled', String(disabled));
      output.tabIndex = disabled ? -1 : 0;
      minus.disabled = disabled || value <= min; plus.disabled = disabled || value >= (typeof max === 'function' ? max(preset) : max);
    }
    function adjust(value) {
      if (disabled) return;
      const next = Math.max(min, Math.min(typeof max === 'function' ? max(preset) : max, fractional ? value : Math.round(value / step) * step));
      if (next !== get(preset)) commit(value => set(value, next));
    }
    listen(group, 'keydown', event => {
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = get(preset) + step;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = get(preset) - step;
      else if (event.key === 'PageUp') next = get(preset) + step * 10;
      else if (event.key === 'PageDown') next = get(preset) - step * 10;
      else if (event.key === 'Home') next = min;
      else if (event.key === 'End') next = typeof max === 'function' ? max(preset) : max;
      else return;
      event.preventDefault(); event.stopPropagation(); adjust(next);
    });
    listen(output, 'pointerdown', event => {
      if (disabled || event.button !== 0) return;
      event.preventDefault(); doc.activeElement?.blur();
      drag = {id: event.pointerId, x: event.clientX, value: get(preset)};
      output.setPointerCapture(event.pointerId); output.classList.add('is-dragging');
    });
    listen(output, 'pointermove', event => {
      if (drag?.id === event.pointerId) adjust(drag.value + Math.round((event.clientX - drag.x) / 8) * step);
    });
    function endDrag(event) {
      if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.id) return;
      const pointer = drag.id; drag = null; output.classList.remove('is-dragging');
      if (output.hasPointerCapture?.(pointer)) output.releasePointerCapture(pointer);
    }
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(output, type, endDrag);
    listen(win, 'blur', endDrag);
    fields.set(id, {input: output, get, update: refresh});
    return {setDisabled(value) {disabled = value;if(disabled) endDrag();refresh();}};
  }
  function checkbox(parent, label, id, get, set) {
    const row = field(parent, label, id); row.classList.add('sdsp-check');
    const input = make('input'); input.type = 'checkbox'; input.id = id; row.prepend(input);
    fields.set(id, {input, get});
    listen(input, 'change', () => commit(value => set(value, input.checked)));
    performanceFocus(input); return input;
  }
  function card(title, id) {
    const element = make('details', 'sdsp-card'); element.open = true;
    if (id) element.id = id;
    const summary = make('summary', '', title), content = make('div', 'sdsp-card-content');
    element.append(summary, content); body.append(element);
    return {element, content};
  }
  function section(parent, title) {
    const element = make('div', 'sdsp-subsection'); element.append(make('h4', '', title)); parent.append(element); return element;
  }
  function group(parent) { const element = make('div', 'sdsp-fields'); parent.append(element); return element; }
  function help(parent, text) { const element = make('p', 'sdsp-help', text); parent.append(element); return element; }
  const body = make('div', 'sdsp-editor'); root.append(body);
  const sourceBar = make('div', 'sdsp-source-bar'); body.append(sourceBar);
  select(sourceBar, 'Sound source', 'source', [['wave', 'Drawn wave'], ['brr', 'BRR sample'], ['noise', 'Noise']],
    value => value.source, (value, source) => {value.source = source;});
  const sourceHint = make('p'); sourceBar.append(sourceHint);

  const levelCard = card('Voice level · signed hardware gain', 'levelSection'), levels = group(levelCard.content);
  number(levels, 'Left · −128 to 127', 'volumeLeft', -128, 127, value => value.volume.left, (value, left) => {value.volume.left = left;});
  number(levels, 'Right · −128 to 127', 'volumeRight', -128, 127, value => value.volume.right, (value, right) => {value.volume.right = right;});
  help(levelCard.content, 'Signed S-DSP gains: a negative value inverts that output. The initial level leaves headroom for eight notes. Master controls the final output separately.');

  const noiseCard = card('S-DSP Noise', 'noiseSection'); noiseCard.element.hidden = true;
  const noiseFields = group(noiseCard.content); noiseFields.classList.add('sdsp-noise-fields');
  number(noiseFields, 'Noise clock · code 0–31', 'noiseClock', 0, 31,
    value => value.noise.clock, (value, clock) => {value.noise.clock = clock;});
  const noiseHint = help(noiseCard.content, ''); noiseHint.id = 'noiseHint';
  help(noiseCard.content, 'One hardware Noise generator is shared by all eight voice envelopes. Keys trigger ADSR / GAIN; note names, Octave and Pitch do not tune Noise. Change Noise clock while holding a key to change its texture.');

  const sampleCard = card('Sample · software preparation / BRR playback', 'sampleSection');
  const actions = make('div', 'sdsp-file-actions'); sampleCard.content.append(actions);
  const loadAudio = make('button', '', 'Load audio…'); loadAudio.id = 'loadAudio'; loadAudio.type = 'button';
  const audioFileInput = make('input', 'file-input'); audioFileInput.id = 'audioFileInput'; audioFileInput.type = 'file'; audioFileInput.accept = 'audio/*,.wav';
  audioFileInput.setAttribute('aria-label', 'Choose audio to convert to BRR');
  const loadBrr = make('button', '', 'Load BRR…'); loadBrr.id = 'loadBrr'; loadBrr.type = 'button';
  const brrFileInput = make('input', 'file-input'); brrFileInput.id = 'brrFileInput'; brrFileInput.type = 'file'; brrFileInput.accept = '.brr,application/octet-stream';
  brrFileInput.setAttribute('aria-label', 'Choose raw BRR sample');
  const cancelImport = make('button', '', 'Cancel conversion'); cancelImport.id = 'cancelImport'; cancelImport.type = 'button'; cancelImport.hidden = true;
  actions.append(loadAudio, audioFileInput, loadBrr, brrFileInput, cancelImport);
  const importStatus = make('p', 'sdsp-help', 'Load audio or raw BRR to prepare a sample.'); importStatus.id = 'importStatus';
  importStatus.setAttribute('role', 'status'); importStatus.setAttribute('aria-live', 'polite'); sampleCard.content.append(importStatus);
  const conversionFields = group(sampleCard.content);
  const conversionRate = select(conversionFields, 'Convert audio at · Hz', 'conversionRate',
    [[8000, '8,000'], [16000, '16,000'], [32000, '32,000']], () => importRate,
    (_value, rate) => {importRate = Number(rate);}, {local:true});
  const sampleBudgetInfo = help(sampleCard.content, ''); sampleBudgetInfo.id = 'sampleBudget';
  const targetFields = group(sampleCard.content); targetFields.classList.add('sdsp-wave-target');
  select(targetFields, 'Edit / preview · one shared canvas', 'waveTarget', [['carrier','Carrier'],['modulator','Modulator']],
    () => selectedTarget(), (_value, target) => {
      cancelStroke();cancelLoad('Import cancelled after changing the edit target. Current samples kept.');waveTarget = target;
    }, {local:true});
  const modSourceFields = group(sampleCard.content); modSourceFields.classList.add('sdsp-modulator-source');
  const pmonSource = select(modSourceFields, 'Modulator source', 'pmonSource', [['wave','Drawn wave'],['brr','BRR sample']],
    value => value.pmon.source, (value, source) => {value.pmon.source = source;});
  const sampleInfo = make('p', 'sdsp-sample-info'); sampleInfo.id = 'sampleInfo'; sampleCard.content.append(sampleInfo);
  const shapeActions = make('div', 'sdsp-wave-actions'); sampleCard.content.append(shapeActions);
  for (const [name, label] of [['sine','Sine'],['triangle','Triangle'],['saw','Saw'],['square','Square']]) {
    const button = make('button', '', label); button.type = 'button'; button.dataset.waveShape = name; shapeActions.append(button);
    listen(button, 'pointerdown', event => {if (event.button === 0) {event.preventDefault();doc.activeElement?.blur();}});
    listen(button, 'click', () => {
      const target = editableTarget();if (!target) return;
      cancelStroke();commit(value => {if (target === 'modulator') value.pmon.wave = waveShape(name);else value.wave = waveShape(name);});
    });
  }
  const canvas = make('canvas'); canvas.id = 'waveCanvas'; canvas.width = 900; canvas.height = 210; canvas.setAttribute('role', 'img');
  sampleCard.content.append(canvas);
  const waveReadout = make('p', 'sdsp-wave-readout'); waveReadout.id = 'waveReadout'; waveReadout.setAttribute('aria-live', 'polite'); sampleCard.content.append(waveReadout);
  const drawingHint = help(sampleCard.content, 'Draw one 128-point cycle here. Releasing a stroke or choosing a shape prepares a new BRR loop and stops held notes. Drawing / encoding are software tools; the output monitor shows the S-DSP result after BRR decoding and Gaussian interpolation.');

  const tuning = section(sampleCard.content, 'BRR reference pitch & loop'), tuningFields = group(tuning);
  number(tuningFields, 'Root MIDI note', 'rootNote', 0, 127, value => value.brr.rootNote, (value, note) => {value.brr.rootNote = note;});
  number(tuningFields, 'PITCH at Root', 'basePitch', 1, 16383, value => value.brr.basePitch, (value, pitch) => {value.brr.basePitch = pitch;});
  const loopBrr = checkbox(tuningFields, 'Loop sample', 'loopBrr', value => value.brr.loopStartSamples !== null, (value, enabled) => {
    if (!value.brr.data) return;
    const data = Uint8Array.from(decodeBase64(value.brr.data)), last = data.length - 9;
    data[last] = enabled ? data[last] | 2 : data[last] & ~2;
    value.brr.data = encodeBase64(data); value.brr.loopStartSamples = enabled ? 0 : null;
  });
  const loopStart = number(tuningFields, 'Loop start · sample frame', 'loopStartSamples', 0,
    () => preset.source === 'noise' ? 0 : Math.max(0, decodedSample().pcm.length - 16),
    value => value.brr.loopStartSamples ?? 0, (value, frame) => {value.brr.loopStartSamples = frame;}, 16);
  help(tuning, 'BRR contains no original sample rate, musical root or loop address. Root / PITCH are your declared tuning. PITCH 4096 reads 32,000 source frames per second. Loop start uses decoded sample frames in blocks of 16; raw BRR loops initially use frame 0 unless you set another position.');
  const pmonTuning = section(sampleCard.content, 'Modulator BRR reference pitch & loop'), pmonTuningFields = group(pmonTuning);
  number(pmonTuningFields, 'Modulator Root MIDI note', 'pmonRootNote', 0, 127,
    value => value.pmon.brr.rootNote, (value, note) => {value.pmon.brr.rootNote = note;});
  number(pmonTuningFields, 'Modulator PITCH at Root', 'pmonBasePitch', 1, 16383,
    value => value.pmon.brr.basePitch, (value, pitch) => {value.pmon.brr.basePitch = pitch;});
  const pmonLoopBrr = checkbox(pmonTuningFields, 'Loop modulator sample', 'pmonLoopBrr', value => value.pmon.brr.loopStartSamples !== null, (value, enabled) => {
    if (!value.pmon.brr.data) return;
    const data = Uint8Array.from(decodeBase64(value.pmon.brr.data)), last = data.length - 9;
    data[last] = enabled ? data[last] | 2 : data[last] & ~2;
    value.pmon.brr.data = encodeBase64(data);value.pmon.brr.loopStartSamples = enabled ? 0 : null;
  });
  const pmonLoopStart = number(pmonTuningFields, 'Modulator Loop start · frame', 'pmonLoopStartSamples', 0,
    () => preset.source === 'noise' ? 0 : Math.max(0, decodedSample('modulator').pcm.length - 16),
    value => value.pmon.brr.loopStartSamples ?? 0, (value, frame) => {value.pmon.brr.loopStartSamples = frame;}, 16);
  help(pmonTuning, 'Modulator BRR has its own declared Root / base PITCH and loop. Ratio multiplies that playback speed after keyboard transposition; it does not infer the sample’s original fundamental. Loop edits stop notes / Echo tails; tuning changes apply while playing.');

  const echoCard = card('S-DSP Echo', 'echoSection');
  const echoSwitches = group(echoCard.content); echoSwitches.classList.add('sdsp-echo-switches');
  checkbox(echoSwitches, 'Enable Echo', 'echoEnabled', value => value.echo.enabled,
    (value, enabled) => {value.echo.enabled = enabled;});
  checkbox(echoSwitches, 'Send all notes', 'echoSend', value => value.echo.send,
    (value, enabled) => {value.echo.send = enabled;});
  const echoFields = group(echoCard.content); echoFields.classList.add('sdsp-echo-controls');
  number(echoFields, 'Delay · code 0–15', 'echoDelay', 0, 15, value => value.echo.delay,
    (value, delay) => {value.echo.delay = delay;});
  number(echoFields, 'Feedback · −128 to 127', 'echoFeedback', -128, 127, value => value.echo.feedback,
    (value, feedback) => {value.echo.feedback = feedback;});
  number(echoFields, 'Return left · −128 to 127', 'echoVolumeLeft', -128, 127, value => value.echo.volumeLeft,
    (value, volume) => {value.echo.volumeLeft = volume;});
  number(echoFields, 'Return right · −128 to 127', 'echoVolumeRight', -128, 127, value => value.echo.volumeRight,
    (value, volume) => {value.echo.volumeRight = volume;});
  const echoDelayInfo = help(echoCard.content, ''); echoDelayInfo.id = 'echoDelayInfo';
  const echoHint = help(echoCard.content, ''); echoHint.id = 'echoHint';
  help(echoCard.content, 'One hardware Echo circuit is shared by all eight voices. On / Off stops held notes and clears the previous Echo tail. Delay, Feedback, Return and FIR changes apply while playing. Signed Return or Feedback values can invert polarity.');
  const firDetails = make('details', 'sdsp-fir-details'); firDetails.id = 'firSection';
  firDetails.append(make('summary', '', 'FIR · Echo tone'));
  const firContent = make('div', 'sdsp-fir-content'); firDetails.append(firContent); echoCard.content.append(firDetails);
  const firFields = group(firContent); firFields.classList.add('sdsp-fir-fields');
  for (let index = 0; index < 8; index++) {
    number(firFields, `Tap ${index} · −128 to 127`, 'echoFir' + index, -128, 127,
      value => value.echo.fir[index], (value, coefficient) => {value.echo.fir[index] = coefficient;});
  }
  const resetFir = make('button', '', 'Identity FIR'); resetFir.id = 'resetEchoFir'; resetFir.type = 'button';
  const firActions = make('div', 'sdsp-file-actions'); firActions.append(resetFir); firContent.append(firActions);
  listen(resetFir, 'pointerdown', event => {if (event.button === 0) {event.preventDefault();doc.activeElement?.blur();}});
  listen(resetFir, 'click', () => {resetFir.blur();commit(value => {value.echo.fir = [127,0,0,0,0,0,0,0];});});
  help(firContent, 'These eight signed hardware coefficients shape only the Echo signal, including its feedback. They do not filter the dry voice. Identity FIR uses 127 followed by seven zeros. Large coefficients or feedback can distort or sustain the Echo.');

  const pmonCard = card('Pitch Modulation · S-DSP hardware', 'pmonSection'); pmonCard.element.open = false;
  const pmonSwitches = group(pmonCard.content); pmonSwitches.classList.add('sdsp-pmon-switches');
  const pmonEnabled = checkbox(pmonSwitches, 'Enable Pitch Modulation', 'pmonEnabled', value => value.pmon.enabled,
    (value, enabled) => {value.pmon.enabled = enabled;});
  const pmonRatio = number(pmonSwitches, 'Modulator ratio · × key note', 'pmonRatio', .125, 8,
    value => value.pmon.ratio, (value, ratio) => {value.pmon.ratio = ratio;}, .125, {fractional:true});
  const pmonHint = help(pmonCard.content, ''); pmonHint.id = 'pmonHint';
  help(pmonCard.content, 'Hardware PMON uses adjacent pairs: CH1 → CH2, CH3 → CH4, CH5 → CH6 and CH7 → CH8, for four keyboard notes. The modulator has no stereo output; only its carrier is sent to Echo. Its hardware envelope / GAIN controls modulation depth.');
  help(pmonCard.content, 'Choose Modulator in the Sample section to draw a wave or load audio / BRR using the same canvas as the carrier. For Drawn wave, Ratio multiplies keyboard-note frequency including Pitch. For BRR, it multiplies that sample’s declared Root / base PITCH playback speed; its original fundamental is not inferred. Each voice’s PITCH is clamped to 1–16,383. Drawing, ratio and pair allocation are software controls for the hardware. On / Off, source, sample, loop or Echo-enable changes stop notes / tails; Ratio, tuning and envelope apply while playing.');
  const pmonEnvelopeFields = group(pmonCard.content); pmonEnvelopeFields.classList.add('sdsp-pmon-envelope');
  const pmonEnvelopeMode = select(pmonEnvelopeFields, 'Modulator envelope', 'pmonEnvelopeMode', [['adsr','ADSR'],['gain','GAIN']],
    value => value.pmon.envelope.mode, (value, mode) => {value.pmon.envelope.mode = mode;});
  const pmonAdsrFields = group(pmonCard.content);
  const pmonAdsrControls = [
    number(pmonAdsrFields, 'Attack · code 0–15', 'pmonAttack', 0, 15, value => value.pmon.envelope.attack, (value, code) => {value.pmon.envelope.attack = code;}),
    number(pmonAdsrFields, 'Decay · code 0–7', 'pmonDecay', 0, 7, value => value.pmon.envelope.decay, (value, code) => {value.pmon.envelope.decay = code;}),
    number(pmonAdsrFields, 'Sustain level · code 0–7', 'pmonSustainLevel', 0, 7, value => value.pmon.envelope.sustainLevel, (value, code) => {value.pmon.envelope.sustainLevel = code;}),
    number(pmonAdsrFields, 'Sustain rate · code 0–31', 'pmonSustainRate', 0, 31, value => value.pmon.envelope.sustainRate, (value, code) => {value.pmon.envelope.sustainRate = code;}),
  ];
  const pmonGainFields = group(pmonCard.content);
  const pmonGainMode = select(pmonGainFields, 'Modulator GAIN shape', 'pmonGainMode', [
    ['direct','Direct level'],['linear-decrease','Linear decrease'],['exponential-decrease','Exponential decrease'],
    ['linear-increase','Linear increase'],['bent-increase','Bent increase'],
  ], value => value.pmon.envelope.gainMode, (value, mode) => {value.pmon.envelope.gainMode = mode;});
  const pmonGainLevel = number(pmonGainFields, 'Depth · Direct GAIN 0–127', 'pmonGainLevel', 0, 127,
    value => value.pmon.envelope.gainLevel, (value, level) => {value.pmon.envelope.gainLevel = level;});
  const pmonGainRate = number(pmonGainFields, 'GAIN rate · code 0–31', 'pmonGainRate', 0, 31,
    value => value.pmon.envelope.gainRate, (value, rate) => {value.pmon.envelope.gainRate = rate;});
  const pmonGainHint = help(pmonCard.content, ''); pmonGainHint.id = 'pmonGainHint';
  const pmonRegisterInfo = help(pmonCard.content, ''); pmonRegisterInfo.id = 'pmonEnvelopeRegisters';

  const envelopeCard = card('Envelope · S-DSP hardware', 'envelopeSection'), envelopeFields = group(envelopeCard.content);
  select(envelopeFields, 'Envelope mode', 'envelopeMode', [['adsr','ADSR'],['gain','GAIN']], value => value.envelope.mode, (value, mode) => {value.envelope.mode = mode;});
  const adsrFields = group(envelopeCard.content);
  const adsrControls = [
    number(adsrFields, 'Attack · code 0–15', 'attack', 0, 15, value => value.envelope.attack, (value, code) => {value.envelope.attack = code;}),
    number(adsrFields, 'Decay · code 0–7', 'decay', 0, 7, value => value.envelope.decay, (value, code) => {value.envelope.decay = code;}),
    number(adsrFields, 'Sustain level · code 0–7', 'sustainLevel', 0, 7, value => value.envelope.sustainLevel, (value, code) => {value.envelope.sustainLevel = code;}),
    number(adsrFields, 'Sustain rate · code 0–31', 'sustainRate', 0, 31, value => value.envelope.sustainRate, (value, code) => {value.envelope.sustainRate = code;}),
  ];
  const gainFields = group(envelopeCard.content);
  const gainMode = select(gainFields, 'GAIN shape', 'gainMode', [
    ['direct','Direct level'],['linear-decrease','Linear decrease'],['exponential-decrease','Exponential decrease'],
    ['linear-increase','Linear increase'],['bent-increase','Bent increase'],
  ], value => value.envelope.gainMode, (value, mode) => {value.envelope.gainMode = mode;});
  const gainLevel = number(gainFields, 'Direct level · 0–127', 'gainLevel', 0, 127, value => value.envelope.gainLevel, (value, level) => {value.envelope.gainLevel = level;});
  const gainRate = number(gainFields, 'GAIN rate · code 0–31', 'gainRate', 0, 31, value => value.envelope.gainRate, (value, rate) => {value.envelope.gainRate = rate;});
  const gainHint = help(envelopeCard.content, ''); gainHint.id = 'gainHint';
  const registerInfo = help(envelopeCard.content, ''); registerInfo.id = 'envelopeRegisters';
  help(envelopeCard.content, 'ADSR and GAIN are S-DSP hardware envelope modes. These are register codes, not milliseconds. Key release uses the fixed hardware KOFF slope; changing the envelope settings applies to held voices.');

  function setLoadStatus(message, error = false) {importStatus.textContent = message;importStatus.dataset.error = String(error);}
  function cancelLoad(message) {
    if (!loadController) return;
    loadRequest++;loadController.abort();loadController = null;
    cancelImport.hidden = true;conversionRate.setDisabled(false);
    if (message) setLoadStatus(message);
  }
  async function importFile(kind, file, target = selectedTarget()) {
    if (target !== selectedTarget()) {setLoadStatus('File selection cancelled after changing the edit target. Current samples kept.');return;}
    cancelLoad();const token = ++loadRequest, controller = new AbortController();loadController = controller;committingImport = false;
    cancelImport.hidden = false;conversionRate.setDisabled(true);
    setLoadStatus('Preparing ' + target + ' · ' + file.name + '…');
    try {
      const callback = kind === 'audio' ? onLoadAudio : onLoadBrr;
      const message = await callback(file, {target, sampleRate:importRate, signal:controller.signal, onCommit() {
        if (disposed || token !== loadRequest || controller.signal.aborted) return;
        loadController = null;committingImport = true;cancelImport.hidden = true;setLoadStatus('Applying ' + target + ' · ' + file.name + '…');
      }});
      if (disposed || token !== loadRequest || controller.signal.aborted) return;
      setLoadStatus(typeof message === 'string' ? message : 'BRR ready · play the keyboard.');
    } catch (error) {
      if (disposed || token !== loadRequest) return;
      if (error?.name === 'AbortError') setLoadStatus('Import cancelled. Current sample kept.');
      else {setLoadStatus('Import failed: ' + (error?.message ?? String(error)) + ' Current sample kept.', true);report(error);}
    } finally {
      if (token === loadRequest) {loadController = null;committingImport = false;cancelImport.hidden = true;conversionRate.setDisabled(false);}
    }
  }
  for (const [button,input,kind] of [[loadAudio,audioFileInput,'audio'],[loadBrr,brrFileInput,'brr']]) {
    let requestedTarget = null, requestedBank = null;
    listen(button, 'click', () => {button.blur();cancelStroke();requestedTarget = selectedTarget();requestedBank=presetBankKey(preset);input.click();});
    listen(input, 'cancel', () => {requestedTarget = requestedBank = null;input.blur();if (!loadController && !committingImport) setLoadStatus('File selection cancelled. Current samples kept.');});
    listen(input, 'change', () => {
      const file=input.files?.[0],target=requestedTarget ?? selectedTarget(),sameBank=requestedBank===null||requestedBank===presetBankKey(preset);
      requestedTarget=requestedBank=null;input.value='';input.blur();
      if(!sameBank){setLoadStatus('File selection cancelled after changing the instrument. Current samples kept.');return;}
      if (file && !disposed) void importFile(kind,file,target);
    });
  }
  listen(cancelImport, 'click', () => {cancelImport.blur();cancelLoad('Import cancelled. Current sample kept.');});

  function decodedSample(target = 'carrier') {
    const data = (target === 'modulator' ? preset.pmon.brr : preset.brr).data;
    let cached = previews.get(target);
    if (!cached || cached.data !== data) {
      cached = {data, decoded:data ? decodeBrr(decodeBase64(data)) : {pcm:new Float32Array(0),blockCount:0}};
      previews.set(target, cached);
    }
    return cached.decoded;
  }
  function selectedTarget() {return pmonActive(preset) && waveTarget === 'modulator' ? 'modulator' : 'carrier';}
  function editableTarget() {
    if (selectedTarget() === 'modulator') return preset.pmon.source === 'wave' ? 'modulator' : null;
    return preset.source === 'wave' ? 'carrier' : null;
  }
  function targetWave(target = editableTarget()) {return target === 'modulator' ? preset.pmon.wave : preset.wave;}
  function canvasVisible() {
    if (!canvas.isConnected || !canvas.clientWidth || !canvas.clientHeight) return false;
    for (let element = canvas; element; element = element.parentElement) {
      if (element.hidden || element.tagName === 'DETAILS' && !element.open) return false;
    }
    return true;
  }
  function drawWave(samples = stroke?.samples) {
    if (disposed || preset.source === 'noise' || !canvasVisible()) return;
    const target = editableTarget(), displayedTarget = selectedTarget();
    const width = canvas.width, height = canvas.height, left = 28, right = width - 15, top = 16, bottom = height - 28;
    const y = value => top + (1 - value) / 2 * (bottom - top), context = canvas.getContext('2d');if (!context) return;
    context.fillStyle = '#242829';context.fillRect(0,0,width,height);
    context.strokeStyle = '#414849';context.lineWidth = 1;context.fillStyle = '#d7dddd';context.font = '11px sans-serif';
    for (const value of [-1,-.5,0,.5,1]) {
      context.beginPath();context.moveTo(left,y(value));context.lineTo(right,y(value));context.stroke();
      if (value === -1 || value === 0 || value === 1) context.fillText(String(value),3,y(value)+4);
    }
    context.strokeStyle = displayedTarget === 'modulator' ? '#92bfe2' : '#8fd6a1';context.lineWidth = 1.6;context.beginPath();
    if (target) {
      const values = samples ?? targetWave(target);
      for (let index=0;index<values.length;index++) {
        const x = left + (right-left) * index / (values.length-1);
        if (!index) context.moveTo(x,y(values[index]));else context.lineTo(x,y(values[index]));
      }
    } else {
      const pcm = decodedSample(displayedTarget).pcm, bins = Math.min(2048,Math.max(1,Math.floor(right-left)),pcm.length);
      if (pcm.length && pcm.length <= right-left) {
        // Short SPC waves need a connected trace; isolated min/max bins would
        // otherwise shrink to sparse one-pixel dashes between sample points.
        for (let index=0;index<pcm.length;index++) {
          const x=left+(right-left)*index/Math.max(1,pcm.length-1);
          if (!index) context.moveTo(x,y(pcm[index]));else context.lineTo(x,y(pcm[index]));
        }
      } else if (pcm.length) {
        if (!previewBins || previewBins.count !== bins || previewBins.pcm !== pcm) {
          const low=new Float32Array(bins),high=new Float32Array(bins);
          for(let bin=0;bin<bins;bin++) {
            const start=Math.floor(bin*pcm.length/bins),end=Math.floor((bin+1)*pcm.length/bins);let minimum=1,maximum=-1;
            for(let index=start;index<end;index++){minimum=Math.min(minimum,pcm[index]);maximum=Math.max(maximum,pcm[index]);}
            low[bin]=minimum;high[bin]=maximum;
          }
          previewBins={count:bins,pcm,low,high};
        }
        for (let bin=0;bin<bins;bin++) {
          const low=previewBins.low[bin],high=previewBins.high[bin],x=left+(right-left)*(bin+.5)/bins;
          context.moveTo(x,y(low));context.lineTo(x,y(high));
          if(low===high){context.moveTo(x-.5,y(low));context.lineTo(x+.5,y(high));}
        }
      }
      if (!pcm.length) {context.moveTo(left,y(0));context.lineTo(right,y(0));}
    }
    context.stroke();context.fillStyle = '#d7dddd';
    context.fillText(target ? (target === 'modulator' ? 'MODULATOR' : 'CARRIER') + ' · 128-POINT PCM · release to prepare BRR'
      : displayedTarget.toUpperCase() + ' · DECODED BRR · before DSP interpolation and envelope',left,height-8);
  }
  function point(event) {
    const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*canvas.width,y=(event.clientY-rect.top)/rect.height*canvas.height;
    return {index:Math.max(0,Math.min(127,Math.round((x-28)/(canvas.width-43)*127))),
      value:Math.max(-1,Math.min(1,1-2*(y-16)/(canvas.height-44)))};
  }
  function moveStroke(event) {
    if (!stroke || event.pointerId!==stroke.id) return;
    if (!canvasVisible() || editableTarget() !== stroke.target) {cancelStroke();return;}
    const next=point(event),previous=stroke.previous,distance=Math.abs(next.index-previous.index);
    for(let step=0;step<=distance;step++){
      const fraction=distance?step/distance:1,index=Math.round(previous.index+(next.index-previous.index)*fraction);
      stroke.samples[index]=Math.max(-1,Math.min(1,previous.value+(next.value-previous.value)*fraction));
    }
    stroke.previous=next;drawWave(stroke.samples);
    waveReadout.textContent='Sample '+next.index+' · '+next.value.toFixed(3)+' · release to apply';
  }
  listen(canvas,'pointerdown',event=>{
    const target=editableTarget();
    if(event.button!==0||stroke||!target||!canvasVisible())return;
    event.preventDefault();doc.activeElement?.blur();canvas.setPointerCapture(event.pointerId);
    stroke={id:event.pointerId,target,samples:targetWave(target).slice(),previous:point(event)};moveStroke(event);
  });
  listen(canvas,'pointermove',moveStroke);
  listen(canvas,'pointerup',event=>{
    if(!stroke||stroke.id!==event.pointerId)return;
    moveStroke(event);if(!stroke)return;
    const values=stroke.samples,target=stroke.target;stroke=null;
    if(canvas.hasPointerCapture?.(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    commit(value=>{if(target==='modulator')value.pmon.wave=values;else value.wave=values;});
  });
  function cancelStroke(event) {
    if(!stroke||event?.pointerId!==undefined&&event.pointerId!==stroke.id)return;
    const id=stroke.id;stroke=null;
    if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);
    drawWave();waveReadout.textContent='Drawing cancelled · previous wave kept';
  }
  listen(canvas,'pointercancel',cancelStroke);listen(canvas,'lostpointercapture',cancelStroke);listen(win,'blur',cancelStroke);
  listen(sampleCard.element,'toggle',()=>{if(!canvasVisible())cancelStroke();});
  listen(win,'keydown',event=>{if(event.key==='Escape'&&stroke){event.preventDefault();event.stopPropagation();cancelStroke();}});
  function resizeWave() {
    if(disposed)return;
    if(!canvasVisible()){cancelStroke();return;}
    const width=Math.max(240,Math.round(canvas.clientWidth)),height=Math.max(150,Math.round(canvas.clientHeight));
    if(canvas.width!==width||canvas.height!==height){cancelStroke();canvas.width=width;canvas.height=height;}
    drawWave();
  }
  const Resize = win.ResizeObserver ?? globalThis.ResizeObserver;
  if(typeof Resize==='function'){
    const observer=new Resize(resizeWave);observer.observe(canvas);cleanups.push(()=>observer.disconnect());
  }
  listen(win,'resize',()=>{cancelStroke();resizeWave();});
  function render() {
    if(disposed)return;
    for(const field of fields.values()){
      if(field.update){field.update();continue;}
      if(field.input.type==='checkbox')field.input.checked=field.get(preset);
    }
    const isWave=preset.source==='wave',isBrr=preset.source==='brr',isNoise=preset.source==='noise',hasBrr=Boolean(preset.brr.data),isGain=preset.envelope.mode==='gain';
    const activePmon=pmonActive(preset),target=editableTarget(),displayedTarget=selectedTarget(),isModulator=displayedTarget==='modulator';
    const modBrr=preset.pmon.source==='brr',hasModBrr=Boolean(preset.pmon.brr.data);
    noiseCard.element.hidden=!isNoise;sampleCard.element.hidden=isNoise;
    noiseHint.textContent=preset.noise.clock===0
      ?'Clock 0 holds the generator’s current value instead of advancing it. This can be a steady DC level; choose a nonzero clock for a changing noise texture.'
      :'Clock '+preset.noise.clock+' controls the shared generator’s texture. It is a hardware rate code, not a musical note or a separate pitch for each key.';
    const modBytes=pmonSampleBytes(preset),carrierBytes=isWave?72:isBrr?decodeBase64(preset.brr.data).length:0;
    const carrierBudget=sampleBudget(preset),maxBrrBytes=isModulator?Math.max(0,carrierBudget+modBytes-carrierBytes):carrierBudget,maxFrames=maxBrrBytes/9*16;
    const echoMaxBytes=sampleBudget({...preset,echo:{...preset.echo,enabled:true}}).toLocaleString('en-US');
    sampleBudgetInfo.textContent='Audio is mixed to mono, resampled and encoded as lossy BRR without normalization. Current '+displayedTarget+' sample limit: '+maxBrrBytes.toLocaleString('en-US')+' BRR bytes / '+maxFrames.toLocaleString('en-US')+' decoded frames (about '+(maxFrames/importRate).toFixed(2)+' s at '+importRate.toLocaleString('en-US')+' Hz). '+(preset.echo.enabled?'Echo reserves 30 KiB of the shared 64 KiB RAM. ':'Echo is off. ')+(activePmon?'Current carrier / modulator: '+carrierBytes.toLocaleString('en-US')+' / '+modBytes.toLocaleString('en-US')+' BRR bytes. ':'')+'Loads replace the selected '+displayedTarget+'. Longer audio is rejected without trimming it.';
    echoDelayInfo.textContent=preset.echo.delay===0?'Delay code 0 uses a 4-byte buffer: one stereo frame at 32,000 Hz (0.03125 ms), not a zero-length delay.'
      :'Delay '+preset.echo.delay+' × 16 ms = '+(preset.echo.delay*16)+' ms. The hardware adopts a changed length at its buffer boundary.';
    echoHint.textContent=isNoise
      ?(preset.echo.enabled?'Echo is enabled. Send adds the newly played Noise envelopes to Echo; Return controls the delayed signal.':'Echo is off. Enable it to add the shared hardware Echo / FIR path to Noise.')
      :preset.echo.enabled?'Echo is enabled. Send adds new carrier notes to Echo; Return controls the delayed signal. The carrier sample limit is '+echoMaxBytes+' BRR bytes.'
        :'Echo is off. You can prepare its settings here, then enable it to hear the result. Enabling Echo reduces the carrier sample limit to '+echoMaxBytes+' BRR bytes; a sample that does not fit is kept with Echo off.';
    sourceHint.textContent=isNoise?'One hardware Noise generator shared by eight voice envelopes. Noise clock changes its texture; keys do not tune it.'
      :(isWave?'One 128-point cycle, encoded as a BRR loop.':'One BRR carrier sample; Root / PITCH declare its tuning.')+(activePmon?' Four PMON pairs use a '+(modBrr?'BRR sample':'drawn wave')+' modulator.':' Eight physical S-DSP voices play the keyboard.');
    targetFields.hidden=!activePmon;modSourceFields.hidden=!isModulator;pmonSource.setDisabled(!activePmon);
    shapeActions.hidden=!target;drawingHint.hidden=!target;tuning.hidden=!isBrr||isModulator;
    pmonTuning.hidden=!isModulator||!modBrr;
    drawingHint.textContent=isModulator
      ?'Draw the modulator’s 128-point cycle here. Shape buttons change this selected wave. Releasing a stroke prepares its BRR loop and stops held notes / Echo tails. Audio / BRR file loads replace this selected modulator. Switch to Carrier to preview or edit its wave.'
      :'Draw the carrier’s 128-point cycle here. Releasing a stroke or choosing a shape prepares a new BRR loop and stops held notes / Echo tails. Drawing / encoding are software tools; the output monitor shows the hardware result after BRR decoding, interpolation and modulation.';
    canvas.dataset.editable=String(Boolean(target));canvas.dataset.waveTarget=isModulator?'modulator':'carrier';
    canvas.setAttribute('aria-label',isNoise?'Waveform editor inactive for hardware Noise':target?'Editable 128-point '+target+' waveform, normalized minus one to plus one':'Decoded BRR '+displayedTarget+' waveform overview');
    loopBrr.disabled=!isBrr||isModulator||!hasBrr;loopStart.setDisabled(!isBrr||isModulator||!hasBrr||preset.brr.loopStartSamples===null);
    pmonLoopBrr.disabled=!isModulator||!modBrr||!hasModBrr;
    pmonLoopStart.setDisabled(!isModulator||!modBrr||!hasModBrr||preset.pmon.brr.loopStartSamples===null);
    for(const control of adsrControls)control.setDisabled(isGain);
    gainMode.setDisabled(!isGain);gainLevel.setDisabled(!isGain||preset.envelope.gainMode!=='direct');
    gainRate.setDisabled(!isGain||preset.envelope.gainMode==='direct');
    const decrease=preset.envelope.gainMode.endsWith('decrease');
    gainHint.textContent=!isGain?'ADSR controls the hardware envelope. Sustain rate 0 holds the sustain level.'
      :preset.envelope.gainMode==='direct'?'Direct GAIN sets the hardware envelope level immediately.'
      :decrease?'Decrease shapes reduce the current envelope. A new voice starts at zero; switch from Direct or ADSR while holding a key to hear the decrease.'
      :'Increase shapes grow from a new voice’s zero envelope. Rate code 0 holds the current envelope.';
    const registers=envelopeRegisters(preset),hex=value=>'0x'+value.toString(16).padStart(2,'0');
    registerInfo.textContent='DSP registers · ADSR1 '+hex(registers.adsr1)+' · ADSR2 '+hex(registers.adsr2)+' · GAIN '+hex(registers.gain);
    pmonEnabled.disabled=isNoise;pmonRatio.setDisabled(!activePmon);pmonEnvelopeMode.setDisabled(!activePmon);
    const modGain=preset.pmon.envelope.mode==='gain',modDirect=preset.pmon.envelope.gainMode==='direct';
    for(const control of pmonAdsrControls)control.setDisabled(!activePmon||modGain);
    pmonGainMode.setDisabled(!activePmon||!modGain);pmonGainLevel.setDisabled(!activePmon||!modGain||!modDirect);
    pmonGainRate.setDisabled(!activePmon||!modGain||modDirect);
    const ratioLabel=modBrr?'Modulator ratio · × BRR speed':'Modulator ratio · × key note';
    doc.getElementById('pmonRatioLabel').textContent=ratioLabel;
    for(const button of pmonSwitches.querySelectorAll('[data-stepper-for="pmonRatio"]'))
      button.setAttribute('aria-label',(Number(button.dataset.stepperDelta)<0?'Decrease ':'Increase ')+ratioLabel);
    pmonHint.textContent=isNoise
      ?'PMON is paused for a Noise carrier. Its authored '+(preset.pmon.enabled?'On':'Off')+' setting and modulator are remembered; switch to Drawn wave or BRR to use it.'
      :activePmon?(modBrr&&!hasModBrr
        ?'On · no modulator BRR loaded. Choose Modulator above and load audio / BRR before playing or copying JavaScript. The empty selection is kept as an editable draft.'
        :'On · four notes, one adjacent modulator → carrier pair per key. Change Ratio, BRR tuning or modulator depth / envelope while holding a key; edit or load the selected side using the shared canvas above.')
        :'Off · eight unmodulated notes. Enable to use four hardware PMON pairs; this stops held notes and Echo tails.';
    pmonGainHint.textContent=!activePmon?'Modulator envelope controls become active when PMON is enabled for a Wave or BRR carrier.'
      :!modGain?'Modulator ADSR changes the modulation depth over time. Sustain rate 0 holds the sustain level.'
        :modDirect?'Direct GAIN sets modulation depth immediately; level 0 removes modulation without turning PMON off.'
          :preset.pmon.envelope.gainMode.endsWith('decrease')?'Decrease reduces the current modulator envelope. A fresh key-on starts at zero; first use Direct or ADSR, then switch while holding a key to hear its depth decrease.'
            :'Increase grows modulation depth from zero. Rate code 0 holds the current envelope.';
    const modRegisters=modulatorEnvelopeRegisters(preset);
    pmonRegisterInfo.textContent='Modulator register settings · ADSR1 '+hex(modRegisters.adsr1)+' · ADSR2 '+hex(modRegisters.adsr2)+' · GAIN '+hex(modRegisters.gain);
    if(isModulator&&!modBrr){
      sampleInfo.textContent='Modulator · 128 authored PCM points · one BRR loop · silent stereo gain · hardware envelope controls depth.';
      if(!stroke)waveReadout.textContent='Modulator · 128 points · release a stroke to apply';
    }else if(isWave&&!isModulator){
      sampleInfo.textContent='Carrier · 128 authored PCM points · one loop · BRR encoding is lossy · 32,000 Hz native DSP.';
      if(!stroke)waveReadout.textContent='Carrier · 128 points · release a stroke to apply';
    }else if(isNoise){
      sampleInfo.textContent='Hardware Noise · one shared clock · eight independent voice envelopes.';
      waveReadout.textContent='Noise is displayed in the live output monitor.';
    }else{
      const brr=isModulator?preset.pmon.brr:preset.brr,decoded=decodedSample(displayedTarget),frames=decoded.pcm.length;
      const rate=32000*brr.basePitch/4096*(isModulator?preset.pmon.ratio:1),label=isModulator?'Modulator':'Carrier';
      sampleInfo.textContent=frames?label+' · '+(brr.name||'BRR sample')+' · '+frames.toLocaleString('en-US')+' decoded frames · '+(decodeBase64(brr.data).length).toLocaleString('en-US')+' BRR bytes · '+(frames/rate).toFixed(3)+' s at Root'+(isModulator?' with Ratio':'')
        :label+' · no BRR loaded · choose Load audio or Load BRR.';
      waveReadout.textContent=frames?label+' · decoded BRR overview · original root and loop address are not stored in BRR':label+' · no sample loaded';
    }
    conversionRate.setDisabled(Boolean(loadController)||committingImport);resizeWave();
  }
  render();
  return {
    update(value) {
      if(disposed)return;
      const next=readPreset(value);
      if(loadController&&(presetBankKey(next)!==presetBankKey(preset)||next.pmon.enabled!==preset.pmon.enabled))
        cancelLoad('Import cancelled after changing the instrument. Current sample kept.');
      cancelStroke();
      const oldSample=selectedTarget()==='modulator'?preset.pmon.brr:preset.brr;
      const nextSample=selectedTarget()==='modulator'?next.pmon.brr:next.brr;
      if((nextSample.data!==oldSample.data||nextSample.name!==oldSample.name)&&!loadController&&!committingImport)
        setLoadStatus(nextSample.data?'Sample ready · play the keyboard, or load another file.':'Load audio or raw BRR to prepare the selected sample.');
      preset=next;render();
    },
    dispose() {
      if(disposed)return;
      cancelLoad();cancelStroke();disposed=true;previews.clear();previewBins=null;
      for(const cleanup of cleanups)cleanup();body.remove();
    },
  };
}
