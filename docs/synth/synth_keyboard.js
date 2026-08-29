import {
  createPitchFromMidi,
} from "../js/pitch.js";

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export const ROW_KEY_STRINGS = [
  "1234567890",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
];

export const FRET_POSITION_PRESETS = [
  { label: "Open", fret: 0 },
  { label: "5th", fret: 5 },
  { label: "12th", fret: 12 },
];

const INSTRUMENT_CONFIGS = {
  guitar: {
    label: "Guitar",
    stringBaseMidis: [
      64,
      59,
      55,
      50,
      45,
      40,
    ],
    stringWindows: [
      [3, 4, 5, 6],
      [2, 3, 4, 5],
      [1, 2, 3, 4],
    ],
  },
  bass: {
    label: "Bass",
    stringBaseMidis: [
      43,
      38,
      33,
      28,
    ],
    stringWindows: [
      [1, 2, 3, 4],
    ],
  },
};

function clampStringWindowIndex(
  state
) {
  const config =
    INSTRUMENT_CONFIGS[
      state.instrument
    ];
  const maxIndex = Math.max(
    0,
    config.stringWindows.length - 1
  );

  state.stringWindowIndex = Math.min(
    maxIndex,
    Math.max(0, state.stringWindowIndex)
  );
}

export function midiToNoteName(midi) {
  const note =
    NOTE_NAMES[
      ((midi % 12) + 12) % 12
    ];
  const octave =
    Math.floor(midi / 12) - 1;

  return `${note}${octave}`;
}

export function createFretboardState() {
  return {
    instrument: "guitar",
    horizontalFretPosition: 0,
    stringWindowIndex: 0,
  };
}

export function getInstrumentConfig(
  instrument
) {
  return (
    INSTRUMENT_CONFIGS[instrument] ??
    INSTRUMENT_CONFIGS.guitar
  );
}

export function setInstrument(
  state,
  instrument
) {
  if (!INSTRUMENT_CONFIGS[instrument]) {
    return;
  }

  state.instrument = instrument;
  clampStringWindowIndex(state);
}

export function setFretPosition(
  state,
  fret
) {
  state.horizontalFretPosition =
    Math.max(0, fret);
}

export function shiftFretPosition(
  state,
  delta
) {
  setFretPosition(
    state,
    state.horizontalFretPosition +
      delta
  );
}

export function setStringWindowIndex(
  state,
  index
) {
  state.stringWindowIndex = index;
  clampStringWindowIndex(state);
}

export function shiftStringWindowIndex(
  state,
  delta
) {
  setStringWindowIndex(
    state,
    state.stringWindowIndex + delta
  );
}

export function getVisibleStrings(
  state
) {
  const config =
    getInstrumentConfig(
      state.instrument
    );
  clampStringWindowIndex(state);

  return config.stringWindows[
    state.stringWindowIndex
  ];
}

export function createFretboardLayout({
  state,
  rowKeyStrings = ROW_KEY_STRINGS,
  referenceMidi,
  referenceBlock,
  referenceFnum,
}) {
  const config =
    getInstrumentConfig(
      state.instrument
    );
  const visibleStrings =
    getVisibleStrings(state);
  const rowDefs = [];
  const entries = [];

  for (
    let rowIndex = 0;
    rowIndex < rowKeyStrings.length;
    rowIndex += 1
  ) {
    const keys =
      rowKeyStrings[rowIndex] ?? "";
    const stringNumber =
      visibleStrings[rowIndex];

    if (!stringNumber) {
      continue;
    }

    const stringBaseMidi =
      config.stringBaseMidis[
        stringNumber - 1
      ];

    const rowDef = {
      keys,
      rowIndex,
      stringNumber,
      stringBaseMidi,
    };

    rowDefs.push(rowDef);

    Array.from(keys).forEach(
      (key, fretOffsetWithinPcRow) => {
        const midi =
          stringBaseMidi +
          fretOffsetWithinPcRow +
          state.horizontalFretPosition;

        entries.push({
          key,
          label: key.toUpperCase(),
          midi,
          noteName:
            midiToNoteName(midi),
          pitch: createPitchFromMidi(
            midi,
            {
              referenceMidi,
              referenceBlock,
              referenceFnum,
            }
          ),
          rowLength: keys.length,
          rowIndex,
          stringNumber,
          stringBaseMidi,
          fretOffsetWithinPcRow,
          fret:
            state.horizontalFretPosition +
            fretOffsetWithinPcRow,
        });
      }
    );
  }

  return {
    instrument:
      state.instrument,
    horizontalFretPosition:
      state.horizontalFretPosition,
    stringWindowIndex:
      state.stringWindowIndex,
    visibleStrings,
    rowDefs,
    entries,
  };
}

export function findLayoutEntry(
  layoutEntries,
  key
) {
  return layoutEntries.find(
    (entry) => entry.key === key
  );
}

export function hasLayoutKey(
  layoutEntries,
  key
) {
  return layoutEntries.some(
    (entry) => entry.key === key
  );
}

function createToolbarButton({
  label,
  selected = false,
  onClick,
}) {
  const button =
    document.createElement(
      "button"
    );
  button.type = "button";
  button.className =
    "toolbar-button";
  if (selected) {
    button.classList.add(
      "is-selected"
    );
  }
  button.textContent = label;
  button.addEventListener(
    "click",
    onClick
  );
  return button;
}

export function renderFretboardControls({
  instrumentRoot,
  positionRoot,
  fretDisplayRoot,
  stringDisplayRoot,
  stringWindowRoot,
  state,
  onInstrumentChange,
  onPositionPresetSelect,
  onStringWindowChange,
}) {
  const config =
    getInstrumentConfig(
      state.instrument
    );

  if (instrumentRoot) {
    instrumentRoot.innerHTML = "";

    for (const [
      instrumentId,
      instrumentConfig,
    ] of Object.entries(
      INSTRUMENT_CONFIGS
    )) {
      instrumentRoot.appendChild(
        createToolbarButton({
          label:
            instrumentConfig.label,
          selected:
            state.instrument ===
            instrumentId,
          onClick: () => {
            onInstrumentChange?.(
              instrumentId
            );
          },
        })
      );
    }
  }

  if (positionRoot) {
    positionRoot.innerHTML = "";

    for (const preset of FRET_POSITION_PRESETS) {
      positionRoot.appendChild(
        createToolbarButton({
          label: preset.label,
          selected:
            state.horizontalFretPosition ===
            preset.fret,
          onClick: () => {
            onPositionPresetSelect?.(
              preset.fret
            );
          },
        })
      );
    }
  }

  if (fretDisplayRoot) {
    fretDisplayRoot.textContent =
      `Fret: ${state.horizontalFretPosition}`;
  }

  if (stringWindowRoot) {
    stringWindowRoot.innerHTML = "";

    config.stringWindows.forEach(
      (windowStrings, index) => {
        const label = `${windowStrings[windowStrings.length - 1]}-${windowStrings[0]}`;

        if (
          stringDisplayRoot &&
          state.stringWindowIndex === index
        ) {
          stringDisplayRoot.textContent =
            `String ${label}`;
        }

        stringWindowRoot.appendChild(
          createToolbarButton({
            label,
            selected:
              state.stringWindowIndex ===
              index,
            onClick: () => {
              onStringWindowChange?.(
                index
              );
            },
          })
        );
      }
    );
  }
}

export function buildKeyboard({
  root,
  rowDefs,
  layoutEntries,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
}) {
  root.innerHTML = "";

  for (const row of rowDefs) {
    const rowElement =
      document.createElement("div");

    rowElement.className =
      "key-row";
    rowElement.dataset.count =
      String(row.keys.length);
    rowElement.dataset.row =
      String(row.rowIndex);
    rowElement.dataset.string =
      String(row.stringNumber);

    for (const keyChar of row.keys) {
      const entry =
        findLayoutEntry(
          layoutEntries,
          keyChar
        );

      if (!entry) {
        continue;
      }

      const button =
        document.createElement(
          "button"
        );

      button.type = "button";
      button.className = "key";
      button.dataset.key =
        entry.key;
      button.dataset.string =
        String(entry.stringNumber);
      button.dataset.fret =
        String(entry.fret);
      button.innerHTML = `
        <strong>${entry.label}</strong>
        <span>${entry.noteName}</span>
        <small>b${entry.pitch.block} / f${entry.pitch.fnum}</small>
      `;

      button.addEventListener(
        "pointerdown",
        async (event) => {
          event.preventDefault();
          await onPointerDown?.(
            event,
            entry,
            button
          );
        }
      );

      button.addEventListener(
        "pointerup",
        (event) => {
          onPointerUp?.(
            event,
            entry,
            button
          );
        }
      );

      button.addEventListener(
        "pointercancel",
        (event) => {
          onPointerCancel?.(
            event,
            entry,
            button
          );
        }
      );

      rowElement.appendChild(
        button
      );
    }

    root.appendChild(
      rowElement
    );
  }
}
