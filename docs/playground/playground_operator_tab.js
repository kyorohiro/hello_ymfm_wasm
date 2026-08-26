import {
  apiOperatorToDisplayOperator,
  buildCommonControls,
  buildHeader,
  buildOperatorControls,
  displayOperatorToApiOperator,
} from "../synth/synth_controls.js";

const CHANNEL_COUNT = 6;
const OPERATOR_NUMBERS = [1, 2, 3, 4];
const COMMON_PARAM_DEFS = [
  { id: "algorithm", label: "ALGO", min: 0, max: 7, step: 1, category: "routing" },
  { id: "feedback", label: "FB", min: 0, max: 7, step: 1, category: "routing" },
  { id: "ams", label: "AMS", min: 0, max: 3, step: 1, category: "modulation" },
  { id: "pms", label: "PMS", min: 0, max: 7, step: 1, category: "modulation" },
  { id: "lfoEnabled", label: "LFO", min: 0, max: 1, step: 1, booleanMode: true, category: "modulation" },
  { id: "lfoFrequency", label: "LFOF", min: 0, max: 7, step: 1, category: "modulation" },
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
};
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
    presetName: "one-op-basic",
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
    preset.left ??
    true;
  baseState.right =
    preset.pan?.right ??
    preset.right ??
    true;

  for (const operator of OPERATOR_NUMBERS) {
    baseState.operators[operator] = {
      ...baseState.operators[operator],
      ...(preset.operators?.[operator] ??
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
  } = options;

  if (!root) {
    throw new Error(
      "Operator tab root is required"
    );
  }

  const stateByChannel =
    Array.from(
      { length: CHANNEL_COUNT },
      () =>
        createChannelStateFromPreset(
          "one-op-basic",
          presets
        )
    );
  const dirtyChannels =
    new Set();
  const globalCommonState = {
    ...GLOBAL_COMMON_STATE,
  };
  let selectedChannel = 0;
  let synth = null;
  let refreshBatchDepth = 0;
  let pendingSelectedRefresh =
    false;

  const commonControls =
    new Map();
  const operatorControls =
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
  const algorithmDescription =
    root.querySelector(
      "#operatorTabAlgorithmDescription"
    );

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

    updateControlsUi();
  }

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
      updateControlsUi();
    }
  }

  function markDirty() {
    dirtyChannels.add(
      selectedChannel
    );
  }

  function applyChannelStateToSynth(
    channel
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
      synth.setLfo(
        globalCommonState.lfoEnabled,
        globalCommonState.lfoFrequency
      );
      synth.setPan(
        channel,
        state.left,
        state.right,
        state.ams,
        state.pms
      );
    } finally {
      endRefreshBatch();
    }
  }

  function updatePanUi() {
    const state =
      currentState();
    panLeft.checked =
      state.left;
    panRight.checked =
      state.right;
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
            "lfoFrequency"
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
  }

  function replaceCurrentState(
    nextState
  ) {
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
    defs: COMMON_PARAM_DEFS,
    state: {
      ...currentState(),
      ...globalCommonState,
    },
    controlsMap: commonControls,
    stackedLabels: true,
    referenceColumnCount:
      OPERATOR_PARAM_DEFS.length,
    gapPx: 4,
    onChange(id, value) {
      if (
        id === "lfoEnabled" ||
        id === "lfoFrequency"
      ) {
        globalCommonState[id] =
          value;
      } else {
        currentState()[id] = value;
      }
      updateAlgorithmDescription();
      markDirty();
      if (synth) {
        if (
          id === "lfoEnabled" ||
          id === "lfoFrequency"
        ) {
          synth.setLfo(
            globalCommonState.lfoEnabled,
            globalCommonState.lfoFrequency
          );
        } else {
          applyChannelStateToSynth(
            selectedChannel
          );
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
    onChange(operator, id, value) {
      currentState().operators[operator][
        id
      ] = value;
      markDirty();
      if (synth) {
        synth.setOperator(
          selectedChannel,
          displayOperatorToApiOperator(
            operator
          ),
          {
            [id]: value,
          }
        );
      }
    },
  });

  for (
    let channel = 0;
    channel < CHANNEL_COUNT;
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

  channelSelect.addEventListener(
    "change",
    () => {
      selectedChannel = Number(
        channelSelect.value
      );
      updateControlsUi();
    }
  );

  presetSelect.addEventListener(
    "change",
    () => {
      replaceCurrentState(
        createChannelStateFromPreset(
          presetSelect.value,
          presets
        )
      );
      onStatus?.(
        `Operator tab preset loaded for channel ${selectedChannel + 1}.`
      );
    }
  );

  panLeft.addEventListener(
    "change",
    () => {
      currentState().left =
        panLeft.checked;
      markDirty();
      if (synth) {
        synth.setPan(
          selectedChannel,
          currentState().left,
          currentState().right,
          currentState().ams,
          currentState().pms
        );
      }
    }
  );

  panRight.addEventListener(
    "change",
    () => {
      currentState().right =
        panRight.checked;
      markDirty();
      if (synth) {
        synth.setPan(
          selectedChannel,
          currentState().left,
          currentState().right,
          currentState().ams,
          currentState().pms
        );
      }
    }
  );

  channelSelect.value = "0";
  updateControlsUi();

  return {
    attachSynth(nextSynth) {
      synth = nextSynth;

      for (const channel of dirtyChannels) {
        applyChannelStateToSynth(
          channel
        );
      }
    },
    syncReset() {
      for (
        let channel = 0;
        channel < CHANNEL_COUNT;
        channel += 1
      ) {
        stateByChannel[channel] =
          createChannelStateFromPreset(
            "one-op-basic",
            presets
          );
      }
      dirtyChannels.clear();
      updateControlsUi();
    },
    syncPreset(channel, presetName, preset) {
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
        nextState.ams =
          preset.ams ??
          nextState.ams;
        nextState.pms =
          preset.pms ??
          nextState.pms;
        nextState.left =
          preset.pan?.left ??
          preset.left ??
          nextState.left;
        nextState.right =
          preset.pan?.right ??
          preset.right ??
          nextState.right;

        for (const operator of OPERATOR_NUMBERS) {
          mergeOperatorParams(
            nextState.operators[operator],
            preset.operators?.[operator]
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
      updateControlsUi();
    },
    syncPan(
      channel,
      left,
      right,
      ams = 0,
      pms = 0
    ) {
      stateByChannel[channel].left =
        left;
      stateByChannel[channel].right =
        right;
      stateByChannel[channel].ams =
        ams;
      stateByChannel[channel].pms =
        pms;
      refreshIfSelected(channel);
    },
  };
}
