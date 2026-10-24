const names = {ym2612: 'YM2612', segapsg: 'Sega PSG', rf5c164: 'RF5C164', pwm: '32X PWM', dx7: 'DX7', snes: 'SNES S-DSP',
  gameboy: 'Game Boy', nes: 'NES APU', ym2151: 'YM2151', ym2203: 'YM2203', ym2608: 'YM2608', ym2610: 'YM2610', ym2610b: 'YM2610B'};

/** One view of the runtime's mixer. Listening volume remains independent of script master gain. */
export function createPlaygroundMixer({root, getMixer, getAudio, getOutputVolume, setOutputVolume,
  getScriptVolume = () => 1, getPersistence = () => null, onError = console.error}) {
  const doc = root.ownerDocument;
  const make = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const master = make('div', 'playground-mixer-master');
  const masterName = make('strong', '', 'Master');
  const masterLabel = make('label', 'playground-mixer-control');
  masterLabel.append(make('span', '', 'Volume'));
  const masterRange = make('input'); masterRange.type = 'range'; masterRange.min = '0'; masterRange.max = '380'; masterRange.step = '1';
  masterRange.setAttribute('aria-label', 'Master volume');
  const masterValue = make('output');
  masterLabel.append(masterRange, masterValue);
  const masterMeter = createMeter('Master');
  const scriptGain = make('span', 'subtext');
  master.append(masterName, masterLabel, masterMeter.host, scriptGain);
  const hint = make('p', 'subtext playground-mixer-hint', 'Chip levels are before shared effects and Master. Solo keeps manual Mute settings.');
  const persistence = make('div', 'playground-mixer-persistence');
  const persistenceHint = make('p', 'subtext', 'Selecting a preset applies it immediately. Adjustments auto-save to mixer/current.json. Set default keeps the current mix for new projects; Save creates a named preset. Extra chips need a fixed id to keep their individual settings.');
  const presetControls = make('div', 'playground-mixer-presets');
  const presetLabel = make('label', 'playground-mixer-preset-label');
  const presetSelect = make('select'); presetSelect.setAttribute('aria-label', 'Mixer preset');
  presetLabel.append(make('span', '', 'Preset'), presetSelect);
  const setDefault = make('button', 'playground-mixer-toggle', 'Set default'); setDefault.type = 'button';
  const savePreset = make('button', 'playground-mixer-toggle', 'Save'); savePreset.type = 'button';
  presetControls.append(presetLabel, setDefault, savePreset);
  persistence.append(persistenceHint, presetControls); persistence.hidden = !getPersistence();
  const saveDialog = make('dialog', 'playground-mixer-save-dialog');
  saveDialog.setAttribute('aria-label', 'Save mixer preset');
  const saveForm = make('form');
  const saveHeading = make('h2', '', 'Save mixer preset');
  const nameLabel = make('label', 'playground-mixer-save-name');
  const nameInput = make('input'); nameInput.type = 'text'; nameInput.required = true;
  nameInput.autocomplete = 'off'; nameInput.setAttribute('aria-label', 'Preset name');
  const nameField = make('span', 'playground-mixer-save-path');
  nameField.append(make('span', 'playground-mixer-save-prefix', 'mixer/'), nameInput);
  nameLabel.append(make('span', '', 'Preset name'), nameField);
  const saveError = make('p', 'playground-mixer-status'); saveError.setAttribute('role', 'status');
  const saveActions = make('div', 'playground-mixer-save-actions');
  const cancelSave = make('button', 'playground-mixer-toggle', 'Cancel'); cancelSave.type = 'button';
  const confirmSave = make('button', 'playground-mixer-toggle', 'Save'); confirmSave.type = 'submit';
  saveActions.append(cancelSave, confirmSave);
  saveForm.append(saveHeading, nameLabel, saveError, saveActions); saveDialog.append(saveForm); doc.body.append(saveDialog);
  const empty = make('p', 'subtext playground-mixer-empty', 'Run a script or play the keyboard to connect sound chips.');
  const strips = make('div', 'playground-mixer-strips');
  const status = make('p', 'subtext playground-mixer-status'); status.setAttribute('role', 'status');
  root.append(master, hint, persistence, empty, strips, status);
  const rows = new Map();
  let visible = false, disposed = false, mixer = null, releaseChanges = null, releaseMeters = null, releasePresets = null;
  let persistenceController = null, presetSignature = null, lastSelectedPreset = '';
  let frame = 0, lastDraw = -Infinity, meterAudio = null, meterOutput = null, meterContext = null, meterRelease = null, splitter = null, analysers = [];
  const masterSamples = [new Float32Array(1024), new Float32Array(1024)];
  const peaks = new Map();

  function createMeter(label) {
    const host = make('div', 'playground-mixer-meter');
    host.setAttribute('aria-label', `${label} output peaks`);
    const sides = ['L', 'R'].map(side => {
      const meter = make('div', 'playground-mixer-meter-side');
      meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', `${label} ${side} peak`);
      meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', '1');
      const fill = make('span', 'playground-mixer-meter-fill'); meter.append(fill); host.append(meter);
      return {meter, fill};
    });
    function update(left = 0, right = 0) {
      [left, right].forEach((value, index) => {
        const amplitude = Number.isFinite(value) ? Math.max(0, value) : 0;
        const db = amplitude > 0 ? `${(20 * Math.log10(amplitude)).toFixed(1)} dBFS` : 'Silent';
        sides[index].fill.style.transform = `scaleX(${Math.min(1, amplitude)})`;
        sides[index].meter.classList.toggle('is-clipping', amplitude > 1);
        sides[index].meter.setAttribute('aria-valuenow', String(Math.min(1, amplitude)));
        sides[index].meter.setAttribute('aria-valuetext', db);
      });
    }
    update();
    return {host, update};
  }

  function change(id, patch) {
    try {
      const previous = mixer.get(id);
      if (Object.entries(patch).every(([key, value]) => previous[key] === value)) return;
      mixer.set(id, patch);
      if (persistenceController) {
        // Show the edited mix immediately, before its debounced first save.
        // The source preset can then be selected again to discard the edits.
        if (!presetSelect.querySelector('option[value="/mixer/current.json"]')) {
          const option = make('option', '', 'mixer/current.json'); option.value = '/mixer/current.json'; presetSelect.append(option);
        }
        presetSelect.value = '/mixer/current.json'; lastSelectedPreset = presetSelect.value;
      }
      status.textContent = ''; delete status.dataset.state;
    }
    catch (error) {status.textContent = error.message; onError(error); refresh();}
  }
  function presetApplied(path, message) {
    refreshPresets(); presetSelect.value = path; lastSelectedPreset = path;
    status.textContent = message; status.dataset.state = 'saved';
  }
  presetSelect.addEventListener('change', () => {
    const previous = lastSelectedPreset, selected = presetSelect.value;
    lastSelectedPreset = selected;
    try {
      persistenceController.selectPreset(selected);
      presetApplied(selected, 'Mixer preset applied.');
    } catch (error) {
      presetSelect.value = previous; lastSelectedPreset = previous;
      status.textContent = error.message; delete status.dataset.state; onError(error);
    }
  });
  setDefault.addEventListener('click', () => {
    try {
      persistenceController.saveDefault();
      presetApplied('/mixer/default.json', 'Default mixer preset saved.');
    } catch (error) {status.textContent = error.message; delete status.dataset.state; onError(error);}
  });
  savePreset.addEventListener('click', () => {
    const paths = new Set(persistenceController.listPresets().map(preset => preset.path));
    let suffix = 1, filename = 'mix.json';
    while (paths.has('/mixer/' + filename)) filename = `mix-${++suffix}.json`;
    nameInput.value = filename; saveError.textContent = '';
    if (!saveDialog.open) saveDialog.showModal();
    nameInput.focus(); nameInput.setSelectionRange(0, filename.length - '.json'.length);
  });
  // Names and dialog navigation must not trigger the audition keyboard. Keep
  // keyup bubbling so a note held before opening the dialog can still release.
  saveDialog.addEventListener('keydown', event => event.stopPropagation());
  saveDialog.addEventListener('close', () => {if (!disposed) savePreset.focus();});
  cancelSave.addEventListener('click', () => saveDialog.close());
  saveForm.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const path = persistenceController.savePreset(nameInput.value);
      presetApplied(path, 'Mixer preset saved.'); saveDialog.close();
    } catch (error) {saveError.textContent = error.message; onError(error);}
  });
  function refreshPresets(change) {
    if (disposed || !persistenceController) return;
    try {
      const presets = persistenceController.listPresets();
      // A live edit can precede the first debounced current.json write.
      if ((change?.source || lastSelectedPreset) === '/mixer/current.json' &&
          !presets.some(preset => preset.path === '/mixer/current.json')) {
        presets.push({path:'/mixer/current.json',label:'mixer/current.json'});
      }
      const signature = JSON.stringify(presets);
      if (signature === presetSignature) {
        if (change?.source && presets.some(preset => preset.path === change.source)) {
          presetSelect.value = change.source; lastSelectedPreset = change.source;
        }
        return;
      }
      const selected = change?.source || presetSelect.value || lastSelectedPreset;
      presetSelect.replaceChildren(...presets.map(preset => {
        const option = make('option', '', preset.label); option.value = preset.path; return option;
      }));
      presetSelect.value = presets.some(preset => preset.path === selected) ? selected
        : ['/mixer/current.json', '/mixer/default.json', '/sys/mixer/default.json'].find(path => presets.some(preset => preset.path === path)) ?? presets[0]?.path ?? '';
      lastSelectedPreset = presetSelect.value;
      presetSelect.disabled = presets.length === 0;
      presetSignature = signature;
    } catch (error) {status.textContent = error.message; delete status.dataset.state; onError(error);}
  }
  function syncPersistence() {
    const next = getPersistence();
    if (persistenceController === next) return;
    releasePresets?.(); releasePresets = null;
    persistenceController = next; presetSignature = null; lastSelectedPreset = ''; persistence.hidden = !next;
    if (next) {
      refreshPresets();
      releasePresets = next.subscribePresets(refreshPresets);
    }
  }
  function createRow(entry) {
    const host = make('section', 'playground-mixer-strip'); host.dataset.chipId = entry.id;
    const heading = make('div', 'playground-mixer-heading');
    const title = make('strong'), idLabel = make('span', 'subtext');
    const mute = make('button', 'playground-mixer-toggle', 'Mute'); mute.type = 'button';
    const solo = make('button', 'playground-mixer-toggle', 'Solo'); solo.type = 'button';
    heading.append(title, idLabel, mute, solo);
    let current = entry;
    mute.addEventListener('click', () => change(entry.id, {muted: !current.muted}));
    solo.addEventListener('click', () => change(entry.id, {solo: !current.solo}));
    function control(key, label, min, max, format) {
      const row = make('label', 'playground-mixer-control'); row.append(make('span', '', label));
      const input = make('input'); input.type = 'range'; input.min = String(min); input.max = String(max); input.step = '1';
      input.dataset.setting = key;
      const output = make('output');
      input.addEventListener('input', () => change(entry.id, {[key]: Number(input.value) / 100}));
      row.append(input, output);
      return {row, update(value, chipName) {
        const percent = Math.round(value * 100);
        input.value = String(percent); output.textContent = format(percent);
        input.setAttribute('aria-label', `${chipName} ${label.toLowerCase()}`);
      }};
    }
    const volume = control('volume', 'Volume', 0, 200, value => `${value}%`);
    const pan = control('pan', 'Pan', -100, 100, value => value === 0 ? 'Center' : `${value < 0 ? 'L' : 'R'} ${Math.abs(value)}`);
    const meter = createMeter(entry.id), connection = make('span', 'subtext');
    host.append(heading, volume.row, pan.row, meter.host, connection);
    return {host, meter, update(next) {
      current = next;
      const name = names[next.name] ?? next.name;
      title.textContent = name; idLabel.textContent = next.id;
      mute.setAttribute('aria-label', `${next.id} mute`); mute.setAttribute('aria-pressed', String(next.muted));
      solo.setAttribute('aria-label', `${next.id} solo`); solo.setAttribute('aria-pressed', String(Boolean(next.solo)));
      host.classList.toggle('is-output-muted', Boolean(next.effectiveMuted ?? next.muted));
      volume.update(next.volume, next.id); pan.update(next.pan, next.id);
      connection.textContent = !next.connected ? 'Not connected' : next.effectiveMuted && !next.muted ? 'Suppressed by Solo' : '';
    }};
  }

  function syncOutputVolume() {
    masterRange.value = String(Math.round(getOutputVolume() * 100));
    masterValue.textContent = `${masterRange.value}%`;
    const gain = getScriptVolume();
    scriptGain.textContent = gain === 1 ? '' : `Script gain: ${Math.round(gain * 100)}%`;
  }
  masterRange.addEventListener('input', () => {
    setOutputVolume(Number(masterRange.value) / 100); syncOutputVolume();
  });

  function detachMasterMeter() {
    meterRelease?.(); meterRelease = null;
    splitter?.disconnect(); splitter = null;
    for (const node of analysers) node.disconnect();
    analysers = []; meterAudio = meterOutput = meterContext = null;
  }
  function attachMasterMeter() {
    const audio = getAudio();
    if (audio === meterAudio && audio?.masterOutputNode === meterOutput && audio?.audioContext === meterContext) return;
    detachMasterMeter();
    if (!audio?.audioContext || !audio?.masterOutputNode || !audio.connectOutputMonitor) return;
    try {
      splitter = audio.audioContext.createChannelSplitter(2);
      analysers = [0, 1].map(channel => {
        const node = audio.audioContext.createAnalyser(); node.fftSize = 1024; node.smoothingTimeConstant = 0;
        splitter.connect(node, channel); return node;
      });
      meterRelease = audio.connectOutputMonitor(splitter); meterAudio = audio;
      meterOutput = audio.masterOutputNode; meterContext = audio.audioContext;
    } catch (error) {detachMasterMeter(); onError(error);}
  }
  function draw(time) {
    if (!visible || doc.hidden || disposed) return;
    frame = requestAnimationFrame(draw);
    if (time - lastDraw < 1000 / 15) return;
    lastDraw = time;
    attachMasterMeter(); syncOutputVolume();
    for (const [id, row] of rows) {
      const peak = peaks.get(id);
      row.meter.update(...(peak && performance.now() - peak.time < 250 ? [peak.left, peak.right] : [0, 0]));
    }
    const masterPeaks = analysers.map((node, channel) => {
      node.getFloatTimeDomainData(masterSamples[channel]);
      let peak = 0; for (const sample of masterSamples[channel]) peak = Math.max(peak, Math.abs(sample));
      return peak;
    });
    masterMeter.update(masterPeaks[0], masterPeaks[1]);
  }
  function stopObservation() {
    cancelAnimationFrame(frame); frame = 0;
    releaseMeters?.(); releaseMeters = null;
    detachMasterMeter(); peaks.clear();
    masterMeter.update(); for (const row of rows.values()) row.meter.update();
  }
  function startObservation() {
    if (!visible || doc.hidden || disposed) return;
    if (!releaseMeters) releaseMeters = mixer?.subscribeMeters?.(values => {
      const time = performance.now();
      for (const value of values) peaks.set(value.id, {...value, time});
    });
    if (!frame) frame = requestAnimationFrame(draw);
  }
  function refresh() {
    if (disposed) return;
    syncPersistence();
    const nextMixer = getMixer();
    if (mixer !== nextMixer) {
      releaseChanges?.(); releaseChanges = null; stopObservation(); mixer = nextMixer;
      releaseChanges = mixer?.subscribe?.(() => {if (visible) refresh();});
    }
    if (!visible) return;
    const entries = mixer?.list() ?? [], ids = new Set(entries.map(entry => entry.id));
    for (const [id, row] of rows) if (!ids.has(id)) {row.host.remove(); rows.delete(id); peaks.delete(id);}
    for (const entry of entries) {
      let row = rows.get(entry.id);
      if (!row) {row = createRow(entry); rows.set(entry.id, row); strips.append(row.host);}
      row.update(entry);
    }
    empty.hidden = entries.length > 0;
    syncOutputVolume(); startObservation();
  }
  function visibilityChanged() {if (doc.hidden) stopObservation(); else if (visible) {refresh(); startObservation();}}
  doc.addEventListener('visibilitychange', visibilityChanged);
  syncOutputVolume(); syncPersistence();
  return {
    refresh, syncOutputVolume,
    setVisible(value) {
      visible = Boolean(value);
      if (visible) refresh(); else stopObservation();
    },
    dispose() {
      disposed = true; visible = false; stopObservation(); releaseChanges?.(); releasePresets?.();
      saveDialog.remove();
      doc.removeEventListener('visibilitychange', visibilityChanged);
    },
  };
}
