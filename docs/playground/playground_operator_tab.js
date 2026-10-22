import {
  apiOperatorToDisplayOperator,
  buildCommonControls,
  buildHeader,
  buildOperatorControls,
  createParamControl,
  displayOperatorToApiOperator,
} from "../synth/synth_controls.js?v=chip-tabs-2";
import { createOperatorEnvelopeView } from './playground_operator_visual.js?v=chip-tabs-2';

const OPERATOR_NUMBERS = [1, 2, 3, 4];
const SPECIAL_MODE_CHANNEL = 2;
const COMMON_PARAM_DEFS = [
  { id: "algorithm", label: "ALGO", min: 0, max: 7, step: 1, category: "routing" },
  { id: "feedback", label: "FB", min: 0, max: 7, step: 1, category: "routing" },
  { id: "ams", label: "AMS", min: 0, max: 3, step: 1, category: "modulation" },
  { id: "pms", label: "PMS", min: 0, max: 7, step: 1, category: "modulation" },
  { id: "lfoEnabled", label: "LFO", min: 0, max: 1, step: 1, booleanMode: true, category: "modulation" },
  { id: "lfoFrequency", label: "LFOF", min: 0, max: 7, step: 1, category: "modulation" },
  { id: "dacEnabled", label: "DAC", min: 0, max: 1, step: 1, booleanMode: true, category: "modulation" },
];
const OPERATOR_PARAM_DEFS = [
  { id: "dt", label: "DT", min: 0, max: 7, step: 1, category: "pitch" },
  { id: "multi", label: "MULTI", min: 0, max: 15, step: 1, category: "pitch" },
  { id: "tl", label: "TL", min: 0, max: 127, step: 1, category: "level" },
  { id: "rs", label: "RS", min: 0, max: 3, step: 1, category: "envelope" },
  { id: "ar", label: "AR", min: 0, max: 31, step: 1, category: "envelope" },
  { id: "am", label: "AM", min: 0, max: 1, step: 1, booleanMode: true, category: "modulation" },
  { id: "d1r", label: "D1R", min: 0, max: 31, step: 1, category: "envelope" },
  { id: "d2r", label: "D2R", min: 0, max: 31, step: 1, category: "envelope" },
  { id: "sl", label: "SL", min: 0, max: 15, step: 1, category: "envelope" },
  { id: "rr", label: "RR", min: 0, max: 15, step: 1, category: "envelope" },
  { id: "ssg", label: "SSG", min: 0, max: 15, step: 1, category: "modulation" },
];
const GLOBAL_COMMON_STATE = {
  lfoEnabled: false,
  lfoFrequency: 0,
  dacEnabled: false,
};
const DEFAULT_SPECIAL_FREQUENCY = Object.freeze({
  block: 0,
  fnum: 0,
});
const ALGORITHM_DESCRIPTIONS = [
  'ALGO 0 <span class="op-color-1">OP1</span> -> <span class="op-color-2">OP2</span> -> <span class="op-color-3">OP3</span> -> <span class="op-color-4">OP4</span> -> OUT',
  'ALGO 1 (<span class="op-color-1">OP1</span> + <span class="op-color-2">OP2</span>) -> <span class="op-color-3">OP3</span> -> <span class="op-color-4">OP4</span> -> OUT',
  'ALGO 2 (<span class="op-color-1">OP1</span> + (<span class="op-color-2">OP2</span> -> <span class="op-color-3">OP3</span>)) -> <span class="op-color-4">OP4</span> -> OUT',
  'ALGO 3 ((<span class="op-color-1">OP1</span> -> <span class="op-color-2">OP2</span>) + <span class="op-color-3">OP3</span>) -> <span class="op-color-4">OP4</span> -> OUT',
  'ALGO 4 (<span class="op-color-1">OP1</span> -> <span class="op-color-2">OP2</span>) + (<span class="op-color-3">OP3</span> -> <span class="op-color-4">OP4</span>) -> OUT',
  'ALGO 5 (<span class="op-color-1">OP1</span> -> <span class="op-color-2">OP2</span>) + (<span class="op-color-1">OP1</span> -> <span class="op-color-3">OP3</span>) + (<span class="op-color-1">OP1</span> -> <span class="op-color-4">OP4</span>) -> OUT',
  'ALGO 6 (<span class="op-color-1">OP1</span> -> <span class="op-color-2">OP2</span>) + <span class="op-color-3">OP3</span> + <span class="op-color-4">OP4</span> -> OUT',
  'ALGO 7 <span class="op-color-1">OP1</span> + <span class="op-color-2">OP2</span> + <span class="op-color-3">OP3</span> + <span class="op-color-4">OP4</span> -> OUT',
];

function getPresetOperator(
  preset,
  displayOperator
) {
  const operators =
    preset?.operators;

  if (!Array.isArray(operators)) {
    return undefined;
  }

  return operators[
    displayOperator - 1
  ];
}

function createDefaultOperatorState(
  operator
) {
  if (operator === 4) {
    return {
      dt: 0,
      multi: 1,
      tl: 8,
      rs: 0,
      ar: 22,
      am: false,
      d1r: 6,
      d2r: 3,
      sl: 3,
      rr: 8,
      ssg: 0,
    };
  }

  return {
    dt: 0,
    multi: 1,
    tl: 127,
    rs: 0,
    ar: 31,
    am: false,
    d1r: 0,
    d2r: 0,
    sl: 0,
    rr: 15,
    ssg: 0,
  };
}

function createDefaultChannelState() {
  return {
    presetName: "",
    algorithm: 7,
    feedback: 0,
    ams: 0,
    pms: 0,
    left: true,
    right: true,
    operators: {
      1: createDefaultOperatorState(1),
      2: createDefaultOperatorState(2),
      3: createDefaultOperatorState(3),
      4: createDefaultOperatorState(4),
    },
  };
}

function cloneOperatorState(
  operatorState
) {
  return { ...operatorState };
}

function createChannelStateFromPreset(
  presetName,
  presets
) {
  const baseState =
    createDefaultChannelState();
  const preset =
    presets[presetName];

  if (!preset) {
    return baseState;
  }

  baseState.presetName = presetName;
  baseState.algorithm =
    preset.algorithm ?? 7;
  baseState.feedback =
    preset.feedback ?? 0;
  baseState.ams =
    preset.ams ?? 0;
  baseState.pms =
    preset.pms ?? 0;
  baseState.left =
    preset.pan?.left ??
    true;
  baseState.right =
    preset.pan?.right ??
    true;

  for (const operator of OPERATOR_NUMBERS) {
    baseState.operators[operator] = {
      ...baseState.operators[operator],
      ...(getPresetOperator(
        preset,
        operator
      ) ??
        {}),
    };
  }

  return baseState;
}

function cloneChannelState(
  state
) {
  return {
    presetName: state.presetName,
    algorithm: state.algorithm,
    feedback: state.feedback,
    ams: state.ams,
    pms: state.pms,
    left: state.left,
    right: state.right,
    operators: {
      1: cloneOperatorState(
        state.operators[1]
      ),
      2: cloneOperatorState(
        state.operators[2]
      ),
      3: cloneOperatorState(
        state.operators[3]
      ),
      4: cloneOperatorState(
        state.operators[4]
      ),
    },
  };
}

function createDefaultChannel3SpecialState() {
  return {
    enabled: false,
    frequencies: {
      1: { ...DEFAULT_SPECIAL_FREQUENCY },
      2: { ...DEFAULT_SPECIAL_FREQUENCY },
      3: { ...DEFAULT_SPECIAL_FREQUENCY },
      4: { ...DEFAULT_SPECIAL_FREQUENCY },
    },
  };
}

function mergeOperatorParams(
  target,
  params
) {
  if (!params) {
    return;
  }

  for (const config of OPERATOR_PARAM_DEFS) {
    if (
      params[config.id] !== undefined
    ) {
      target[config.id] =
        params[config.id];
    }
  }
}

export function createPlaygroundOperatorTab(
  options
) {
  const {
    root,
    presets,
    presetOrder,
    onStatus,
    channelCount = 6,
    supportsDac = true,
  } = options;

  if (!root) {
    throw new Error(
      "Operator tab root is required"
    );
  }

  const stateByChannel =
    Array.from(
      { length: channelCount },
      () =>
        createChannelStateFromPreset(
          "",
          presets
        )
    );
  const dirtyChannels =
    new Set();
  const globalCommonState = {
    ...GLOBAL_COMMON_STATE,
  };
  let selectedChannel = 0;
  let selectionVersion = 0;
  let synth = null;
  let refreshBatchDepth = 0;
  let pendingSelectedRefresh =
    false;
  let controlsDirty = false;
  let controlsFrame = null;
  let visible = false;
  let disposed = false;
  const requestFrame = options.requestAnimationFrame ?? (callback => requestAnimationFrame(callback));
  const cancelFrame = options.cancelAnimationFrame ?? (frame => cancelAnimationFrame(frame));
  let channel3SpecialState =
    createDefaultChannel3SpecialState();

  const commonControls =
    new Map();
  const operatorControls =
    new Map();
  const channel3SpecialControls =
    new Map();

  root.innerHTML = `
    <div class="operator-tab-toolbar">
      <div class="preset-row">
        <label for="operatorTabChannelSelect">Channel</label>
        <select id="operatorTabChannelSelect"></select>
      </div>
      <div class="preset-row">
        <label for="operatorTabPresetSelect">Preset</label>
        <select id="operatorTabPresetSelect"></select>
      </div>
      <label class="toolbar-check">
        <input id="operatorTabPanLeft" type="checkbox" checked>
        Left
      </label>
      <label class="toolbar-check">
        <input id="operatorTabPanRight" type="checkbox" checked>
        Right
      </label>
    </div>
    <p id="operatorTabAlgorithmDescription" class="algo-inline"></p>
    <details class="operator-envelope-guide" open>
      <summary>Operator envelopes</summary>
      <div class="operator-envelope-tools">
        <div data-operator-envelope-legend role="group" aria-label="Edit operator envelope">
          ${OPERATOR_NUMBERS.map(op => `<button type="button" class="op-color-${op}" data-envelope-operator="${op}" aria-pressed="${op === 4}">OP${op}</button>`).join('')}
        </div>
        <output data-envelope-readout></output>
      </div>
      <div class="operator-envelope-plot">
        <canvas data-operator-envelope width="720" height="144" role="img" aria-label="Schematic envelopes for OP1 through OP4. Select an operator and drag its labeled points to edit."></canvas>
        ${['attack', 'decay', 'sustain', 'release'].map(handle => `<button type="button" class="operator-envelope-handle" data-envelope-handle="${handle}" aria-label="${handle}"></button>`).join('')}
      </div>
      <p class="subtext">Drag points · ←/→ rate, ↑/↓ level when a point is focused. Relative time/level; pitch, RS and SSG-EG affect actual envelopes.</p>
    </details>
    <div class="operator-stack">
      <div class="operator-header-row">
        <div class="operator-header-spacer"></div>
        <div class="operator-header-strip" id="operatorTabCommonHeader"></div>
      </div>
      <div class="operator-row">
        <div class="operator-name" aria-hidden="true"></div>
        <div class="param-strip" id="operatorTabCommonControls"></div>
      </div>
      <div class="operator-header-row">
        <div class="operator-header-spacer operator-corner-label">OP</div>
        <div class="operator-header-strip" id="operatorTabOperatorHeader"></div>
      </div>
      <div id="operatorTabOperatorControls" class="operator-stack"></div>
      <div class="special-monitor">
        <div class="special-monitor-head">
          <span class="special-monitor-title">CH3SP</span>
          <span id="operatorTabSpecialModePill" class="pill">Special Off</span>
        </div>
        <div id="operatorTabSpecialControls" class="operator-stack"></div>
      </div>
    </div>
  `;

  const channelSelect =
    root.querySelector(
      "#operatorTabChannelSelect"
    );
  const presetSelect =
    root.querySelector(
      "#operatorTabPresetSelect"
    );
  const panLeft =
    root.querySelector(
      "#operatorTabPanLeft"
    );
  const panRight =
    root.querySelector(
      "#operatorTabPanRight"
    );
  const commonHeader =
    root.querySelector(
      "#operatorTabCommonHeader"
    );
  const commonControlsRoot =
    root.querySelector(
      "#operatorTabCommonControls"
    );
  const operatorHeader =
    root.querySelector(
      "#operatorTabOperatorHeader"
    );
  const operatorControlsRoot =
    root.querySelector(
      "#operatorTabOperatorControls"
    );
  const specialModePill =
    root.querySelector(
      "#operatorTabSpecialModePill"
    );
  const specialControlsRoot =
    root.querySelector(
      "#operatorTabSpecialControls"
    );
  const algorithmDescription =
    root.querySelector(
      "#operatorTabAlgorithmDescription"
    );
  const envelopeView = createOperatorEnvelopeView({
    root: root.querySelector('.operator-envelope-guide'),
    getOperators: () => currentState().operators,
    getSelectionKey: () => selectionVersion,
    onEdit: applyOperatorParams,
  });

  buildHeader(
    commonHeader,
    COMMON_PARAM_DEFS
  );
  if (commonHeader?.parentElement) {
    commonHeader.parentElement.style.display =
      "none";
  }
  buildHeader(
    operatorHeader,
    OPERATOR_PARAM_DEFS
  );

  function currentState() {
    return stateByChannel[
      selectedChannel
    ];
  }

  function refreshIfSelected(
    channel
  ) {
    if (channel !== selectedChannel) {
      return;
    }

    if (refreshBatchDepth > 0) {
      pendingSelectedRefresh =
        true;
      return;
    }

    scheduleControlsRefresh();
  }

  function cancelControlsFrame() {
    if (controlsFrame !== null) cancelFrame(controlsFrame);
    controlsFrame = null;
  }

  function scheduleControlsRefresh() {
    controlsDirty = true;
    if (disposed || !visible || document.hidden || refreshBatchDepth || controlsFrame !== null) return;
    controlsFrame = requestFrame(() => {
      controlsFrame = null;
      if (!disposed && visible && !document.hidden && controlsDirty) updateControlsUi();
    });
  }

  function visibilityChanged() {
    if (document.hidden) cancelControlsFrame();
    else if (controlsDirty) scheduleControlsRefresh();
  }
  document.addEventListener('visibilitychange', visibilityChanged);

  function beginRefreshBatch() {
    refreshBatchDepth += 1;
  }

  function endRefreshBatch() {
    if (refreshBatchDepth === 0) {
      return;
    }

    refreshBatchDepth -= 1;

    if (
      refreshBatchDepth === 0 &&
      pendingSelectedRefresh
    ) {
      pendingSelectedRefresh =
        false;
      scheduleControlsRefresh();
    }
  }

  function markDirty() {
    options.onEdit?.();
    dirtyChannels.add(
      selectedChannel
    );
  }

  function applyChannelStateToSynth(
    channel,
    includeGlobal = false
  ) {
    if (!synth) {
      return;
    }

    const state =
      stateByChannel[channel];

    beginRefreshBatch();

    try {
      for (const operator of OPERATOR_NUMBERS) {
        synth.setOperator(
          channel,
          displayOperatorToApiOperator(
            operator
          ),
          state.operators[operator]
        );
      }

      synth.setAlgo(
        channel,
        state.algorithm,
        state.feedback
      );
      // Selecting a channel's voice must not rewrite chip-wide controls or
      // the independently playing CH3 pitch. Only restore them on attachment.
      if (includeGlobal) {
        if (synth.supportsLfo !== false) synth.setLfo(
          globalCommonState.lfoEnabled,
          globalCommonState.lfoFrequency
        );
        if (supportsDac) synth.setDacEnabled?.(
          globalCommonState.dacEnabled
        );
        synth.setChannel3SpecialMode(
          channel3SpecialState.enabled
        );
        for (const operator of OPERATOR_NUMBERS) {
          applyChannel3SpecialOperator(operator);
        }
      }
      applyPanToSynth(channel);
    } finally {
      endRefreshBatch();
    }
  }

  function applyChannel3SpecialOperator(operator) {
    if (!synth) {
      return;
    }

    const entry =
      channel3SpecialState.frequencies[operator];
    synth.setChannel3SpecialFrequency(
      displayOperatorToApiOperator(operator),
      entry.block,
      entry.fnum
    );
    if (operator === 4) {
      synth.setFrequency(
        SPECIAL_MODE_CHANNEL,
        entry.block,
        entry.fnum
      );
    }
  }

  function applyPanToSynth(channel) {
    if (!synth || synth.supportsPan === false) {
      return;
    }

    const state = stateByChannel[channel];
    synth.setPan(
      channel,
      state.left,
      state.right,
      state.ams,
      state.pms
    );
  }

  function updatePanUi() {
    const state =
      currentState();
    const mono = synth?.supportsPan === false;
    panLeft.disabled = mono;
    panRight.disabled = mono;
    panLeft.checked =
      mono || state.left;
    panRight.checked =
      mono || state.right;
    for (const id of ['ams', 'pms', 'lfoEnabled', 'lfoFrequency']) {
      const unavailable = id === 'ams' || id === 'pms' ? mono : synth?.supportsLfo === false;
      for (const input of commonControls.get(id)?.element.querySelectorAll('input,button,select') ?? []) input.disabled = unavailable;
    }
  }

  function updateAlgorithmDescription() {
    if (!algorithmDescription) {
      return;
    }

    const state =
      currentState();
    const description =
      ALGORITHM_DESCRIPTIONS[
        state.algorithm
      ] ??
      `ALGO ${state.algorithm}`;
    const feedbackText =
      state.feedback === 0
        ? "FB off"
        : `OP1 feedback ${state.feedback}`;

    algorithmDescription.innerHTML =
      `${description} ${feedbackText}`;
  }

  function updateControlsUi() {
    controlsDirty = false;
    cancelControlsFrame();
    const state =
      currentState();

    presetSelect.value =
      state.presetName;
    updatePanUi();
    updateAlgorithmDescription();

    for (const config of COMMON_PARAM_DEFS) {
      commonControls
        .get(config.id)
        ?.updateVisual(
          config.id ===
            "lfoEnabled" ||
          config.id ===
            "lfoFrequency" ||
          config.id ===
            "dacEnabled"
            ? globalCommonState[
                config.id
              ]
            : state[config.id]
        );
    }

    for (const operator of OPERATOR_NUMBERS) {
      const rowControls =
        operatorControls.get(
          operator
        );
      if (!rowControls) {
        continue;
      }

      for (const config of OPERATOR_PARAM_DEFS) {
        rowControls
          .get(config.id)
          ?.updateVisual(
            state.operators[operator][
              config.id
            ]
          );
      }
    }

    updateSpecialUi();
    envelopeView.invalidate();
  }

  function updateSpecialUi() {
    if (!specialModePill) {
      return;
    }

    specialModePill.textContent =
      channel3SpecialState.enabled
        ? "Special On"
        : "Special Off";
    for (const operator of OPERATOR_NUMBERS) {
      const entry =
        channel3SpecialState
          .frequencies[operator] ??
        DEFAULT_SPECIAL_FREQUENCY;
      channel3SpecialControls
        .get(`op${operator}-block`)
        ?.updateVisual(entry.block);
      channel3SpecialControls
        .get(`op${operator}-fnum`)
        ?.updateVisual(entry.fnum);
    }
    channel3SpecialControls
      .get("enabled")
      ?.updateVisual(
        channel3SpecialState.enabled
      );
  }

  function buildSpecialControls() {
    if (!specialControlsRoot) {
      return;
    }

    specialControlsRoot.innerHTML = "";
    specialControlsRoot.className =
      "special-control-strip";

    const modeControl =
      createParamControl({
        label: "MODE",
        min: 0,
        max: 1,
        step: 1,
        booleanMode: true,
        category: "modulation",
        wheelAdjust: false,
        value:
          channel3SpecialState.enabled,
        onChange: (nextValue) => {
          channel3SpecialState.enabled =
            Boolean(nextValue);
          synth?.setChannel3SpecialMode(
            channel3SpecialState.enabled
          );
          updateSpecialUi();
        },
      });
    channel3SpecialControls.set(
      "enabled",
      modeControl
    );
    specialControlsRoot.appendChild(
      modeControl.element
    );

    for (const operator of OPERATOR_NUMBERS) {
      const blockControl =
        createParamControl({
          label: `OP${operator}B`,
          min: 0,
          max: 7,
          step: 1,
          category: "pitch",
          wheelAdjust: false,
          value:
            channel3SpecialState
              .frequencies[operator]
              .block,
          onChange: (nextValue) => {
            channel3SpecialState
              .frequencies[operator]
              .block = nextValue;
            applyChannel3SpecialOperator(operator);
            updateSpecialUi();
          },
        });
      channel3SpecialControls.set(
        `op${operator}-block`,
        blockControl
      );
      specialControlsRoot.appendChild(
        blockControl.element
      );

      const fnumControl =
        createParamControl({
          label: `OP${operator}F`,
          min: 0,
          max: 2047,
          step: 1,
          category: "pitch",
          wheelAdjust: false,
          value:
            channel3SpecialState
              .frequencies[operator]
              .fnum,
          onChange: (nextValue) => {
            channel3SpecialState
              .frequencies[operator]
              .fnum = nextValue;
            applyChannel3SpecialOperator(operator);
            updateSpecialUi();
          },
        });
      channel3SpecialControls.set(
        `op${operator}-fnum`,
        fnumControl
      );
      specialControlsRoot.appendChild(
        fnumControl.element
      );
    }
  }

  function replaceCurrentState(
    nextState
  ) {
    selectionVersion += 1;
    stateByChannel[
      selectedChannel
    ] = cloneChannelState(
      nextState
    );
    updateControlsUi();
    markDirty();
    applyChannelStateToSynth(
      selectedChannel
    );
  }

  buildCommonControls({
    root: commonControlsRoot,
    defs: COMMON_PARAM_DEFS.filter(config => supportsDac || config.id !== 'dacEnabled'),
    state: {
      ...currentState(),
      ...globalCommonState,
    },
    controlsMap: commonControls,
    stackedLabels: true,
    referenceColumnCount:
      OPERATOR_PARAM_DEFS.length,
    gapPx: 4,
    wheelAdjust: false,
    onChange(id, value) {
      const state = id === "lfoEnabled" ||
        id === "lfoFrequency" ||
        id === "dacEnabled"
        ? globalCommonState : currentState();
      if (state[id] === value) return;
      state[id] = value;
      updateAlgorithmDescription();
      markDirty();
      if (synth) {
        if (
          id === "lfoEnabled" ||
          id === "lfoFrequency"
        ) {
          if (synth.supportsLfo !== false) synth.setLfo(
            globalCommonState.lfoEnabled,
            globalCommonState.lfoFrequency
          );
        } else if (
          id === "dacEnabled"
        ) {
          synth.setDacEnabled?.(
            globalCommonState.dacEnabled
          );
        } else if (id === 'algorithm' || id === 'feedback') {
          synth.setAlgo(selectedChannel, currentState().algorithm, currentState().feedback);
        } else if (id === 'ams' || id === 'pms') {
          applyPanToSynth(selectedChannel);
        }
      }
    },
  });

  buildOperatorControls({
    root: operatorControlsRoot,
    operatorNumbers:
      OPERATOR_NUMBERS,
    defs: OPERATOR_PARAM_DEFS,
    operatorStates:
      currentState().operators,
    controlsMap: operatorControls,
    wheelAdjust: false,
    onChange(operator, id, value) {
      applyOperatorParams(operator, {[id]: value});
    },
  });

  function applyOperatorParams(operator, params) {
    const state = currentState().operators[operator];
    const changed = {};
    for (const config of OPERATOR_PARAM_DEFS) {
      if (params[config.id] === undefined || params[config.id] === state[config.id]) continue;
      state[config.id] = params[config.id];
      changed[config.id] = params[config.id];
      operatorControls.get(operator)?.get(config.id)?.updateVisual(params[config.id]);
    }
    if (!Object.keys(changed).length) return;
    envelopeView.invalidate();
    markDirty();
    synth?.setOperator(selectedChannel, displayOperatorToApiOperator(operator), changed);
  }

  buildSpecialControls();

  for (
    let channel = 0;
    channel < channelCount;
    channel += 1
  ) {
    const option =
      document.createElement(
        "option"
      );
    option.value = String(channel);
    option.textContent =
      `Channel ${channel + 1}`;
    channelSelect.appendChild(
      option
    );
  }

  const currentOption = document.createElement("option");
  currentOption.value = "";
  currentOption.textContent = "Current";
  presetSelect.appendChild(currentOption);

  for (const presetName of presetOrder) {
    const option =
      document.createElement(
        "option"
      );
    option.value = presetName;
    option.textContent =
      presets[presetName]?.label ??
      presetName;
    presetSelect.appendChild(
      option
    );
  }

  function registerPresetOption(presetName, label) {
    for (const option of presetSelect.options) {
      if (option.value === presetName) {
        return;
      }
    }

    const option = document.createElement("option");
    option.value = presetName;
    option.textContent =
      label ?? presets[presetName]?.label ?? presetName;
    presetSelect.appendChild(option);
  }

  function removePresetOption(presetName) {
    for (const option of presetSelect.options) {
      if (option.value === presetName) {
        option.remove();
        break;
      }
    }
  }

  channelSelect.addEventListener(
    "change",
    () => {
      selectionVersion += 1;
      selectedChannel = Number(
        channelSelect.value
      );
      updateControlsUi();
      channelSelect.blur();
    }
  );

  presetSelect.addEventListener(
    "change",
    () => {
      presetSelect.blur();
      if (!presetSelect.value) {
        currentState().presetName = "";
        return;
      }
      replaceCurrentState(
        createChannelStateFromPreset(
          presetSelect.value,
          presets
        )
      );
      onStatus?.(
        `YM2612 preset loaded for channel ${selectedChannel + 1}.`
      );
    }
  );

  panLeft.addEventListener(
    "change",
    () => {
      currentState().left =
        panLeft.checked;
      markDirty();
      applyPanToSynth(selectedChannel);
    }
  );

  panRight.addEventListener(
    "change",
    () => {
      currentState().right =
        panRight.checked;
      markDirty();
      applyPanToSynth(selectedChannel);
    }
  );

  channelSelect.value = "0";
  updateControlsUi();

  if (options.idPrefix) {
    for (const element of root.querySelectorAll("[id]")) element.id = options.idPrefix + element.id;
    for (const label of root.querySelectorAll("[for]")) label.htmlFor = options.idPrefix + label.htmlFor;
  }

  return {
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      envelopeView.setVisible(visible);
      if (!visible) cancelControlsFrame();
      else if (controlsDirty) scheduleControlsRefresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelControlsFrame();
      document.removeEventListener('visibilitychange', visibilityChanged);
      envelopeView.dispose();
    },
    registerPresetOption,
    removePresetOption,
    selectChannel(channel) {
      selectionVersion += 1;
      selectedChannel = Math.max(0, Math.min(channelCount - 1, Number(channel) || 0));
      channelSelect.value = String(selectedChannel);
      updateControlsUi();
    },
    selectPreset(channel, presetName) {
      selectionVersion += 1;
      selectedChannel = Math.max(0, Math.min(channelCount - 1, Number(channel) || 0));
      channelSelect.value = String(selectedChannel);
      if (presets[presetName]) {
        replaceCurrentState(createChannelStateFromPreset(presetName, presets));
        updateControlsUi();
      }
    },
    getSelectedChannel() {
      return selectedChannel;
    },
    getChannelPreset(channel = selectedChannel) {
      const state = stateByChannel[Math.max(0, Math.min(channelCount - 1, Number(channel) || 0))];
      return {
        algorithm: state.algorithm,
        feedback: state.feedback,
        ams: state.ams,
        pms: state.pms,
        pan: { left: state.left, right: state.right },
        operators: {
          1: { ...state.operators[1] },
          2: { ...state.operators[2] },
          3: { ...state.operators[3] },
          4: { ...state.operators[4] },
        },
      };
    },
    attachSynth(nextSynth) {
      synth = nextSynth;
      updatePanUi();

      for (const channel of dirtyChannels) {
        applyChannelStateToSynth(
          channel,
          true
        );
      }
    },
    syncReset() {
      selectionVersion += 1;
      for (
        let channel = 0;
        channel < channelCount;
        channel += 1
      ) {
        stateByChannel[channel] =
          createChannelStateFromPreset(
            "",
            presets
          );
      }
      channel3SpecialState =
        createDefaultChannel3SpecialState();
      Object.assign(globalCommonState, GLOBAL_COMMON_STATE);
      dirtyChannels.clear();
      scheduleControlsRefresh();
    },
    syncPreset(channel, presetName, preset) {
      if (channel === selectedChannel) selectionVersion += 1;
      const nextState =
        presetName &&
        presets[presetName]
          ? createChannelStateFromPreset(
              presetName,
              presets
            )
          : createDefaultChannelState();

      if (
        preset &&
        typeof preset === "object"
      ) {
        nextState.algorithm =
          preset.algorithm ??
          nextState.algorithm;
        nextState.feedback =
          preset.feedback ??
          nextState.feedback;
        if (
          preset.lfo &&
          typeof preset.lfo === "object"
        ) {
          globalCommonState.lfoEnabled =
            preset.lfo.enabled ??
            globalCommonState.lfoEnabled;
          globalCommonState.lfoFrequency =
            preset.lfo.frequency ??
            globalCommonState.lfoFrequency;
        }
        globalCommonState.dacEnabled =
          preset.dacEnabled ??
          globalCommonState.dacEnabled;
        nextState.ams =
          preset.ams ??
          nextState.ams;
        nextState.pms =
          preset.pms ??
          nextState.pms;
        nextState.left =
          preset.pan?.left ??
          nextState.left;
        nextState.right =
          preset.pan?.right ??
          nextState.right;

        for (const operator of OPERATOR_NUMBERS) {
          mergeOperatorParams(
            nextState.operators[operator],
            getPresetOperator(
              preset,
              operator
            )
          );
        }
      }

      nextState.presetName =
        presetName ??
        nextState.presetName;
      stateByChannel[channel] =
        nextState;
      refreshIfSelected(channel);
    },
    syncOperator(
      channel,
      operator,
      params
    ) {
      const displayOperator =
        apiOperatorToDisplayOperator(
          operator
        );
      mergeOperatorParams(
        stateByChannel[channel]
          .operators[
            displayOperator
          ],
        params
      );
      refreshIfSelected(channel);
    },
    syncAlgo(
      channel,
      algorithm,
      feedback = 0
    ) {
      stateByChannel[channel].algorithm =
        algorithm;
      stateByChannel[channel].feedback =
        feedback;
      refreshIfSelected(channel);
    },
    syncLfo(
      enabled,
      frequency
    ) {
      globalCommonState.lfoEnabled =
        enabled;
      globalCommonState.lfoFrequency =
        frequency;
      scheduleControlsRefresh();
    },
    syncDacEnabled(enabled) {
      globalCommonState.dacEnabled =
        enabled;
      scheduleControlsRefresh();
    },
    syncChannel3SpecialMode(
      enabled
    ) {
      channel3SpecialState.enabled =
        enabled;
      scheduleControlsRefresh();
    },
    syncChannel3SpecialFrequency(
      operator,
      block,
      fnum
    ) {
      const displayOperator =
        apiOperatorToDisplayOperator(
          operator
        );
      channel3SpecialState
        .frequencies[
        displayOperator
      ] = {
        block,
        fnum,
      };
      scheduleControlsRefresh();
    },
    syncPan(
      channel,
      left,
      right,
      ams = undefined,
      pms = undefined
    ) {
      stateByChannel[channel].left =
        left;
      stateByChannel[channel].right =
        right;
      if (ams !== undefined) stateByChannel[channel].ams = ams;
      if (pms !== undefined) stateByChannel[channel].pms = pms;
      refreshIfSelected(channel);
    },
  };
}
