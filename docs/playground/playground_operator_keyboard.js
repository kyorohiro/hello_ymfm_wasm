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
  onPresetChange,
  ensureAudioReady,
  onStatus,
}) {
  const state = createFretboardState();
  let synth = null;
  let channelMode = "fixed";
  let fixedChannel = 0;
  let roundRobinChannel = 0;
  let preparing = false;
  let layout = createFretboardLayout({ state, ...REFERENCE });
  const held = new Map();

  root.innerHTML = `
    <div class="playground-keyboard-toolbar">
      <label>Mo:
        <select id="playgroundKeyboardChannelMode">
          <option value="fixed">Fixed channel</option>
          <option value="roundRobin">Round robin all channels</option>
        </select>
      </label>
      <label>Ch:
        <select id="playgroundKeyboardChannel"></select>
      </label>
      <label>Pre
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
    preparing = nextPreparing;
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
      channelMode === "roundRobin" ? null : fixedChannel,
      presetSelect.value
    );
    presetSelect.blur();
  });

  function rebuild() {
    layout = createFretboardLayout({ state, ...REFERENCE });
    buildKeyboard({
      root: keysRoot,
      rowDefs: layout.rowDefs,
      layoutEntries: layout.entries,
      onPointerDown: (_event, entry, button) => press(entry, button),
      onPointerUp: (_event, entry, button) => release(entry, button),
      onPointerCancel: (_event, entry, button) => release(entry, button),
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
    if (held.has(entry.key) || preparing) return;
    if (!synth && ensureAudioReady) {
      setPreparing(true);
      try {
        await ensureAudioReady();
      } catch (error) {
        setPreparing(false);
        onStatus?.(`Audio could not start: ${error.message}`);
        return;
      }
      setPreparing(false);
    }
    if (!synth) return;
    const channel = channelMode === "roundRobin"
      ? roundRobinChannel++ % channelCount
      : fixedChannel;
    synth.noteOn(channel, entry.pitch.block, entry.pitch.fnum);
    held.set(entry.key, { channel, button });
    button?.classList.add("is-active");
    onStatus?.(`Playing ${entry.noteName} on channel ${channel + 1}.`);
  }

  function release(entry, button) {
    const note = held.get(entry.key);
    if (!note) return;
    synth?.noteOff(note.channel);
    held.delete(entry.key);
    (button ?? note.button)?.classList.remove("is-active");
  }

  function onKeyDown(event) {
    if (
      root.closest(".tab-panel")?.hidden ||
      event.repeat ||
      (/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName ?? "") &&
        !root.contains(event.target))
    ) return;
    const entry = findLayoutEntry(layout.entries, event.key);
    if (!entry) return;
    event.preventDefault();
    void press(entry, keysRoot.querySelector(`[data-key="${CSS.escape(entry.key)}"]`));
  }

  function onKeyUp(event) {
    if (root.closest(".tab-panel")?.hidden) return;
    const entry = findLayoutEntry(layout.entries, event.key);
    if (!entry) return;
    event.preventDefault();
    release(entry, keysRoot.querySelector(`[data-key="${CSS.escape(entry.key)}"]`));
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  rebuild();
  return {
    attachSynth(nextSynth) {
      for (const note of held.values()) synth?.noteOff(note.channel);
      held.clear();
      synth = nextSynth;
      setPreparing(false);
    },
    dispose() {
      for (const note of held.values()) synth?.noteOff(note.channel);
      held.clear();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    },
  };
}
