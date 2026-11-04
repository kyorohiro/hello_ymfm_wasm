// SPDX-License-Identifier: BSD-3-Clause

/** File analysis is passive; only an explicit voice choice replaces the instrument. */
export function createVgmLibrary({root, onSelect}) {
  const $ = id => root.querySelector(`#${id}`);
  const events = new AbortController();
  let library = null, filter = 'all', page = 0, selected = null;
  let request = 0, selection = 0, pending = null, disposed = false;
  const pageSize = 24;
  const listen = (node, type, handler) => node.addEventListener(type, handler, {signal: events.signal});
  const status = (message, error = false) => {
    $('vgmStatus').textContent = message;
    $('vgmStatus').dataset.error = String(error);
  };
  function render() {
    $('vgmLibrary').hidden = !library;
    if (!library) return;
    const voices = library.voices.filter(voice => filter === 'all' || voice.kind === filter);
    page = Math.max(0, Math.min(page, Math.ceil(voices.length / pageSize) - 1));
    $('vgmFileName').textContent = library.name;
    const start = page * pageSize;
    $('vgmPage').textContent = voices.length ? `${start + 1}–${Math.min(start + pageSize, voices.length)} / ${voices.length} sounds` : 'No sounds in this source';
    $('vgmPrevious').disabled = page === 0;
    $('vgmNext').disabled = start + pageSize >= voices.length;
    for (const button of root.querySelectorAll('[data-vgm-filter]')) {
      const kind = button.dataset.vgmFilter;
      const count = kind === 'all' ? library.voices.length : library.voices.filter(voice => voice.kind === kind).length;
      const label = {all:'All', pulse:'Pulse', triangle:'Triangle', noise:'Noise', dmc:'DMC', fds:'FDS'}[kind];
      button.textContent = `${label} (${count})`;
      button.setAttribute('aria-pressed', String(filter === kind));
      button.disabled = count === 0;
    }
    const buttons = voices.slice(start, start + pageSize).map(voice => {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.vgmVoice = String(voice.id);
      button.setAttribute('aria-pressed', String(voice.id === selected));
      const name = document.createElement('span'); name.textContent = voice.preset.name;
      const detail = document.createElement('small');
      detail.textContent = `CH${voice.channel} · ${(voice.firstTime / 44100).toFixed(2)} s · ${voice.occurrences} ${voice.occurrences === 1 ? 'match' : 'matches'}`;
      button.append(name, detail);
      button.addEventListener('click', async () => {
        button.blur();
        const token = ++selection, source = library;
        try {
          await onSelect(voice.preset);
          if (disposed || token !== selection || source !== library) return;
          selected = voice.id; render();
          status(`${voice.preset.name} loaded · play the keyboard.`);
        } catch (error) {
          if (!disposed && token === selection) status(`Could not load sound: ${error.message}`, true);
        }
      });
      return button;
    });
    $('vgmVoices').replaceChildren(...buttons);
    $('vgmWarningsSummary').textContent = `File notes (${library.warnings.length})`;
    $('vgmWarningList').replaceChildren(...library.warnings.map(note => {
      const item = document.createElement('li'); item.textContent = note; return item;
    }));
    $('vgmWarnings').hidden = !library.warnings.length;
    const warnings = library.voices.find(voice => voice.id === selected)?.warnings ?? [];
    $('vgmVoiceWarnings').textContent = warnings.length ? `Sound notes: ${warnings.join(' ')}` : '';
    $('vgmVoiceWarnings').hidden = !warnings.length;
  }
  function cancel() {
    request++; pending?.abort(); pending = null;
    $('vgmLibrary').dataset.loading = 'false';
    $('cancelVgm').hidden = true;
  }
  listen($('loadVgm'), 'click', () => {$('loadVgm').blur(); $('vgmFileInput').click();});
  listen($('vgmFileInput'), 'change', async () => {
    const file = $('vgmFileInput').files?.[0];
    $('vgmFileInput').value = ''; $('vgmFileInput').blur();
    if (!file) return;
    cancel();
    const token = request, controller = new AbortController(); pending = controller;
    $('vgmLibrary').dataset.loading = 'true';
    $('cancelVgm').hidden = false;
    status(`Reading ${file.name}…`);
    try {
      // The instrument can start even when optional file-analysis assets fail.
      const {extractVgmInstruments, MAX_VGM_BYTES} = await import('./vgm_import.js');
      if (disposed || token !== request) return;
      if (file.size > MAX_VGM_BYTES) throw new Error('VGM / VGZ files must be at most 64 MiB.');
      const bytes = await file.arrayBuffer();
      if (disposed || token !== request) return;
      const result = await extractVgmInstruments(bytes, {signal: controller.signal});
      if (disposed || token !== request) return;
      library = {...result, name: file.name}; filter = 'all'; page = 0; selected = null; selection++;
      render();
      status(`${result.voices.length} sounds found · choose one to play. Current instrument kept.`);
    } catch (error) {
      if (!disposed && token === request && error.name !== 'AbortError') status(`VGM import failed: ${error.message} Current sound kept.`, true);
    } finally {
      if (token === request) {pending = null; $('vgmLibrary').dataset.loading = 'false'; $('cancelVgm').hidden = true;}
    }
  });
  listen($('cancelVgm'), 'click', () => {
    $('cancelVgm').blur(); cancel(); status('VGM import cancelled. Current sound kept.');
  });
  listen($('closeVgm'), 'click', () => {
    $('closeVgm').blur(); cancel(); selection++; library = null; selected = null;
    $('vgmVoices').replaceChildren(); render(); status('Library closed. Current instrument kept.');
  });
  for (const button of root.querySelectorAll('[data-vgm-filter]')) listen(button, 'click', () => {
    button.blur(); filter = button.dataset.vgmFilter; page = 0; render();
  });
  for (const [id, direction] of [['vgmPrevious', -1], ['vgmNext', 1]]) listen($(id), 'click', () => {
    $(id).blur(); page += direction; render();
  });
  return {
    clearSelection() {selection++; selected = null; render();},
    dispose() {disposed = true; cancel(); events.abort();},
  };
}
