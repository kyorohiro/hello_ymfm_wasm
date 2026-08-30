import {
  FM_PRESETS,
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

const SONIC_PI_SAMPLE_ALIASES = [
  "sonic-pi/ambi-choir",
  "sonic-pi/ambi-dark-woosh",
  "sonic-pi/ambi-drone",
  "sonic-pi/ambi-glass-hum",
  "sonic-pi/ambi-glass-rub",
  "sonic-pi/ambi-haunted-hum",
  "sonic-pi/ambi-lunar-land",
  "sonic-pi/ambi-piano",
  "sonic-pi/ambi-sauna",
  "sonic-pi/ambi-soft-buzz",
  "sonic-pi/ambi-swoosh",
  "sonic-pi/arovane-beat-a",
  "sonic-pi/arovane-beat-b",
  "sonic-pi/arovane-beat-c",
  "sonic-pi/arovane-beat-d",
  "sonic-pi/arovane-beat-e",
  "sonic-pi/bass-dnb-f",
  "sonic-pi/bass-drop-c",
  "sonic-pi/bass-hard-c",
  "sonic-pi/bass-hit-c",
  "sonic-pi/bass-thick-c",
  "sonic-pi/bass-trance-c",
  "sonic-pi/bass-voxy-c",
  "sonic-pi/bass-voxy-hit-c",
  "sonic-pi/bass-woodsy-c",
  "sonic-pi/bd-808",
  "sonic-pi/bd-ada",
  "sonic-pi/bd-boom",
  "sonic-pi/bd-chip",
  "sonic-pi/bd-fat",
  "sonic-pi/bd-gas",
  "sonic-pi/bd-haus",
  "sonic-pi/bd-jazz",
  "sonic-pi/bd-klub",
  "sonic-pi/bd-mehackit",
  "sonic-pi/bd-pure",
  "sonic-pi/bd-sone",
  "sonic-pi/bd-tek",
  "sonic-pi/bd-zome",
  "sonic-pi/bd-zum",
  "sonic-pi/drum-bass-hard",
  "sonic-pi/drum-bass-soft",
  "sonic-pi/drum-cowbell",
  "sonic-pi/drum-cymbal-closed",
  "sonic-pi/drum-cymbal-hard",
  "sonic-pi/drum-cymbal-open",
  "sonic-pi/drum-cymbal-pedal",
  "sonic-pi/drum-cymbal-soft",
  "sonic-pi/drum-heavy-kick",
  "sonic-pi/drum-roll",
  "sonic-pi/drum-snare-hard",
  "sonic-pi/drum-snare-soft",
  "sonic-pi/drum-splash-hard",
  "sonic-pi/drum-splash-soft",
  "sonic-pi/drum-tom-hi-hard",
  "sonic-pi/drum-tom-hi-soft",
  "sonic-pi/drum-tom-lo-hard",
  "sonic-pi/drum-tom-lo-soft",
  "sonic-pi/drum-tom-mid-hard",
  "sonic-pi/drum-tom-mid-soft",
  "sonic-pi/elec-beep",
  "sonic-pi/elec-bell",
  "sonic-pi/elec-blip",
  "sonic-pi/elec-blip2",
  "sonic-pi/elec-blup",
  "sonic-pi/elec-bong",
  "sonic-pi/elec-chime",
  "sonic-pi/elec-cymbal",
  "sonic-pi/elec-filt-snare",
  "sonic-pi/elec-flip",
  "sonic-pi/elec-fuzz-tom",
  "sonic-pi/elec-hi-snare",
  "sonic-pi/elec-hollow-kick",
  "sonic-pi/elec-lo-snare",
  "sonic-pi/elec-mid-snare",
  "sonic-pi/elec-ping",
  "sonic-pi/elec-plip",
  "sonic-pi/elec-pop",
  "sonic-pi/elec-snare",
  "sonic-pi/elec-soft-kick",
  "sonic-pi/elec-tick",
  "sonic-pi/elec-triangle",
  "sonic-pi/elec-twang",
  "sonic-pi/elec-twip",
  "sonic-pi/elec-wood",
  "sonic-pi/glitch-bass-g",
  "sonic-pi/glitch-perc1",
  "sonic-pi/glitch-perc2",
  "sonic-pi/glitch-perc3",
  "sonic-pi/glitch-perc4",
  "sonic-pi/glitch-perc5",
  "sonic-pi/glitch-robot1",
  "sonic-pi/glitch-robot2",
  "sonic-pi/guit-e-fifths",
  "sonic-pi/guit-e-slide",
  "sonic-pi/guit-em9",
  "sonic-pi/guit-harmonics",
  "sonic-pi/hat-bdu",
  "sonic-pi/hat-cab",
  "sonic-pi/hat-cats",
  "sonic-pi/hat-gem",
  "sonic-pi/hat-gnu",
  "sonic-pi/hat-gump",
  "sonic-pi/hat-hier",
  "sonic-pi/hat-len",
  "sonic-pi/hat-mess",
  "sonic-pi/hat-metal",
  "sonic-pi/hat-noiz",
  "sonic-pi/hat-psych",
  "sonic-pi/hat-raw",
  "sonic-pi/hat-sci",
  "sonic-pi/hat-snap",
  "sonic-pi/hat-star",
  "sonic-pi/hat-tap",
  "sonic-pi/hat-yosh",
  "sonic-pi/hat-zan",
  "sonic-pi/hat-zap",
  "sonic-pi/hat-zild",
  "sonic-pi/loop-3d-printer",
  "sonic-pi/loop-amen",
  "sonic-pi/loop-amen-full",
  "sonic-pi/loop-breakbeat",
  "sonic-pi/loop-compus",
  "sonic-pi/loop-drone-g-97",
  "sonic-pi/loop-electric",
  "sonic-pi/loop-garzul",
  "sonic-pi/loop-industrial",
  "sonic-pi/loop-mehackit1",
  "sonic-pi/loop-mehackit2",
  "sonic-pi/loop-mika",
  "sonic-pi/loop-perc1",
  "sonic-pi/loop-perc2",
  "sonic-pi/loop-safari",
  "sonic-pi/loop-tabla",
  "sonic-pi/loop-weirdo",
  "sonic-pi/mehackit-phone1",
  "sonic-pi/mehackit-phone2",
  "sonic-pi/mehackit-phone3",
  "sonic-pi/mehackit-phone4",
  "sonic-pi/mehackit-robot1",
  "sonic-pi/mehackit-robot2",
  "sonic-pi/mehackit-robot3",
  "sonic-pi/mehackit-robot4",
  "sonic-pi/mehackit-robot5",
  "sonic-pi/mehackit-robot6",
  "sonic-pi/mehackit-robot7",
  "sonic-pi/misc-burp",
  "sonic-pi/misc-cineboom",
  "sonic-pi/misc-crow",
  "sonic-pi/perc-bell",
  "sonic-pi/perc-bell2",
  "sonic-pi/perc-door",
  "sonic-pi/perc-impact1",
  "sonic-pi/perc-impact2",
  "sonic-pi/perc-snap",
  "sonic-pi/perc-snap2",
  "sonic-pi/perc-swash",
  "sonic-pi/perc-swoosh",
  "sonic-pi/perc-till",
  "sonic-pi/ride-tri",
  "sonic-pi/ride-via",
  "sonic-pi/sn-dolf",
  "sonic-pi/sn-dub",
  "sonic-pi/sn-generic",
  "sonic-pi/sn-zome",
  "sonic-pi/tabla-dhec",
  "sonic-pi/tabla-ghe1",
  "sonic-pi/tabla-ghe2",
  "sonic-pi/tabla-ghe3",
  "sonic-pi/tabla-ghe4",
  "sonic-pi/tabla-ghe5",
  "sonic-pi/tabla-ghe6",
  "sonic-pi/tabla-ghe7",
  "sonic-pi/tabla-ghe8",
  "sonic-pi/tabla-ke1",
  "sonic-pi/tabla-ke2",
  "sonic-pi/tabla-ke3",
  "sonic-pi/tabla-na",
  "sonic-pi/tabla-na-o",
  "sonic-pi/tabla-na-s",
  "sonic-pi/tabla-re",
  "sonic-pi/tabla-tas1",
  "sonic-pi/tabla-tas2",
  "sonic-pi/tabla-tas3",
  "sonic-pi/tabla-te1",
  "sonic-pi/tabla-te2",
  "sonic-pi/tabla-te-m",
  "sonic-pi/tabla-te-ne",
  "sonic-pi/tabla-tun1",
  "sonic-pi/tabla-tun2",
  "sonic-pi/tabla-tun3",
  "sonic-pi/tbd-fxbed-loop",
  "sonic-pi/tbd-highkey-c4",
  "sonic-pi/tbd-pad-1",
  "sonic-pi/tbd-pad-2",
  "sonic-pi/tbd-pad-3",
  "sonic-pi/tbd-pad-4",
  "sonic-pi/tbd-perc-blip",
  "sonic-pi/tbd-perc-hat",
  "sonic-pi/tbd-perc-tap-1",
  "sonic-pi/tbd-perc-tap-2",
  "sonic-pi/tbd-voctone",
  "sonic-pi/vinyl-backspin",
  "sonic-pi/vinyl-hiss",
  "sonic-pi/vinyl-rewind",
  "sonic-pi/vinyl-scratch",
];

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

function createPropertySuggestions(
  names,
  kind,
  range,
  documentation
) {
  return names.map((name) => ({
    label: name,
    kind: kind.Property,
    insertText: name,
    documentation:
      typeof documentation ===
      "function"
        ? documentation(name)
        : documentation,
    range,
  }));
}

function createMethodSuggestions(
  names,
  kind,
  range,
  documentation
) {
  return names.map((name) => ({
    label: name,
    kind: kind.Method,
    insertText: name,
    documentation:
      typeof documentation ===
      "function"
        ? documentation(name)
        : documentation,
    range,
  }));
}

function createKnownObjectSuggestions(
  objectName,
  kind,
  range
) {
  if (objectName === "pg") {
    return [
      ...createPropertySuggestions(
        [
          "fm",
          "fx",
          "psg",
          "context",
          "sample",
          "stream",
          "presets",
          "CH1",
          "CH2",
          "CH3",
          "CH4",
          "CH5",
          "CH6",
          "OP1",
          "OP2",
          "OP3",
          "OP4",
        ],
        kind,
        range,
        "Playground helper property."
      ),
      ...createMethodSuggestions(
        [
          "play",
          "sleep",
          "beat",
          "nextBeat",
          "tween",
          "setBpm",
          "liveLoop",
          "livePrepare",
          "scale",
          "chord",
          "noteToBlockFnum",
          "noteLerp",
          "choose",
          "cycle",
          "rand",
          "rrange",
          "randInt",
          "lerp",
          "psgTone",
          "psgNoise",
          "stopLoop",
          "stopAllLoops",
          "stopAll",
          "setMasterVolume",
          "getMasterVolume",
          "log",
        ],
        kind,
        range,
        "Playground helper method."
      ),
    ];
  }

  if (objectName === "sample") {
    return [
      ...createMethodSuggestions(
        [
          "load",
          "play",
          "stop",
          "stopAll",
          "unload",
          "isLoaded",
          "get",
          "list",
        ],
        kind,
        range,
        "Sample helper method."
      ),
    ];
  }

  if (objectName === "stream") {
    return [
      ...createMethodSuggestions(
        [
          "load",
          "play",
          "pause",
          "stop",
          "unload",
          "isLoaded",
          "get",
          "list",
        ],
        kind,
        range,
        "Stream helper method."
      ),
    ];
  }

  if (objectName === "fx") {
    return [
      ...createMethodSuggestions(
        [
          "gain",
          "eq",
          "radioTone",
          "lofi",
          "stereoWidth",
          "bitcrusher",
          "filter",
          "delay",
          "distortion",
          "compressor",
          "gate",
          "wobble",
          "flanger",
          "chorus",
          "tapeSaturation",
          "reverb",
          "branch",
          "parallel",
          "slicer",
          "setChain",
          "clear",
        ],
        kind,
        range,
        "FX helper method."
      ),
    ];
  }

  return null;
}

function extractFxUnitVariables(
  source
) {
  const variables =
    new Map();
  const pattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*fx\.(gain|eq|filter|delay|distortion|compressor|gate|wobble|flanger|reverb|slicer)\s*\(/g;
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

function extractDeclaredVariableNames(
  source
) {
  const names =
    new Set();
  const pattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g;
  let match =
    pattern.exec(source);

  while (match) {
    names.add(
      match[1]
    );
    match = pattern.exec(source);
  }

  return names;
}

function extractFunctionNames(
  source
) {
  const names =
    new Set();
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/g,
  ];

  for (const pattern of patterns) {
    let match =
      pattern.exec(source);
    while (match) {
      names.add(
        match[1]
      );
      match = pattern.exec(source);
    }
  }

  return names;
}

function extractParameterNames(
  source
) {
  const names =
    new Set();
  const patterns = [
    /\bfunction(?:\s+[A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g,
    /(?:async\s*)?\(([^)]*)\)\s*=>/g,
    /(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/g,
  ];

  for (const pattern of patterns) {
    let match =
      pattern.exec(source);
    while (match) {
      const rawParameters =
        match[1] ?? "";
      for (const part of rawParameters.split(",")) {
        const name =
          part
            .trim()
            .replace(/^(\.\.\.)/, "")
            .replace(/=.*/, "")
            .trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) {
          names.add(name);
        }
      }
      match = pattern.exec(source);
    }
  }

  return names;
}

function extractLiveLoopNames(
  source
) {
  const names =
    new Set();
  const pattern =
    /\b(?:pg\.)?liveLoop\(\s*["']([^"']+)["']/g;
  let match =
    pattern.exec(source);

  while (match) {
    names.add(
      match[1]
    );
    match = pattern.exec(source);
  }

  return names;
}

/**
 * Build one lightweight source analysis object before generating suggestions.
 *
 * This keeps the completion provider from re-deriving object/function/argument
 * names in scattered ad-hoc branches.
 *
 * @param {string} source
 * @returns {{
 *   declaredVariableNames: Set<string>,
 *   functionNames: Set<string>,
 *   parameterNames: Set<string>,
 *   liveLoopNames: Set<string>,
 *   effectUnitVariables: Map<string, string>,
 *   livePrepareObjects: Map<string, { properties: Record<string, string> }>,
 * }}
 */
function buildSourceAnalysis(
  source
) {
  const effectUnitVariables =
    extractFxUnitVariables(
      source
    );

  return {
    declaredVariableNames:
      extractDeclaredVariableNames(
        source
      ),
    functionNames:
      extractFunctionNames(
        source
      ),
    parameterNames:
      extractParameterNames(
        source
      ),
    liveLoopNames:
      extractLiveLoopNames(
        source
      ),
    effectUnitVariables,
    livePrepareObjects:
      extractLivePrepareObjects(
        source,
        effectUnitVariables
      ),
  };
}

function createFxUnitSuggestions(
  effectType,
  kind,
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
    distortion: ["drive", "mix", "outputGain"],
    compressor: [
      "threshold",
      "knee",
      "ratio",
      "attack",
      "release",
      "outputGain",
    ],
    gate: ["threshold", "floor", "mix"],
    wobble: [
      "cutoff",
      "depth",
      "rate",
      "resonance",
      "mix",
    ],
    flanger: [
      "time",
      "depth",
      "rate",
      "feedback",
      "mix",
    ],
    reverb: ["mix", "tone"],
    slicer: ["phase", "mix"],
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
    "dt",
    "multi",
    "tl",
    "rs",
    "ar",
    "am",
    "d1r",
    "sr",
    "d2r",
    "sl",
    "rr",
    "ssg",
  ].map((label) => ({
    label,
    kind: kind.Property,
    insertText:
      `${label}: \${1},`,
    insertTextRules: snippet,
    documentation:
      `YM2612 operator parameter: ${label}.`,
    range,
  }));
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
        'preset: FM_PRESETS["${1:one-op-basic}"],',
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
    gain: ["gain"],
    eq: ["bass", "mid", "treble"],
    radioTone: [
      "highpass",
      "lowpass",
      "presence",
      "mix",
      "output",
    ],
    lofi: [
      "cutoff",
      "highshelf",
      "drive",
      "mix",
      "output",
    ],
    stereoWidth: [
      "width",
      "mix",
      "output",
    ],
    bitcrusher: [
      "bitDepth",
      "holdFrames",
      "mix",
      "output",
    ],
    filter: ["type", "cutoff", "q"],
    delay: ["time", "feedback", "mix"],
    distortion: ["drive", "mix", "output"],
    compressor: [
      "threshold",
      "knee",
      "ratio",
      "attack",
      "release",
      "output",
    ],
    gate: ["threshold", "floor", "mix"],
    wobble: [
      "cutoff",
      "depth",
      "rate",
      "resonance",
      "mix",
    ],
    flanger: [
      "time",
      "depth",
      "rate",
      "feedback",
      "mix",
    ],
    chorus: [
      "delay1",
      "delay2",
      "depth",
      "rate",
      "spread",
      "mix",
      "output",
    ],
    tapeSaturation: [
      "drive",
      "output",
      "mix",
    ],
    reverb: ["mix", "tone"],
    slicer: ["phase", "mix"],
  };

  return (definitions[effectType] ?? []).map(
    (label) => ({
      label,
      kind: kind.Property,
      insertText:
        `${label}: \${1},`,
      insertTextRules: snippet,
      documentation:
        `${effectType} option: ${label}.`,
      range,
    })
  );
}

function detectFxConfigContext(
  sourceBeforeCursor
) {
  const candidates = [
    { prefix: "fx.gain(", effectType: "gain" },
    { prefix: "fx.eq(", effectType: "eq" },
    { prefix: "fx.radioTone(", effectType: "radioTone" },
    { prefix: "fx.lofi(", effectType: "lofi" },
    { prefix: "fx.stereoWidth(", effectType: "stereoWidth" },
    { prefix: "fx.bitcrusher(", effectType: "bitcrusher" },
    { prefix: "fx.filter(", effectType: "filter" },
    { prefix: "fx.delay(", effectType: "delay" },
    { prefix: "fx.distortion(", effectType: "distortion" },
    { prefix: "fx.compressor(", effectType: "compressor" },
    { prefix: "fx.gate(", effectType: "gate" },
    { prefix: "fx.wobble(", effectType: "wobble" },
    { prefix: "fx.flanger(", effectType: "flanger" },
    { prefix: "fx.chorus(", effectType: "chorus" },
    { prefix: "fx.tapeSaturation(", effectType: "tapeSaturation" },
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
  return Object.keys(
    FM_PRESETS
  ).map((name) => ({
    label: name,
    kind: kind.Value,
    insertText: name,
    documentation:
      FM_PRESETS[name]
        ?.label ?? name,
    range,
  }));
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

function createSetBpmSuggestions(
  kind,
  range
) {
  return [
    {
      label: "120",
      kind: kind.Value,
      insertText: "120",
      documentation:
        "Common default BPM.",
      range,
    },
    {
      label: "140",
      kind: kind.Value,
      insertText: "140",
      documentation:
        "Faster BPM example.",
      range,
    },
  ];
}

function createNameSuggestions(
  names,
  kind,
  range,
  documentation
) {
  return Array.from(names).map(
    (name) => ({
      label: name,
      kind,
      insertText: name,
      documentation,
      range,
    })
  );
}

function createStringLiteralSuggestions(
  values,
  kind,
  range,
  documentation,
  options = {}
) {
  const quoteWrapped =
    options.quoteWrapped !== false;
  return Array.from(values).map(
    (value) => ({
      label: value,
      kind,
      insertText: quoteWrapped
        ? `"${value}"`
        : value,
      documentation,
      range,
    })
  );
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
    /FM_PRESETS\[\s*["'][^"']*$/.test(
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

function isInsideSampleLoadString(
  linePrefix
) {
  return /(sample|stream)\.load\(\s*["'][^"']*$/.test(
    linePrefix
  ) || /(sample|stream)\.load\(\s*["'][^"']*["']\s*,\s*["'][^"']*$/.test(
    linePrefix
  ) || /pg\.(sample|stream)\.load\(\s*["'][^"']*$/.test(
    linePrefix
  ) || /pg\.(sample|stream)\.load\(\s*["'][^"']*["']\s*,\s*["'][^"']*$/.test(
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

function isAtSetBpmFirstArgument(
  linePrefix
) {
  return /(^|[^.\w])setBpm\(\s*$/.test(
    linePrefix
  ) || /pg\.setBpm\(\s*$/.test(
    linePrefix
  );
}

function isAtChooseFirstArgument(
  linePrefix
) {
  return /(^|[^.\w])choose\(\s*$/.test(
    linePrefix
  ) || /pg\.choose\(\s*$/.test(
    linePrefix
  );
}

function isAtStopLoopFirstArgument(
  linePrefix
) {
  return /(^|[^.\w])stopLoop\(\s*$/.test(
    linePrefix
  ) || /pg\.stopLoop\(\s*$/.test(
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

/**
 * Register Tetorica-specific Monaco completion behavior for the playground.
 *
 * This attaches one JavaScript CompletionItemProvider and keeps the custom
 * suggestions for YM2612/FM learning use-cases in one place.
 *
 * Intended scope:
 * - pg / fm / fx helper API suggestions
 * - note / scale suggestions
 * - YM2612 register and register-value suggestions
 * - lightweight argument-context suggestions such as setBpm(...)
 *
 * This layer is intentionally separate from the global `.d.ts` type
 * declarations. General type understanding should come from Monaco's
 * TypeScript engine, while this function adds playground-specific guidance.
 *
 * @param {typeof import("monaco-editor")} monaco Monaco runtime object.
 * @returns {void}
 */

export function registerMonacoCompletions(
  monaco
) {
  const kind =
    monaco.languages
      .CompletionItemKind;
  const snippet =
    monaco.languages
      .CompletionItemInsertTextRule
      .InsertAsSnippet;

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
        const source =
          model.getValue();
        const analysis =
          buildSourceAnalysis(
            source
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
        const propertyAccessMatch =
          /(?:^|[^\w$])([A-Za-z_$][\w$]*)\.$/.exec(
            linePrefix
          );

        const effectUnitVariables =
          analysis.effectUnitVariables;
        const livePrepareObjects =
          analysis.livePrepareObjects;

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
          isAtChooseFirstArgument(
            linePrefix
          )
        ) {
          const chooseNames =
            new Set([
              ...analysis.declaredVariableNames,
              ...analysis.parameterNames,
            ]);
          suggestions.push(
            ...createNameSuggestions(
              chooseNames,
              kind.Variable,
              range,
              "Declared value available in this source."
            )
          );
        }

        if (
          isAtStopLoopFirstArgument(
            linePrefix
          )
        ) {
          suggestions.push(
            ...createStringLiteralSuggestions(
              analysis.liveLoopNames,
              kind.Value,
              range,
              "Known liveLoop name from this source."
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
          isAtSetBpmFirstArgument(
            linePrefix
          )
        ) {
          suggestions.push(
            ...createSetBpmSuggestions(
              kind,
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
          isInsideSampleLoadString(
            linePrefix
          )
        ) {
          suggestions.push(
            ...createStringLiteralSuggestions(
              SONIC_PI_SAMPLE_ALIASES,
              kind.Value,
              range,
              "Built-in Sonic Pi sample alias.",
              { quoteWrapped: false }
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
            sourceBeforeCursor,
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
              range
            )) {
              suggestions.push(item);
            }
          }
        }

        if (
          /\.(bass|mid|treble|cutoff|q|mix|feedback|time|tone|phase)\.$/.test(
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
          /fx\.setChain\(\[\s*$/.test(
            linePrefix
          )
        ) {
          suggestions.push(
            ...createNameSuggestions(
              effectUnitVariables.keys(),
              kind.Variable,
              range,
              "Known FX unit declared in this source."
            )
          );
        }

        if (
          propertyAccessMatch &&
          suggestions.length === 0
        ) {
          return null;
        }

        return {
          suggestions,
        };
      },
    }
  );
}
