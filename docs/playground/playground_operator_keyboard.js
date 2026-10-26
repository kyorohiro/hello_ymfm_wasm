import {
  buildKeyboard,
  createFretboardLayout,
  createFretboardState,
  findLayoutEntry,
  renderFretboardControls,
  setFretPosition,
  setInstrument,
  setStringWindowIndex,
} from "../synth/synth_keyboard.js?v=audio-numeric-bindings-1";

let keyboardSequence = 0;
const EDITOR_TABS = new Set(['extra-fm', 'segapsg', 'rf5c164', 'gameboy', 'nes', 'snes', 'ym2151', 'okim6258', 'huc6280', 'wonderswan', 'dx7', 'ym3812', 'ym3526', 'y8950', 'ymf262', 'ym2413', 'ay8910']);

export function createPlaygroundOperatorKeyboard({
  root,
  channelCount = 6,
  presets = {},
  presetOrder = [],
  onChannelChange,
  getSelectedChannel,
  onPresetChange,
  ensureAudioReady,
  onStatus,
  idPrefix = "",
  getClock,
  clockDivider = 144,
  auditionPriority = false,
  canHandleComputerKeys = () => true,
  minimizeHost = null,
  onControlsMinimizedChange,
  routing = null,
}) {
  const state = createFretboardState();
  let synth = null;
  let channelMode = "fixed";
  let fixedChannel = 0;
  let roundRobinChannel = 0;
  const layoutOptions = {
    state,
    getClock: () => getClock?.() ?? (synth?.fm ?? synth)?.clock ?? 7670454,
    divider: clockDivider,
  };
  let layout = createFretboardLayout(layoutOptions);
  const held = new Map();
  const keyboardId = ++keyboardSequence;
  let pressSequence = 0;
  let generation = 0;
  let noteTarget = null;
  let editorTarget = null;
  let enabled = false;
  let operatorMode = false;
  let editorMode = false;
  let view = null;
  let disposed = false;
  let routingState = routing?.getState() ?? null;
  let unsubscribeRouting = null;

  const currentNoteTarget = () => enabled && !operatorMode ? editorMode ? editorTarget : noteTarget : null;
  const routedKeyboard = () => Boolean(routing) && !operatorMode && !editorMode;
  const showFmDetails = () => !editorMode && channelCount > 0 && !routedKeyboard() && (operatorMode || !noteTarget);
  const reportError = error => {if (error?.name !== 'AbortError') onStatus?.(`Keyboard could not play: ${error.message ?? error}`);};
  function callTarget(target, method, event) {
    try {
      const result = event === undefined ? target[method]() : target[method](event);
      if (result?.then) Promise.resolve(result).catch(reportError);
      return result;
    } catch (error) {reportError(error);}
  }
  function updateButton(button) {
    if (button) button.classList.toggle('is-active', [...held.values()].some(note => note.started && note.button === button));
  }
  function releaseNote(note) {
    if (!note.started) return;
    if (note.target) callTarget(note.target, 'noteOff', note.event);
    else if (note.channel !== undefined) note.synth?.noteOff(note.channel);
  }
  function releaseNotes(includeCurrentTarget) {
    generation++;
    const notes = [...held.values()];
    const targets = new Set(notes.filter(note => note.started && note.target).map(note => note.target));
    if (includeCurrentTarget && currentNoteTarget()) targets.add(currentNoteTarget());
    held.clear();
    for (const note of notes) {releaseNote(note); updateButton(note.button);}
    for (const target of targets) callTarget(target, 'allNotesOff');
  }
  const releaseAll = () => releaseNotes(true);
  const releaseOwnedNotes = () => releaseNotes(false);

  root.innerHTML = `
    ${minimizeHost ? '<button id="playgroundKeyboardMinimize" class="playground-keyboard-minimize" type="button">−</button>' : ''}
    <div id="playgroundKeyboardRoutingTools" class="playground-keyboard-toolbar playground-keyboard-routing-tools" hidden>
      <label>Chip:
        <select id="playgroundKeyboardChip" aria-label="Keyboard chip"></select>
      </label>
      <label>CH:
        <select id="playgroundKeyboardTargetChannel" aria-label="Keyboard channel"></select>
      </label>
    </div>
    <div id="playgroundKeyboardChannelTools" class="playground-keyboard-toolbar playground-keyboard-channel-tools">
      <label>Mo:
        <select id="playgroundKeyboardChannelMode">
          <option value="fixed">Fixed channel</option>
          <option value="roundRobin">Round robin all channels</option>
        </select>
      </label>
      <label>Ch:
        <select id="playgroundKeyboardChannel"></select>
      </label>
      <label class="playground-keyboard-preset">Pre
        <select id="playgroundKeyboardPreset"></select>
      </label>
    </div>
    <p id="playgroundKeyboardEditorTarget" class="playground-keyboard-target" hidden></p>
    <div id="playgroundKeyboardFretTools" class="playground-keyboard-toolbar playground-keyboard-tools">
      <div id="playgroundKeyboardInstrument"></div>
      <div id="playgroundKeyboardPosition"></div>
      <span id="playgroundKeyboardFret"></span>
      <span id="playgroundKeyboardStrings"></span>
    </div>
    <div class="playground-keyboard" id="playgroundKeyboardKeys"></div>
    <p class="subtext" id="playgroundKeyboardStatus">Audio idle</p>
    <p class="subtext" id="playgroundKeyboardHint">Click a key or use the number and letter rows. ${auditionPriority
      ? 'Held keys take priority on the selected channel; code resumes on its next note after release.'
      : 'The selected YM2612 channel is used.'}</p>
  `;

  const keysRoot = root.querySelector("#playgroundKeyboardKeys");
  const channelModeSelect = root.querySelector("#playgroundKeyboardChannelMode");
  const channelSelect = root.querySelector("#playgroundKeyboardChannel");
  const presetSelect = root.querySelector("#playgroundKeyboardPreset");
  const instrumentRoot = root.querySelector("#playgroundKeyboardInstrument");
  const positionRoot = root.querySelector("#playgroundKeyboardPosition");
  const fretRoot = root.querySelector("#playgroundKeyboardFret");
  const stringsRoot = root.querySelector("#playgroundKeyboardStrings");
  const keyboardStatus = root.querySelector("#playgroundKeyboardStatus");
  const channelTools = root.querySelector('#playgroundKeyboardChannelTools');
  const keyboardHint = root.querySelector('#playgroundKeyboardHint');
  const routingTools = root.querySelector('#playgroundKeyboardRoutingTools');
  const chipSelect = root.querySelector('#playgroundKeyboardChip');
  const targetChannelSelect = root.querySelector('#playgroundKeyboardTargetChannel');
  const editorTargetLabel = root.querySelector('#playgroundKeyboardEditorTarget');

  function selectedRoute() {
    const chip = routingState?.chips?.find(entry => String(entry.id) === String(routingState.chipId));
    const channel = chip?.channels?.find(entry => String(entry.id) === String(routingState.channelId));
    return {chip, channel, label: chip ? `${chip.label}${channel ? ` / ${channel.label}` : ''}` : ''};
  }

  const selectSignatures = new WeakMap();
  function syncSelect(select, entries, value, placeholder) {
    const options = entries.length ? entries : [{id:'', label:placeholder}];
    const signature = JSON.stringify(options.map(entry => [String(entry.id), entry.label, Boolean(entry.disabled)]));
    // Safari keeps a native picker open while this element has focus. Metadata
    // updates must not replace its options or overwrite an uncommitted choice.
    if (document.activeElement === select) return;
    if (selectSignatures.get(select) !== signature) {
      select.replaceChildren(...options.map(entry => {
        const option = document.createElement('option');
        option.value = String(entry.id);
        option.textContent = entry.label;
        option.disabled = Boolean(entry.disabled);
        return option;
      }));
      selectSignatures.set(select, signature);
    }
    select.value = value == null ? '' : String(value);
  }

  function syncRoutingControls() {
    if (!routing) return;
    const {chip} = selectedRoute();
    syncSelect(chipSelect, (routingState?.chips ?? []).map(entry => ({...entry, disabled:false})), routingState?.chipId, 'No connected instruments');
    syncSelect(targetChannelSelect, chip?.channels ?? [], routingState?.channelId, 'No channels');
    chipSelect.disabled = !routingState?.chips?.length;
    targetChannelSelect.disabled = !chip || chip.disabled || !chip.channels?.length;
  }

  function updateRoutingState() {
    if (disposed) return;
    const next = routing.getState();
    const before = selectedRoute();
    const changed = String(next?.chipId ?? '') !== String(routingState?.chipId ?? '') ||
      String(next?.channelId ?? '') !== String(routingState?.channelId ?? '');
    routingState = next;
    const after = selectedRoute();
    const playable = route => Boolean(route.chip && !route.chip.disabled && route.channel && !route.channel.disabled);
    if (routedKeyboard() && (changed || playable(before) !== playable(after))) releaseOwnedNotes();
    syncRoutingControls();
    updateTargetControls();
  }

  function selectRoute(select, action) {
    if (!routing || disposed) return;
    releaseOwnedNotes();
    try { action(select.value); }
    catch (error) { reportError(error); }
    select.blur();
    updateRoutingState();
  }
  chipSelect.addEventListener('change', () => selectRoute(chipSelect, id => routing.selectChip(id)));
  targetChannelSelect.addEventListener('change', () => selectRoute(targetChannelSelect, id => routing.selectChannel(id)));
  for (const select of [chipSelect, targetChannelSelect]) select.addEventListener('blur', syncRoutingControls);

  function updateTargetControls() {
    routingTools.hidden = !routedKeyboard();
    channelTools.hidden = !showFmDetails();
    editorTargetLabel.hidden = !editorMode;
    editorTargetLabel.textContent = editorTarget?.name ?? (root.dataset.audioState === 'preparing'
      ? 'Preparing audio...'
      : 'Select a sound chip and channel to audition.');
    const {chip, label} = selectedRoute();
    keyboardHint.textContent = editorMode
      ? editorTarget ? `Click a key or use the number and letter rows to play ${editorTarget.name}.`
        : 'Prepare audio and select a channel in this sound-chip editor.'
      : routedKeyboard()
      ? chip?.disabled ? `${label}: ${chip.hint ?? 'Keyboard playback is unavailable for this instrument.'}`
        : chip ? `Click a key or use the number and letter rows to play ${label}.${chip.hint ? ` ${chip.hint}` : ''}`
        : 'Connect an instrument to play this keyboard.'
      : noteTarget && !operatorMode
      ? `Click a key or use the number and letter rows to play ${noteTarget.name}.`
      : channelCount === 0 ? 'Connect an instrument to play this keyboard.'
      : `Click a key or use the number and letter rows. ${auditionPriority
        ? 'Held keys take priority on the selected channel; code resumes on its next note after release.'
        : 'The selected FM channel is used.'}`;
    if (routedKeyboard() && root.dataset.audioState !== 'preparing' && !held.size) {
      keyboardStatus.textContent = `${root.dataset.audioState === 'ready' ? 'Audio ready' : 'Audio idle'}${label ? ` · ${label}` : ''}`;
    }
  }

  function setPreparing(nextPreparing) {
    root.dataset.audioState = nextPreparing ? "preparing" : "ready";
    keyboardStatus.textContent = nextPreparing
      ? "Preparing audio..."
      : "Audio ready";
    updateTargetControls();
  }

  for (let channel = 0; channel < channelCount; channel += 1) {
    const option = document.createElement("option");
    option.value = String(channel);
    option.textContent = `CH${channel + 1}`;
    channelSelect.appendChild(option);
  }

  channelModeSelect.addEventListener("change", () => {
    channelMode = channelModeSelect.value;
    channelSelect.disabled = channelMode === "roundRobin";
    channelModeSelect.blur();
  });
  channelSelect.addEventListener("change", () => {
    fixedChannel = Number(channelSelect.value);
    channelSelect.blur();
    onChannelChange?.(fixedChannel);
  });
  channelSelect.value = "0";

  const currentPreset = document.createElement("option");
  currentPreset.value = "";
  currentPreset.textContent = "Current";
  presetSelect.appendChild(currentPreset);
  for (const presetName of presetOrder) {
    const option = document.createElement("option");
    option.value = presetName;
    option.textContent = presets[presetName]?.label ?? presetName;
    presetSelect.appendChild(option);
  }
  presetSelect.addEventListener("change", () => {
    onPresetChange?.(
      channelMode === "roundRobin" ? null : operatorMode ? getSelectedChannel() : fixedChannel,
      presetSelect.value
    );
    presetSelect.blur();
  });

  function renderLayout() {
    layout = createFretboardLayout(layoutOptions);
    buildKeyboard({
      root: keysRoot,
      rowDefs: layout.rowDefs,
      layoutEntries: layout.entries,
      showPitch: showFmDetails(),
      onPointerDown: (event, entry, button) => press(entry, button, false, `pointer:${event.pointerId ?? entry.key}`),
      onPointerUp: (event, entry) => release(`pointer:${event.pointerId ?? entry.key}`),
      onPointerCancel: (event, entry) => release(`pointer:${event.pointerId ?? entry.key}`),
    });
    renderFretboardControls({
      instrumentRoot,
      positionRoot,
      fretDisplayRoot: fretRoot,
      stringDisplayRoot: stringsRoot,
      stringWindowRoot: null,
      state,
      onInstrumentChange: (value) => {
        setInstrument(state, value);
        rebuild();
      },
      onPositionPresetSelect: (value) => {
        setFretPosition(state, value);
        rebuild();
      },
      onStringWindowChange: (value) => {
        setStringWindowIndex(state, value);
        rebuild();
      },
    });
    updateTargetControls();
  }

  function rebuild() {releaseAll(); renderLayout();}

  async function press(entry, button, fromComputerKeys = false, inputKey = `computer:${entry.key}`) {
    if (disposed || !enabled || held.has(inputKey)) return;
    if (editorMode && !editorTarget) return;
    if (routedKeyboard()) {
      const {chip, channel} = selectedRoute();
      if (!chip || chip.disabled || !channel || channel.disabled) return;
    }
    const token = generation;
    const target = currentNoteTarget();
    const note = {button, target, started:false, event:{id:`keyboard-${keyboardId}-${++pressSequence}`, midi:entry.midi, velocity:100}};
    held.set(inputKey, note);
    if (ensureAudioReady) {
      setPreparing(true);
      try {
        await ensureAudioReady();
      } catch (error) {
        if (held.get(inputKey) === note) held.delete(inputKey);
        setPreparing(false);
        onStatus?.(`Audio could not start: ${error.message}`);
        return;
      }
      setPreparing(false);
    }
    if (!enabled || generation !== token || held.get(inputKey) !== note) return;
    if (fromComputerKeys && !canHandleComputerKeys()) {
      held.delete(inputKey);
      return;
    }
    if (target) {
      if (currentNoteTarget() !== target) {held.delete(inputKey); return;}
      note.started = true;
      updateButton(button);
      try {
        const pending = target.noteOn(note.event);
        // A target may await preparation before touching its instrument. A
        // release while it waited must still silence that eventual voice.
        if (pending?.then) {
          await pending;
          if (generation !== token || held.get(inputKey) !== note || currentNoteTarget() !== target) callTarget(target, 'noteOff', note.event);
        }
        if (generation === token && held.get(inputKey) === note && currentNoteTarget() === target) onStatus?.(`Playing ${entry.noteName} on ${target.name}.`);
      } catch (error) {
        const current = held.get(inputKey) === note && generation === token;
        if (held.get(inputKey) === note) held.delete(inputKey);
        callTarget(target, 'noteOff', note.event);
        updateButton(button); if (current) reportError(error);
      }
      return;
    }
    if (editorMode || routedKeyboard() || !synth || channelCount < 1) {held.delete(inputKey); return;}
    const channel = channelMode === "roundRobin" ? roundRobinChannel++ % channelCount
      : operatorMode ? getSelectedChannel?.() ?? 0 : fixedChannel;
    // A channel has one voice: releasing a stolen key must not stop its replacement.
    for (const [key, previous] of held) {
      if (previous.channel === channel) {
        held.delete(key);
        updateButton(previous.button);
      }
    }
    note.channel = channel;
    note.synth = synth;
    note.started = true;
    if (synth.noteOnMidi) synth.noteOnMidi(channel, entry.midi);
    else synth.noteOn(channel, entry.pitch.block, entry.pitch.fnum);
    button?.classList.add("is-active");
    onStatus?.(`Playing ${entry.noteName} on channel ${channel + 1}.`);
  }

  function release(inputKey) {
    const note = held.get(inputKey);
    if (!note) return;
    held.delete(inputKey);
    releaseNote(note);
    updateButton(note.button);
  }

  function onKeyDown(event) {
    if (
      !enabled || !canHandleComputerKeys() || event.ctrlKey || event.metaKey || event.altKey ||
      event.editable || event.target?.isContentEditable ||
      event.repeat ||
      (/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName ?? "") &&
        event.target?.type !== "range")
    ) return;
    const entry = findLayoutEntry(layout.entries, event.key);
    if (!entry) return;
    event.preventDefault();
    void press(entry, keysRoot.querySelector(`[data-key="${CSS.escape(entry.key)}"]`), true, `computer:${event.code ?? entry.key}`);
  }

  function onKeyUp(event) {
    if (!enabled) return;
    const inputKey = `computer:${event.code ?? findLayoutEntry(layout.entries, event.key)?.key ?? event.key}`;
    if (!held.has(inputKey)) return;
    event.preventDefault();
    release(inputKey);
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseAll);

  rebuild();
  if (routing) {
    syncRoutingControls();
    unsubscribeRouting = routing.subscribe(updateRoutingState);
  }
  if (idPrefix) {
    for (const element of root.querySelectorAll("[id]")) element.id = idPrefix + element.id;
  }
  if (minimizeHost) {
    const button = root.querySelector(`#${idPrefix}playgroundKeyboardMinimize`);
    let minimized = false;
    const update = () => {
      minimizeHost.classList.toggle('is-keyboard-minimized', minimized);
      button.textContent = minimized ? 'Keys' : '−';
      button.title = minimized ? 'Show keyboard controls' : 'Minimize keyboard controls';
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-expanded', String(!minimized));
      onControlsMinimizedChange?.(minimized);
    };
    button.setAttribute('aria-controls', `${routing ? `${idPrefix}playgroundKeyboardRoutingTools ` : ''}${idPrefix}playgroundKeyboardChannelTools ${idPrefix}playgroundKeyboardFretTools`);
    button.addEventListener('click', () => { minimized = !minimized; update(); });
    update();
  }
  return {
    releaseAll,
    setView(tabName) {
      if (disposed) return;
      const previousDetails = showFmDetails();
      const nextEditorMode = EDITOR_TABS.has(tabName);
      const nextEnabled = tabName === "operator" || tabName === "keyboard" || nextEditorMode;
      const nextOperatorMode = tabName === "operator";
      if (view !== tabName) releaseOwnedNotes();
      view = tabName;
      enabled = nextEnabled;
      operatorMode = nextOperatorMode;
      editorMode = nextEditorMode;
      root.hidden = !enabled;
      channelModeSelect.disabled = false;
      channelSelect.disabled = channelMode === "roundRobin";
      channelSelect.value = String(operatorMode ? getSelectedChannel?.() ?? 0 : fixedChannel);
      channelModeSelect.value = channelMode;
      if (previousDetails !== showFmDetails()) renderLayout();
      else updateTargetControls();
    },
    syncChannel() {
      if (operatorMode) channelSelect.value = String(getSelectedChannel());
    },
    attachSynth(nextSynth) {
      if (synth && !currentNoteTarget()) releaseAll();
      synth = nextSynth;
      setPreparing(false);
    },
    attachNoteTarget(target) {
      if (target !== null && (!target || typeof target.name !== 'string' ||
          ['noteOn','noteOff','allNotesOff'].some(method => typeof target[method] !== 'function'))) {
        throw new TypeError('Keyboard target requires name, noteOn, noteOff and allNotesOff');
      }
      if (target === noteTarget) return;
      if (!editorMode) releaseOwnedNotes();
      noteTarget = target;
      if (routedKeyboard()) updateTargetControls();
      else if (!editorMode) renderLayout();
    },
    attachEditorTarget(target) {
      if (target !== null && (!target || typeof target.name !== 'string' ||
          ['noteOn','noteOff','allNotesOff'].some(method => typeof target[method] !== 'function'))) {
        throw new TypeError('Keyboard target requires name, noteOn, noteOff and allNotesOff');
      }
      if (target !== editorTarget && enabled && editorMode) releaseOwnedNotes();
      editorTarget = target;
      updateTargetControls();
    },
    dispose() {
      releaseAll();
      disposed = true; enabled = false; noteTarget = null; editorTarget = null; synth = null;
      unsubscribeRouting?.();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
    },
  };
}
