// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createDefaultPreset, readPreset, waveShape} from './preset.js';

/** A passive editor. Editing never creates an audio device. */
export function createEditor({root, onChange = () => {}, onError = () => {}}) {
  const doc = root.ownerDocument, win = doc.defaultView ?? globalThis;
  const cleanups = [], fields = new Map(), pointerControls = new WeakSet();
  let preset = createDefaultPreset(), disposed = false, stroke = null, target = 'main';
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
  function select(parent, label, id, choices, get, set) {
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
      if (value !== String(get(preset))) commit(preset => set(preset, value));
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
  function number(parent, label, id, min, max, get, set, step = 1) {
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
      const value = get(preset); output.textContent = String(value);
      output.setAttribute('aria-valuenow', String(value)); output.setAttribute('aria-disabled', String(disabled));
      group.setAttribute('aria-disabled', String(disabled));
      output.tabIndex = disabled ? -1 : 0;
      minus.disabled = disabled || value <= min; plus.disabled = disabled || value >= max;
    }
    function adjust(value) {
      if (disabled) return;
      const next = Math.max(min, Math.min(max, Math.round(value / step) * step));
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
  select(sourceBar, 'Source', 'source', [['wave', 'Wavetable'], ['noise', 'Noise']], value => value.source, (value, source) => {value.source = source;});
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
    const observer = new Resize(resizeWave); observer.observe(canvas); cleanups.push(() => observer.disconnect());
  } else listen(win, 'resize', resizeWave);
  function render() {
    if (disposed) return;
    for (const {input, get, update} of fields.values()) {
      if (update) {update();continue;}
      if (input.type === 'checkbox') input.checked = get(preset);
      else if (doc.activeElement !== input) input.value = String(get(preset));
    }
    const isNoise = preset.source === 'noise';
    waveCard.element.hidden = isNoise; noiseCard.element.hidden = !isNoise;
    lfoEnabled.disabled = isNoise;
    for (const control of lfoControls) control.setDisabled(isNoise || !preset.lfo.enabled);
    for (const control of periodControls) control.setDisabled(isNoise || !preset.lfo.enabled || preset.lfo.mode !== 'recorded');
    lfoReset.disabled = isNoise || !preset.lfo.enabled;
    lfoOutputEnabled.disabled = isNoise || !preset.lfo.enabled;
    for (const control of outputControls) control.setDisabled(isNoise || !preset.lfo.enabled || !preset.lfo.output.enabled);
    periodHint.textContent = preset.lfo.mode === 'recorded'
      ? 'Recorded periods: C4 plays the original CH1 period. Other keys and Pitch transpose CH1; CH2 keeps its fixed period. A displayed period of 4096 is stored as register value 0. Elapsed waveform phase and song automation are not restored.'
      : 'Follow keyboard: keys play their normal notes and CH2 follows CH1’s period, so note pitch also changes modulation speed. Choose Recorded periods to keep CH2 independent and make C4 the recorded carrier pitch.';
    for (const control of envelopeControls) control.setDisabled(!preset.envelope.enabled);
    for (const button of targetButtons) button.setAttribute('aria-pressed', String(button.dataset.waveTarget === target));
    canvas.setAttribute('aria-label', `Editable HuC6280 ${target === 'main' ? 'main' : 'LFO CH2'} waveform, 32 samples from 0 to 31`);
    sourceHint.textContent = isNoise ? 'CH5 + CH6 · two noise voices. Keys trigger; they do not change pitch.'
      : preset.lfo.enabled ? preset.lfo.mode === 'recorded' ? 'CH1 + CH2 pair · one voice. C4 plays the recorded carrier pitch; CH2 period stays fixed.'
        : 'CH1 + CH2 pair · one voice. CH2 period follows the keyboard.' : 'CH1–CH6 · six wavetable voices in round robin.';
    resizeWave(); drawWave(stroke?.samples);
    if (!stroke) waveReadout.textContent = `${target === 'main' ? 'Main wave' : 'LFO wave · CH2'} · 32 samples · 5-bit levels · draw, then release to apply`;
  }
  render();
  return {
    update(value) {
      if (disposed) return;
      const next = readPreset(value);
      const previousWave = target === 'main' ? preset.wave : preset.lfo.wave, nextWave = target === 'main' ? next.wave : next.lfo.wave;
      if (stroke && (next.source !== preset.source || nextWave.some((sample, index) => sample !== previousWave[index]))) cancelStroke();
      preset = next; render();
    },
    dispose() {if (disposed) return; cancelStroke();disposed = true;for (const cleanup of cleanups) cleanup();body.remove();},
  };
}
