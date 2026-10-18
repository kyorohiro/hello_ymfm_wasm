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
    const modeControls = ['song', 'instruments', 'javascript', 'trace'].map((mode, index) => {
      const label = element('label', undefined, modes), radio = element('input', undefined, label);
      radio.type = 'radio'; radio.name = 'spc-import-mode'; radio.value = mode; radio.checked = index === 0;
      label.append(document.createTextNode({song:' Song playback', instruments:' Instruments', javascript:' Song JavaScript', trace:' Event trace (analysis)'}[mode]));
      return radio;
    });
    const help = element('p', '', dialog);
    const conversion = element('fieldset', undefined, dialog); conversion.hidden = true; conversion.disabled = true;
    conversion.dataset.spcConversion = ''; const conversionLegend = element('legend', 'Song JavaScript', conversion);
    const lengthLabel = element('label', 'Conversion seconds ', conversion);
    const seconds = element('input', undefined, lengthLabel); seconds.type = 'number'; seconds.min = '0.1'; seconds.max = '600'; seconds.step = 'any';
    seconds.dataset.spcConversionSeconds = ''; seconds.value = '120'; seconds.required = true;
    const controlLabel = element('label', 'Control step (ms) ', conversion);
    const controlStep = element('input', undefined, controlLabel); controlStep.type = 'number';
    controlStep.min = '0'; controlStep.max = '1000'; controlStep.step = 'any'; controlStep.value = '20'; controlStep.required = true;
    controlStep.dataset.spcControlStep = '';
    const conversionHelp = element('p', '', conversion);
    const progress = element('progress', undefined, conversion); progress.max = 1; progress.value = 0; progress.hidden = true;
    progress.setAttribute('aria-label', 'SPC conversion progress');
    const conversionStatus = element('p', '', conversion); conversionStatus.setAttribute('role', 'status');
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
      const source = await import('./playground_spc_source.js?v=spc-note-comments-1');
      const prepared = await source.prepareSpcImport(await file.arrayBuffer(), file.name, {signal:controller.signal});
      if (!alive()) return;
      const tagSeconds = prepared.metadata.playSeconds;
      seconds.value = String(Number.isFinite(tagSeconds) && tagSeconds >= 0.1 ? Math.min(600, tagSeconds) : 120);
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
        const selectedMode = mode(), song = selectedMode === 'song', javascript = selectedMode === 'javascript', trace = selectedMode === 'trace';
        instruments.hidden = selectedMode !== 'instruments'; instruments.disabled = instruments.hidden;
        conversion.hidden = !(javascript || trace); conversion.disabled = conversion.hidden;
        controlLabel.hidden = !javascript; controlStep.disabled = !javascript;
        conversionLegend.textContent = javascript ? 'Song JavaScript' : 'Event trace';
        conversionHelp.textContent = javascript
          ? 'Starts at the saved SPC position. Choose 0.1–600 seconds. Controls keep the last value per interval; 0 keeps every distinct value. Key-on/off times are retained. Up to 20,000 interpreted events and 64,512 bytes / 256 BRR versions. No tempo, note-name or loop detection.'
          : 'Starts at the saved SPC position. Choose 0.1–600 seconds. Unused work RAM is omitted after analyzing the song. No automatic loop detection or tag fade. Up to 1,000,000 retained writes; large logs are intended for analysis.';
        confirm.textContent = javascript || trace ? 'Convert & import' : 'Import';
        help.textContent = javascript
          ? 'Generate readable loadBRR / setPreset / setPitch / keyOn / timeline.waitUntil / keyOff code. Times use one song origin, so timer delays do not accumulate. This is an approximate re-performance: initially active envelopes restart; echo and subsequent BRR RAM edits are omitted. Use Song playback for the original sound.' : trace
          ? 'Record detailed timed DSP and RAM writes, retaining BRR changes, echo, noise and pitch modulation. This preserves the captured execution; it is a low-level analysis log, not editable musical notes.' : song
          ? 'Play the original SPC700 program with useSoundChip(\'spc\'). Use spc.onEvent() to inspect key requests and parameter changes. Playback continues until Stop.'
          : 'Save selected BRR samples, captured settings and editable SNES scripts. Candidates are from this snapshot; unused directory data may not be an instrument. Echo, noise, pitch modulation and song-time changes are omitted.';
        destination.textContent = `New folder: ${source.allocateSpcImportDirectory(file.name, existingPaths(), existingDirectories())}`;
      };
      modes.disabled = false; confirm.disabled = false;
      for (const radio of modeControls) radio.addEventListener('change', updateMode);
      updateMode();
      onStatus?.('SPC ready. Choose an import mode.');
      confirm.addEventListener('click', async () => {
        if (!alive()) return;
        if (['javascript','trace'].includes(mode()) && !seconds.reportValidity()) return;
        if (mode() === 'javascript' && !controlStep.reportValidity()) return;
        confirm.disabled = true; error.textContent = '';
        modes.disabled = true; conversion.disabled = true; instruments.disabled = true;
        try {
          const selected = rows.filter(row => row.check.checked).map(row => ({candidateId:row.candidate.id,
            ...(row.voice.value !== '' ? {voiceIndex:Number(row.voice.value)} : {}),
            referenceNote:/^\d+$/.test(row.note.value.trim()) ? Number(row.note.value.trim()) : row.note.value.trim()}));
          const directory = source.allocateSpcImportDirectory(file.name, existingPaths(), existingDirectories());
          let plan;
          if (['javascript','trace'].includes(mode())) {
            progress.hidden = false; progress.value = 0; conversionStatus.textContent = 'Preparing conversion…';
            const {convertSpcImport} = await import('./playground_spc_trace.js?v=spc-note-comments-1');
            if (!alive()) return;
            plan = await convertSpcImport(prepared, {directory, mode:mode(), controlStepMs:Number(controlStep.value), durationSeconds:Number(seconds.value), signal:controller.signal,
              onProgress:value => {if (alive()) {
                progress.value = value.ratio;
                conversionStatus.textContent = value.stage === 'source' ? 'Generating JavaScript…'
                  : `${value.stage === 'interpret' ? 'Interpreting' : value.stage === 'analyze' ? 'Analyzing' : 'Recording'} ${value.renderedSeconds.toFixed(1)} / ${value.durationSeconds.toFixed(1)} seconds…`;
              }}});
          } else plan = source.buildSpcImportFiles(prepared, {mode:mode(), directory, selected});
          if (!alive()) return;
          await importFiles(plan, file.name);
          dialog.close();
        } catch (failure) {
          if (alive()) {
            error.textContent = `${failure.message}${['javascript','trace'].includes(mode()) ? ' Try a shorter interval or use Song playback.' : ''}`;
            confirm.disabled = false; modes.disabled = false; progress.hidden = true; updateMode();
          }
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
