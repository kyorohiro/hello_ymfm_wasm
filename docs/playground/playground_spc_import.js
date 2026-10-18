function element(tag, text, parent) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  parent?.append(node);
  return node;
}

/** SPC files remain assets; song playback and editable instruments are separate imports. */
export function installSpcImport({button, existingPaths, existingDirectories = () => [], importFiles, onStatus, onError}) {
  const input = element('input', undefined, document.body);
  input.type = 'file'; input.accept = '.spc'; input.hidden = true; input.dataset.spcImportFile = '';
  button.title = 'Import SPC song playback or BRR instruments with editable JavaScript';
  let activeDialog = null, request = 0;
  button.addEventListener('click', () => {input.value = ''; input.click();});
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    activeDialog?.close();
    const current = ++request, controller = new AbortController();
    const dialog = element('dialog', undefined, document.body); activeDialog = dialog;
    dialog.id = 'spcImportDialog'; dialog.className = 'playground-settings-dialog spc-import-dialog';
    const title = element('h2', `Import SPC: ${file.name}`, dialog); title.id = 'spcImportTitle';
    dialog.setAttribute('aria-labelledby', title.id);
    const summary = element('p', 'Reading SPC…', dialog); summary.setAttribute('role', 'status');
    const modes = element('fieldset', undefined, dialog); element('legend', 'Import as', modes); modes.disabled = true;
    const modeControls = ['song', 'instruments'].map((mode, index) => {
      const label = element('label', undefined, modes), radio = element('input', undefined, label);
      radio.type = 'radio'; radio.name = 'spc-import-mode'; radio.value = mode; radio.checked = index === 0;
      label.append(document.createTextNode(mode === 'song' ? ' Song playback' : ' Instruments'));
      return radio;
    });
    const help = element('p', '', dialog);
    const instruments = element('fieldset', undefined, dialog); instruments.dataset.spcImportInstruments = ''; instruments.hidden = true; instruments.disabled = true;
    element('legend', 'Choose BRR instruments', instruments);
    element('p', 'The assigned note labels the captured pitch for your own keyboard playing. C4 is a starting assignment, not a detected original note. The generated script first plays the captured raw PITCH.', instruments);
    const tableHost = element('div', undefined, instruments); tableHost.className = 'spc-import-table';
    const table = element('table', undefined, tableHost), header = element('tr', undefined, element('thead', undefined, table));
    for (const heading of ['Import', 'SRCN', 'Sample', 'Voice settings', 'Assigned note']) element('th', heading, header);
    const body = element('tbody', undefined, table);
    const destination = element('p', '', dialog); destination.dataset.spcImportDestination = '';
    const footer = element('div', undefined, dialog); footer.className = 'spc-import-actions';
    const error = element('p', '', footer); error.setAttribute('role', 'alert');
    const cancel = element('button', 'Cancel', footer); cancel.type = 'button'; cancel.dataset.spcImportCancel = '';
    const confirm = element('button', 'Import', footer); confirm.type = 'button'; confirm.dataset.spcImportConfirm = ''; confirm.disabled = true;
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      controller.abort();
      if (activeDialog === dialog) {activeDialog = null; request++;}
      dialog.remove();
    }, {once:true});
    dialog.showModal();
    const alive = () => current === request && !controller.signal.aborted && dialog.open;
    try {
      onStatus?.(`Reading ${file.name}…`);
      const source = await import('./playground_spc_source.js?v=spc-import-types-1');
      const prepared = await source.prepareSpcImport(await file.arrayBuffer(), file.name, {signal:controller.signal});
      if (!alive()) return;
      summary.textContent = `${prepared.metadata.title || file.name} · ${prepared.candidates.length} BRR candidate(s). Original SPC is preserved in Files.`;
      for (const warning of prepared.warnings ?? []) element('p', warning, instruments);
      const rows = [];
      let selectedFirst = false;
      for (const candidate of prepared.candidates) {
        const row = element('tr', undefined, body);
        const check = element('input', undefined, element('td', undefined, row)); check.type = 'checkbox'; check.dataset.spcCandidate = candidate.id;
        check.disabled = !candidate.importable; check.checked = candidate.importable && !selectedFirst;
        if (check.checked) selectedFirst = true;
        check.setAttribute('aria-label', `Import SRCN ${candidate.sourceNumber}`);
        const aliases = candidate.sourceNumbers ?? [candidate.sourceNumber];
        const name = element('td', aliases.slice(0, 8).join(', ') + (aliases.length > 8 ? `… (${aliases.length} SRCNs)` : ''), row);
        name.title = aliases.join(', ');
        const info = element('td', candidate.importable
          ? `${candidate.brr.length} bytes${candidate.loop ? ' · loop' : ''}` : candidate.importReason, row);
        if (!candidate.importable) info.className = 'subtext';
        const voice = element('select', undefined, element('td', undefined, row)); voice.dataset.spcVoice = '';
        voice.setAttribute('aria-label', `Voice settings for SRCN ${candidate.sourceNumber}`);
        for (const captured of candidate.voices) element('option', `Voice ${captured.index + 1} · PITCH ${captured.pitch}`, voice).value = String(captured.index);
        if (!candidate.voices.length) element('option', 'Default settings (no Voice captured)', voice).value = '';
        const note = element('input', undefined, element('td', undefined, row)); note.type = 'text'; note.value = 'C4'; note.dataset.spcReference = '';
        note.setAttribute('aria-label', `Assigned note for SRCN ${candidate.sourceNumber}`); note.title = 'Your assigned note name or MIDI number for the captured pitch';
        const updateRow = () => {voice.disabled = note.disabled = !check.checked;}; check.addEventListener('change', updateRow); updateRow();
        rows.push({candidate, check, voice, note});
      }
      const mode = () => modeControls.find(control => control.checked).value;
      const updateMode = () => {
        const song = mode() === 'song'; instruments.hidden = song; instruments.disabled = song;
        help.textContent = song
          ? 'Play the original SPC700 program with useSoundChip(\'spc\'). This creates player code, not a transcription of the song into notes. Playback continues until Stop.'
          : 'Save selected BRR samples, captured settings and editable SNES scripts. Candidates are from this snapshot; unused directory data may not be an instrument. Echo, noise, pitch modulation and song-time changes are omitted.';
        destination.textContent = `New folder: ${source.allocateSpcImportDirectory(file.name, existingPaths(), existingDirectories())}`;
      };
      modes.disabled = false; confirm.disabled = false;
      for (const radio of modeControls) radio.addEventListener('change', updateMode);
      updateMode();
      confirm.addEventListener('click', async () => {
        if (!alive()) return;
        confirm.disabled = true; error.textContent = '';
        try {
          const selected = rows.filter(row => row.check.checked).map(row => ({candidateId:row.candidate.id,
            ...(row.voice.value !== '' ? {voiceIndex:Number(row.voice.value)} : {}),
            referenceNote:/^\d+$/.test(row.note.value.trim()) ? Number(row.note.value.trim()) : row.note.value.trim()}));
          const plan = source.buildSpcImportFiles(prepared, {mode:mode(),
            directory:source.allocateSpcImportDirectory(file.name, existingPaths(), existingDirectories()), selected});
          await importFiles(plan, file.name);
          dialog.close();
        } catch (failure) {
          if (alive()) {error.textContent = failure.message; confirm.disabled = false;}
        }
      });
    } catch (failure) {
      if (alive() && failure.name !== 'AbortError') {
        summary.textContent = `Cannot import SPC: ${failure.message}`;
        onError?.(failure);
      }
    }
  });
}
