// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 kyorohiro.

/** Passive SPC sound browser. Opening a snapshot never selects or plays a sound.
 * onOpen(file, {signal}) returns the batch prepared by parseSpcVoices.
 * onSelect(candidate, {signal, onCommit}) adopts one validated preset. Call
 * onCommit immediately before adoption; cancellation ends at that boundary.
 * Reject a stale selection with AbortError so its row is not marked selected.
 */
export function createSpcBrowser({root, onOpen, onSelect, onError = () => {}}) {
  if (!root || typeof onOpen !== 'function' || typeof onSelect !== 'function')
    throw new TypeError('SPC browser requires a root, onOpen and onSelect');
  const doc = root.ownerDocument, cleanups = [];
  let disposed = false, sequence = 0, operation = null, batch = null, selectedId = null;
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
  const status = make('p', 'sdsp-help', 'Load an SPC snapshot to inspect its eight voice settings.');
  status.id = 'spcImportStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); content.append(status);
  const metadata = make('p', 'sdsp-spc-metadata'); metadata.id = 'spcMetadata'; metadata.hidden = true; content.append(metadata);
  const warnings = make('ul', 'sdsp-spc-warnings'); warnings.id = 'spcWarnings'; warnings.hidden = true; content.append(warnings);
  const list = make('div', 'sdsp-spc-candidates'); list.id = 'spcCandidates'; content.append(list);
  content.append(make('p', 'sdsp-help', 'Snapshot voice settings only: no song playback, SPC700 driver updates, or restoration of the current envelope phase. C4 is a declared audition reference at the captured PITCH, not the original musical root. Activity is only an ENVX / OUTX snapshot heuristic; inactive voices may still contain usable samples.'));
  root.append(section);

  function setStatus(message, error = false) {
    if (disposed) return;
    status.textContent = message; status.dataset.error = String(error);
  }
  const current = op => !disposed && operation === op && op.token === sequence && !op.controller.signal.aborted;
  function refresh() {
    const applying = operation?.committing === true;
    load.disabled = applying;
    cancel.hidden = !operation || applying;
    section.setAttribute('aria-busy', String(Boolean(operation)));
    for (const button of list.querySelectorAll('[data-spc-voice]')) {
      const candidate = batch?.candidates.find(item => item.voice.index === Number(button.dataset.spcVoice));
      button.disabled = applying || !candidate?.preset;
      button.setAttribute('aria-pressed', String(candidate?.id === selectedId));
      button.closest('.sdsp-spc-candidate')?.classList.toggle('is-selected', candidate?.id === selectedId);
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
      const voice = candidate.voice, sample = candidate.sample;
      const row = make('div', 'sdsp-spc-candidate'); row.dataset.candidateId = candidate.id;
      const button = make('button', 'sdsp-spc-select', `CH${voice.index + 1} · SRCN ${voice.sourceNumber}`);
      button.type = 'button'; button.id = 'spcCandidate' + voice.index; button.dataset.spcVoice = String(voice.index);
      button.disabled = !candidate.preset; button.setAttribute('aria-pressed', 'false');
      const details = make('div', 'sdsp-spc-candidate-copy');
      details.id = `spcCandidate${voice.index}Info`; button.setAttribute('aria-describedby', details.id);
      const state = voice.active ? 'Activity detected' : 'Inactive snapshot';
      details.append(make('p', 'sdsp-spc-voice', `${state} · PITCH ${voice.pitch} · L/R ${voice.volumeLeft}/${voice.volumeRight} · ${voice.envelopeMode === 'adsr' ? 'ADSR' : 'GAIN'}`));
      if (sample) {
        const unresolved = [candidate.reason, ...(candidate.warnings ?? [])].some(message => /loop target/i.test(message ?? ''));
        const loop = sample.loopStartSamples === null ? (unresolved ? 'Loop unresolved' : 'One-shot') : 'Loop frame ' + sample.loopStartSamples;
        details.append(make('p', '', `${sample.bytes.toLocaleString('en-US')} BRR bytes · ${sample.frames.toLocaleString('en-US')} frames · ${loop} · Start ${hex(sample.startAddress)}`));
      }
      if (candidate.reason) details.append(make('p', 'sdsp-spc-unavailable', 'Unavailable: ' + text(candidate.reason)));
      for (const warning of candidate.warnings ?? []) details.append(make('p', 'sdsp-spc-warning', text(warning)));
      row.append(button, details); list.append(row);
    }
    refresh();
  }
  async function openFile(file) {
    if (disposed || operation?.committing) return;
    const op = startOperation('open');
    setStatus('Reading ' + text(file.name) + '… Current instrument kept.');
    try {
      const next = await onOpen(file, {signal:op.controller.signal});
      if (!current(op)) return;
      if (!next || !Array.isArray(next.candidates)) throw new TypeError('SPC import returned no voice candidates');
      batch = next; selectedId = null; showBatch();
      const available = batch.candidates.filter(candidate => candidate.preset).length;
      setStatus(available ? `${available} of ${batch.candidates.length} voice candidates available. Current instrument kept. Select a sound to load it.`
        : 'No playable voice candidates in this snapshot. Current instrument kept. See the reasons below.');
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
    if (disposed || operation?.committing || !candidate?.preset) return;
    const op = startOperation('select');
    setStatus(`Preparing CH${candidate.voice.index + 1} · SRCN ${candidate.voice.sourceNumber}…`);
    try {
      const message = await onSelect(candidate, {signal:op.controller.signal, onCommit() {
        if (!current(op)) throw abortError();
        op.committing = true; refresh();
        setStatus(`Applying CH${candidate.voice.index + 1} · SRCN ${candidate.voice.sourceNumber}…`);
      }});
      if (!current(op)) return;
      selectedId = candidate.id; refresh();
      setStatus(typeof message === 'string' ? message : `Loaded CH${candidate.voice.index + 1} · SRCN ${candidate.voice.sourceNumber}. Play the keyboard, edit it or save a preset.`);
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
  return {
    clearSelection() {if (!disposed) {selectedId = null; refresh();}},
    dispose() {
      if (disposed) return;
      disposed = true; sequence++; operation?.controller.abort(); operation = null; batch = null;
      for (const cleanup of cleanups) cleanup(); section.remove();
    },
  };
}
