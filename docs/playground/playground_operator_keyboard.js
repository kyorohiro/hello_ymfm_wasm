import {
  buildKeyboard,
  createFretboardLayout,
  createFretboardState,
  findLayoutEntry,
  renderFretboardControls,
  setFretPosition,
  setInstrument,
  setStringWindowIndex,
} from "../synth/synth_keyboard.js";

const REFERENCE = {
  referenceMidi: 62,
  referenceBlock: 4,
  referenceFnum: 553,
};

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
}) {
  const state = createFretboardState();
  let synth = null;
  let channelMode = "fixed";
  let fixedChannel = 0;
  let roundRobinChannel = 0;
  let layout = createFretboardLayout({ state, ...REFERENCE });
  const held = new Map();
  let enabled = false;
  let operatorMode = false;

  function releaseAll() {
    for (const note of held.values()) {
      if (note.channel !== undefined) synth?.noteOff(note.channel);
      note.button?.classList.remove("is-active");
    }
    held.clear();
  }

  root.innerHTML = `
    <div class="playground-keyboard-toolbar playground-keyboard-channel-tools">
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
    <div class="playground-keyboard-toolbar playground-keyboard-tools">
      <div id="playgroundKeyboardInstrument"></div>
      <div id="playgroundKeyboardPosition"></div>
      <span id="playgroundKeyboardFret"></span>
      <span id="playgroundKeyboardStrings"></span>
    </div>
    <div class="playground-keyboard" id="playgroundKeyboardKeys"></div>
    <p class="subtext" id="playgroundKeyboardStatus">Audio idle</p>
    <p class="subtext">Click a key or use the number and letter rows. The selected Operator channel is used.</p>
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

  function setPreparing(nextPreparing) {
    root.dataset.audioState = nextPreparing ? "preparing" : "ready";
    keyboardStatus.textContent = nextPreparing
      ? "Preparing audio..."
      : "Audio ready";
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

  function rebuild() {
    releaseAll();
    layout = createFretboardLayout({ state, ...REFERENCE });
    buildKeyboard({
      root: keysRoot,
      rowDefs: layout.rowDefs,
      layoutEntries: layout.entries,
      onPointerDown: (_event, entry, button) => press(entry, button),
      onPointerUp: (_event, entry) => release(entry),
      onPointerCancel: (_event, entry) => release(entry),
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
  }

  async function press(entry, button) {
    if (!enabled || held.has(entry.key)) return;
    const note = { button };
    held.set(entry.key, note);
    if (!synth && ensureAudioReady) {
      setPreparing(true);
      try {
        await ensureAudioReady();
      } catch (error) {
        if (held.get(entry.key) === note) held.delete(entry.key);
        setPreparing(false);
        onStatus?.(`Audio could not start: ${error.message}`);
        return;
      }
      setPreparing(false);
    }
    if (!synth || !enabled || held.get(entry.key) !== note) return;
    const channel = channelMode === "roundRobin" ? roundRobinChannel++ % channelCount
      : operatorMode ? getSelectedChannel() : fixedChannel;
    // A channel has one voice: releasing a stolen key must not stop its replacement.
    for (const [key, previous] of held) {
      if (previous.channel === channel) {
        previous.button?.classList.remove("is-active");
        held.delete(key);
      }
    }
    note.channel = channel;
    synth.noteOn(channel, entry.pitch.block, entry.pitch.fnum);
    button?.classList.add("is-active");
    onStatus?.(`Playing ${entry.noteName} on channel ${channel + 1}.`);
  }

  function release(entry) {
    const note = held.get(entry.key);
    if (!note) return;
    if (note.channel !== undefined) synth?.noteOff(note.channel);
    held.delete(entry.key);
    note.button?.classList.remove("is-active");
  }

  function onKeyDown(event) {
    if (
      !enabled || event.ctrlKey || event.metaKey || event.altKey ||
      event.target?.isContentEditable ||
      event.repeat ||
      (/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName ?? "") &&
        event.target?.type !== "range")
    ) return;
    const entry = findLayoutEntry(layout.entries, event.key);
    if (!entry) return;
    event.preventDefault();
    void press(entry, keysRoot.querySelector(`[data-key="${CSS.escape(entry.key)}"]`));
  }

  function onKeyUp(event) {
    if (!enabled) return;
    const entry = findLayoutEntry(layout.entries, event.key);
    if (!entry || !held.has(entry.key)) return;
    event.preventDefault();
    release(entry);
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", releaseAll);

  rebuild();
  return {
    setView(tabName) {
      releaseAll();
      enabled = tabName === "operator" || tabName === "keyboard";
      operatorMode = tabName === "operator";
      root.hidden = !enabled;
      channelModeSelect.disabled = false;
      channelSelect.disabled = channelMode === "roundRobin";
      channelSelect.value = String(operatorMode ? getSelectedChannel() : fixedChannel);
      channelModeSelect.value = channelMode;
    },
    syncChannel() {
      if (operatorMode) channelSelect.value = String(getSelectedChannel());
    },
    attachSynth(nextSynth) {
      if (synth) releaseAll();
      synth = nextSynth;
      setPreparing(false);
    },
    dispose() {
      releaseAll();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
    },
  };
}
