// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createDefaultPreset, readPreset, waveShape} from './preset.js';
import {decodeDdaData, MAX_AUDIO_FILE_BYTES} from './dda_pcm.js';

/** A passive editor. Editing never creates an audio device. */
export function createEditor({root, onChange = () => {}, onError = () => {},
  onLoadAudio = async () => {throw new Error('Audio loading is not connected');}}) {
  const doc = root.ownerDocument, win = doc.defaultView ?? globalThis;
  const cleanups = [], fields = new Map(), pointerControls = new WeakSet();
  let preset = createDefaultPreset(), disposed = false, stroke = null, target = 'main';
  let importRate = 11025, loadRequest = 0, loadController = null;
  let ddaPreviewData = null, ddaPreview = null, ddaDrawn = null;
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
      const next = readPreset(preset); mutator(next);
      preset = readPreset(next); render();
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
    const row = make('label', 'huc-field'); row.htmlFor = id;
    row.append(make('span', '', label)); parent.append(row); return row;
  }
  function select(parent, label, id, choices, get, set, {local = false} = {}) {
    const row = make('div', 'huc-field huc-choice-field'), title = make('span', '', label);
    title.id = `${id}Label`; row.dataset.choice = id; row.append(title); parent.append(row);
    const group = make('div', 'huc-choice-group'); group.id = id;
    group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-labelledby', title.id); row.append(group);
    let disabled = false;
    const buttons = choices.map(([value, text]) => {
      const button = make('button', 'huc-choice', text); button.type = 'button';
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
    const row = make('div', 'huc-field'), title = make('span', '', label);
    title.id = `${id}Label`; row.append(title); parent.append(row);
    const group = make('div', 'huc-stepper'); group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', title.id); row.append(group);
    const minus = make('button', 'huc-stepper-button', '−'), plus = make('button', 'huc-stepper-button', '+');
    const output = make('output', 'huc-stepper-value'); output.id = id;
    output.tabIndex = 0; output.setAttribute('role', 'spinbutton');
    output.setAttribute('aria-labelledby', title.id); output.setAttribute('aria-valuemin', String(min)); output.setAttribute('aria-valuemax', String(max));
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
      output.textContent = fractional && Number(shown) !== value ? `≈${shown}` : shown;
      output.title = `${value} · Drag left or right, or use the arrow keys.`;
      output.setAttribute('aria-valuenow', String(value)); output.setAttribute('aria-disabled', String(disabled));
      group.setAttribute('aria-disabled', String(disabled));
      output.tabIndex = disabled ? -1 : 0;
      minus.disabled = disabled || value <= min; plus.disabled = disabled || value >= max;
    }
    function adjust(value) {
      if (disabled) return;
      const next = Math.max(min, Math.min(max, fractional ? value : Math.round(value / step) * step));
      if (next !== get(preset)) commit(value => set(value, next));
    }
    listen(group, 'keydown', event => {
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = get(preset) + step;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = get(preset) - step;
      else if (event.key === 'PageUp') next = get(preset) + step * 10;
      else if (event.key === 'PageDown') next = get(preset) - step * 10;
      else if (event.key === 'Home') next = min;
      else if (event.key === 'End') next = max;
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
    const row = field(parent, label, id); row.classList.add('huc-check');
    const input = make('input'); input.type = 'checkbox'; input.id = id; row.prepend(input);
    fields.set(id, {input, get});
    listen(input, 'change', () => commit(value => set(value, input.checked)));
    performanceFocus(input); return input;
  }
  function card(title, id) {
    const element = make('details', 'huc-card'); element.open = true;
    if (id) element.id = id;
    const summary = make('summary', '', title), content = make('div', 'huc-card-content');
    element.append(summary, content); body.append(element);
    return {element, content};
  }
  function section(parent, title) {
    const element = make('div', 'huc-subsection'); element.append(make('h4', '', title)); parent.append(element); return element;
  }
  function group(parent) { const element = make('div', 'huc-fields'); parent.append(element); return element; }
  function help(parent, text) { const element = make('p', 'huc-help', text); parent.append(element); return element; }
  const body = make('div', 'huc-editor'); root.append(body);
  const sourceBar = make('div', 'huc-source-bar'); body.append(sourceBar);
  select(sourceBar, 'Source', 'source', [['wave', 'Wavetable'], ['noise', 'Noise'], ['dda', 'DDA PCM']], value => value.source, (value, source) => {value.source = source;});
  const sourceHint = make('p'); sourceBar.append(sourceHint);

  const levelCard = card('Level & stereo · hardware', 'levelSection'), levels = group(levelCard.content);
  number(levels, 'Channel level · 0–31', 'volume', 0, 31, value => value.volume, (value, volume) => {value.volume = volume;});
  number(levels, 'Left balance · 0–15', 'panLeft', 0, 15, value => value.pan.left, (value, left) => {value.pan.left = left;});
  number(levels, 'Right balance · 0–15', 'panRight', 0, 15, value => value.pan.right, (value, right) => {value.pan.right = right;});
  help(levelCard.content, 'These are HuC6280 hardware attenuation levels, not percentages. They update held notes. Master controls the final output separately.');

  const waveCard = card('Waveform · 32 × 5-bit wavetable', 'waveSection'), wave = waveCard.content;
  const waveHeading = make('div', 'huc-wave-heading'); wave.append(waveHeading);
  const targets = make('div', 'huc-wave-targets'); targets.setAttribute('role', 'group'); targets.setAttribute('aria-label', 'Waveform editing target'); waveHeading.append(targets);
  const targetButtons = [];
  for (const [name, label] of [['main', 'Main wave'], ['lfo', 'LFO wave · CH2']]) {
    const button = make('button', '', label); button.type = 'button'; button.dataset.waveTarget = name;
    listen(button, 'pointerdown', event => {if (event.button === 0) {event.preventDefault();doc.activeElement?.blur();}});
    listen(button, 'click', () => {cancelStroke();target = name;render();});
    targets.append(button); targetButtons.push(button);
  }
  const shapes = make('div', 'huc-wave-actions'); shapes.setAttribute('role', 'group'); shapes.setAttribute('aria-label', 'Waveform shape'); waveHeading.append(shapes);
  for (const [name, label] of [['sine', 'Sine'], ['triangle', 'Triangle'], ['saw', 'Saw'], ['square', 'Square']]) {
    const button = make('button', '', label); button.type = 'button'; button.dataset.waveShape = name; shapes.append(button);
    listen(button, 'pointerdown', event => {if (event.button === 0) {event.preventDefault();doc.activeElement?.blur();}});
    listen(button, 'click', () => {cancelStroke();commit(value => {if (target === 'main') value.wave = waveShape(name);else value.lfo.wave = waveShape(name);});});
  }
  const canvas = make('canvas'); canvas.id = 'waveCanvas'; canvas.width = 900; canvas.height = 220;
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Editable HuC6280 main waveform, 32 samples from 0 to 31'); wave.append(canvas);
  const waveReadout = make('p', 'huc-wave-readout'); waveReadout.setAttribute('aria-live', 'polite'); wave.append(waveReadout);
  help(wave, 'Draw either wave on this canvas. Releasing a stroke or choosing a shape applies it automatically and stops held notes. Main wave is copied to the playable channels; LFO wave modulates CH1 when Hardware LFO is enabled.');

  const ddaCard = card('DDA PCM · 5-bit DAC / software playback', 'ddaSection'), dda = ddaCard.content;
  const loadActions = make('div', 'huc-dda-actions'); dda.append(loadActions);
  const loadDdaAudio = make('button', '', 'Load audio…'); loadDdaAudio.type = 'button'; loadDdaAudio.id = 'loadDdaAudio';
  const ddaAudioFileInput = make('input', 'file-input'); ddaAudioFileInput.type = 'file'; ddaAudioFileInput.id = 'ddaAudioFileInput';
  ddaAudioFileInput.accept = 'audio/*,.wav'; ddaAudioFileInput.setAttribute('aria-label', 'Choose audio to convert to five-bit DDA PCM');
  const cancelDdaAudio = make('button', '', 'Cancel conversion'); cancelDdaAudio.type = 'button'; cancelDdaAudio.id = 'cancelDdaAudio'; cancelDdaAudio.hidden = true;
  loadActions.append(loadDdaAudio, ddaAudioFileInput, cancelDdaAudio);
  const ddaLoadStatus = make('p', 'huc-help', 'Load audio to play it through the five-bit DAC.'); ddaLoadStatus.id = 'ddaLoadStatus';
  ddaLoadStatus.setAttribute('role', 'status'); ddaLoadStatus.setAttribute('aria-live', 'polite'); dda.append(ddaLoadStatus);
  const importFields = group(dda);
  const conversionRate = select(importFields, 'Convert audio at · Hz', 'ddaImportRate', [
    [8000, '8,000'], [11025, '11,025'], [16000, '16,000'], [22050, '22,050'], [32000, '32,000'], [44100, '44,100'],
  ], () => importRate, (_value, rate) => {importRate = Number(rate);}, {local:true});
  help(dda, 'Choose a conversion rate before loading. Audio channels are combined to mono, resampled and quantized to 0–31. Loading replaces the current PCM; changing the conversion choice alone keeps the current sound. WAV is portable; other audio formats depend on the browser’s decoder.');
  const ddaInfo = make('p', 'huc-dda-info'); ddaInfo.id = 'ddaInfo'; dda.append(ddaInfo);
  const ddaCanvas = make('canvas'); ddaCanvas.id = 'ddaCanvas'; ddaCanvas.width = 900; ddaCanvas.height = 180;
  ddaCanvas.setAttribute('role', 'img'); ddaCanvas.setAttribute('aria-label', 'Five-bit PCM waveform overview, values 0 to 31'); dda.append(ddaCanvas);
  const playback = section(dda, 'Playback · software control'), playbackFields = group(playback);
  number(playbackFields, 'DAC rate · Hz', 'ddaRate', 1, 192000, value => value.dda.sampleRate, (value, rate) => {value.dda.sampleRate = rate;}, 1, {fractional:true});
  number(playbackFields, 'Root MIDI note', 'ddaRootNote', 0, 127, value => value.dda.rootNote, (value, note) => {value.dda.rootNote = note;});
  number(playbackFields, 'Playback speed · %', 'ddaSpeed', 12.5, 400, value => value.dda.speed * 100, (value, percent) => {value.dda.speed = percent / 100;}, 12.5);
  checkbox(playbackFields, 'Loop PCM', 'ddaLoop', value => value.dda.loop, (value, loop) => {value.dda.loop = loop;});
  help(playback, 'The Root note plays the stored PCM at its DAC rate and chosen speed. Other keys and Pitch change the software readout speed. DAC rate reinterprets the current samples; it does not resample them. These controls update held notes without restarting them. Turning Loop on after a one-shot has ended takes effect on the next note.');
  help(dda, 'The five-bit DAC is a HuC6280 hardware feature. PCM data supply, rate, keyboard pitch, Loop and Envelope are software controls. Playback holds one code per output frame and skips intermediate codes at high speeds. Software Envelope can soften note and one-shot edges; Loop boundaries keep the original sample discontinuity.');
  help(dda, 'Software limits: 32 MiB input audio, 30 minutes decoded audio, and 16,777,216 DAC samples. Longer or higher-rate conversions may exceed the sample limit. PCM data is included when saving a preset.');
  const setLoadStatus = (message, error = false) => {
    ddaLoadStatus.textContent = message; ddaLoadStatus.dataset.error = String(error);
  };
  function cancelDdaLoad(message) {
    loadRequest++; loadController?.abort(); loadController = null;
    cancelDdaAudio.hidden = true; conversionRate.setDisabled(false);
    if (message) setLoadStatus(message);
  }
  listen(loadDdaAudio, 'click', () => {loadDdaAudio.blur();ddaAudioFileInput.click();});
  listen(ddaAudioFileInput, 'cancel', () => {ddaAudioFileInput.blur();if (!loadController) setLoadStatus('File selection cancelled. Current PCM kept.');});
  listen(ddaAudioFileInput, 'change', async () => {
    const file = ddaAudioFileInput.files?.[0]; ddaAudioFileInput.value = ''; ddaAudioFileInput.blur();
    if (!file || disposed) return;
    cancelDdaLoad(); const token = loadRequest, controller = new AbortController(); loadController = controller;
    cancelDdaAudio.hidden = false; conversionRate.setDisabled(true); setLoadStatus(`Reading and converting ${file.name}…`);
    try {
      if (file.size > MAX_AUDIO_FILE_BYTES) throw new Error('Choose an audio file no larger than 32 MiB');
      const message = await onLoadAudio(file, {sampleRate:importRate, signal:controller.signal, onCommit() {
        if (disposed || token !== loadRequest || controller.signal.aborted) return;
        loadController = null;
        cancelDdaAudio.hidden = true;
        setLoadStatus(`Applying ${file.name}…`);
      }});
      if (disposed || token !== loadRequest || controller.signal.aborted) return;
      setLoadStatus(typeof message === 'string' ? message : 'PCM loaded · play the keyboard.');
    } catch (error) {
      if (disposed || token !== loadRequest) return;
      if (error?.name === 'AbortError') setLoadStatus('Conversion cancelled. Current PCM kept.');
      else {setLoadStatus(`Audio import failed: ${error?.message ?? String(error)} Current PCM kept.`, true);report(error);}
    } finally {
      if (token === loadRequest) {loadController = null;cancelDdaAudio.hidden = true;conversionRate.setDisabled(false);}
    }
  });
  listen(cancelDdaAudio, 'click', () => {cancelDdaAudio.blur();cancelDdaLoad('Conversion cancelled. Current PCM kept.');});

  function prepareDdaPreview() {
    if (ddaPreviewData === preset.dda.data) return;
    const samples = decodeDdaData(preset.dda.data), count = Math.min(2048, samples.length);
    const minima = new Uint8Array(count), maxima = new Uint8Array(count);
    for (let bin = 0; bin < count; bin++) {
      const start = Math.floor(bin * samples.length / count), end = Math.floor((bin + 1) * samples.length / count);
      let min = 31, max = 0;
      for (let index = start; index < end; index++) {const value = samples[index];min = Math.min(min, value);max = Math.max(max, value);}
      minima[bin] = min; maxima[bin] = max;
    }
    ddaPreviewData = preset.dda.data; ddaPreview = {samples:samples.length, minima, maxima}; ddaDrawn = null;
  }
  function drawDda() {
    if (disposed || ddaCard.element.hidden || !ddaCanvas.clientWidth || !ddaCanvas.clientHeight) return;
    prepareDdaPreview();
    const width = Math.max(240, Math.round(ddaCanvas.clientWidth)), height = Math.max(150, Math.round(ddaCanvas.clientHeight));
    const key = `${width}:${height}`;
    if (ddaDrawn === key) return;
    ddaCanvas.width = width; ddaCanvas.height = height;
    const context = ddaCanvas.getContext('2d'); if (!context) return;
    const left = 27, right = width - 15, top = 16, bottom = height - 26, span = bottom - top;
    const y = code => bottom - code / 31 * span;
    context.fillStyle = '#22272b';context.fillRect(0,0,width,height);
    context.lineWidth = 1;context.strokeStyle = '#44484b';context.fillStyle = '#d8dadd';context.font = '11px sans-serif';
    for (const code of [0,8,16,24,31]) {
      context.beginPath();context.moveTo(left,y(code));context.lineTo(right,y(code));context.stroke();
      if ([0,16,31].includes(code)) context.fillText(String(code),3,y(code)+4);
    }
    context.strokeStyle = '#ffb04f';context.lineWidth = 1.5;context.beginPath();
    const bins = ddaPreview.minima.length;
    if (bins) for (let bin = 0; bin < bins; bin++) {
      const x = left + (right - left) * (bin + .5) / bins;
      context.moveTo(x,y(ddaPreview.minima[bin]));context.lineTo(x,y(ddaPreview.maxima[bin]));
      if (ddaPreview.minima[bin] === ddaPreview.maxima[bin]) {context.moveTo(x-.5,y(ddaPreview.minima[bin]));context.lineTo(x+.5,y(ddaPreview.maxima[bin]));}
    } else {context.moveTo(left,y(16));context.lineTo(right,y(16));}
    context.stroke();context.fillStyle = '#d8dadd';context.fillText('5-BIT PCM · waveform overview',left,height-7);
    if (!bins) context.fillText('Load audio to play',left,top+18);
    ddaDrawn = key;
  }

  const noiseCard = card('Noise · hardware CH5 / CH6', 'noiseSection'), noiseFields = group(noiseCard.content);
  number(noiseFields, 'Noise clock code', 'noiseFrequency', 0, 31, value => value.noise.frequency, (value, frequency) => {value.noise.frequency = frequency;});
  help(noiseCard.content, 'Two noise channels play in round robin. The clock code changes the noise texture immediately, including held notes. Every keyboard key triggers the same noise; note pitch and the Pitch wheels do not tune it.');

  const lfoCard = card('Hardware LFO · CH2 → CH1', 'lfoSection'), lfoFields = group(lfoCard.content);
  const lfoEnabled = checkbox(lfoFields, 'Enable Hardware LFO', 'lfoEnabled', value => value.lfo.enabled, (value, enabled) => {value.lfo.enabled = enabled;});
  const lfoControls = [
    number(lfoFields, 'Rate divider code', 'lfoFrequency', 0, 255, value => value.lfo.frequency, (value, frequency) => {value.lfo.frequency = frequency;}),
    select(lfoFields, 'Depth · period offset', 'lfoDepth', [[1, '1 · ×1'], [2, '2 · ×4'], [3, '3 · ×16']], value => value.lfo.depth, (value, depth) => {value.lfo.depth = Number(depth);}),
  ];
  const tuning = section(lfoCard.content, 'Carrier & modulator periods'), tuningFields = group(tuning);
  lfoControls.push(select(tuningFields, 'Period mode', 'lfoMode', [['follow', 'Follow keyboard'], ['recorded', 'Recorded periods']],
    value => value.lfo.mode, (value, mode) => {value.lfo.mode = mode;}));
  const periodControls = [
    number(tuningFields, 'CH1 period at C4', 'lfoCarrierPeriod', 1, 4096, value => value.lfo.carrierPeriod, (value, period) => {value.lfo.carrierPeriod = period;}),
    number(tuningFields, 'CH2 fixed period', 'lfoModulatorPeriod', 1, 4096, value => value.lfo.modulatorPeriod, (value, period) => {value.lfo.modulatorPeriod = period;}),
  ];
  const lfoReset = checkbox(tuningFields, 'Hold LFO reset', 'lfoReset', value => value.lfo.reset, (value, reset) => {value.lfo.reset = reset;});
  const periodHint = help(tuning, ''); periodHint.id = 'lfoPeriodHint';
  const output = section(lfoCard.content, 'CH2 audio output'), outputFields = group(output);
  const lfoOutputEnabled = checkbox(outputFields, 'Enable CH2 output', 'lfoOutputEnabled', value => value.lfo.output.enabled,
    (value, enabled) => {value.lfo.output.enabled = enabled;});
  const outputControls = [
    number(outputFields, 'CH2 level · 0–31', 'lfoOutputVolume', 0, 31, value => value.lfo.output.volume, (value, volume) => {value.lfo.output.volume = volume;}),
    number(outputFields, 'CH2 left · 0–15', 'lfoOutputLeft', 0, 15, value => value.lfo.output.pan.left, (value, left) => {value.lfo.output.pan.left = left;}),
    number(outputFields, 'CH2 right · 0–15', 'lfoOutputRight', 0, 15, value => value.lfo.output.pan.right, (value, right) => {value.lfo.output.pan.right = right;}),
  ];
  help(output, 'CH2 always supplies the modulation wave while LFO is enabled. Its audio output is optional: enable it and choose a level above 0 to hear it. Imported pairs retain the recorded CH2 output, level and balance. Both channels stop with their single keyboard voice.');
  help(lfoCard.content, 'This is the chip’s fixed CH2 → CH1 frequency modulation. Enabling it selects one keyboard voice using the CH1 / CH2 pair and stops held notes. Choose “LFO wave” above to draw CH2 on the same canvas. The rate is a hardware divider code, not Hz: higher nonzero codes slow the modulation. Hold LFO reset controls the hardware reset line. Noise does not use LFO.');

  const envelopeCard = card('Envelope · software control', 'envelopeSection'), envFields = group(envelopeCard.content);
  checkbox(envFields, 'Enable Software envelope', 'envelopeEnabled', value => value.envelope.enabled, (value, enabled) => {value.envelope.enabled = enabled;});
  // Times are stored in seconds; the steppers use integer milliseconds.
  const envelopeControls = [];
  for (const [key, label, maximum, scale, step] of [
    ['attack', 'Attack · ms', 10000, 1000, 5],
    ['decay', 'Decay · ms', 10000, 1000, 5],
    ['sustain', 'Sustain · %', 100, 100, 1],
    ['release', 'Release · ms', 10000, 1000, 5],
  ]) {
    envelopeControls.push(number(envFields, label, `envelope${key[0].toUpperCase()}${key.slice(1)}`, 0, maximum,
      value => Math.round(value.envelope[key] * scale), (value, setting) => {value.envelope[key] = setting / scale;}, step));
  }
  help(envelopeCard.content, 'HuC6280 has no hardware ADSR. This software envelope moves the chip’s channel level during a note. Attack / Decay / Release are milliseconds; Sustain is a percentage of the chosen level. Timing edits apply to new notes; switching the envelope On or Off stops held notes.');

  function samples() {return target === 'main' ? preset.wave : preset.lfo.wave;}
  function drawWave(values = samples()) {
    const context = canvas.getContext('2d'); if (!context) return;
    const {width, height} = canvas, margin = 25, top = 18, bottom = height - 25, step = (width - 2 * margin) / 32;
    context.fillStyle = '#22272b'; context.fillRect(0, 0, width, height);
    context.strokeStyle = '#44484b'; context.lineWidth = 1;
    for (let index = 0; index <= 32; index++) {
      const x = margin + index * step; context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke();
    }
    for (const level of [0, 8, 16, 24, 31]) {
      const y = bottom - level / 31 * (bottom - top); context.beginPath(); context.moveTo(margin, y); context.lineTo(width - margin, y); context.stroke();
    }
    context.fillStyle = '#d8dadd'; context.font = '12px sans-serif'; context.fillText('31', 4, top + 4); context.fillText('0', 11, bottom + 4);
    context.fillText(`${target === 'main' ? 'MAIN' : 'LFO CH2'} · 32 × 5-bit`, margin, height - 7);
    context.strokeStyle = '#ffb04f'; context.lineWidth = 2.5; context.beginPath();
    for (let index = 0; index < 32; index++) {
      const x = margin + index * step, y = bottom - values[index] / 31 * (bottom - top);
      if (!index) context.moveTo(x, y); else context.lineTo(x, y);
      context.lineTo(x + step, y);
    }
    context.stroke();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * canvas.width, y = (event.clientY - rect.top) / rect.height * canvas.height;
    return {
      index: Math.max(0, Math.min(31, Math.floor((x - 25) / (canvas.width - 50) * 32))),
      value: Math.max(0, Math.min(31, Math.round((canvas.height - 25 - y) / (canvas.height - 43) * 31))),
    };
  }
  function moveStroke(event) {
    if (!stroke || stroke.id !== event.pointerId) return;
    const next = point(event), previous = stroke.previous, distance = Math.abs(next.index - previous.index);
    for (let step = 0; step <= distance; step++) {
      const ratio = distance ? step / distance : 1, index = Math.round(previous.index + (next.index - previous.index) * ratio);
      stroke.samples[index] = Math.round(previous.value + (next.value - previous.value) * ratio);
    }
    stroke.previous = next; drawWave(stroke.samples);
    waveReadout.textContent = `Sample ${next.index} · value ${next.value} / 31 · release to apply`;
  }
  listen(canvas, 'pointerdown', event => {
    if (event.button !== 0 || stroke || preset.source !== 'wave') return;
    event.preventDefault(); doc.activeElement?.blur(); canvas.setPointerCapture(event.pointerId);
    stroke = {id:event.pointerId, target, samples:[...samples()], previous:point(event)}; moveStroke(event);
  });
  listen(canvas, 'pointermove', moveStroke);
  listen(canvas, 'pointerup', event => {
    if (!stroke || stroke.id !== event.pointerId) return;
    moveStroke(event); const values = stroke.samples, editTarget = stroke.target; stroke = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    commit(value => {if (editTarget === 'main') value.wave = values;else value.lfo.wave = values;});
    waveReadout.textContent = 'Wave applied · press a key to hear it';
  });
  function cancelStroke(event) {
    if (!stroke || event?.pointerId !== undefined && stroke.id !== event.pointerId) return;
    const pointer = stroke.id; stroke = null;
    if (canvas.hasPointerCapture?.(pointer)) canvas.releasePointerCapture(pointer);
    drawWave(); waveReadout.textContent = 'Drawing cancelled · previous wave kept';
  }
  listen(canvas, 'pointercancel', cancelStroke); listen(canvas, 'lostpointercapture', cancelStroke); listen(win, 'blur', cancelStroke);
  function resizeWave() {
    if (disposed || !canvas.clientWidth || !canvas.clientHeight) return;
    const width = Math.max(240, Math.round(canvas.clientWidth)), height = Math.max(150, Math.round(canvas.clientHeight));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width; canvas.height = height; drawWave(stroke?.samples);
  }
  const Resize = win.ResizeObserver ?? globalThis.ResizeObserver;
  if (typeof Resize === 'function') {
    const observer = new Resize(() => {resizeWave();drawDda();}); observer.observe(canvas); observer.observe(ddaCanvas);
    cleanups.push(() => observer.disconnect());
  } else listen(win, 'resize', () => {resizeWave();drawDda();});
  function render() {
    if (disposed) return;
    for (const {input, get, update} of fields.values()) {
      if (update) {update();continue;}
      if (input.type === 'checkbox') input.checked = get(preset);
      else if (doc.activeElement !== input) input.value = String(get(preset));
    }
    const isNoise = preset.source === 'noise', isDda = preset.source === 'dda', isWave = preset.source === 'wave';
    waveCard.element.hidden = !isWave; noiseCard.element.hidden = !isNoise; ddaCard.element.hidden = !isDda; lfoCard.element.hidden = isDda;
    lfoEnabled.disabled = !isWave;
    for (const control of lfoControls) control.setDisabled(!isWave || !preset.lfo.enabled);
    for (const control of periodControls) control.setDisabled(!isWave || !preset.lfo.enabled || preset.lfo.mode !== 'recorded');
    lfoReset.disabled = !isWave || !preset.lfo.enabled;
    lfoOutputEnabled.disabled = !isWave || !preset.lfo.enabled;
    for (const control of outputControls) control.setDisabled(!isWave || !preset.lfo.enabled || !preset.lfo.output.enabled);
    periodHint.textContent = preset.lfo.mode === 'recorded'
      ? 'Recorded periods: C4 plays the original CH1 period. Other keys and Pitch transpose CH1; CH2 keeps its fixed period. A displayed period of 4096 is stored as register value 0. Elapsed waveform phase and song automation are not restored.'
      : 'Follow keyboard: keys play their normal notes and CH2 follows CH1’s period, so note pitch also changes modulation speed. Choose Recorded periods to keep CH2 independent and make C4 the recorded carrier pitch.';
    for (const control of envelopeControls) control.setDisabled(!preset.envelope.enabled);
    for (const button of targetButtons) button.setAttribute('aria-pressed', String(button.dataset.waveTarget === target));
    canvas.setAttribute('aria-label', `Editable HuC6280 ${target === 'main' ? 'main' : 'LFO CH2'} waveform, 32 samples from 0 to 31`);
    sourceHint.textContent = isDda ? 'CH1–CH6 · six five-bit DAC voices. PCM playback, pitch and Loop use software control.'
      : isNoise ? 'CH5 + CH6 · two noise voices. Keys trigger; they do not change pitch.'
      : preset.lfo.enabled ? preset.lfo.mode === 'recorded' ? 'CH1 + CH2 pair · one voice. C4 plays the recorded carrier pitch; CH2 period stays fixed.'
        : 'CH1 + CH2 pair · one voice. CH2 period follows the keyboard.' : 'CH1–CH6 · six wavetable voices in round robin.';
    const data = preset.dda.data, count = data.length / 4 * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    ddaInfo.textContent = count
      ? `${preset.dda.name || 'Loaded PCM'} · ${count.toLocaleString('en-US')} samples · ${preset.dda.sampleRate.toLocaleString('en-US')} Hz · ${(count / preset.dda.sampleRate / preset.dda.speed).toFixed(2)} s at Root / ${preset.dda.speed * 100}%`
      : 'No PCM loaded · choose Load audio, then play the keyboard.';
    conversionRate.setDisabled(Boolean(loadController)); drawDda();
    resizeWave(); drawWave(stroke?.samples);
    if (!stroke) waveReadout.textContent = `${target === 'main' ? 'Main wave' : 'LFO wave · CH2'} · 32 samples · 5-bit levels · draw, then release to apply`;
  }
  render();
  return {
    update(value) {
      if (disposed) return;
      const next = readPreset(value);
      if (loadController && preset.source === 'dda' && next.source !== 'dda') cancelDdaLoad('Conversion cancelled after changing source. Current PCM kept.');
      if ((preset.dda.data !== next.dda.data || preset.dda.name !== next.dda.name) && !loadController && !ddaLoadStatus.textContent.startsWith('Applying ')) {
        setLoadStatus(next.dda.data ? 'PCM ready · play the keyboard, or load audio to replace it.' : 'Load audio to play it through the five-bit DAC.');
      }
      const previousWave = target === 'main' ? preset.wave : preset.lfo.wave, nextWave = target === 'main' ? next.wave : next.lfo.wave;
      if (stroke && (next.source !== preset.source || nextWave.some((sample, index) => sample !== previousWave[index]))) cancelStroke();
      preset = next; render();
    },
    dispose() {
      if (disposed) return;
      cancelDdaLoad(); cancelStroke(); disposed = true; ddaPreviewData = ddaPreview = ddaDrawn = null;
      for (const cleanup of cleanups) cleanup(); body.remove();
    },
  };
}
