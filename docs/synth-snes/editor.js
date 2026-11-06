// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.
import {createDefaultPreset, readPreset, waveShape, envelopeRegisters} from './preset.js';
import {decodeBase64, encodeBase64} from './sample.js';
import {decodeBrr} from '../js/snes_brr.js';

/** Passive sound editor: drawing and file conversion do not open an audio device. */
export function createEditor({root, onChange = () => {}, onError = () => {},
  onLoadAudio = async () => {throw new Error('Audio loading is not connected');},
  onLoadBrr = async () => {throw new Error('BRR loading is not connected');}}) {
  const doc = root.ownerDocument, win = doc.defaultView ?? globalThis;
  const cleanups = [], fields = new Map(), pointerControls = new WeakSet();
  let preset = createDefaultPreset(), disposed = false, stroke = null;
  let importRate = 16000, loadRequest = 0, loadController = null, committingImport = false;
  let previewData = null, preview = null, previewBins = null;
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
  select(sourceBar, 'Sound source', 'source', [['wave', 'Drawn wave'], ['brr', 'BRR sample']],
    value => value.source, (value, source) => {value.source = source;});
  const sourceHint = make('p'); sourceBar.append(sourceHint);

  const levelCard = card('Voice level · signed hardware gain', 'levelSection'), levels = group(levelCard.content);
  number(levels, 'Left · −128 to 127', 'volumeLeft', -128, 127, value => value.volume.left, (value, left) => {value.volume.left = left;});
  number(levels, 'Right · −128 to 127', 'volumeRight', -128, 127, value => value.volume.right, (value, right) => {value.volume.right = right;});
  help(levelCard.content, 'Signed S-DSP gains: a negative value inverts that output. The initial level leaves headroom for eight notes. Master controls the final output separately.');

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
  help(sampleCard.content, 'Audio is mixed to mono, resampled and encoded as lossy BRR without normalization. The S-DSP has 64 KiB of shared RAM; this instrument reserves its directory and accepts up to 64,512 BRR bytes. Longer audio is rejected without trimming it.');
  const sampleInfo = make('p', 'sdsp-sample-info'); sampleInfo.id = 'sampleInfo'; sampleCard.content.append(sampleInfo);
  const shapeActions = make('div', 'sdsp-wave-actions'); sampleCard.content.append(shapeActions);
  for (const [name, label] of [['sine','Sine'],['triangle','Triangle'],['saw','Saw'],['square','Square']]) {
    const button = make('button', '', label); button.type = 'button'; button.dataset.waveShape = name; shapeActions.append(button);
    listen(button, 'pointerdown', event => {if (event.button === 0) {event.preventDefault();doc.activeElement?.blur();}});
    listen(button, 'click', () => {cancelStroke();commit(value => {value.wave = waveShape(name);});});
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
    () => Math.max(0, decodedSample().pcm.length - 16),
    value => value.brr.loopStartSamples ?? 0, (value, frame) => {value.brr.loopStartSamples = frame;}, 16);
  help(tuning, 'BRR contains no original sample rate, musical root or loop address. Root / PITCH are your declared tuning. PITCH 4096 reads 32,000 source frames per second. Loop start uses decoded sample frames in blocks of 16; raw BRR loops initially use frame 0 unless you set another position.');

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
  async function importFile(kind, file) {
    cancelLoad();const token = ++loadRequest, controller = new AbortController();loadController = controller;committingImport = false;
    cancelImport.hidden = false;conversionRate.setDisabled(true);
    setLoadStatus('Preparing ' + file.name + '…');
    try {
      const callback = kind === 'audio' ? onLoadAudio : onLoadBrr;
      const message = await callback(file, {sampleRate:importRate, signal:controller.signal, onCommit() {
        if (disposed || token !== loadRequest || controller.signal.aborted) return;
        loadController = null;committingImport = true;cancelImport.hidden = true;setLoadStatus('Applying ' + file.name + '…');
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
    listen(button, 'click', () => {button.blur();input.click();});
    listen(input, 'cancel', () => {input.blur();if (!loadController && !committingImport) setLoadStatus('File selection cancelled. Current sample kept.');});
    listen(input, 'change', () => {const file=input.files?.[0];input.value='';input.blur();if (file && !disposed) void importFile(kind,file);});
  }
  listen(cancelImport, 'click', () => {cancelImport.blur();cancelLoad('Import cancelled. Current sample kept.');});

  function decodedSample() {
    const data = preset.brr.data;
    if (previewData !== data) {
      previewData = data;
      preview = data ? decodeBrr(decodeBase64(data)) : {pcm:new Float32Array(0),blockCount:0};
      previewBins = null;
    }
    return preview;
  }
  function drawWave(samples = stroke?.samples) {
    if (disposed || !canvas.clientWidth || !canvas.clientHeight) return;
    const width = canvas.width, height = canvas.height, left = 28, right = width - 15, top = 16, bottom = height - 28;
    const y = value => top + (1 - value) / 2 * (bottom - top), context = canvas.getContext('2d');if (!context) return;
    context.fillStyle = '#24252d';context.fillRect(0,0,width,height);
    context.strokeStyle = '#454650';context.lineWidth = 1;context.fillStyle = '#d7d7df';context.font = '11px sans-serif';
    for (const value of [-1,-.5,0,.5,1]) {
      context.beginPath();context.moveTo(left,y(value));context.lineTo(right,y(value));context.stroke();
      if (value === -1 || value === 0 || value === 1) context.fillText(String(value),3,y(value)+4);
    }
    context.strokeStyle = '#c5b0ff';context.lineWidth = 1.6;context.beginPath();
    if (preset.source === 'wave') {
      const values = samples ?? preset.wave;
      for (let index=0;index<values.length;index++) {
        const x = left + (right-left) * index / (values.length-1);
        if (!index) context.moveTo(x,y(values[index]));else context.lineTo(x,y(values[index]));
      }
    } else {
      const pcm = decodedSample().pcm, bins = Math.min(2048,Math.max(1,Math.floor(right-left)),pcm.length);
      if (!previewBins || previewBins.count !== bins) {
        const low=new Float32Array(bins),high=new Float32Array(bins);
        for(let bin=0;bin<bins;bin++) {
          const start=Math.floor(bin*pcm.length/bins),end=Math.floor((bin+1)*pcm.length/bins);let minimum=1,maximum=-1;
          for(let index=start;index<end;index++){minimum=Math.min(minimum,pcm[index]);maximum=Math.max(maximum,pcm[index]);}
          low[bin]=minimum;high[bin]=maximum;
        }
        previewBins={count:bins,low,high};
      }
      for (let bin=0;bin<bins;bin++) {
        const low=previewBins.low[bin],high=previewBins.high[bin],x=left+(right-left)*(bin+.5)/bins;
        context.moveTo(x,y(low));context.lineTo(x,y(high));
        if(low===high){context.moveTo(x-.5,y(low));context.lineTo(x+.5,y(high));}
      }
      if (!pcm.length) {context.moveTo(left,y(0));context.lineTo(right,y(0));}
    }
    context.stroke();context.fillStyle = '#d7d7df';
    context.fillText(preset.source==='wave' ? '128-POINT PCM · draw, then release to prepare BRR' : 'DECODED BRR · before DSP interpolation and envelope',left,height-8);
  }
  function point(event) {
    const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*canvas.width,y=(event.clientY-rect.top)/rect.height*canvas.height;
    return {index:Math.max(0,Math.min(127,Math.round((x-28)/(canvas.width-43)*127))),
      value:Math.max(-1,Math.min(1,1-2*(y-16)/(canvas.height-44)))};
  }
  function moveStroke(event) {
    if (!stroke || event.pointerId!==stroke.id) return;
    const next=point(event),previous=stroke.previous,distance=Math.abs(next.index-previous.index);
    for(let step=0;step<=distance;step++){
      const fraction=distance?step/distance:1,index=Math.round(previous.index+(next.index-previous.index)*fraction);
      stroke.samples[index]=Math.max(-1,Math.min(1,previous.value+(next.value-previous.value)*fraction));
    }
    stroke.previous=next;drawWave(stroke.samples);
    waveReadout.textContent='Sample '+next.index+' · '+next.value.toFixed(3)+' · release to apply';
  }
  listen(canvas,'pointerdown',event=>{
    if(event.button!==0||stroke||preset.source!=='wave')return;
    event.preventDefault();doc.activeElement?.blur();canvas.setPointerCapture(event.pointerId);
    stroke={id:event.pointerId,samples:preset.wave.slice(),previous:point(event)};moveStroke(event);
  });
  listen(canvas,'pointermove',moveStroke);
  listen(canvas,'pointerup',event=>{
    if(!stroke||stroke.id!==event.pointerId)return;
    moveStroke(event);const values=stroke.samples;stroke=null;
    if(canvas.hasPointerCapture?.(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    commit(value=>{value.wave=values;});
  });
  function cancelStroke(event) {
    if(!stroke||event?.pointerId!==undefined&&event.pointerId!==stroke.id)return;
    const id=stroke.id;stroke=null;
    if(canvas.hasPointerCapture?.(id))canvas.releasePointerCapture(id);
    drawWave();waveReadout.textContent='Drawing cancelled · previous wave kept';
  }
  listen(canvas,'pointercancel',cancelStroke);listen(canvas,'lostpointercapture',cancelStroke);listen(win,'blur',cancelStroke);
  listen(win,'keydown',event=>{if(event.key==='Escape'&&stroke){event.preventDefault();event.stopPropagation();cancelStroke();}});
  function resizeWave() {
    if(disposed||!canvas.clientWidth||!canvas.clientHeight)return;
    const width=Math.max(240,Math.round(canvas.clientWidth)),height=Math.max(150,Math.round(canvas.clientHeight));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    drawWave();
  }
  const Resize = win.ResizeObserver ?? globalThis.ResizeObserver;
  if(typeof Resize==='function'){
    const observer=new Resize(resizeWave);observer.observe(canvas);cleanups.push(()=>observer.disconnect());
  }else listen(win,'resize',resizeWave);
  function render() {
    if(disposed)return;
    for(const field of fields.values()){
      if(field.update){field.update();continue;}
      if(field.input.type==='checkbox')field.input.checked=field.get(preset);
    }
    const isWave=preset.source==='wave',hasBrr=Boolean(preset.brr.data),isGain=preset.envelope.mode==='gain';
    sourceHint.textContent=isWave?'One 128-point cycle, encoded as a BRR loop and played by eight physical S-DSP voices.':'One BRR sample shared by eight physical S-DSP voices. Root / PITCH declare its tuning.';
    shapeActions.hidden=!isWave;drawingHint.hidden=!isWave;tuning.hidden=isWave;
    canvas.dataset.editable=String(isWave);
    canvas.setAttribute('aria-label',isWave?'Editable 128-point waveform, normalized minus one to plus one':'Decoded BRR waveform overview');
    loopBrr.disabled=!hasBrr;loopStart.setDisabled(!hasBrr||preset.brr.loopStartSamples===null);
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
    if(isWave){
      sampleInfo.textContent='128 authored PCM points · one loop · BRR encoding is lossy · 32,000 Hz native DSP.';
      if(!stroke)waveReadout.textContent='Drawn wave · 128 points · release a stroke to apply';
    }else{
      const decoded=decodedSample(),frames=decoded.pcm.length,rate=32000*preset.brr.basePitch/4096;
      sampleInfo.textContent=frames?(preset.brr.name||'BRR sample')+' · '+frames.toLocaleString('en-US')+' decoded frames · '+(decodeBase64(preset.brr.data).length).toLocaleString('en-US')+' BRR bytes · '+(frames/rate).toFixed(3)+' s at Root'
        :'No BRR loaded · choose Load audio or Load BRR.';
      waveReadout.textContent=frames?'Decoded BRR overview · original root and loop address are not stored in BRR':'No sample loaded';
    }
    conversionRate.setDisabled(Boolean(loadController)||committingImport);resizeWave();
  }
  render();
  return {
    update(value) {
      if(disposed)return;
      const next=readPreset(value);
      if(loadController&&(next.source!==preset.source||next.brr.data!==preset.brr.data||next.wave.some((sample,index)=>sample!==preset.wave[index])))
        cancelLoad('Import cancelled after changing the instrument. Current sample kept.');
      if(stroke&&(next.source!==preset.source||next.wave.some((sample,index)=>sample!==preset.wave[index])))cancelStroke();
      if((next.brr.data!==preset.brr.data||next.brr.name!==preset.brr.name)&&!loadController&&!committingImport)
        setLoadStatus(next.brr.data?'Sample ready · play the keyboard, or load another file.':'Load audio or raw BRR to prepare a sample.');
      preset=next;render();
    },
    dispose() {
      if(disposed)return;
      cancelLoad();cancelStroke();disposed=true;previewData=preview=previewBins=null;
      for(const cleanup of cleanups)cleanup();body.remove();
    },
  };
}
