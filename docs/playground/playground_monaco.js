import {
  MEGADRIVE_FM_PRESET_ORDER,
  MEGADRIVE_FM_PRESETS,
} from "../js/megasynth.js";

const SCALE_NAMES = [
  "major",
  "minor",
  "majorPentatonic",
  "minorPentatonic",
  "chromatic",
];

const NOTE_NAMES = (() => {
  const pitchClasses = [
    "C",
    "C#",
    "D",
    "Eb",
    "E",
    "F",
    "F#",
    "G",
    "Ab",
    "A",
    "Bb",
    "B",
  ];
  const notes = [];
  for (let octave = 0; octave <= 7; octave += 1) {
    for (const pitchClass of pitchClasses) {
      notes.push(`${pitchClass}${octave}`);
    }
  }
  return notes;
})();

const YM2612_REGISTER_CANDIDATES = [
  { value: "0x22", description: "LFO enable / frequency" },
  { value: "0x24", description: "Timer A high" },
  { value: "0x25", description: "Timer A low" },
  { value: "0x26", description: "Timer B" },
  { value: "0x27", description: "Timer control / mode" },
  { value: "0x28", description: "Key on / key off" },
  { value: "0x2a", description: "DAC data" },
  { value: "0x2b", description: "DAC enable" },
  { value: "0x30", description: "DT / MULTI base" },
  { value: "0x40", description: "TL base" },
  { value: "0x50", description: "RS / AR base" },
  { value: "0x60", description: "AM / D1R base" },
  { value: "0x70", description: "SR / D2R base" },
  { value: "0x80", description: "SL / RR base" },
  { value: "0x90", description: "SSG-EG base" },
  { value: "0xa0", description: "F-Number low base" },
  { value: "0xa4", description: "Block / F-Number high base" },
  { value: "0xb0", description: "Algorithm / feedback base" },
  { value: "0xb4", description: "Pan / AMS / PMS base" },
];

function createMonacoTopLevelItems(
  monaco
) {
  const kind =
    monaco.languages
      .CompletionItemKind;
  const snippet =
    monaco.languages
      .CompletionItemInsertTextRule
      .InsertAsSnippet;

  return [
    {
      label: "liveLoop",
      kind: kind.Snippet,
      insertText:
        'liveLoop("${1:name}", async () => {\n  await play("${2:E4}", { channel: ${3:0}, duration: ${4:0.08} });\n  await beat(${5:0.5});\n});',
      insertTextRules: snippet,
      documentation:
        "Create a repeating named live loop.",
    },
    {
      label: "livePrepare",
      kind: kind.Snippet,
      insertText:
        'const ${1:mainFx} = await livePrepare("${2:main-fx}", async ({ fx, fm, log }) => {\n  ${3:const filter = fx.filter({ type: "lowpass", cutoff: 1200, q: 1.1 });}\n  return { ${4:filter} };\n});',
      insertTextRules: snippet,
      documentation:
        "Prepare and reuse live state across runs.",
    },
    {
      label: "play",
      kind: kind.Function,
      insertText:
        'await play("${1:E4}", { channel: ${2:0}, duration: ${3:0.08} });',
      insertTextRules: snippet,
      documentation:
        "Play one note through the YM2612 synth layer.",
    },
    {
      label: "beat",
      kind: kind.Function,
      insertText:
        "await beat(${1:0.5});",
      insertTextRules: snippet,
      documentation:
        "Wait using the shared beat clock.",
    },
    {
      label: "sleep",
      kind: kind.Function,
      insertText:
        "await sleep(${1:0.12});",
      insertTextRules: snippet,
      documentation:
        "Wait using seconds instead of beat units.",
    },
    {
      label: "nextBeat",
      kind: kind.Function,
      insertText:
        "await nextBeat();",
      insertTextRules: snippet,
      documentation:
        "Wait for the next integer beat boundary.",
    },
    {
      label: "setBpm",
      kind: kind.Function,
      insertText:
        "setBpm(${1:120});",
      insertTextRules: snippet,
      documentation:
        "Set the shared BPM used by beat().",
    },
    {
      label: "scale",
      kind: kind.Function,
      insertText:
        'scale("${1:E4}", "${2:minorPentatonic}", ${3:2})',
      insertTextRules: snippet,
      documentation:
        "Build a note array from a named scale.",
    },
    {
      label: "choose",
      kind: kind.Function,
      insertText:
        "choose(${1:values})",
      insertTextRules: snippet,
      documentation:
        "Pick one random item from an array.",
    },
    {
      label: "pg",
      kind: kind.Variable,
      insertText: "pg",
      documentation:
        "Tetorica playground helper namespace.",
    },
    {
      label: "fm",
      kind: kind.Variable,
      insertText: "fm",
      documentation:
        "Raw YM2612Synth control layer.",
    },
    {
      label: "fx",
      kind: kind.Variable,
      insertText: "fx",
      documentation:
        "Master FX creation and chain control.",
    },
    {
      label: "fm.write",
      kind: kind.Function,
      insertText:
        "fm.write(${1:0}, ${2:0x22}, ${3:0x08});",
      insertTextRules: snippet,
      documentation:
        "Write one YM2612 register in compact form: port, register, value.",
    },
    {
      label: "fm.writeAddress",
      kind: kind.Function,
      insertText:
        "fm.writeAddress(${1:0}, ${2:0x22});",
      insertTextRules: snippet,
      documentation:
        "Write one YM2612 register number to the address port.",
    },
    {
      label: "fm.writeData",
      kind: kind.Function,
      insertText:
        "fm.writeData(${1:0x08});",
      insertTextRules: snippet,
      documentation:
        "Write one YM2612 value to the data port after writeAddress().",
    },
    {
      label: "fm.read",
      kind: kind.Function,
      insertText:
        "fm.read(${1:0});",
      insertTextRules: snippet,
      documentation:
        "Read one raw YM2612 bus offset. On AudioWorklet transport, synchronous read may be unavailable.",
    },
    {
      label: "fm.readStatus",
      kind: kind.Function,
      insertText:
        "fm.readStatus();",
      insertTextRules: snippet,
      documentation:
        "Read the YM2612 status register.",
    },
    {
      label: "fm.getIrq",
      kind: kind.Function,
      insertText:
        "fm.getIrq();",
      insertTextRules: snippet,
      documentation:
        "Read the current YM2612 IRQ pin state when available.",
    },
    {
      label:
        "MEGADRIVE_FM_PRESETS",
      kind: kind.Variable,
      insertText:
        "MEGADRIVE_FM_PRESETS",
      documentation:
        "Built-in YM2612 preset table.",
    },
  ];
}

function extractFxUnitVariables(
  source
) {
  const variables =
    new Map();
  const pattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*fx\.(gain|eq|filter|delay|reverb)\s*\(/g;
  let match =
    pattern.exec(source);

  while (match) {
    variables.set(
      match[1],
      match[2]
    );
    match = pattern.exec(source);
  }

  return variables;
}

function extractLivePrepareObjects(
  source,
  effectUnitVariables
) {
  const objects =
    new Map();
  const pattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+livePrepare\s*\([\s\S]*?return\s*\{([\s\S]*?)\}\s*;?[\s\S]*?\)\s*;?/g;
  let match =
    pattern.exec(source);

  while (match) {
    const objectName =
      match[1];
    const body =
      match[2];
    const properties = {};
    const parts =
      body
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

    for (const part of parts) {
      const aliasMatch =
        /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/.exec(
          part
        );
      const shorthandMatch =
        /^([A-Za-z_$][\w$]*)$/.exec(
          part
        );

      if (aliasMatch) {
        const propertyName =
          aliasMatch[1];
        const variableName =
          aliasMatch[2];
        properties[propertyName] =
          effectUnitVariables.get(
            variableName
          ) ?? "unknown";
        continue;
      }

      if (shorthandMatch) {
        const variableName =
          shorthandMatch[1];
        properties[variableName] =
          effectUnitVariables.get(
            variableName
          ) ?? "unknown";
      }
    }

    objects.set(objectName, {
      properties,
    });
    match = pattern.exec(source);
  }

  return objects;
}

function createFxUnitSuggestions(
  effectType,
  kind,
  snippet,
  range
) {
  const suggestions = [
    {
      label: "input",
      kind: kind.Property,
      insertText: "input",
      documentation:
        "AudioNode input of this effect unit.",
      range,
    },
    {
      label: "output",
      kind: kind.Property,
      insertText: "output",
      documentation:
        "AudioNode output of this effect unit.",
      range,
    },
    {
      label: "dispose",
      kind: kind.Method,
      insertText: "dispose()",
      documentation:
        "Disconnect and dispose this effect unit.",
      range,
    },
  ];

  const parameterNames = {
    gain: ["gain"],
    eq: ["bass", "mid", "treble"],
    filter: ["cutoff", "q"],
    delay: ["time", "feedback", "mix"],
    reverb: ["mix", "tone"],
  }[effectType] ?? [];

  for (const name of parameterNames) {
    suggestions.push({
      label: name,
      kind: kind.Property,
      insertText: name,
      documentation:
        `Parameter control for ${name}. Use .set(...) or .rampTo(...).`,
      range,
    });
  }

  return suggestions;
}

function createLivePrepareObjectSuggestions(
  livePrepareObject,
  kind,
  range
) {
  const suggestions = [];

  for (const [propertyName, effectType] of Object.entries(
    livePrepareObject.properties
  )) {
    suggestions.push({
      label: propertyName,
      kind: kind.Property,
      insertText: propertyName,
      documentation:
        effectType === "unknown"
          ? "Value returned from livePrepare()."
          : `${effectType} effect unit returned from livePrepare().`,
      range,
    });
  }

  return suggestions;
}

function createFmOperatorParamSuggestions(
  kind,
  snippet,
  range
) {
  return [
    {
      label: "dt",
      kind: kind.Property,
      insertText: "dt: ${1:0},",
      insertTextRules: snippet,
      documentation:
        "Detune. Small pitch offset for this operator.",
      range,
    },
    {
      label: "multi",
      kind: kind.Property,
      insertText: "multi: ${1:1},",
      insertTextRules: snippet,
      documentation:
        "Frequency multiplier for this operator.",
      range,
    },
    {
      label: "tl",
      kind: kind.Property,
      insertText: "tl: ${1:8},",
      insertTextRules: snippet,
      documentation:
        "Total level. Lower is louder.",
      range,
    },
    {
      label: "rs",
      kind: kind.Property,
      insertText: "rs: ${1:0},",
      insertTextRules: snippet,
      documentation:
        "Rate scaling.",
      range,
    },
    {
      label: "ar",
      kind: kind.Property,
      insertText: "ar: ${1:22},",
      insertTextRules: snippet,
      documentation:
        "Attack rate.",
      range,
    },
    {
      label: "am",
      kind: kind.Property,
      insertText: "am: ${1:false},",
      insertTextRules: snippet,
      documentation:
        "Amplitude modulation enable.",
      range,
    },
    {
      label: "d1r",
      kind: kind.Property,
      insertText: "d1r: ${1:6},",
      insertTextRules: snippet,
      documentation:
        "First decay rate.",
      range,
    },
    {
      label: "sr",
      kind: kind.Property,
      insertText: "sr: ${1:3},",
      insertTextRules: snippet,
      documentation:
        "Sustain rate. Same YM2612 register family often called D2R in this project UI.",
      range,
    },
    {
      label: "d2r",
      kind: kind.Property,
      insertText: "d2r: ${1:3},",
      insertTextRules: snippet,
      documentation:
        "Sustain rate / D2R.",
      range,
    },
    {
      label: "sl",
      kind: kind.Property,
      insertText: "sl: ${1:3},",
      insertTextRules: snippet,
      documentation:
        "Sustain level.",
      range,
    },
    {
      label: "rr",
      kind: kind.Property,
      insertText: "rr: ${1:8},",
      insertTextRules: snippet,
      documentation:
        "Release rate.",
      range,
    },
    {
      label: "ssg",
      kind: kind.Property,
      insertText: "ssg: ${1:0},",
      insertTextRules: snippet,
      documentation:
        "SSG-EG setting.",
      range,
    },
  ];
}

function createPlayOptionsSuggestions(
  kind,
  snippet,
  range
) {
  return [
    {
      label: "channel",
      kind: kind.Property,
      insertText: "channel: ${1:0},",
      insertTextRules: snippet,
      documentation:
        "YM2612 channel number 0..5.",
      range,
    },
    {
      label: "duration",
      kind: kind.Property,
      insertText: "duration: ${1:0.08},",
      insertTextRules: snippet,
      documentation:
        "Note duration in seconds.",
      range,
    },
    {
      label: "preset",
      kind: kind.Property,
      insertText:
        'preset: MEGADRIVE_FM_PRESETS["${1:one-op-basic}"],',
      insertTextRules: snippet,
      documentation:
        "Optional preset object applied before playing the note.",
      range,
    },
  ];
}

function createFxConfigSuggestions(
  effectType,
  kind,
  snippet,
  range
) {
  const definitions = {
    gain: [
      {
        label: "gain",
        insertText: "gain: ${1:1.0},",
        documentation: "Gain amount.",
      },
    ],
    eq: [
      {
        label: "bass",
        insertText: "bass: ${1:0},",
        documentation: "EQ bass gain in dB.",
      },
      {
        label: "mid",
        insertText: "mid: ${1:0},",
        documentation: "EQ mid gain in dB.",
      },
      {
        label: "treble",
        insertText: "treble: ${1:0},",
        documentation: "EQ treble gain in dB.",
      },
    ],
    filter: [
      {
        label: "type",
        insertText: 'type: "${1:lowpass}",',
        documentation: "Filter type such as lowpass or highpass.",
      },
      {
        label: "cutoff",
        insertText: "cutoff: ${1:1200},",
        documentation: "Filter cutoff frequency in Hz.",
      },
      {
        label: "q",
        insertText: "q: ${1:1.1},",
        documentation: "Filter resonance / Q.",
      },
    ],
    delay: [
      {
        label: "time",
        insertText: "time: ${1:0.24},",
        documentation: "Delay time in seconds.",
      },
      {
        label: "feedback",
        insertText: "feedback: ${1:0.28},",
        documentation: "Delay feedback amount.",
      },
      {
        label: "mix",
        insertText: "mix: ${1:0.16},",
        documentation: "Dry/wet mix.",
      },
    ],
    reverb: [
      {
        label: "mix",
        insertText: "mix: ${1:0.18},",
        documentation: "Dry/wet mix.",
      },
      {
        label: "tone",
        insertText: "tone: ${1:5400},",
        documentation: "Reverb tone / damping frequency.",
      },
    ],
  };

  return (definitions[effectType] ?? []).map((item) => ({
    label: item.label,
    kind: kind.Property,
    insertText: item.insertText,
    insertTextRules: snippet,
    documentation: item.documentation,
    range,
  }));
}

function detectFxConfigContext(
  sourceBeforeCursor
) {
  const candidates = [
    { prefix: "fx.gain(", effectType: "gain" },
    { prefix: "fx.eq(", effectType: "eq" },
    { prefix: "fx.filter(", effectType: "filter" },
    { prefix: "fx.delay(", effectType: "delay" },
    { prefix: "fx.reverb(", effectType: "reverb" },
  ];

  let bestMatch = null;
  for (const candidate of candidates) {
    const index =
      sourceBeforeCursor.lastIndexOf(
        candidate.prefix
      );
    if (
      index >= 0 &&
      (bestMatch === null ||
        index > bestMatch.index)
    ) {
      bestMatch = {
        ...candidate,
        index,
      };
    }
  }

  if (!bestMatch) {
    return null;
  }

  return isInsideCallObject(
    sourceBeforeCursor,
    [bestMatch.prefix]
  )
    ? bestMatch.effectType
    : null;
}

function createPresetSuggestions(
  kind,
  range
) {
  return MEGADRIVE_FM_PRESET_ORDER.map(
    (name) => ({
      label: name,
      kind: kind.Value,
      insertText: name,
      documentation:
        `Built-in YM2612 preset: ${name}`,
      range,
    })
  );
}

function createScaleSuggestions(
  kind,
  range
) {
  return SCALE_NAMES.map((name) => ({
    label: name,
    kind: kind.Value,
    insertText: name,
    documentation:
      `Scale name: ${name}`,
    range,
  }));
}

function createNoteSuggestions(
  kind,
  range
) {
  return NOTE_NAMES.map((name) => ({
    label: name,
    kind: kind.Value,
    insertText: name,
    documentation:
      `Note name: ${name}`,
    insertText: `"${name}"`,
    range,
  }));
}

function createPlayCallSuggestions(
  kind,
  snippet,
  range
) {
  return [
    {
      label: '"E4"',
      kind: kind.Value,
      insertText: '"${1:E4}"',
      insertTextRules: snippet,
      documentation:
        "First note argument for play().",
      range,
    },
    {
      label: '"C4", { ... }',
      kind: kind.Snippet,
      insertText:
        '"${1:C4}", { channel: ${2:0}, duration: ${3:0.08} }',
      insertTextRules: snippet,
      documentation:
        "Play note plus options object.",
      range,
    },
  ];
}

function createScaleCallSuggestions(
  kind,
  snippet,
  range
) {
  return [
    {
      label: '"E4"',
      kind: kind.Value,
      insertText: '"${1:E4}"',
      insertTextRules: snippet,
      documentation:
        "Root note argument for scale().",
      range,
    },
    {
      label: '"E4", "minorPentatonic", 2',
      kind: kind.Snippet,
      insertText:
        '"${1:E4}", "${2:minorPentatonic}", ${3:2}',
      insertTextRules: snippet,
      documentation:
        "Root note, scale name, and octave span.",
      range,
    },
  ];
}

function createRegisterSuggestions(
  kind,
  range
) {
  return YM2612_REGISTER_CANDIDATES.map(
    ({ value, description }) => ({
      label: `${value} ${description}`,
      kind: kind.Value,
      insertText: value,
      documentation: description,
      range,
    })
  );
}

function createRegisterValueSuggestions(
  registerValue,
  kind,
  range
) {
  const definitions = {
    "0x22": [
      { value: "0x00", description: "LFO off" },
      { value: "0x08", description: "LFO on, frequency 0" },
      { value: "0x0f", description: "LFO on, frequency 7" },
    ],
    "0x28": [
      { value: "0x00", description: "Key off channel 1" },
      { value: "0x01", description: "Key off channel 2" },
      { value: "0x02", description: "Key off channel 3" },
      { value: "0x04", description: "Key off channel 4" },
      { value: "0x05", description: "Key off channel 5" },
      { value: "0x06", description: "Key off channel 6" },
      { value: "0xf0", description: "Key on all operators, channel 1" },
      { value: "0xf1", description: "Key on all operators, channel 2" },
      { value: "0xf2", description: "Key on all operators, channel 3" },
      { value: "0xf4", description: "Key on all operators, channel 4" },
      { value: "0xf5", description: "Key on all operators, channel 5" },
      { value: "0xf6", description: "Key on all operators, channel 6" },
    ],
    "0x2b": [
      { value: "0x00", description: "DAC off" },
      { value: "0x80", description: "DAC on" },
    ],
    "0xb0": [
      { value: "0x07", description: "Algorithm 7, feedback 0" },
      { value: "0x04", description: "Algorithm 4, feedback 0" },
      { value: "0x23", description: "Algorithm 3, feedback 4" },
      { value: "0x38", description: "Algorithm 0, feedback 7" },
    ],
    "0xb4": [
      { value: "0x80", description: "Left only, AMS 0, PMS 0" },
      { value: "0x40", description: "Right only, AMS 0, PMS 0" },
      { value: "0xc0", description: "Left + right, AMS 0, PMS 0" },
      { value: "0xc4", description: "Left + right, AMS 0, PMS 4" },
      { value: "0xf7", description: "Left + right, AMS 3, PMS 7" },
    ],
  };

  return (definitions[registerValue] ?? []).map(
    ({ value, description }) => ({
      label: `${value} ${description}`,
      kind: kind.Value,
      insertText: value,
      documentation: description,
      range,
    })
  );
}

function isInsidePresetString(
  linePrefix
) {
  return (
    /MEGADRIVE_FM_PRESETS\[\s*["'][^"']*$/.test(
      linePrefix
    ) ||
    /pg\.presets\[\s*["'][^"']*$/.test(
      linePrefix
    )
  );
}

function isInsideScaleNameString(
  linePrefix
) {
  return /(scale|pg\.scale)\(\s*["'][^"']*["']\s*,\s*["'][^"']*$/.test(
    linePrefix
  );
}

function isInsideNoteString(
  linePrefix
) {
  return /(^|[^.\w])(play|scale)\(\s*["'][^"']*$/.test(
    linePrefix
  ) || /pg\.(play|scale)\(\s*["'][^"']*$/.test(
    linePrefix
  );
}

function isAtPlayFirstArgument(
  linePrefix
) {
  return /(^|[^.\w])play\(\s*$/.test(
    linePrefix
  ) || /pg\.play\(\s*$/.test(
    linePrefix
  );
}

function isAtScaleFirstArgument(
  linePrefix
) {
  return /(^|[^.\w])scale\(\s*$/.test(
    linePrefix
  ) || /pg\.scale\(\s*$/.test(
    linePrefix
  );
}

function isInsideYm2612RegisterArgument(
  linePrefix
) {
  return /fm\.(write|writeAddress)\(\s*[^,]+,\s*[^,)]*$/.test(
    linePrefix
  );
}

function detectYm2612ValueRegister(
  linePrefix
) {
  const writeMatch =
    /fm\.write\(\s*[^,]+,\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*[^,)]*$/.exec(
      linePrefix
    );
  if (writeMatch) {
    return normalizeRegisterLiteral(
      writeMatch[1]
    );
  }

  return null;
}

function normalizeRegisterLiteral(
  value
) {
  if (!value) {
    return null;
  }

  const parsed =
    value.startsWith("0x") ||
    value.startsWith("0X")
      ? Number.parseInt(value, 16)
      : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return `0x${parsed.toString(16)}`;
}

function isInsideCallObject(
  sourceBeforeCursor,
  callPrefixes
) {
  let callIndex = -1;
  for (const prefix of callPrefixes) {
    const candidate =
      sourceBeforeCursor.lastIndexOf(
        prefix
      );
    if (candidate > callIndex) {
      callIndex = candidate;
    }
  }

  if (callIndex < 0) {
    return false;
  }

  const tail =
    sourceBeforeCursor.slice(callIndex);
  const openBraceIndex =
    tail.indexOf("{");

  if (openBraceIndex < 0) {
    return false;
  }

  let depth = 0;
  for (
    let index = openBraceIndex;
    index < tail.length;
    index += 1
  ) {
    const char = tail[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return false;
      }
    }
  }

  return depth > 0;
}

function registerMonacoCompletions(
  monaco
) {
  const kind =
    monaco.languages
      .CompletionItemKind;
  const snippet =
    monaco.languages
      .CompletionItemInsertTextRule
      .InsertAsSnippet;
  const topLevelItems =
    createMonacoTopLevelItems(
      monaco
    );

  monaco.languages.registerCompletionItemProvider(
    "javascript",
    {
      triggerCharacters: [
        ".",
        '"',
        "'",
      ],
      provideCompletionItems(
        model,
        position
      ) {
        const effectUnitVariables =
          extractFxUnitVariables(
            model.getValue()
          );
        const livePrepareObjects =
          extractLivePrepareObjects(
            model.getValue(),
            effectUnitVariables
          );
        const word =
          model.getWordUntilPosition(
            position
          );
        const range = {
          startLineNumber:
            position.lineNumber,
          endLineNumber:
            position.lineNumber,
          startColumn:
            word.startColumn,
          endColumn:
            word.endColumn,
        };
        const linePrefix =
          model.getLineContent(
            position.lineNumber
          ).slice(
            0,
            position.column - 1
          );
        const sourceBeforeCursor =
          model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber:
              position.lineNumber,
            endColumn:
              position.column,
          });
        const suggestions = [];

        if (
          isInsidePresetString(
            linePrefix
          )
        ) {
          suggestions.push(
            ...createPresetSuggestions(
              kind,
              range
            )
          );
        }

        if (
          isAtPlayFirstArgument(
            linePrefix
          )
        ) {
          suggestions.push(
            ...createPlayCallSuggestions(
              kind,
              snippet,
              range
            )
          );
        }

        if (
          isAtScaleFirstArgument(
            linePrefix
          )
        ) {
          suggestions.push(
            ...createScaleCallSuggestions(
              kind,
              snippet,
              range
            )
          );
        }

        if (
          isInsideScaleNameString(
            linePrefix
          )
        ) {
          suggestions.push(
            ...createScaleSuggestions(
              kind,
              range
            )
          );
        }

        if (
          isInsideNoteString(
            linePrefix
          )
        ) {
          suggestions.push(
            ...createNoteSuggestions(
              kind,
              range
            )
          );
        }

        if (
          isInsideYm2612RegisterArgument(
            linePrefix
          )
        ) {
          suggestions.push(
            ...createRegisterSuggestions(
              kind,
              range
            )
          );
        }

        const registerValueContext =
          detectYm2612ValueRegister(
            linePrefix
          );
        if (registerValueContext) {
          suggestions.push(
            ...createRegisterValueSuggestions(
              registerValueContext,
              kind,
              range
            )
          );
        }

        if (
          isInsideCallObject(
            sourceBeforeCursor,
            ["fm.setOperator("]
          )
        ) {
          suggestions.push(
            ...createFmOperatorParamSuggestions(
              kind,
              snippet,
              range
            )
          );
        }

        if (
          isInsideCallObject(
            sourceBeforeCursor
            ,
            ["play(", "pg.play("]
          )
        ) {
          suggestions.push(
            ...createPlayOptionsSuggestions(
              kind,
              snippet,
              range
            )
          );
        }

        const fxConfigType =
          detectFxConfigContext(
            sourceBeforeCursor
          );
        if (fxConfigType) {
          suggestions.push(
            ...createFxConfigSuggestions(
              fxConfigType,
              kind,
              snippet,
              range
            )
          );
        }

        if (/\bfx\.$/.test(linePrefix)) {
          suggestions.push(
            {
              label: "gain",
              kind: kind.Function,
              insertText:
                'gain({ gain: ${1:1.0} })',
              insertTextRules:
                snippet,
              documentation:
                "Create a gain effect unit.",
              range,
            },
            {
              label: "eq",
              kind: kind.Function,
              insertText:
                'eq({\n  bass: ${1:0},\n  mid: ${2:0},\n  treble: ${3:0},\n})',
              insertTextRules:
                snippet,
              documentation:
                "Create a 3-band EQ unit.",
              range,
            },
            {
              label: "filter",
              kind: kind.Function,
              insertText:
                'filter({\n  type: "${1:lowpass}",\n  cutoff: ${2:1200},\n  q: ${3:1.1},\n})',
              insertTextRules:
                snippet,
              documentation:
                "Create a filter effect unit.",
              range,
            },
            {
              label: "delay",
              kind: kind.Function,
              insertText:
                'delay({\n  time: ${1:0.24},\n  feedback: ${2:0.28},\n  mix: ${3:0.16},\n})',
              insertTextRules:
                snippet,
              documentation:
                "Create a delay effect unit.",
              range,
            },
            {
              label: "reverb",
              kind: kind.Function,
              insertText:
                'reverb({\n  mix: ${1:0.18},\n  tone: ${2:5400},\n})',
              insertTextRules:
                snippet,
              documentation:
                "Create a reverb effect unit.",
              range,
            },
            {
              label: "setChain",
              kind: kind.Method,
              insertText:
                "setChain([${1:effect}])",
              insertTextRules:
                snippet,
              documentation:
                "Replace the current master FX chain.",
              range,
            },
            {
              label: "clear",
              kind: kind.Method,
              insertText:
                "clear()",
              documentation:
                "Clear the current master FX chain.",
              range,
            }
          );
        }

        if (/\bfm\.$/.test(linePrefix)) {
          suggestions.push(
            {
              label: "setPreset",
              kind: kind.Method,
              insertText:
                'setPreset(${1:0}, MEGADRIVE_FM_PRESETS["${2:one-op-basic}"])',
              insertTextRules:
                snippet,
              documentation:
                "Apply one preset to one YM2612 channel.",
              range,
            },
            {
              label: "setOperator",
              kind: kind.Method,
              insertText:
                'setOperator(${1:0}, ${2:4}, {\n  dt: ${3:0},\n  multi: ${4:1},\n  tl: ${5:8},\n  ar: ${6:22},\n  d1r: ${7:6},\n  d2r: ${8:3},\n  sl: ${9:3},\n  rr: ${10:8},\n})',
              insertTextRules:
                snippet,
              documentation:
                "Partially update one YM2612 operator.",
              range,
            },
            {
              label: "setAlgo",
              kind: kind.Method,
              insertText:
                "setAlgo(${1:0}, ${2:7}, ${3:0})",
              insertTextRules:
                snippet,
              documentation:
                "Set YM2612 algorithm and feedback for a channel.",
              range,
            },
            {
              label: "setPan",
              kind: kind.Method,
              insertText:
                "setPan(${1:0}, ${2:true}, ${3:true}, ${4:0}, ${5:0})",
              insertTextRules:
                snippet,
              documentation:
                "Set stereo output enable flags plus AMS/PMS for a channel.",
              range,
            },
            {
              label: "setLfo",
              kind: kind.Method,
              insertText:
                "setLfo(${1:false}, ${2:0})",
              insertTextRules:
                snippet,
              documentation:
                "Set YM2612 chip LFO enable and frequency.",
              range,
            },
            {
              label: "noteOn",
              kind: kind.Method,
              insertText:
                "noteOn(${1:0}, ${2:4}, ${3:553})",
              insertTextRules:
                snippet,
              documentation:
                "Trigger YM2612 note on with block and F-Number.",
              range,
            },
            {
              label: "write",
              kind: kind.Method,
              insertText:
                "write(${1:0}, ${2:0x22}, ${3:0x08})",
              insertTextRules:
                snippet,
              documentation:
                "Compact YM2612 register write: port, register, value.",
              range,
            },
            {
              label: "writeAddress",
              kind: kind.Method,
              insertText:
                "writeAddress(${1:0}, ${2:0x22})",
              insertTextRules:
                snippet,
              documentation:
                "Write one YM2612 register number to the address port.",
              range,
            },
            {
              label: "writeData",
              kind: kind.Method,
              insertText:
                "writeData(${1:0x08})",
              insertTextRules:
                snippet,
              documentation:
                "Write one YM2612 value to the data port after writeAddress().",
              range,
            },
            {
              label: "noteOff",
              kind: kind.Method,
              insertText:
                "noteOff(${1:0})",
              insertTextRules:
                snippet,
              documentation:
                "Trigger YM2612 note off on one channel.",
              range,
            }
          );
        }

        if (/\bpg\.$/.test(linePrefix)) {
          suggestions.push(
            {
              label: "play",
              kind: kind.Method,
              insertText:
                'play("${1:E4}", { channel: ${2:0}, duration: ${3:0.08} })',
              insertTextRules:
                snippet,
              documentation:
                "Play one note through the YM2612 synth layer.",
              range,
            },
            {
              label: "sleep",
              kind: kind.Method,
              insertText:
                "sleep(${1:0.12})",
              insertTextRules:
                snippet,
              documentation:
                "Wait using seconds.",
              range,
            },
            {
              label: "beat",
              kind: kind.Method,
              insertText:
                "beat(${1:0.5})",
              insertTextRules:
                snippet,
              documentation:
                "Wait using the shared beat clock.",
              range,
            },
            {
              label: "nextBeat",
              kind: kind.Method,
              insertText:
                "nextBeat()",
              insertTextRules:
                snippet,
              documentation:
                "Wait for the next integer beat boundary.",
              range,
            },
            {
              label: "setBpm",
              kind: kind.Method,
              insertText:
                "setBpm(${1:120})",
              insertTextRules:
                snippet,
              documentation:
                "Set the shared BPM.",
              range,
            },
            {
              label: "liveLoop",
              kind: kind.Method,
              insertText:
                'liveLoop("${1:name}", async () => {\n  await pg.play("${2:E4}", { channel: ${3:0}, duration: ${4:0.08} });\n  await pg.beat(${5:0.5});\n})',
              insertTextRules:
                snippet,
              documentation:
                "Create a repeating named live loop.",
              range,
            },
            {
              label: "livePrepare",
              kind: kind.Method,
              insertText:
                'livePrepare("${1:main-fx}", async ({ fx, fm, log }) => {\n  ${2:const filter = fx.filter({ type: "lowpass", cutoff: 1200, q: 1.1 });}\n  return { ${3:filter} };\n})',
              insertTextRules:
                snippet,
              documentation:
                "Prepare and reuse live state across runs.",
              range,
            },
            {
              label: "scale",
              kind: kind.Method,
              insertText:
                'scale("${1:E4}", "${2:minorPentatonic}", ${3:2})',
              insertTextRules:
                snippet,
              documentation:
                "Build a note array from a named scale.",
              range,
            },
            {
              label: "choose",
              kind: kind.Method,
              insertText:
                "choose(${1:values})",
              insertTextRules:
                snippet,
              documentation:
                "Pick one random item from an array.",
              range,
            },
            {
              label: "rand",
              kind: kind.Method,
              insertText:
                "rand()",
              documentation:
                "Return a random float from 0 to 1.",
              range,
            },
            {
              label: "randInt",
              kind: kind.Method,
              insertText:
                "randInt(${1:0}, ${2:7})",
              insertTextRules:
                snippet,
              documentation:
                "Return a random integer in a range.",
              range,
            },
            {
              label: "stopLoop",
              kind: kind.Method,
              insertText:
                'stopLoop("${1:name}")',
              insertTextRules:
                snippet,
              documentation:
                "Stop one live loop by name.",
              range,
            },
            {
              label: "stopAllLoops",
              kind: kind.Method,
              insertText:
                "stopAllLoops()",
              documentation:
                "Stop all live loops.",
              range,
            },
            {
              label: "stopAll",
              kind: kind.Method,
              insertText:
                "stopAll()",
              documentation:
                "Stop all sounding notes.",
              range,
            },
            {
              label: "log",
              kind: kind.Method,
              insertText:
                'log("${1:hello}")',
              insertTextRules:
                snippet,
              documentation:
                "Write one line to the playground console.",
              range,
            },
            {
              label: "fm",
              kind: kind.Property,
              insertText:
                "fm",
              documentation:
                "Raw YM2612Synth layer.",
              range,
            },
            {
              label: "fx",
              kind: kind.Property,
              insertText:
                "fx",
              documentation:
                "Master FX helper API.",
              range,
            },
            {
              label: "presets",
              kind: kind.Property,
              insertText:
                "presets",
              documentation:
                "Built-in YM2612 preset table.",
              range,
            }
          );
        }

        const effectUnitMatch =
          /(?:^|[^\w$])([A-Za-z_$][\w$]*)\.$/.exec(
            linePrefix
          );
        const livePreparePropertyMatch =
          /(?:^|[^\w$])([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.$/.exec(
            linePrefix
          );

        if (effectUnitMatch && !livePreparePropertyMatch) {
          const variableName =
            effectUnitMatch[1];
          const livePrepareObject =
            livePrepareObjects.get(
              variableName
            );

          if (livePrepareObject) {
            for (const item of createLivePrepareObjectSuggestions(
              livePrepareObject,
              kind,
              range
            )) {
              suggestions.push(item);
            }
          }

          const effectType =
            effectUnitVariables.get(
              variableName
            );

          if (effectType) {
            for (const item of createFxUnitSuggestions(
              effectType,
              kind,
              snippet,
              range
            )) {
              suggestions.push(item);
            }
          }
        }

        if (livePreparePropertyMatch) {
          const objectName =
            livePreparePropertyMatch[1];
          const propertyName =
            livePreparePropertyMatch[2];
          const livePrepareObject =
            livePrepareObjects.get(
              objectName
            );
          const effectType =
            livePrepareObject?.properties?.[
              propertyName
            ];

          if (effectType) {
            for (const item of createFxUnitSuggestions(
              effectType,
              kind,
              snippet,
              range
            )) {
              suggestions.push(item);
            }
          }
        }

        if (
          /MEGADRIVE_FM_PRESETS\[\s*["']([^"']*)$/.test(
            linePrefix
          )
        ) {
          for (const presetName of MEGADRIVE_FM_PRESET_ORDER) {
            suggestions.push({
              label: presetName,
              kind: kind.Value,
              insertText:
                presetName,
              documentation:
                MEGADRIVE_FM_PRESETS[
                  presetName
                ]?.label ??
                presetName,
              range,
            });
          }
        }

        if (
          /\.(bass|mid|treble|cutoff|q|mix|feedback|time|tone)\.$/.test(
            linePrefix
          )
        ) {
          suggestions.push(
            {
              label: "set",
              kind: kind.Method,
              insertText:
                "set(${1:value})",
              insertTextRules:
                snippet,
              documentation:
                "Set one effect parameter immediately.",
              range,
            },
            {
              label: "rampTo",
              kind: kind.Method,
              insertText:
                "rampTo(${1:value}, ${2:0.18})",
              insertTextRules:
                snippet,
              documentation:
                "Smoothly move one effect parameter over time.",
              range,
            }
          );
        }

        if (
          suggestions.length === 0
        ) {
          for (const item of topLevelItems) {
            suggestions.push({
              ...item,
              range,
            });
          }
        }

        return {
          suggestions,
        };
      },
    }
  );
}

function registerMonacoHover(
  monaco
) {
  monaco.languages.registerHoverProvider(
    "javascript",
    {
      provideHover(
        model,
        position
      ) {
        const word =
          model.getWordAtPosition(
            position
          );

        if (!word) {
          return null;
        }

        const docs = {
          liveLoop:
            "Create a named repeating live loop.",
          livePrepare:
            "Prepare and reuse live state across runs.",
          beat:
            "Wait using the shared beat clock.",
          nextBeat:
            "Wait for the next beat boundary.",
          fx: "Create and connect master FX units.",
          fm: "Control raw YM2612Synth behavior.",
        };
        const message =
          docs[word.word];

        if (!message) {
          return null;
        }

        return {
          contents: [
            {
              value: `**${word.word}**\n\n${message}`,
            },
          ],
        };
      },
    }
  );
}

function registerMonacoPlaygroundGlobals(
  monaco
) {
  const declarations =
    `
declare const MEGADRIVE_FM_PRESETS: Record<string, unknown>;

type YM2612OperatorParams = {
  dt?: number;
  multi?: number;
  tl?: number;
  rs?: number;
  ar?: number;
  am?: boolean;
  d1r?: number;
  sr?: number;
  d2r?: number;
  sl?: number;
  rr?: number;
  ssg?: number;
};

type PlaygroundPlayOptions = {
  channel?: number;
  duration?: number;
  preset?: object;
};

type GainFXOptions = {
  gain?: number;
};

type EqFXOptions = {
  bass?: number;
  mid?: number;
  treble?: number;
};

type FilterFXOptions = {
  type?: string;
  cutoff?: number;
  q?: number;
};

type DelayFXOptions = {
  time?: number;
  feedback?: number;
  mix?: number;
};

type ReverbFXOptions = {
  mix?: number;
  tone?: number;
};

declare const fm: {
  reset(): void;
  setPreset(channel: number, preset: object): void;
  setOperator(channel: number, operator: number, params: YM2612OperatorParams): void;
  setAlgo(channel: number, algorithm: number, feedback?: number): void;
  setPan(channel: number, left: boolean, right: boolean, ams?: number, pms?: number): void;
  setLfo(enabled: boolean, frequency: number): void;
  noteOn(channel: number, block: number, fnum: number): void;
  noteOff(channel: number): void;
  write(port: number, register: number, value: number): void;
  writeAddress(port: number, register: number): void;
  writeData(value: number): void;
  read(offset: number): number;
  readStatus(): number;
  getIrq(): boolean;
  rawWrite(port: number, register: number, value: number): void;
};

declare const fx: {
  gain(options?: GainFXOptions): any;
  eq(options?: EqFXOptions): any;
  filter(options?: FilterFXOptions): any;
  delay(options?: DelayFXOptions): any;
  reverb(options?: ReverbFXOptions): any;
  setChain(effects: any[]): void;
  clear(): void;
};

declare function liveLoop(name: string, fn: () => Promise<void> | void): void;
declare function livePrepare(name: string, fn: (context: { fx: typeof fx; fm: typeof fm; log: (...args: unknown[]) => void }) => Promise<any> | any): Promise<any>;
declare function play(note: string, options?: PlaygroundPlayOptions): Promise<void>;
declare function sleep(seconds: number): Promise<void>;
declare function beat(beats?: number): Promise<void>;
declare function nextBeat(): Promise<void>;
declare function setBpm(bpm: number): void;
declare function scale(root: string, name: string, octaves?: number): string[];
declare function choose<T>(values: T[]): T;
declare function rand(): number;
declare function randInt(min: number, max: number): number;
declare function stopLoop(name: string): void;
declare function stopAllLoops(): void;
declare function stopAll(): void;
declare const pg: {
  fm: typeof fm;
  fx: typeof fx;
  presets: typeof MEGADRIVE_FM_PRESETS;
  play(note: string, options?: PlaygroundPlayOptions): Promise<void>;
  sleep: typeof sleep;
  beat: typeof beat;
  nextBeat: typeof nextBeat;
  setBpm: typeof setBpm;
  liveLoop: typeof liveLoop;
  livePrepare: typeof livePrepare;
  scale: typeof scale;
  choose: typeof choose;
  rand: typeof rand;
  randInt: typeof randInt;
  stopLoop: typeof stopLoop;
  stopAllLoops: typeof stopAllLoops;
  stopAll: typeof stopAll;
  log: (...args: unknown[]) => void;
};
`;

  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    declarations,
    "file:///tetorica-playground-globals.d.ts"
  );
}

function loadMonacoLoader() {
  return new Promise(
    (resolve, reject) => {
      if (
        window.require?.config &&
        window.monaco
      ) {
        resolve(window.monaco);
        return;
      }

      const script =
        document.createElement(
          "script"
        );
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/loader.min.js";
      script.onload = () => {
        resolve();
      };
      script.onerror = () => {
        reject(
          new Error(
            "Failed to load Monaco loader"
          )
        );
      };
      document.head.appendChild(
        script
      );
    }
  );
}

export async function initializePlaygroundMonaco(
  options
) {
  const {
    editor,
    editorHost,
    getEditorValue,
    setEditorNote,
    setEditorAdapter,
  } = options;

  try {
    await loadMonacoLoader();
  } catch (error) {
    console.warn(error);
    setEditorNote(
      "Monaco editor could not load. Fallback textarea is active."
    );
    return;
  }

  try {
    await new Promise(
      (resolve, reject) => {
        window.MonacoEnvironment = {
          getWorkerUrl() {
            const workerSource =
              `
                self.MonacoEnvironment = { baseUrl: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/" };
                importScripts("https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs/base/worker/workerMain.js");
              `;
            return URL.createObjectURL(
              new Blob(
                [workerSource],
                {
                  type: "text/javascript",
                }
              )
            );
          },
        };

        window.require.config({
          paths: {
            vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.2/min/vs",
          },
        });

        window.require(
          [
            "vs/editor/editor.main",
          ],
          () => {
            resolve();
          },
          reject
        );
      }
    );

    const monaco =
      window.monaco;
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(
      {
        allowNonTsExtensions: true,
        checkJs: false,
        noLib: false,
        lib: [
          "es2020",
        ],
        target:
          monaco.languages.typescript.ScriptTarget.ES2020,
      }
    );
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
      {
        noSemanticValidation: true,
        noSyntaxValidation: false,
      }
    );
    registerMonacoCompletions(
      monaco
    );
    registerMonacoHover(monaco);
    registerMonacoPlaygroundGlobals(
      monaco
    );

    const monacoEditor =
      monaco.editor.create(
        editorHost,
        {
          value: getEditorValue(),
          language: "javascript",
          theme: "vs-dark",
          automaticLayout: true,
          minimap: {
            enabled: false,
          },
          fontSize: 13,
          lineHeight: 21,
          roundedSelection: false,
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: "on",
          wordBasedSuggestions: "off",
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          snippetSuggestions: "top",
          suggest: {
            showClasses: false,
            showColors: false,
            showConstants: false,
            showConstructors: false,
            showEnums: false,
            showEnumMembers: false,
            showEvents: false,
            showFields: false,
            showFiles: false,
            showFolders: false,
            showInterfaces: false,
            showIssues: false,
            showKeywords: false,
            showModules: false,
            showOperators: false,
            showProperties: true,
            showReferences: false,
            showStructs: false,
            showTypeParameters: false,
            showUsers: false,
            showVariables: true,
            showWords: false,
          },
        }
      );

    editorHost.dataset.ready =
      "true";
    editor.style.display = "none";
    setEditorNote(
      "Monaco editor is active. Tetorica-specific completion is enabled."
    );

    setEditorAdapter({
      kind: "monaco",
      getValue() {
        return monacoEditor.getValue();
      },
      setValue(value) {
        monacoEditor.setValue(
          value
        );
      },
      focus() {
        monacoEditor.focus();
      },
    });
  } catch (error) {
    console.warn(error);
    setEditorNote(
      "Monaco editor setup failed. Fallback textarea is active."
    );
  }
}
