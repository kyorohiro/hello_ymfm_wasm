// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

/** Passive SPC sound browser. Opening a snapshot never selects or plays a sound.
 * onOpen(file, {signal}) returns the batch prepared by parseSpcVoices.
 * onSelect(candidate, {includeEcho, includePmon, signal, onCommit}) adopts one
 * validated voice / pair, dry / Echo variant. Changing import mode never adopts a sound. Call
 * onCommit immediately before adoption; cancellation ends at that boundary.
 * Reject a stale selection with AbortError so its row is not marked selected.
 */
export function createSpcBrowser({root, onOpen, onSelect, onError = () => {}}) {
  if (!root || typeof onOpen !== 'function' || typeof onSelect !== 'function')
    throw new TypeError('SPC browser requires a root, onOpen and onSelect');
  const doc = root.ownerDocument, cleanups = [];
  let disposed = false, sequence = 0, operation = null, batch = null, selectedId = null, selectedMode = null;
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const listen = (node, type, callback) => {
    node.addEventListener(type, callback);
    cleanups.push(() => node.removeEventListener(type, callback));
  };
  const text = value => String(value ?? '').slice(0, 1024);
  const hex = value => Number.isInteger(value) ? '$' + value.toString(16).toUpperCase().padStart(4, '0') : '—';
  const usesPair = (candidate, enabled = includePmon.checked) => enabled && candidate?.voice.pitchModulation && !candidate.voice.noise;
  const voiceLabel = (candidate, pairMode = includePmon.checked) => usesPair(candidate, pairMode)
    ? `CH${candidate.voice.index} → CH${candidate.voice.index + 1} · PMON`
    : `CH${candidate.voice.index + 1} · ${candidate.voice.noise ? 'Noise' : 'SRCN ' + candidate.voice.sourceNumber}`;
  const modeKey = (echo = includeEcho.checked, pmon = includePmon.checked) => `${Number(echo)}:${Number(pmon)}`;
  const abortError = () => new DOMException('SPC operation cancelled', 'AbortError');
  const section = make('details', 'sdsp-card sdsp-spc-browser');
  section.id = 'spcSection'; section.open = true;
  section.append(make('summary', '', 'Sounds from SPC'));
  const content = make('div', 'sdsp-card-content'); section.append(content);
  const actions = make('div', 'sdsp-file-actions');
  const load = make('button', '', 'Load SPC…'); load.id = 'loadSpc'; load.type = 'button';
  const input = make('input'); input.id = 'spcFileInput'; input.type = 'file'; input.accept = '.spc'; input.hidden = true;
  input.setAttribute('aria-label', 'Choose SPC snapshot for sound extraction');
  const cancel = make('button', '', 'Cancel'); cancel.id = 'cancelSpcImport'; cancel.type = 'button'; cancel.hidden = true;
  actions.append(load, input, cancel); content.append(actions);
  const hint = make('p', 'sdsp-help', 'Opening a file keeps the current instrument. Select a sound below to load it, then play the keyboard, edit it or save a preset.');
  content.append(hint);
  const echoOption = make('label', 'sdsp-spc-echo-option');
  const includeEcho = make('input'); includeEcho.id = 'spcIncludeEcho'; includeEcho.type = 'checkbox';
  echoOption.append(includeEcho, make('span', '', 'Import Echo / FIR settings')); content.append(echoOption);
  const pmonOption = make('label', 'sdsp-spc-echo-option');
  const includePmon = make('input'); includePmon.id = 'spcIncludePmon'; includePmon.type = 'checkbox';
  pmonOption.append(includePmon, make('span', '', 'Import PMON pairs')); content.append(pmonOption);
  const echoInfo = make('p', 'sdsp-help sdsp-spc-echo-info'); echoInfo.id = 'spcEchoInfo'; content.append(echoInfo);
  const pmonInfo = make('p', 'sdsp-help'); pmonInfo.id = 'spcPmonInfo'; content.append(pmonInfo);
  const status = make('p', 'sdsp-help', 'Load an SPC snapshot to inspect its eight voice settings.');
  status.id = 'spcImportStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); content.append(status);
  const metadata = make('p', 'sdsp-spc-metadata'); metadata.id = 'spcMetadata'; metadata.hidden = true; content.append(metadata);
  const warnings = make('ul', 'sdsp-spc-warnings'); warnings.id = 'spcWarnings'; warnings.hidden = true; content.append(warnings);
  const list = make('div', 'sdsp-spc-candidates'); list.id = 'spcCandidates'; content.append(list);
  content.append(make('p', 'sdsp-help', 'Snapshot voice settings only: no song playback, SPC700 driver updates, or restoration of the current envelope phase. For BRR voices, C4 is a declared audition reference at the captured PITCH, not the original musical root. Noise uses the shared clock instead of musical pitch. Activity is only an ENVX / OUTX snapshot heuristic; inactive voices may still contain usable settings.'));
  root.append(section);

  function setStatus(message, error = false) {
    if (disposed) return;
    status.textContent = message; status.dataset.error = String(error);
  }
  const current = op => !disposed && operation === op && op.token === sequence && !op.controller.signal.aborted;
  const variant = (candidate, echo = includeEcho.checked, pmon = includePmon.checked) => usesPair(candidate, pmon)
    ? candidate?.[echo ? 'pmonEchoVariant' : 'pmonVariant'] ?? {preset:null, reason:'PMON pair settings are unavailable. Open the SPC file again.', warnings:[]}
    : echo ? candidate?.echoVariant ?? {preset:null, reason:'Echo settings are unavailable. Open the SPC file again.', warnings:[]} : candidate;
  function showEchoInfo() {
    pmonInfo.textContent = includePmon.checked
      ? 'Next selection imports a recorded PMON carrier with its preceding modulator. Other voices keep their ordinary settings. Both BRR PITCH references are declared at C4; original fundamentals, playback phases and song automation are not recovered. Changing this option keeps the current instrument.'
      : 'PMON pairs are off. Recorded PMON carriers load their base voice only. Enable this option before selecting a carrier to import its preceding modulator too; changing the option does not change the current sound.';
    const next = includeEcho.checked ? 'Next selection imports captured Echo / FIR settings.' : 'Next selection loads the voice only, with Echo Off.';
    const echo = batch?.echo;
    if (!echo) {echoInfo.textContent = next + ' Changing this option keeps the current instrument. Past Echo audio and tails are not restored.'; return;}
    const delay = echo.delay === 0 ? '0 (one stereo frame)' : `${echo.delay * 16} ms (code ${echo.delay})`;
    const fir = Array.isArray(echo.fir) ? ' · FIR ' + echo.fir.join(', ') : '';
    echoInfo.textContent = next + ` Recorded Echo: ${echo.enabled ? 'writes enabled' : 'writes disabled; imports Off'} · Delay ${delay} · Feedback ${echo.feedback} · Return L/R ${echo.volumeLeft}/${echo.volumeRight}${fir}. Send follows the selected CH. The Echo buffer starts empty; past audio and tails are not restored.`;
  }
  function availabilityStatus() {
    const available = batch.candidates.filter(candidate => variant(candidate)?.preset).length;
    return available ? `${available} of ${batch.candidates.length} voice candidates available${includeEcho.checked ? ' with captured Echo settings' : ''}${includePmon.checked ? ' / recorded PMON pairs where present' : ''}. Current instrument kept. Select a sound to load it.`
      : 'No playable voice candidates in this import mode. Current instrument kept. See the reasons below.';
  }
  function refresh() {
    const applying = operation?.committing === true;
    load.disabled = applying;
    includeEcho.disabled = applying;
    includePmon.disabled = applying;
    cancel.hidden = !operation || applying;
    section.setAttribute('aria-busy', String(Boolean(operation)));
    showEchoInfo();
    for (const button of list.querySelectorAll('[data-spc-voice]')) {
      const candidate = batch?.candidates.find(item => item.voice.index === Number(button.dataset.spcVoice));
      const selected = candidate?.id === selectedId && modeKey() === selectedMode;
      button.disabled = applying || !variant(candidate)?.preset;
      button.setAttribute('aria-pressed', String(selected));
      button.closest('.sdsp-spc-candidate')?.classList.toggle('is-selected', selected);
    }
  }
  function cancelOperation(message) {
    if (!operation || operation.committing) return false;
    sequence++; operation.controller.abort(); operation = null; refresh();
    if (message) setStatus(message);
    return true;
  }
  function startOperation(kind) {
    cancelOperation();
    const op = {kind, token:++sequence, controller:new AbortController(), committing:false};
    operation = op; refresh(); return op;
  }
  function showBatch() {
    const tags = batch.metadata ?? {};
    metadata.textContent = [text(batch.name), tags.title && 'Title: ' + text(tags.title),
      tags.game && 'Game: ' + text(tags.game), tags.artist && 'Artist: ' + text(tags.artist),
      'DIR ' + hex(batch.directory << 8)].filter(Boolean).join(' · ');
    metadata.hidden = false;
    warnings.replaceChildren();
    for (const warning of batch.warnings ?? []) warnings.append(make('li', '', text(warning)));
    warnings.hidden = !warnings.childElementCount;
    list.replaceChildren();
    for (const candidate of batch.candidates) {
      const voice = candidate.voice, sample = candidate.sample, choice = variant(candidate);
      const row = make('div', 'sdsp-spc-candidate'); row.dataset.candidateId = candidate.id;
      const button = make('button', 'sdsp-spc-select', voiceLabel(candidate));
      button.type = 'button'; button.id = 'spcCandidate' + voice.index; button.dataset.spcVoice = String(voice.index);
      button.disabled = !choice?.preset; button.setAttribute('aria-pressed', 'false');
      const details = make('div', 'sdsp-spc-candidate-copy');
      details.id = `spcCandidate${voice.index}Info`; button.setAttribute('aria-describedby', details.id);
      const state = voice.active ? 'Activity detected' : 'Inactive snapshot';
      const pitch = voice.noise ? 'Noise clock ' + (batch.noiseClock ?? candidate.preset?.noise?.clock ?? '—') : 'PITCH ' + voice.pitch;
      details.append(make('p', 'sdsp-spc-voice', `${state} · ${usesPair(candidate) ? 'Carrier SRCN ' + voice.sourceNumber + ' · ' : ''}${pitch} · L/R ${voice.volumeLeft}/${voice.volumeRight} · ${voice.envelopeMode === 'adsr' ? 'ADSR' : 'GAIN'}${includeEcho.checked ? ' · Echo send ' + (voice.echo ? 'On' : 'Off') : ''}`));
      if (sample) {
        const unresolved = [choice?.reason, ...(choice?.warnings ?? [])].some(message => /loop target/i.test(message ?? ''));
        const loop = sample.loopStartSamples === null ? (unresolved ? 'Loop unresolved' : 'One-shot') : 'Loop frame ' + sample.loopStartSamples;
        details.append(make('p', '', `${sample.bytes.toLocaleString('en-US')} BRR bytes · ${sample.frames.toLocaleString('en-US')} frames · ${loop} · Start ${hex(sample.startAddress)}`));
      }
      if (usesPair(candidate) && candidate.pmonPair) {
        const mod = candidate.pmonPair.modulatorVoice, modSample = candidate.pmonPair.sample;
        details.append(make('p', 'sdsp-spc-pair', `Modulator CH${mod.index + 1} · SRCN ${mod.sourceNumber} · PITCH ${mod.pitch} · ${mod.envelopeMode === 'adsr' ? 'ADSR' : 'GAIN'} · silent stereo output`));
        if (modSample) {
          const unresolved = [choice?.reason, ...(choice?.warnings ?? [])].some(message => /modulator.*loop|loop.*modulator/i.test(message ?? ''));
          const loop = modSample.loopStartSamples === null ? (unresolved ? 'Loop unresolved' : 'One-shot') : 'Loop frame ' + modSample.loopStartSamples;
          details.append(make('p', '', `Modulator ${modSample.bytes.toLocaleString('en-US')} BRR bytes · ${modSample.frames.toLocaleString('en-US')} frames · ${loop} · Start ${hex(modSample.startAddress)}`));
        }
      }
      if (choice?.reason) details.append(make('p', 'sdsp-spc-unavailable', 'Unavailable: ' + text(choice.reason)));
      for (const warning of choice?.warnings ?? []) {
        // Shared buffer/history limits already appear above the list. Keep
        // complete parser warnings for reuse without repeating them per row.
        if (includeEcho.checked && text(warning).startsWith('Captured Echo / FIR parameters start with an empty buffer.')) continue;
        details.append(make('p', 'sdsp-spc-warning', text(warning)));
      }
      row.append(button, details); list.append(row);
    }
    refresh();
  }
  async function openFile(file) {
    if (disposed || operation?.committing) return;
    const op = startOperation('open');
    op.fileName = text(file.name);
    setStatus('Reading ' + text(file.name) + '… Current instrument kept.');
    try {
      const next = await onOpen(file, {signal:op.controller.signal});
      if (!current(op)) return;
      if (!next || !Array.isArray(next.candidates)) throw new TypeError('SPC import returned no voice candidates');
      batch = next; selectedId = null; selectedMode = null; showBatch();
      setStatus(availabilityStatus());
    } catch (error) {
      if (!current(op)) return;
      if (error?.name === 'AbortError') setStatus('SPC import cancelled. Current instrument and previous list kept.');
      else {
        setStatus('SPC import failed: ' + text(error?.message ?? error) + ' Current instrument and previous list kept.', true);
        onError(error);
      }
    } finally {
      if (operation === op) {operation = null; refresh();}
    }
  }
  async function selectCandidate(candidate) {
    const mode = includeEcho.checked, pairMode = includePmon.checked;
    if (disposed || operation?.committing || !variant(candidate, mode, pairMode)?.preset) return;
    const op = startOperation('select');
    op.includeEcho = mode; op.includePmon = pairMode;
    setStatus(`Preparing ${voiceLabel(candidate, pairMode)}…`);
    try {
      const message = await onSelect(candidate, {includeEcho:mode, includePmon:pairMode, signal:op.controller.signal, onCommit() {
        if (!current(op)) throw abortError();
        op.committing = true; refresh();
        setStatus(`Applying ${voiceLabel(candidate, pairMode)}…`);
      }});
      if (!current(op)) return;
      selectedId = candidate.id; selectedMode = modeKey(mode, pairMode); refresh();
      setStatus(typeof message === 'string' ? message : `Loaded ${voiceLabel(candidate, pairMode)}. Play the keyboard, edit it or save a preset.`);
    } catch (error) {
      if (!current(op)) return;
      if (error?.name === 'AbortError') setStatus('SPC sound selection cancelled. Current instrument kept.');
      else {
        setStatus('SPC sound load failed: ' + text(error?.message ?? error) + ' Current instrument kept.', true);
        onError(error);
      }
    } finally {
      if (operation === op) {operation = null; refresh();}
    }
  }
  function changeMode() {
    includeEcho.blur();includePmon.blur();
    if (disposed) return;
    if (operation?.committing) {includeEcho.checked = operation.includeEcho;includePmon.checked = operation.includePmon; refresh(); return;}
    if (operation?.kind === 'select') cancelOperation();
    if (batch) showBatch(); else refresh();
    setStatus(operation?.kind === 'open'
      ? `Reading ${operation.fileName}… Import mode changed for the next selection. Current instrument kept.`
      : batch ? availabilityStatus() : 'Import mode changed. Current instrument kept. Load an SPC, then select a sound.');
  }
  listen(includeEcho, 'change', changeMode);listen(includePmon, 'change', changeMode);
  listen(load, 'click', () => {load.blur(); if (!disposed && !operation?.committing) input.click();});
  listen(input, 'cancel', () => {
    input.blur();
    if (!operation) setStatus('File selection cancelled. Current instrument and previous list kept.');
  });
  listen(input, 'change', () => {
    const file = input.files?.[0]; input.value = ''; input.blur();
    if (file) void openFile(file);
  });
  listen(cancel, 'click', () => {cancel.blur(); cancelOperation('SPC import cancelled. Current instrument and previous list kept.');});
  listen(list, 'pointerdown', event => {
    if (event.button === 0 && event.target.closest('[data-spc-voice]')) {event.preventDefault(); doc.activeElement?.blur();}
  });
  listen(list, 'click', event => {
    const button = event.target.closest('[data-spc-voice]');
    if (!button || button.disabled) return;
    button.blur();
    const candidate = batch?.candidates.find(item => item.voice.index === Number(button.dataset.spcVoice));
    if (candidate) void selectCandidate(candidate);
  });
  refresh();
  return {
    clearSelection() {if (!disposed) {selectedId = null; selectedMode = null; refresh();}},
    dispose() {
      if (disposed) return;
      disposed = true; sequence++; operation?.controller.abort(); operation = null; batch = null;
      for (const cleanup of cleanups) cleanup(); section.remove();
    },
  };
}
