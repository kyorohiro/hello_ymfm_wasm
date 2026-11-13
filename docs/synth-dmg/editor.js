// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createDefaultPreset, readPreset, waveShape} from './preset.js';

/** A passive editor. Editing never creates an audio device. */
export function createEditor({root, onChange = () => {}, onError = () => {}}) {
  const doc = root.ownerDocument, win = doc.defaultView ?? globalThis;
  const cleanups = [], fields = new Map(), pointerControls = new WeakSet(), cancelGestures=[];
  let dragging=0;
  let preset = createDefaultPreset(), disposed = false, stroke = null, liveChannel = null, liveOrigin = 'Code';
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
      const previous=readPreset(preset),channel=liveChannel,origin=liveOrigin;
      const next = readPreset(preset); mutator(next);
      preset = readPreset(next); render();
      Promise.resolve(onChange(readPreset(preset),{previous,channel,origin})).catch(report);
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
    const row = make('label', 'gb-field'); row.htmlFor = id;
    row.append(make('span', '', label)); parent.append(row); return row;
  }
  function select(parent, label, id, choices, get, set) {
    const row = make('div', 'gb-field gb-choice-field'), title = make('span', '', label);
    title.id = `${id}Label`; row.dataset.choice = id; row.append(title); parent.append(row);
    const group = make('div', 'gb-choice-group'); group.id = id;
    group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-labelledby', title.id); row.append(group);
    let disabled = false;
    const buttons = choices.map(([value, text]) => {
      const button = make('button', 'gb-choice', text); button.type = 'button';
      button.dataset.choiceFor = id; button.dataset.choiceValue = String(value);
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
  function number(parent, label, id, min, max, get, set) {
    const row = make('div', 'gb-field'), title = make('span', '', label);
    title.id = `${id}Label`; row.append(title); parent.append(row);
    const group = make('div', 'gb-stepper'); group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', title.id); row.append(group);
    const minus = make('button', 'gb-stepper-button', '−'), plus = make('button', 'gb-stepper-button', '+');
    const output = make('output', 'gb-stepper-value'); output.id = id;
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
      listen(button, 'click', () => adjust(get(preset) + delta));
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
      const next = Math.max(min, Math.min(max, Math.round(value)));
      if (next !== get(preset)) commit(value => set(value, next));
    }
    listen(group, 'keydown', event => {
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = get(preset) + 1;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = get(preset) - 1;
      else if (event.key === 'Home') next = min;
      else if (event.key === 'End') next = max;
      else return;
      event.preventDefault(); event.stopPropagation(); adjust(next);
    });
    listen(output, 'pointerdown', event => {
      if (disabled || event.button !== 0) return;
      event.preventDefault(); doc.activeElement?.blur();
      if(drag)endDrag();
      drag = {id: event.pointerId, x: event.clientX, value: get(preset)};
      dragging++;
      output.setPointerCapture(event.pointerId); output.classList.add('is-dragging');
    });
    listen(output, 'pointermove', event => {
      if (drag?.id === event.pointerId) adjust(drag.value + Math.round((event.clientX - drag.x) / 8));
    });
    function endDrag(event) {
      if (!drag || event?.pointerId !== undefined && event.pointerId !== drag.id) return;
      const pointer = drag.id; drag = null; output.classList.remove('is-dragging');
      dragging--;
      if (output.hasPointerCapture?.(pointer)) output.releasePointerCapture(pointer);
    }
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(output, type, endDrag);
    listen(win, 'blur', endDrag);
    cancelGestures.push(()=>endDrag());
    fields.set(id, {input: output, get, update: refresh});
    return {setDisabled(value) {disabled = value;if(disabled) endDrag();refresh();}};
  }
  function checkbox(parent, label, id, get, set) {
    const row = field(parent, label, id); row.classList.add('gb-check');
    const input = make('input'); input.type = 'checkbox'; input.id = id; row.prepend(input);
    fields.set(id, {input, get});
    listen(input, 'change', () => commit(value => set(value, input.checked)));
    performanceFocus(input); return input;
  }
  function card(title) {
    const element = make('section', 'gb-card'); element.append(make('h3', '', title)); body.append(element); return element;
  }
  function section(parent, title) {
    const element = make('div', 'gb-subsection'); element.append(make('h4', '', title)); parent.append(element); return element;
  }
  function group(parent) { const element = make('div', 'gb-fields'); parent.append(element); return element; }
  function help(parent, text) { const element = make('p', 'gb-help', text); parent.append(element); return element; }
  function envelope(parent, source, prefix) {
    const controls = group(section(parent, 'Hardware volume envelope'));
    select(controls, 'Direction', `${prefix}EnvelopeDirection`, [['down', 'Fade out'], ['up', 'Fade in']], value => value[source].envelope.direction, (value, direction) => {value[source].envelope.direction = direction;});
    number(controls, 'Pace · 0 = hold', `${prefix}EnvelopePeriod`, 0, 7, value => value[source].envelope.period, (value, period) => {value[source].envelope.period = period;});
    help(parent, 'Initial volume and envelope settings apply on the next note. Pace is a hardware code: 1–7 steps at multiples of 1/64 second; 0 holds the initial level. This is not an ADSR envelope.');
  }
  const body = make('div', 'gb-editor'); root.append(body);
  const sourceBar = make('div', 'gb-source-bar'); body.append(sourceBar);
  const sourceControl=select(sourceBar, 'Source', 'source', [['pulse', 'Pulse'], ['wave', 'Wave'], ['noise', 'Noise']], value => value.source, (value, source) => {value.source = source;});
  const sourceHint = make('p'); sourceBar.append(sourceHint);

  const pulse = card('Pulse · hardware square waves'), pulseFields = group(pulse);
  select(pulseFields, 'Duty', 'pulseDuty', [[.125, '12.5%'], [.25, '25%'], [.5, '50%'], [.75, '75%']], value => value.pulse.duty, (value, duty) => {value.pulse.duty = Number(duty);});
  number(pulseFields, 'Initial volume · 0–15', 'pulseVolume', 0, 15, value => value.pulse.volume, (value, volume) => {value.pulse.volume = volume;});
  const pulsePreview = make('div', 'gb-pulse-preview'); pulsePreview.setAttribute('aria-hidden', 'true');
  const pulseSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'), pulsePath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  pulseSvg.setAttribute('viewBox', '0 0 320 46'); pulseSvg.setAttribute('preserveAspectRatio', 'none'); pulseSvg.append(pulsePath); pulsePreview.append(pulseSvg); pulse.append(pulsePreview);
  envelope(pulse, 'pulse', 'pulse');
  const sweepFields = group(section(pulse, 'Hardware pitch sweep · CH1 only'));
  const sweepEnabled = checkbox(sweepFields, 'Enable Sweep', 'sweepEnabled', value => value.pulse.sweep.enabled, (value, enabled) => {
    value.pulse.sweep.enabled = enabled;
    // A live CH can report NR10=0, with no configured pace/shift to enable.
    // Give this deliberate On gesture the same useful defaults as a new sound.
    if(enabled&&liveChannel===0&&!value.pulse.sweep.period&&!value.pulse.sweep.shift){
      const defaults=createDefaultPreset().pulse.sweep;
      value.pulse.sweep.period=defaults.period;value.pulse.sweep.shift=defaults.shift;
    }
  });
  const sweepControls = [
    select(sweepFields, 'Direction', 'sweepDirection', [['up', 'Pitch up'], ['down', 'Pitch down']], value => value.pulse.sweep.direction, (value, direction) => {value.pulse.sweep.direction = direction;}),
    number(sweepFields, 'Pace · 0 = disabled', 'sweepPeriod', 0, 7, value => value.pulse.sweep.period, (value, period) => {value.pulse.sweep.period = period;}),
    number(sweepFields, 'Shift · 0 = no change', 'sweepShift', 0, 7, value => value.pulse.sweep.shift, (value, shift) => {value.pulse.sweep.shift = shift;}),
  ];
  help(pulse, 'Sweep is only available on CH1. Enabling it selects one Pulse voice and stops held notes; disabling it restores the two-voice round robin. Sweep settings apply on the next note.');

  const wave = card('Wave · hardware Wave RAM');
  const waveHeading = make('div', 'gb-wave-heading'), shapes = make('div', 'gb-wave-actions'); waveHeading.append(make('span', 'gb-help', 'Draw 32 four-bit samples'), shapes); wave.append(waveHeading);
  for (const [name, label] of [['sine', 'Sine'], ['triangle', 'Triangle'], ['saw', 'Saw'], ['square', 'Square']]) {
    const button = make('button', '', label); button.type = 'button'; button.dataset.waveShape = name; shapes.append(button);
    listen(button, 'click', () => {button.blur(); commit(value => {value.wave.samples = waveShape(name);});});
  }
  const canvas = make('canvas'); canvas.id = 'waveCanvas'; canvas.width = 900; canvas.height = 220; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Editable Game Boy waveform, 32 samples with values from 0 to 15'); wave.append(canvas);
  const waveReadout = make('p', 'gb-wave-readout', '32 samples · 4-bit levels · draw, then release to apply'); wave.append(waveReadout);
  select(group(wave), 'Wave output level', 'waveLevel', [[1, '100%'], [.5, '50%'], [.25, '25%'], [0, 'Mute']], value => value.wave.level, (value, level) => {value.wave.level = Number(level);});
  help(wave, 'Wave has one hardware channel. Drawing is a software editor for Wave RAM. Releasing a stroke or choosing a shape applies the wave automatically and stops any held Wave note. Press a key again to hear it.');

  const noise = card('Noise · hardware LFSR'), noiseFields = group(noise);
  number(noiseFields, 'Initial volume · 0–15', 'noiseVolume', 0, 15, value => value.noise.volume, (value, volume) => {value.noise.volume = volume;});
  number(noiseFields, 'Clock divisor code', 'noiseDivisor', 0, 7, value => value.noise.divisor, (value, divisor) => {value.noise.divisor = divisor;});
  number(noiseFields, 'Clock shift code', 'noiseShift', 0, 15, value => value.noise.shift, (value, shift) => {value.noise.shift = shift;});
  select(noiseFields, 'LFSR width', 'noiseWidth', [[15, '15-bit · long'], [7, '7-bit · short']], value => value.noise.width, (value, width) => {value.noise.width = Number(width);});
  envelope(noise, 'noise', 'noise');
  help(noise, 'Noise has one hardware channel. Every keyboard key triggers the same noise; keys and the Pitch wheel do not tune it to notes. Divisor, shift and LFSR width change its clock and character.');

  const pan = make('div', 'gb-pan'); body.append(pan); pan.append(make('span', '', 'Hardware routing'));
  checkbox(pan, 'Left', 'panLeft', value => value.pan.left, (value, enabled) => {value.pan.left = enabled;});
  checkbox(pan, 'Right', 'panRight', value => value.pan.right, (value, enabled) => {value.pan.right = enabled;});

  function drawWave(samples = preset.wave.samples) {
    const context = canvas.getContext('2d'); if (!context) return;
    const {width, height} = canvas, margin = 17, top = 18, bottom = height - 25, step = (width - 2 * margin) / 32;
    context.fillStyle = '#283427'; context.fillRect(0, 0, width, height);
    context.strokeStyle = '#546347'; context.lineWidth = 1;
    for (let index = 0; index <= 32; index++) {
      const x = margin + index * step; context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke();
    }
    for (const level of [0, 5, 10, 15]) {
      const y = bottom - level / 15 * (bottom - top); context.beginPath(); context.moveTo(margin, y); context.lineTo(width - margin, y); context.stroke();
    }
    context.fillStyle = '#c7d6ac'; context.font = '12px sans-serif'; context.fillText('15', 2, top + 4); context.fillText('0', 6, bottom + 4);
    context.fillText('WAVE RAM · 32 × 4-bit', margin, height - 7);
    context.strokeStyle = '#c6dd95'; context.lineWidth = 2.5; context.beginPath();
    for (let index = 0; index < 32; index++) {
      const x = margin + index * step, y = bottom - samples[index] / 15 * (bottom - top);
      if (!index) context.moveTo(x, y); else context.lineTo(x, y);
      context.lineTo(x + step, y);
    }
    context.stroke();
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width * canvas.width, y = (event.clientY - rect.top) / rect.height * canvas.height;
    const index = Math.max(0, Math.min(31, Math.floor((x - 17) / (canvas.width - 34) * 32)));
    const value = Math.max(0, Math.min(15, Math.round((canvas.height - 25 - y) / (canvas.height - 43) * 15)));
    return {index, value};
  }
  function moveStroke(event) {
    if (!stroke || stroke.id !== event.pointerId) return;
    const next = point(event), previous = stroke.previous, distance = Math.abs(next.index - previous.index);
    for (let step = 0; step <= distance; step++) {
      const ratio = distance ? step / distance : 1, index = Math.round(previous.index + (next.index - previous.index) * ratio);
      stroke.samples[index] = Math.round(previous.value + (next.value - previous.value) * ratio);
    }
    stroke.previous = next; drawWave(stroke.samples);
    waveReadout.textContent = `Sample ${next.index} · value ${next.value} / 15 · release to apply`;
  }
  listen(canvas, 'pointerdown', event => {
    if (event.button !== 0 || stroke || preset.source !== 'wave') return;
    event.preventDefault(); canvas.setPointerCapture(event.pointerId);
    stroke = {id:event.pointerId, samples:[...preset.wave.samples], previous:point(event)}; moveStroke(event);
  });
  listen(canvas, 'pointermove', moveStroke);
  listen(canvas, 'pointerup', event => {
    if (!stroke || stroke.id !== event.pointerId) return;
    moveStroke(event); const samples = stroke.samples; stroke = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    commit(value => {value.wave.samples = samples;});
    waveReadout.textContent = 'Wave applied · press a key to hear it';
  });
  function cancelStroke(event) {
    if (!stroke || event?.pointerId !== undefined && stroke.id !== event.pointerId) return;
    const pointer=stroke.id;stroke = null;
    if(canvas.hasPointerCapture?.(pointer))canvas.releasePointerCapture(pointer);
    drawWave(); waveReadout.textContent = 'Drawing cancelled · previous wave kept';
  }
  listen(canvas, 'pointercancel', cancelStroke); listen(canvas, 'lostpointercapture', cancelStroke);
  listen(win, 'blur', cancelStroke);
  function resizeWave() {
    if (disposed || !canvas.clientWidth || !canvas.clientHeight) return;
    // Use logical CSS pixels so labels stay readable when the editor narrows.
    // Hidden source panels report zero; retain their last useful backing size.
    const width = Math.max(240, Math.round(canvas.clientWidth)), height = Math.max(150, Math.round(canvas.clientHeight));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width; canvas.height = height; drawWave(stroke?.samples);
  }
  const Resize = win.ResizeObserver ?? globalThis.ResizeObserver;
  if (typeof Resize === 'function') {
    const observer = new Resize(resizeWave); observer.observe(canvas);
    cleanups.push(() => observer.disconnect());
  } else listen(win, 'resize', resizeWave);
  function render() {
    if (disposed) return;
    for (const {input, get, update} of fields.values()) {
      if (update) {update();continue;}
      const value = get(preset);
      if (input.type === 'checkbox') input.checked = value;
      else if (doc.activeElement !== input) input.value = String(value);
    }
    pulse.hidden = preset.source !== 'pulse'; wave.hidden = preset.source !== 'wave'; noise.hidden = preset.source !== 'noise';
    sourceControl.setDisabled(liveChannel!==null);
    sweepEnabled.disabled=liveChannel!==null&&liveChannel!==0;
    for (const input of sweepControls) {
      if (input.setDisabled) input.setDisabled(!preset.pulse.sweep.enabled||liveChannel!==null&&liveChannel!==0);
      else input.disabled = !preset.pulse.sweep.enabled||liveChannel!==null&&liveChannel!==0;
    }
    sourceHint.textContent = preset.source === 'pulse' ? (preset.pulse.sweep.enabled ? 'CH1 · one voice with hardware Sweep.' : 'CH1 + CH2 · two voices in round robin.') : preset.source === 'wave' ? 'CH3 · one voice, with your own Wave RAM.' : 'CH4 · one noise voice. Keys trigger; they do not change pitch.';
    if(liveChannel!==null)sourceHint.textContent=liveOrigin==='VGM'?`VGM CH ${liveChannel+1} · read-only sent / configured ${preset.source} settings.`:`${liveOrigin} CH ${liveChannel+1} · edit this physical channel. Choose another CH above to change source.`;
    const high = preset.pulse.duty * 80; let path = '';
    for (let index = 0; index < 4; index++) {const x = index * 80; path += `${index ? 'L' : 'M'}${x} 10 L${x + high} 10 L${x + high} 36 L${x + 80} 36 `;}
    pulsePath.setAttribute('d', path); resizeWave(); drawWave(stroke?.samples);
    if (!stroke) waveReadout.textContent = '32 samples · 4-bit levels · draw, then release to apply';
  }
  render();
  return {
    update(value, {channel = null, origin = 'Code'} = {}) {
      if (disposed) return;
      const next = readPreset(value);
      if(channel!==liveChannel||origin!==liveOrigin||next.source!==preset.source){for(const cancel of cancelGestures)cancel();cancelStroke();}
      if (stroke && next.wave.samples.some((sample, index) => sample !== preset.wave.samples[index])) cancelStroke();
      preset = next; liveChannel = channel; liveOrigin = origin; render();
    },
    isInteracting:()=>Boolean(stroke||dragging),
    dispose() {if (disposed) return; disposed = true; stroke = null; for (const cleanup of cleanups) cleanup(); body.remove();},
  };
}
