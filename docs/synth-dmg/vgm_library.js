// SPDX-License-Identifier: BSD-3-Clause
import {extractVgmInstruments, MAX_VGM_BYTES} from './vgm_import.js';

/** Import source logs and static sounds into Files without applying a sound,
 * running Code or requesting audio. Each persistence callback must honor its
 * isCurrent guard before committing; source and sound storage are independent. */
export function setupGameboyVgmImport({root, onSource, onSounds,
  extract = extractVgmInstruments, onStatus = () => {}} = {}) {
  if (!root?.querySelector || typeof onSource !== 'function' || typeof onSounds !== 'function' ||
    typeof extract !== 'function' || typeof onStatus !== 'function')
    throw new TypeError('DMG VGM import requires a mount and storage callbacks.');
  const $ = id => root.querySelector(`#${id}`);
  const load = $('loadVgm'), input = $('vgmFileInput'), cancelButton = $('cancelVgm'), label = $('vgmStatus');
  if (!load || !input || !cancelButton || !label) throw new Error('DMG VGM import controls are missing.');
  const events = new AbortController();
  let request = 0, pending = null, disposed = false;
  const listen = (node, type, handler) => node.addEventListener(type, handler, {signal: events.signal});
  const status = (message, error = false) => {
    if (disposed) return;
    if (label.textContent !== message) label.textContent = message;
    label.dataset.error = String(error);
    onStatus(message,error);
  };
  const busy = value => {root.dataset.loading = String(value); cancelButton.hidden = !value;};
  function invalidate() {
    const wasPending = Boolean(pending);
    request++; pending?.abort(); pending = null; busy(false);
    return wasPending;
  }
  function cancel() {
    if (!disposed && invalidate()) status('VGM import cancelled. Current instrument kept.');
  }
  listen(load, 'click', () => {load.blur(); input.click();});
  listen(input, 'change', async () => {
    const file = input.files?.[0]; input.value = ''; input.blur();
    if (!file || disposed) return;
    invalidate();
    const token = request, controller = new AbortController(); pending = controller;
    const isCurrent = () => !disposed && token === request && !controller.signal.aborted;
    busy(true); status(`Reading ${file.name}…`);
    try {
      if (file.size > MAX_VGM_BYTES) throw new RangeError('VGM / VGZ files must be at most 64 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrent()) return;
      // Check the actual read as well as File.size before analysis or storage.
      if (bytes.byteLength > MAX_VGM_BYTES) throw new RangeError('VGM / VGZ files must be at most 64 MiB.');
      let result = null, analysisError = null;
      try {
        result = await extract(bytes, {signal: controller.signal});
        if (!result || !Array.isArray(result.voices)) throw new TypeError('VGM extraction returned no sound list.');
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        analysisError = error;
      }
      if (!isCurrent()) return;
      const messages = [];
      let failed = false;
      try {
        const path = await onSource({name: file.name, bytes}, {isCurrent});
        messages.push(path ? `Original source saved to ${path}.` : 'Original source not saved to Files.');
        if (!path) failed = true;
      } catch (error) {
        messages.push(`Original source not saved to Files: ${error?.message ?? String(error)}.`); failed = true;
      }
      if (!isCurrent()) return;
      if (analysisError) {
        messages.push(`Sound extraction failed: ${analysisError?.message ?? String(analysisError)}.`); failed = true;
      } else if (!result.voices.length) messages.push('No static sounds found.');
      else {
        try {
          const saved = await onSounds({name: file.name, voices: result.voices}, {isCurrent});
          if (!isCurrent()) return;
          if (!saved || !Array.isArray(saved.paths) || !saved.paths.length) {
            messages.push('Extracted sounds not saved to Files.'); failed = true;
          } else messages.push(`${saved.paths.length} ${saved.paths.length === 1 ? 'sound' : 'sounds'} saved to ${saved.directory || 'Files'}. Choose a preset in Files to load it.`);
        } catch (error) {
          messages.push(`Extracted sounds not saved to Files: ${error?.message ?? String(error)}.`); failed = true;
        }
      }
      if (!isCurrent()) return;
      if (Array.isArray(result?.warnings) && result.warnings.length) messages.push(result.warnings.join(' '));
      messages.push('Current instrument kept.'); status(messages.join(' '), failed);
    } catch (error) {
      if (isCurrent() && error?.name !== 'AbortError') status(`VGM import failed: ${error?.message ?? String(error)} Current instrument kept.`, true);
    } finally {
      if (token === request) {pending = null; busy(false);}
    }
  });
  listen(cancelButton, 'click', () => {cancelButton.blur(); cancel();});
  busy(false);
  return {cancel, dispose() {if (disposed) return; disposed = true; invalidate(); events.abort();}};
}
