// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createDefaultPreset, readPreset, waveShape, MAX_DPCM_BYTES, createDemoDpcm} from './preset.js';
import {createDmcBitEditor} from './dmc_editor.js';

/** A passive editor. Editing never creates an audio device. */
export function createEditor({root, onChange = () => {}, onSaveDpcm = () => {}, onError = () => {}}) {
  const doc = root.ownerDocument, win = doc.defaultView ?? globalThis;
  const cleanups = [], fields = new Map(), pointerControls = new WeakSet();
  let preset = createDefaultPreset(), disposed = false, stroke = null;
  let dpcmRequest = 0, readingDpcm = false;
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
  function commit(mutator, {resetDmcHistory = false} = {}) {
    if (disposed) return;
    try {
      const next = readPreset(preset); mutator(next);
      const checked = readPreset(next);
      cancelDpcmRead(); preset = checked; render({resetDmcHistory});
      Promise.resolve(onChange(readPreset(preset))).catch(report);
      return true;
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
    const row = make('label', 'nes-field'); row.htmlFor = id;
    row.append(make('span', '', label)); parent.append(row); return row;
  }
  function select(parent, label, id, choices, get, set) {
    const row = make('div', 'nes-field nes-choice-field'), title = make('span', '', label);
    title.id = `${id}Label`; row.dataset.choice = id; row.append(title); parent.append(row);
    const group = make('div', 'nes-choice-group'); group.id = id;
    group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-labelledby', title.id); row.append(group);
    let disabled = false;
    const buttons = choices.map(([value, text]) => {
      const button = make('button', 'nes-choice', text); button.type = 'button';
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
    const row = make('div', 'nes-field'), title = make('span', '', label);
    title.id = `${id}Label`; row.append(title); parent.append(row);
    const group = make('div', 'nes-stepper'); group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', title.id); row.append(group);
    const minus = make('button', 'nes-stepper-button', '−'), plus = make('button', 'nes-stepper-button', '+');
    const output = make('output', 'nes-stepper-value'); output.id = id;
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
      drag = {id: event.pointerId, x: event.clientX, value: get(preset)};
      output.setPointerCapture(event.pointerId); output.classList.add('is-dragging');
    });
    listen(output, 'pointermove', event => {
      if (drag?.id === event.pointerId) adjust(drag.value + Math.round((event.clientX - drag.x) / 8));
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
    const row = field(parent, label, id); row.classList.add('nes-check');
    const input = make('input'); input.type = 'checkbox'; input.id = id; row.prepend(input);
    fields.set(id, {input, get});
    listen(input, 'change', () => commit(value => set(value, input.checked)));
    performanceFocus(input); return input;
  }
  function card(title) {
    const element = make('section', 'nes-card'); element.append(make('h3', '', title)); body.append(element); return element;
  }
  function section(parent, title) {
    const element = make('div', 'nes-subsection'); element.append(make('h4', '', title)); parent.append(element); return element;
  }
  function group(parent) { const element = make('div', 'nes-fields'); parent.append(element); return element; }
  function help(parent, text) { const element = make('p', 'nes-help', text); parent.append(element); return element; }
  const body = make('div', 'nes-editor'); root.append(body);
  const sourceBar = make('div', 'nes-source-bar'); body.append(sourceBar);
  select(sourceBar, 'Source', 'source', [['pulse','Pulse'],['triangle','Triangle'],['noise','Noise'],['dmc','DMC'],['fds','FDS']], value => value.source, (value, source) => {value.source = source;});
  const sourceHint = make('p'); sourceBar.append(sourceHint);

  const pulse = card('Pulse · hardware square waves'), pulseFields = group(pulse);
  select(pulseFields, 'Duty', 'pulseDuty', [[.125,'12.5%'],[.25,'25%'],[.5,'50%'],[.75,'75%']], value => value.pulse.duty, (value, duty) => {value.pulse.duty = Number(duty);});
  const fixedVolume = number(pulseFields, 'Fixed volume · 0–15', 'pulseVolume', 0, 15, value => value.pulse.volume, (value, volume) => {value.pulse.volume = volume;});
  const pulsePreview = make('div', 'nes-pulse-preview'); pulsePreview.setAttribute('aria-hidden','true');
  const pulseSvg = doc.createElementNS('http://www.w3.org/2000/svg','svg'), pulsePath = doc.createElementNS('http://www.w3.org/2000/svg','path');
  pulseSvg.setAttribute('viewBox','0 0 320 46'); pulseSvg.setAttribute('preserveAspectRatio','none'); pulseSvg.append(pulsePath); pulsePreview.append(pulseSvg); pulse.append(pulsePreview);
  const envelopeFields = group(section(pulse, 'Hardware volume envelope'));
  checkbox(envelopeFields, 'Enable Envelope', 'pulseEnvelopeEnabled', value => value.pulse.envelope.enabled, (value, enabled) => {value.pulse.envelope.enabled = enabled;});
  const envelopePeriod = number(envelopeFields, 'Period · 0–15', 'pulseEnvelopePeriod', 0, 15, value => value.pulse.envelope.period, (value, period) => {value.pulse.envelope.period = period;});
  const envelopeLoop = checkbox(envelopeFields, 'Loop Envelope', 'pulseEnvelopeLoop', value => value.pulse.envelope.loop, (value, loop) => {value.pulse.envelope.loop = loop;});
  help(pulse, 'Envelope starts at the hardware maximum and decays; looping repeats it. Period 0 is the fastest setting. Fixed volume applies when Envelope is off. Envelope changes take effect on the next note.');
  const sweepFields = group(section(pulse, 'Hardware pitch sweep · both Pulse channels'));
  checkbox(sweepFields, 'Enable Sweep', 'sweepEnabled', value => value.pulse.sweep.enabled, (value, enabled) => {value.pulse.sweep.enabled = enabled;});
  const sweepControls = [
    select(sweepFields, 'Direction', 'sweepNegate', [[false,'Pitch down'],[true,'Pitch up']], value => value.pulse.sweep.negate, (value, negate) => {value.pulse.sweep.negate = negate === 'true';}),
    number(sweepFields, 'Period · 0–7', 'sweepPeriod', 0, 7, value => value.pulse.sweep.period, (value, period) => {value.pulse.sweep.period = period;}),
    number(sweepFields, 'Shift · 0 = no change', 'sweepShift', 0, 7, value => value.pulse.sweep.shift, (value, shift) => {value.pulse.sweep.shift = shift;}),
  ];
  help(pulse, 'Both Pulse channels have Sweep, so round robin keeps two voices. The hardware changes the timer: Pitch up subtracts from it. Sweep edits apply on the next note.');

  const triangle = card('Triangle · fixed hardware waveform');
  const trianglePreview = make('div','nes-triangle-preview'); trianglePreview.setAttribute('aria-hidden','true');
  trianglePreview.innerHTML = '<svg viewBox="0 0 320 60" preserveAspectRatio="none"><path d="M0 50 L40 10 L80 50 L120 10 L160 50 L200 10 L240 50 L280 10 L320 50"/></svg>';
  triangle.append(trianglePreview);
  help(triangle, 'One Triangle channel follows your keyboard notes. Its waveform and level are fixed by the hardware; use Master for the output level. This version keeps the hardware gate open while a key is held.');

  const noise = card('Noise · hardware LFSR'), noiseFields = group(noise);
  const noiseFixedVolume = number(noiseFields, 'Fixed volume · 0–15', 'noiseVolume', 0, 15, value => value.noise.volume, (value, volume) => {value.noise.volume = volume;});
  number(noiseFields, 'Period code · 0–15', 'noisePeriod', 0, 15, value => value.noise.period, (value, period) => {value.noise.period = period;});
  select(noiseFields, 'LFSR mode', 'noiseShortMode', [[false,'Long sequence'],[true,'Short sequence']], value => value.noise.shortMode, (value, shortMode) => {value.noise.shortMode = shortMode === 'true';});
  const noiseEnvelopeFields = group(section(noise, 'Hardware volume envelope'));
  checkbox(noiseEnvelopeFields, 'Enable Envelope', 'noiseEnvelopeEnabled', value => value.noise.envelope.enabled, (value, enabled) => {value.noise.envelope.enabled = enabled;});
  const noiseEnvelopePeriod = number(noiseEnvelopeFields, 'Period · 0–15', 'noiseEnvelopePeriod', 0, 15, value => value.noise.envelope.period, (value, period) => {value.noise.envelope.period = period;});
  const noiseEnvelopeLoop = checkbox(noiseEnvelopeFields, 'Loop Envelope', 'noiseEnvelopeLoop', value => value.noise.envelope.loop, (value, loop) => {value.noise.envelope.loop = loop;});
  help(noise, 'The NES APU generates this envelope: volume starts at 15 and decays to 0; Loop repeats the decay. Period 0 is fastest. Fixed volume applies when Envelope is off. Envelope changes apply on the next note.');
  help(noise, 'One Noise channel. Every key triggers the same noise; note pitch and the Pitch wheels do not tune it. Period and LFSR mode change its clock and character while it sounds.');

  const dmc = card('DMC · 1-bit DPCM sample'), dmcActions = make('div', 'nes-wave-actions'); dmc.append(dmcActions);
  const loadDpcm = make('button', '', 'Load DPCM…'), demoDpcm = make('button', '', 'Demo sample'), saveDpcm = make('button', '', 'Save DPCM…'), cancelDpcm = make('button', '', 'Cancel load');
  loadDpcm.id = 'loadDpcm'; demoDpcm.id = 'demoDpcm'; saveDpcm.id = 'saveDpcm'; cancelDpcm.id = 'cancelDpcm'; cancelDpcm.hidden = true;
  saveDpcm.title = 'Save the committed sample bytes as .dmc, without generated padding. Save a preset to keep playback settings too.';
  const dpcmFileInput = make('input', 'file-input'); dpcmFileInput.type = 'file'; dpcmFileInput.id = 'dpcmFileInput';
  dpcmFileInput.accept = '.dmc,.dpcm,application/octet-stream'; dpcmFileInput.setAttribute('aria-label', 'Choose a pre-encoded DPCM sample, 1 to 4081 bytes');
  for (const button of [loadDpcm, demoDpcm, saveDpcm, cancelDpcm]) {
    button.type = 'button';
    listen(button, 'pointerdown', event => {if (event.button === 0) {event.preventDefault(); doc.activeElement?.blur();}});
  }
  dmcActions.append(loadDpcm, demoDpcm, saveDpcm, cancelDpcm, dpcmFileInput);
  const dpcmStatus = make('p', 'nes-help', 'No sample loaded. Load DPCM or choose Demo sample, then play the keyboard.');
  dpcmStatus.id = 'dpcmStatus'; dpcmStatus.dataset.error = 'false'; dpcmStatus.setAttribute('role', 'status'); dpcmStatus.setAttribute('aria-live', 'polite'); dmc.append(dpcmStatus);
  help(dmc, 'Save DPCM exports the committed bytes only, without generated padding. Save preset also keeps Rate, Loop and Initial level.');
  const dmcFields = group(dmc);
  number(dmcFields, 'Rate index · 0–15', 'dmcRate', 0, 15, value => value.dmc.rate, (value, rate) => {value.dmc.rate = rate;});
  number(dmcFields, 'Initial level · 0–127', 'dmcLevel', 0, 127, value => value.dmc.level, (value, level) => {value.dmc.level = level;});
  checkbox(dmcFields, 'Loop sample', 'dmcLoop', value => value.dmc.loop, (value, loop) => {value.dmc.loop = loop;});
  const dmcReadout = make('p', 'nes-wave-readout'); dmc.append(dmcReadout);
  const dmcBits = createDmcBitEditor({root:dmc, onChange:data => commit(value => {value.dmc.data = data;}), onError:report});
  help(dmc, 'DMC plays pre-encoded 1-bit DPCM bytes, not WAV or other ordinary audio files. A sample contains 1–4081 bytes; this app pads it to the hardware length of 16 × n + 1 bytes with alternating bits.');
  help(dmc, 'One DMC channel. Every key triggers the same sample at the selected Rate; keys and Pitch do not tune it. Rate changes pitch and duration together. Rate and Loop edits apply live; Initial level applies on the next trigger. Releasing the key stops playback.');
  function sampleStatus(text, error = false) {dpcmStatus.textContent = text; dpcmStatus.dataset.error = String(error);}
  function cancelDpcmRead() {
    dpcmRequest++;
    if (readingDpcm) sampleStatus('DPCM load cancelled. Current sound kept.');
    readingDpcm = false; cancelDpcm.hidden = true;
  }
  function installDpcm(data, label) {
    const length = Math.ceil((data.length - 1) / 16) * 16 + 1;
    if (!commit(value => {value.source = 'dmc'; value.dmc.data = data;}, {resetDmcHistory:true})) return;
    sampleStatus(`${label} · ${data.length} bytes${length !== data.length ? ` → ${length} hardware bytes` : ''} · play the keyboard.`);
  }
  listen(loadDpcm, 'click', () => {loadDpcm.blur(); dpcmFileInput.click();});
  listen(demoDpcm, 'click', () => {demoDpcm.blur(); installDpcm(createDemoDpcm(), 'Demo DPCM · software generated');});
  listen(saveDpcm, 'click', () => {
    saveDpcm.blur();
    if (disposed || !preset.dmc.data.length) return;
    try {Promise.resolve(onSaveDpcm([...preset.dmc.data])).catch(report);} catch (error) {report(error);}
  });
  listen(cancelDpcm, 'click', () => {cancelDpcm.blur(); cancelDpcmRead();});
  listen(dpcmFileInput, 'change', async () => {
    const file = dpcmFileInput.files?.[0]; dpcmFileInput.value = ''; dpcmFileInput.blur();
    if (!file) return;
    cancelDpcmRead(); const token = dpcmRequest; readingDpcm = true; cancelDpcm.hidden = false;
    sampleStatus(`Reading ${file.name}…`);
    try {
      if (!file.size || file.size > MAX_DPCM_BYTES) throw new RangeError(`DPCM samples must contain 1–${MAX_DPCM_BYTES} bytes.`);
      if (/\.(?:wav|wave|aif|aiff|mp3|mp4|m4a|ogg|flac|vgm|vgz)$/i.test(file.name)) throw new TypeError('Choose pre-encoded .dmc / .dpcm data. Audio and VGM files are not raw DPCM.');
      const buffer = await file.arrayBuffer();
      if (disposed || token !== dpcmRequest) return;
      // Recheck bytes rather than trusting file metadata or a stale read.
      if (!buffer.byteLength || buffer.byteLength > MAX_DPCM_BYTES) throw new RangeError(`DPCM samples must contain 1–${MAX_DPCM_BYTES} bytes.`);
      readingDpcm = false; cancelDpcm.hidden = true;
      installDpcm(Array.from(new Uint8Array(buffer)), `Loaded ${file.name}`);
    } catch (error) {
      if (!disposed && token === dpcmRequest) sampleStatus(`DPCM load failed: ${error.message} Current sound kept.`, true);
    } finally {
      if (token === dpcmRequest) {readingDpcm = false; cancelDpcm.hidden = true;}
    }
  });

  const fds = card('FDS · Wave RAM + frequency modulation'), fdsFields = group(fds);
  const fdsFixedVolume = number(fdsFields, 'Fixed volume · 0–32', 'fdsVolume', 0, 32, value => value.fds.volume, (value, volume) => {value.fds.volume = volume;});
  select(fdsFields, 'Master scale', 'fdsMaster', [[0,'100%'],[1,'67%'],[2,'50%'],[3,'40%']], value => value.fds.master, (value, master) => {value.fds.master = Number(master);});
  const fdsEnvelopeFields = group(section(fds, 'Hardware volume envelope'));
  checkbox(fdsEnvelopeFields, 'Enable Envelope', 'fdsEnvelopeEnabled', value => value.fds.envelope.enabled, (value, enabled) => {value.fds.envelope.enabled = enabled;});
  const fdsEnvelopeControls = [
    select(fdsEnvelopeFields, 'Direction', 'fdsEnvelopeIncrease', [[false,'Decrease'],[true,'Increase']], value => value.fds.envelope.increase, (value, increase) => {value.fds.envelope.increase = increase === 'true';}),
    number(fdsEnvelopeFields, 'Initial gain · 0–63', 'fdsEnvelopeInitialGain', 0, 63, value => value.fds.envelope.initialGain, (value, initialGain) => {value.fds.envelope.initialGain = initialGain;}),
    number(fdsEnvelopeFields, 'Period · 0–63', 'fdsEnvelopePeriod', 0, 63, value => value.fds.envelope.period, (value, period) => {value.fds.envelope.period = period;}),
  ];
  help(fds, 'The FDS hardware raises or lowers gain. Start at 0 for a rise, or 32 for a decay. Gain 33–63 stays at the output limit of 32 until it falls below it. Envelope settings apply on the next note.');
  const fdsClockFields = group(section(fds, 'Shared envelope clock · Volume + Depth'));
  const fdsEnvelopeMasterSpeed = number(fdsClockFields, 'Master period · 0–255', 'fdsEnvelopeMasterSpeed', 0, 255, value => value.fds.envelopeClock.masterSpeed, (value, masterSpeed) => {value.fds.envelopeClock.masterSpeed = masterSpeed;});
  const fdsEnvelopeHalt = checkbox(fdsClockFields, 'Pause both envelopes', 'fdsEnvelopeHalt', value => value.fds.envelopeClock.halt, (value, halt) => {value.fds.envelopeClock.halt = halt;});
  help(fds, 'Volume and Depth envelopes share this clock. Larger periods are slower; Master period 0 or Pause stops both. Each envelope has its own Period. Clock changes apply on the next note.');
  const editHeading = make('div','nes-wave-heading'), targets = make('div','nes-wave-actions');
  editHeading.append(make('span','nes-help','Edit one hardware table'),targets); fds.append(editHeading);
  let editTarget = 'wave', brush = 1;
  function action(parent, label, data, callback) {
    const button = make('button','',label); button.type='button';Object.assign(button.dataset,data);parent.append(button);
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();doc.activeElement?.blur();}});
    listen(button,'click',()=>{button.blur();callback();});return button;
  }
  const targetButtons = ['wave','modulation'].map(target => action(targets, target==='wave'?'Wave':'Modulation', {fdsEdit:target}, () => {
    cancelStroke();editTarget=target;render();
  }));
  const shapes = make('div','nes-wave-actions'); fds.append(shapes);
  for (const [name,label] of [['sine','Sine'],['triangle','Triangle'],['saw','Saw'],['square','Square']]) action(shapes,label,{waveShape:name},()=>commit(value=>{value.fds.wave=waveShape(name);}));
  const modShapes = make('div','nes-wave-actions');fds.append(modShapes);
  function modulationShape(name) {
    if(name==='flat')return Array(32).fill(0);
    if(name==='rise')return [4,...Array(31).fill(1)];
    if(name==='fall')return [4,...Array(31).fill(7)];
    return [...Array(8).fill(1),...Array(16).fill(7),...Array(8).fill(1)];
  }
  for (const [name,label] of [['flat','Flat'],['vibrato','Vibrato'],['rise','Rise'],['fall','Fall']]) action(modShapes,label,{modShape:name},()=>commit(value=>{value.fds.modulation.table=modulationShape(name);}));
  const brushRow = make('div','nes-wave-actions nes-mod-brush');fds.append(brushRow);
  const labels = ['0','+1','+2','+4','Reset','−4','−2','−1'];
  const brushButtons = labels.map((label,code)=>action(brushRow,label,{modCode:String(code)},()=>{brush=code;render();}));
  const canvas = make('canvas');canvas.id='fdsCanvas';canvas.width=900;canvas.height=220;canvas.setAttribute('role','img');fds.append(canvas);
  const waveReadout=make('p','nes-wave-readout');fds.append(waveReadout);
  const modulationFields = group(section(fds,'Hardware frequency modulation'));
  checkbox(modulationFields,'Enable modulation','fdsModEnabled',value=>value.fds.modulation.enabled,(value,enabled)=>{value.fds.modulation.enabled=enabled;});
  const fdsModRate = number(modulationFields,'Rate · 0–4095','fdsModRate',0,4095,value=>value.fds.modulation.rate,(value,rate)=>{value.fds.modulation.rate=rate;});
  const fdsFixedDepth = number(modulationFields,'Fixed depth · 0–63','fdsModDepth',0,63,value=>value.fds.modulation.depth,(value,depth)=>{value.fds.modulation.depth=depth;});
  const fdsModBias = number(modulationFields,'Bias · −64 to +63','fdsModBias',-64,63,value=>value.fds.modulation.bias,(value,bias)=>{value.fds.modulation.bias=bias;});
  const modulationControls = [fdsModRate,fdsFixedDepth,fdsModBias];
  help(fds,'Wave stores 64 six-bit samples. Modulation stores 32 commands that change an internal pitch counter; Reset clears that counter. Enable modulation to hear it vary the wave’s playback frequency. Rate controls its speed, Depth its strength and Bias its starting offset.');
  const fdsDepthEnvelopeFields = group(section(fds, 'Hardware depth envelope'));
  const fdsDepthEnvelopeEnabled = checkbox(fdsDepthEnvelopeFields, 'Enable Depth Envelope', 'fdsModEnvelopeEnabled', value => value.fds.modulation.envelope.enabled, (value, enabled) => {value.fds.modulation.envelope.enabled = enabled;});
  const fdsDepthEnvelopeControls = [
    select(fdsDepthEnvelopeFields, 'Direction', 'fdsModEnvelopeIncrease', [[false,'Decrease'],[true,'Increase']], value => value.fds.modulation.envelope.increase, (value, increase) => {value.fds.modulation.envelope.increase = increase === 'true';}),
    number(fdsDepthEnvelopeFields, 'Initial depth · 0–63', 'fdsModEnvelopeInitialGain', 0, 63, value => value.fds.modulation.envelope.initialGain, (value, initialGain) => {value.fds.modulation.envelope.initialGain = initialGain;}),
    number(fdsDepthEnvelopeFields, 'Period · 0–63', 'fdsModEnvelopePeriod', 0, 63, value => value.fds.modulation.envelope.period, (value, period) => {value.fds.modulation.envelope.period = period;}),
  ];
  help(fds, 'Enable modulation to hear the Depth Envelope. Increase raises depths below 32; Decrease falls toward 0. Start at 0 for a gradual increase. Fixed depth and Initial depth can reach 63. Volume and Depth use the Shared envelope clock above. Envelope edits apply on the next note.');
  help(fds,'Wave and modulation-table edits apply on release and stop held notes. Play a new note to hear them. Rate, Bias, Master scale and active fixed volume / depth can change while a note is held. Drawing and shape presets are software tools for editing these hardware tables.');

  function drawWave(samples = editTarget==='wave'?preset.fds.wave:preset.fds.modulation.table) {
    const context=canvas.getContext('2d');if(!context)return;
    const {width,height}=canvas,margin=24,top=18,bottom=height-25,isWave=editTarget==='wave',count=isWave?64:32;
    const step=(width-2*margin)/count,delta=[0,1,2,4,0,-4,-2,-1];
    const yFor=value=>isWave?bottom-value/63*(bottom-top):bottom-(value+4)/8*(bottom-top);
    context.fillStyle='#202831';context.fillRect(0,0,width,height);context.strokeStyle='#405365';context.lineWidth=1;
    for(let index=0;index<=count;index++){const x=margin+index*step;context.beginPath();context.moveTo(x,top);context.lineTo(x,bottom);context.stroke();}
    for(const level of isWave?[0,21,42,63]:[-4,0,4]){const y=yFor(level);context.beginPath();context.moveTo(margin,y);context.lineTo(width-margin,y);context.stroke();}
    context.fillStyle='#cbd9e7';context.font='12px sans-serif';context.fillText(isWave?'63':'+4',2,top+4);context.fillText(isWave?'0':'−4',3,bottom+4);
    context.fillText(isWave?'WAVE RAM · 64 × 6-bit':'MODULATION · 32 commands · R = reset',margin,height-7);
    context.strokeStyle=isWave?'#85bedf':'#e4b078';context.lineWidth=2.5;context.beginPath();
    for(let index=0;index<count;index++){const x=margin+index*step,y=yFor(isWave?samples[index]:delta[samples[index]]);if(!index)context.moveTo(x,y);else context.lineTo(x,y);context.lineTo(x+step,y);}
    context.stroke();
    if(!isWave){context.fillStyle='#ef9a91';for(let index=0;index<count;index++)if(samples[index]===4)context.fillText('R',margin+index*step+1,yFor(0)-6);}
  }
  function point(event) {
    const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*canvas.width,y=(event.clientY-rect.top)/rect.height*canvas.height;
    const count=editTarget==='wave'?64:32,index=Math.max(0,Math.min(count-1,Math.floor((x-24)/(canvas.width-48)*count)));
    const value=editTarget==='wave'?Math.max(0,Math.min(63,Math.round((canvas.height-25-y)/(canvas.height-43)*63))):brush;
    return {index,value};
  }
  function moveStroke(event) {
    if(!stroke||stroke.id!==event.pointerId)return;
    const next=point(event),previous=stroke.previous,distance=Math.abs(next.index-previous.index);
    for(let step=0;step<=distance;step++){
      const ratio=distance?step/distance:1,index=Math.round(previous.index+(next.index-previous.index)*ratio);
      stroke.samples[index]=editTarget==='wave'?Math.round(previous.value+(next.value-previous.value)*ratio):brush;
    }
    stroke.previous=next;drawWave(stroke.samples);
    waveReadout.textContent=editTarget==='wave'?`Sample ${next.index} · value ${next.value} / 63 · release to apply`:`Command ${next.index} · ${labels[next.value]} · release to apply`;
  }
  listen(canvas,'pointerdown',event=>{
    if(event.button!==0||stroke||preset.source!=='fds')return;
    event.preventDefault();doc.activeElement?.blur();canvas.setPointerCapture(event.pointerId);
    stroke={id:event.pointerId,samples:[...(editTarget==='wave'?preset.fds.wave:preset.fds.modulation.table)],previous:point(event)};moveStroke(event);
  });
  listen(canvas,'pointermove',moveStroke);
  listen(canvas,'pointerup',event=>{
    if(!stroke||stroke.id!==event.pointerId)return;
    moveStroke(event);const samples=stroke.samples;stroke=null;
    if(canvas.hasPointerCapture?.(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    commit(value=>{if(editTarget==='wave')value.fds.wave=samples;else value.fds.modulation.table=samples;});
    waveReadout.textContent='Table applied · press a key to hear it';
  });
  function cancelStroke(event) {
    if(!stroke||event?.pointerId!==undefined&&stroke.id!==event.pointerId)return;
    const id=stroke.id;stroke=null;if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);drawWave();
    waveReadout.textContent='Drawing cancelled · previous table kept';
  }
  listen(canvas,'pointercancel',cancelStroke);listen(canvas,'lostpointercapture',cancelStroke);listen(win,'blur',cancelStroke);
  function resizeWave() {
    if(disposed||!canvas.clientWidth||!canvas.clientHeight)return;
    const width=Math.max(240,Math.round(canvas.clientWidth)),height=Math.max(150,Math.round(canvas.clientHeight));
    if(canvas.width===width&&canvas.height===height)return;
    canvas.width=width;canvas.height=height;drawWave(stroke?.samples);
  }
  const Resize=win.ResizeObserver??globalThis.ResizeObserver;
  if(typeof Resize==='function'){const observer=new Resize(resizeWave);observer.observe(canvas);cleanups.push(()=>observer.disconnect());}
  else listen(win,'resize',resizeWave);
  function render({resetDmcHistory = false} = {}) {
    if(disposed)return;
    for(const {input,get,update} of fields.values()){
      if(update){update();continue;}const value=get(preset);
      if(input.type==='checkbox')input.checked=value;else if(doc.activeElement!==input)input.value=String(value);
    }
    pulse.hidden=preset.source!=='pulse';triangle.hidden=preset.source!=='triangle';noise.hidden=preset.source!=='noise';dmc.hidden=preset.source!=='dmc';fds.hidden=preset.source!=='fds';
    fixedVolume.setDisabled(preset.pulse.envelope.enabled);envelopePeriod.setDisabled(!preset.pulse.envelope.enabled);envelopeLoop.disabled=!preset.pulse.envelope.enabled;
    noiseFixedVolume.setDisabled(preset.noise.envelope.enabled);noiseEnvelopePeriod.setDisabled(!preset.noise.envelope.enabled);noiseEnvelopeLoop.disabled=!preset.noise.envelope.enabled;
    fdsFixedVolume.setDisabled(preset.fds.envelope.enabled);for(const control of fdsEnvelopeControls)control.setDisabled(!preset.fds.envelope.enabled);
    const fdsClockEnabled = preset.fds.envelope.enabled || preset.fds.modulation.envelope.enabled;
    fdsEnvelopeMasterSpeed.setDisabled(!fdsClockEnabled);fdsEnvelopeHalt.disabled=!fdsClockEnabled;
    for(const control of sweepControls)control.setDisabled(!preset.pulse.sweep.enabled);
    for(const control of modulationControls)control.setDisabled(!preset.fds.modulation.enabled);
    fdsFixedDepth.setDisabled(!preset.fds.modulation.enabled || preset.fds.modulation.envelope.enabled);
    fdsDepthEnvelopeEnabled.disabled=!preset.fds.modulation.enabled;
    for(const control of fdsDepthEnvelopeControls)control.setDisabled(!preset.fds.modulation.enabled || !preset.fds.modulation.envelope.enabled);
    for(const button of targetButtons)button.setAttribute('aria-pressed',String(button.dataset.fdsEdit===editTarget));
    for(const button of brushButtons)button.setAttribute('aria-pressed',String(Number(button.dataset.modCode)===brush));
    shapes.hidden=editTarget!=='wave';modShapes.hidden=brushRow.hidden=editTarget!=='modulation';
    canvas.setAttribute('aria-label',editTarget==='wave'?'Editable FDS waveform, 64 samples with values from 0 to 63':'Editable FDS modulation table, 32 pitch-counter commands');
    sourceHint.textContent={pulse:'CH1 + CH2 · two Pulse voices in round robin.',triangle:'CH3 · one fixed Triangle voice.',noise:'CH4 · one Noise voice. Keys trigger; they do not change pitch.',dmc:'CH5 · one DPCM sample. Keys trigger; Rate sets playback speed.',fds:'FDS · one Wave RAM voice, with hardware frequency modulation.'}[preset.source];
    const bytes = preset.dmc.data.length, hardwareBytes = bytes ? Math.ceil((bytes - 1) / 16) * 16 + 1 : 0;
    saveDpcm.disabled = bytes === 0;
    const bitRate = 1789773 / [428,380,340,320,286,254,226,214,190,160,142,128,106,84,72,54][preset.dmc.rate];
    dmcReadout.textContent = `${bytes} bytes${bytes !== hardwareBytes ? ` → ${hardwareBytes} hardware bytes` : ''} · ${(bitRate / 1000).toFixed(2)} kbit/s${bytes ? ` · about ${(hardwareBytes * 8 / bitRate * 1000).toFixed(0)} ms / pass` : ''}`;
    dmcBits.update(preset.dmc, {resetHistory:resetDmcHistory});
    const high=preset.pulse.duty*80;let path='';for(let index=0;index<4;index++){const x=index*80;path+=`${index?'L':'M'}${x} 10 L${x+high} 10 L${x+high} 36 L${x+80} 36 `;}
    pulsePath.setAttribute('d',path);resizeWave();drawWave(stroke?.samples);
    if(!stroke)waveReadout.textContent=editTarget==='wave'?'64 samples · 6-bit levels · draw, then release to apply':`32 commands · brush ${labels[brush]} · choose a command, then paint`;
  }
  render();
  return {
    update(value, {resetDmcHistory = false} = {}){
      if(disposed)return;const next=readPreset(value);
      dmcBits.cancelDrawing();
      if(stroke&&(next.source!==preset.source||JSON.stringify(next.fds)!==JSON.stringify(preset.fds)))cancelStroke();
      cancelDpcmRead();
      if(JSON.stringify(next.dmc.data)!==JSON.stringify(preset.dmc.data)) sampleStatus(next.dmc.data.length ? `Embedded DPCM · ${next.dmc.data.length} bytes · play the keyboard.` : 'No sample loaded. Load DPCM or choose Demo sample, then play the keyboard.');
      preset=next;render({resetDmcHistory});
    },
    dispose(){if(disposed)return;cancelDpcmRead();disposed=true;stroke=null;dmcBits.dispose();for(const cleanup of cleanups)cleanup();body.remove();},
  };
}
