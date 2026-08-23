import {
  MegaDriveSynth,
  createDelayFX,
  createEqFX,
  createFilterFX,
  createGainFX,
  createReverbFX,
  MEGADRIVE_FM_PRESET_ORDER,
  MEGADRIVE_FM_PRESETS,
} from "../js/megasynth.js";
import {
  createPitchFromMidi,
} from "../synth/synth_keyboard.js";
import {
  createPlaygroundOperatorTab,
} from "./playground_operator_tab.js";

const REFERENCE_MIDI = 62;
const REFERENCE_BLOCK = 4;
const REFERENCE_FNUM = 553;
const NOTE_TO_SEMITONE = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};
const SCALE_INTERVALS = {
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
const EXAMPLES = {
  single: `fm.setPreset(0, MEGADRIVE_FM_PRESETS["one-op-basic"]);
await play("C4", { channel: 0, duration: 0.35 });
await sleep(0.12);
await play("E4", { channel: 0, duration: 0.35 });
await sleep(0.12);
await play("G4", { channel: 0, duration: 0.5 });
`,
  random: `fm.setPreset(0, MEGADRIVE_FM_PRESETS["two-op-bell"]);
const notes = scale("Eb2", "majorPentatonic", 2);

for (let step = 0; step < 16; step += 1) {
  await play(choose(notes), {
    channel: 0,
    duration: 0.12 + rand() * 0.15,
  });
  await sleep(0.08);
}
`,
  "8-bit-arcade-sweep": `setBpm(132);

fm.reset();

// channel 0 = lead voice
// operator 4 = carrier
// operator 2 = main modulator
fm.setOperator(0, 1, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(0, 2, {
  multi: 3,
  tl: 30,
  ar: 24,
  d1r: 9,
  d2r: 5,
  sl: 6,
  rr: 9,
});
fm.setOperator(0, 3, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(0, 4, {
  multi: 1,
  tl: 10,
  ar: 25,
  d1r: 8,
  d2r: 4,
  sl: 5,
  rr: 8,
});
fm.setAlgo(0, 4, 3);
fm.setPan(0, true, true);

// channel 1 = simple bass support
fm.setPreset(1, MEGADRIVE_FM_PRESETS["one-op-basic"]);
fm.setOperator(1, 4, {
  tl: 18,
  ar: 28,
  d1r: 7,
  d2r: 3,
  sl: 4,
  rr: 8,
});

liveLoop("lead", async () => {
  const phrase = ["E5", "B4", "A4", "E5", "D6", "A5"];
  //await nextBeat();
  await play(choose(phrase), {
    channel: 0,
    duration: 0.100,
  });
  await beat(0.001);
});

liveLoop("multi-sweep", async () => {
  const modulatorMulti = choose([2, 3, 4, 6, 8, 10]);
  fm.setOperator(0, 2, {
    multi: modulatorMulti,
  });
  await beat(0.125);
});

liveLoop("bass", async () => {
  await nextBeat();
  await play("E2", {
    channel: 1,
    duration: 0.16,
  });
  await beat(1);
});
`,
  "live-loop": `setBpm(120);

fm.setPreset(0, MEGADRIVE_FM_PRESETS["one-op-basic"]);
fm.setPreset(1, MEGADRIVE_FM_PRESETS["two-op-bell"]);

liveLoop("bass", async () => {
  await nextBeat();
  await play("E2", { channel: 0, duration: 0.14 });
  await beat(1);
  await play("E2", { channel: 0, duration: 0.14 });
  await beat(1);
  await play("G2", { channel: 0, duration: 0.14 });
  await beat(1);
  await play("A2", { channel: 0, duration: 0.14 });
  await beat(1);
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  //await nextBeat();
  await play(choose(notes), {
    channel: 1,
    duration: 0.08,
  });
  await beat(0.125);
});
`,
  "fm-direct": `fm.reset();
fm.setPreset(0, MEGADRIVE_FM_PRESETS["one-op-basic"]);
fm.setOperator(0, 4, {
  multi: 3,
  tl: 10,
  ar: 24,
  d1r: 8,
  d2r: 5,
  sl: 5,
  rr: 8,
});
fm.setAlgo(0, 7, 0);
fm.setPan(0, true, true);

for (const note of ["C3", "G3", "Bb3", "C4"]) {
  await play(note, { channel: 0, duration: 0.22 });
  await sleep(0.06);
}
`,
  "fm-api-beep": `fm.reset();

// channel 0 = YM2612 channel 1
// operator 4 is the audible carrier in this simple setup
fm.setOperator(0, 1, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(0, 2, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(0, 3, { tl: 127, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15 });
fm.setOperator(0, 4, {
  dt: 0,
  multi: 1,
  tl: 8,
  ar: 22,
  d1r: 6,
  d2r: 3,
  sl: 3,
  rr: 8,
});

fm.setAlgo(0, 7, 0);
fm.setPan(0, true, true);

fm.noteOn(0, 4, 553);
await sleep(0.4);
fm.noteOff(0);
await sleep(0.3);
`,
  "raw-write-beep": `fm.reset();

// Port 0, channel 1, operator 4 only

// DT / MULTI
fm.writeAddress(0, 0x3c);
fm.writeData((0 << 4) | 1);

// Total Level
fm.writeAddress(0, 0x4c);
fm.writeData(8);

// Attack Rate
fm.writeAddress(0, 0x5c);
fm.writeData(22);

// First Decay Rate
fm.writeAddress(0, 0x6c);
fm.writeData(6);

// Sustain Rate
fm.writeAddress(0, 0x7c);
fm.writeData(3);

// Sustain Level / Release Rate
fm.writeAddress(0, 0x8c);
fm.writeData((3 << 4) | 8);

// Algorithm / Feedback
fm.writeAddress(0, 0xb0);
fm.writeData((0 << 3) | 7);

// Left / Right output enable
fm.writeAddress(0, 0xb4);
fm.writeData(0xc0);

// BLOCK / F-NUM high and low
fm.writeAddress(0, 0xa4);
fm.writeData((4 << 3) | ((553 >> 8) & 0x07));
fm.writeAddress(0, 0xa0);
fm.writeData(553 & 0xff);

// Key On all operators on channel 1
fm.writeAddress(0, 0x28);
fm.writeData(0xf0 | 0x00);
await sleep(0.4);

// Key Off
fm.writeAddress(0, 0x28);
fm.writeData(0x00);
await sleep(0.3);
`,
  "fx-loop": `setBpm(120);

fm.setPreset(0, MEGADRIVE_FM_PRESETS["one-op-basic"]);
fm.setPreset(1, MEGADRIVE_FM_PRESETS["two-op-bell"]);

const mainFx = await livePrepare("fx-loop-chain", async ({ fx }) => {
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 2200,
    q: 1.4,
  });
  const delay = fx.delay({
    time: 0.18,
    feedback: 0.32,
    mix: 0.18,
  });
  const reverb = fx.reverb({
    mix: 0.12,
    tone: 6200,
  });

  return {
    filter,
    delay,
    reverb,
  };
});

fx.setChain([
  mainFx.filter,
  mainFx.delay,
  mainFx.reverb,
]);

liveLoop("bass", async () => {
  await nextBeat();
  await play("E2", { channel: 0, duration: 0.12 });
  await beat(1);
  await play("G2", { channel: 0, duration: 0.12 });
  await beat(1);
  await play("A2", { channel: 0, duration: 0.12 });
  await beat(1);
  await play("B2", { channel: 0, duration: 0.12 });
  await beat(1);
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  mainFx.filter.cutoff.set(choose([900, 1400, 2200, 3600, 5200]));
  mainFx.delay.mix.set(choose([0.1, 0.16, 0.22]));
  await play(choose(notes), {
    channel: 1,
    duration: 0.08,
  });
  await beat(0.125);
});
`,
  "fx-motion": `setBpm(120);

fm.setPreset(0, MEGADRIVE_FM_PRESETS["four-op-pad"]);
fm.setPreset(1, MEGADRIVE_FM_PRESETS["two-op-bell"]);

const mainFx = await livePrepare("fx-motion-chain", async ({ fx }) => {
  const gain = fx.gain({
    gain: 0.9,
  });
  const eq = fx.eq({
    bass: 0,
    mid: 0,
    treble: 0,
  });
  const filter = fx.filter({
    type: "lowpass",
    cutoff: 1200,
    q: 1.1,
  });
  const delay = fx.delay({
    time: 0.24,
    feedback: 0.28,
    mix: 0.16,
  });
  const reverb = fx.reverb({
    mix: 0.18,
    tone: 5400,
  });

  return {
    gain,
    eq,
    filter,
    delay,
    reverb,
  };
});

fx.setChain([
  mainFx.gain,
  mainFx.eq,
  mainFx.filter,
  mainFx.delay,
  mainFx.reverb,
]);

liveLoop("pad", async () => {
  await nextBeat();
  await play("E3", { channel: 0, duration: 0.45 });
  await beat(2);
  await play("G3", { channel: 0, duration: 0.45 });
  await beat(2);
});

liveLoop("lead", async () => {
  const notes = scale("E4", "minorPentatonic", 2);
  await play(choose(notes), {
    channel: 1,
    duration: 0.08,
  });
  await beat(0.25);
});

liveLoop("fx-motion", async () => {
  mainFx.eq.bass.rampTo(
    choose([-6, -3, 0, 3, 6]),
    0.18
  );
  mainFx.eq.mid.rampTo(
    choose([-5, -2, 0, 2, 5]),
    0.18
  );
  mainFx.eq.treble.rampTo(
    choose([-6, -2, 0, 3, 7]),
    0.18
  );
  mainFx.filter.cutoff.rampTo(
    choose([800, 1200, 1800, 2600, 4200, 6400]),
    0.18
  );
  mainFx.delay.mix.rampTo(
    choose([0.08, 0.12, 0.18, 0.24]),
    0.12
  );
  mainFx.reverb.mix.set(
    choose([0.1, 0.16, 0.22])
  );
  await beat(0.5);
});
`,
};

const runButton =
  document.getElementById("runButton");
const stopButton =
  document.getElementById("stopButton");
const loadExampleButton =
  document.getElementById(
    "loadExampleButton"
  );
const exampleSelect =
  document.getElementById(
    "exampleSelect"
  );
const editor =
  document.getElementById("editor");
const editorHost =
  document.getElementById(
    "editorHost"
  );
const editorNote =
  document.getElementById(
    "editorNote"
  );
const status =
  document.getElementById("status");
const runtimeState =
  document.getElementById(
    "runtimeState"
  );
const consoleOutput =
  document.getElementById(
    "consoleOutput"
  );
const consoleTab =
  document.getElementById(
    "consoleTab"
  );
const helpersTab =
  document.getElementById(
    "helpersTab"
  );
const operatorTabButton =
  document.getElementById(
    "operatorTabButton"
  );
const consolePanel =
  document.getElementById(
    "consolePanel"
  );
const helpersPanel =
  document.getElementById(
    "helpersPanel"
  );
const operatorPanel =
  document.getElementById(
    "operatorPanel"
  );
const operatorTabRoot =
  document.getElementById(
    "operatorTabRoot"
  );

const megaDrive =
  new MegaDriveSynth({
    workletUrl:
      "../js/ym2612-worklet.js",
    ym2612WasmUrl:
      "../generated/ym2612_wasm.wasm",
  });

let synth = null;
let currentRunToken = 0;
let activeNotes = new Set();
let currentLoopContext = null;
const playgroundRuntime = {
  bpm: 120,
  clockStartTime: null,
  liveLoops: new Map(),
  livePrepared: new Map(),
};
const preparedFxUnits =
  new WeakSet();
let editorAdapter =
  createTextareaEditorAdapter(
    editor
  );
const operatorTab =
  createPlaygroundOperatorTab({
    root: operatorTabRoot,
    presets:
      MEGADRIVE_FM_PRESETS,
    presetOrder:
      MEGADRIVE_FM_PRESET_ORDER,
    onStatus(message) {
      setStatus(message);
    },
  });

function createTextareaEditorAdapter(
  textarea
) {
  return {
    kind: "textarea",
    getValue() {
      return textarea.value;
    },
    setValue(value) {
      textarea.value = value;
    },
    focus() {
      textarea.focus();
    },
  };
}

function setEditorNote(message) {
  if (editorNote) {
    editorNote.textContent =
      message;
  }
}

function getEditorValue() {
  return editorAdapter.getValue();
}

function setEditorValue(value) {
  editorAdapter.setValue(value);
}

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
          )
            .slice(
              0,
              position.column - 1
            );
        const suggestions = [];

        if (
          /\bfx\.$/.test(
            linePrefix
          )
        ) {
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

        if (
          /\bfm\.$/.test(
            linePrefix
          )
        ) {
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
                "setPan(${1:0}, ${2:true}, ${3:true})",
              insertTextRules:
                snippet,
              documentation:
                "Set stereo output enable flags for a channel.",
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

        if (
          /\bpg\.$/.test(
            linePrefix
          )
        ) {
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

declare const fm: {
  reset(): void;
  setPreset(channel: number, preset: object): void;
  setOperator(channel: number, operator: number, params: object): void;
  setAlgo(channel: number, algorithm: number, feedback?: number): void;
  setPan(channel: number, left: boolean, right: boolean): void;
  noteOn(channel: number, block: number, fnum: number): void;
  noteOff(channel: number): void;
  write(port: number, register: number, value: number): void;
  writeAddress(port: number, register: number): void;
  writeData(value: number): void;
  rawWrite(port: number, register: number, value: number): void;
};

declare const fx: {
  gain(options?: object): any;
  eq(options?: object): any;
  filter(options?: object): any;
  delay(options?: object): any;
  reverb(options?: object): any;
  setChain(effects: any[]): void;
  clear(): void;
};

declare function liveLoop(name: string, fn: () => Promise<void> | void): void;
declare function livePrepare(name: string, fn: (context: { fx: typeof fx; fm: typeof fm; log: (...args: unknown[]) => void }) => Promise<any> | any): Promise<any>;
declare function play(note: string, options?: { channel?: number; duration?: number; preset?: object }): Promise<void>;
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
  play: typeof play;
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

async function initializeMonacoEditor() {
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

    editorAdapter = {
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
    };
  } catch (error) {
    console.warn(error);
    setEditorNote(
      "Monaco editor setup failed. Fallback textarea is active."
    );
  }
}

function createFxApi() {
  if (!megaDrive.audioContext) {
    throw new Error(
      "Audio is not ready yet"
    );
  }

  return {
    gain(options = {}) {
      return createGainFX(
        megaDrive.audioContext,
        options
      );
    },

    eq(options = {}) {
      return createEqFX(
        megaDrive.audioContext,
        options
      );
    },

    filter(options = {}) {
      return createFilterFX(
        megaDrive.audioContext,
        options
      );
    },

    delay(options = {}) {
      return createDelayFX(
        megaDrive.audioContext,
        options
      );
    },

    reverb(options = {}) {
      return createReverbFX(
        megaDrive.audioContext,
        options
      );
    },

    setChain(effects = []) {
      megaDrive.setFXChain(
        effects
      );
      return effects;
    },

    clear(options = {}) {
      return megaDrive.clearFXChain(
        options
      );
    },
  };
}

function markPreparedFxUnits(value) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      markPreparedFxUnits(item);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  if (value.input && value.output) {
    preparedFxUnits.add(value);
  }

  for (const nestedValue of Object.values(value)) {
    markPreparedFxUnits(nestedValue);
  }
}

function clearRunFxChain() {
  const previousChain =
    megaDrive.clearFXChain();

  for (const effect of previousChain) {
    if (
      !preparedFxUnits.has(effect)
    ) {
      effect?.dispose?.();
    }
  }
}

async function livePrepare(
  name,
  fn,
  api
) {
  if (
    typeof name !== "string" ||
    name.length === 0
  ) {
    throw new Error(
      "livePrepare(name, fn) requires a non-empty string name"
    );
  }

  if (typeof fn !== "function") {
    throw new Error(
      "livePrepare(name, fn) requires a callback"
    );
  }

  if (
    playgroundRuntime.livePrepared.has(
      name
    )
  ) {
    return playgroundRuntime.livePrepared.get(
      name
    );
  }

  const result =
    await fn(api);
  playgroundRuntime.livePrepared.set(
    name,
    result
  );
  markPreparedFxUnits(result);
  return result;
}

function setStatus(message) {
  status.textContent = message;
}

function setRuntimeState(message) {
  runtimeState.textContent = message;
}

function logLine(message) {
  consoleOutput.textContent += `${message}\n`;
  consoleOutput.scrollTop =
    consoleOutput.scrollHeight;
}

function clearConsole() {
  consoleOutput.textContent = "";
}

function formatLogArgs(args) {
  return args
    .map((value) =>
      typeof value === "string"
        ? value
        : JSON.stringify(value)
    )
    .join(" ");
}

function setBottomTab(tabName) {
  const tabs = [
    {
      name: "console",
      button: consoleTab,
      panel: consolePanel,
    },
    {
      name: "helpers",
      button: helpersTab,
      panel: helpersPanel,
    },
    {
      name: "operator",
      button: operatorTabButton,
      panel: operatorPanel,
    },
  ];

  for (const tab of tabs) {
    const isSelected =
      tab.name === tabName;
    tab.button?.setAttribute(
      "aria-selected",
      isSelected ? "true" : "false"
    );
    if (tab.panel) {
      tab.panel.hidden =
        !isSelected;
    }
  }
}

function moveBottomTabFocus(
  activeTab,
  direction
) {
  const tabs = [
    consoleTab,
    helpersTab,
    operatorTabButton,
  ].filter(Boolean);
  const currentIndex =
    tabs.indexOf(activeTab);

  if (currentIndex === -1) {
    return;
  }

  const nextIndex =
    (currentIndex +
      direction +
      tabs.length) %
    tabs.length;
  tabs[nextIndex]?.focus();
  setBottomTab(
    tabs[nextIndex] === consoleTab
      ? "console"
      : tabs[nextIndex] === helpersTab
        ? "helpers"
        : "operator"
  );
}

function nowSeconds() {
  if (megaDrive.audioContext) {
    return megaDrive.audioContext.currentTime;
  }

  return performance.now() / 1000;
}

function ensureMusicClock() {
  if (
    playgroundRuntime.clockStartTime ===
    null
  ) {
    playgroundRuntime.clockStartTime =
      nowSeconds();
  }
}

function beatsToSeconds(beats) {
  return (
    beats * 60 /
    playgroundRuntime.bpm
  );
}

function currentBeat() {
  ensureMusicClock();
  return (
    (nowSeconds() -
      playgroundRuntime.clockStartTime) /
    beatsToSeconds(1)
  );
}

function resolveWithLoopContext(
  resolve,
  value,
  loopState = null
) {
  currentLoopContext = loopState;
  resolve(value);
}

async function ensureReady() {
  if (synth) {
    await megaDrive.resume();
    setRuntimeState("Audio ready");
    return;
  }

  setStatus(
    "Loading Mega Drive audio..."
  );
  setRuntimeState("Preparing...");
    await megaDrive.start();
    synth = megaDrive.fm;
    operatorTab.attachSynth(synth);
    synth.setPreset(
      0,
      MEGADRIVE_FM_PRESETS[
      "one-op-basic"
    ]
  );
  setRuntimeState("Audio ready");
  setStatus("Audio ready.");
}

function stopAll() {
  if (!synth) {
    return;
  }

  for (let channel = 0; channel < 6; channel += 1) {
    synth.noteOff(channel);
  }
  activeNotes.clear();
}

function parseNoteName(noteName) {
  const match =
    /^([A-G](?:#|b)?)(-?\d+)$/.exec(
      String(noteName).trim()
    );

  if (!match) {
    throw new Error(
      `Unsupported note name: ${noteName}`
    );
  }

  const [, note, octaveText] =
    match;
  const semitone =
    NOTE_TO_SEMITONE[note];

  if (semitone === undefined) {
    throw new Error(
      `Unsupported note: ${note}`
    );
  }

  const octave =
    Number(octaveText);
  return (octave + 1) * 12 + semitone;
}

function toPitch(noteOrMidi) {
  const midi =
    typeof noteOrMidi === "number"
      ? noteOrMidi
      : parseNoteName(noteOrMidi);

  return createPitchFromMidi(midi, {
    referenceMidi:
      REFERENCE_MIDI,
    referenceBlock:
      REFERENCE_BLOCK,
    referenceFnum:
      REFERENCE_FNUM,
  });
}

async function sleep(seconds, runToken = currentRunToken) {
  const loopState =
    currentLoopContext;
  const effectiveToken =
    loopState?.runToken ?? runToken;
  const waitMs =
    Math.max(0, seconds * 1000);

  await new Promise((resolve) => {
    window.setTimeout(() => {
      resolveWithLoopContext(
        resolve,
        undefined,
        loopState
      );
    }, waitMs);
  });

  if (
    loopState?.stopped ||
    effectiveToken !==
      (loopState?.runToken ??
        currentRunToken)
  ) {
    throw new Error("Run stopped");
  }
}

async function waitForBeat(
  targetBeat,
  runToken = currentRunToken,
  loopState = currentLoopContext
) {
  ensureMusicClock();
  const effectiveToken =
    loopState?.runToken ?? runToken;
  const targetTime =
    playgroundRuntime.clockStartTime +
    beatsToSeconds(targetBeat);
  const waitMs =
    Math.max(
      0,
      (targetTime - nowSeconds()) *
        1000
    );

  await new Promise((resolve) => {
    window.setTimeout(() => {
      resolveWithLoopContext(
        resolve,
        undefined,
        loopState
      );
    }, waitMs);
  });

  if (
    loopState?.stopped ||
    effectiveToken !==
      (loopState?.runToken ??
        currentRunToken)
  ) {
    throw new Error("Run stopped");
  }
}

async function beat(
  beats = 1
) {
  const loopState =
    currentLoopContext;

  if (!loopState) {
    await sleep(
      beatsToSeconds(beats)
    );
    return;
  }

  const baseBeat =
    Math.max(
      loopState.cursorBeat,
      currentBeat()
    );
  loopState.cursorBeat =
    baseBeat + beats;
  await waitForBeat(
    loopState.cursorBeat,
    currentRunToken,
    loopState
  );
}

async function nextBeat() {
  const loopState =
    currentLoopContext;

  if (!loopState) {
    const next =
      Math.floor(
        currentBeat() + 0.000001
      ) + 1;
    await waitForBeat(next);
    return;
  }

  const baseBeat =
    Math.max(
      loopState.cursorBeat,
      currentBeat()
    );
  loopState.cursorBeat =
    Math.floor(baseBeat + 0.000001) +
    1;
  await waitForBeat(
    loopState.cursorBeat,
    currentRunToken,
    loopState
  );
}

function setBpm(bpm) {
  const nextBpm =
    Number(bpm);

  if (
    !Number.isFinite(nextBpm) ||
    nextBpm <= 0
  ) {
    throw new Error(
      `Invalid BPM: ${bpm}`
    );
  }

  const beatPosition =
    currentBeat();
  playgroundRuntime.bpm = nextBpm;
  playgroundRuntime.clockStartTime =
    nowSeconds() -
    beatsToSeconds(beatPosition);
}

async function play(
  note,
  options = {}
) {
  if (!synth) {
    throw new Error(
      "Audio is not ready yet"
    );
  }

  const channel =
    options.channel ?? 0;
  const duration =
    options.duration ?? 0.2;
  const presetName =
    options.preset ?? null;

  if (presetName) {
    const preset =
      MEGADRIVE_FM_PRESETS[
        presetName
      ];
    if (!preset) {
      throw new Error(
        `Unknown preset: ${presetName}`
      );
    }
    synth.setPreset(
      channel,
      preset
    );
  }

  const pitch = toPitch(note);
  synth.noteOn(
    channel,
    pitch.block,
    pitch.fnum
  );
  activeNotes.add(channel);

  await sleep(duration);

  synth.noteOff(channel);
  activeNotes.delete(channel);
}

function liveLoop(name, fn, evaluationState) {
  if (
    typeof name !== "string" ||
    name.length === 0
  ) {
    throw new Error(
      "liveLoop(name, fn) requires a non-empty string name"
    );
  }

  if (typeof fn !== "function") {
    throw new Error(
      "liveLoop(name, fn) requires a callback"
    );
  }

  evaluationState.loopDefinitions.set(
    name,
    fn
  );
}

function stopLoop(name) {
  const state =
    playgroundRuntime.liveLoops.get(
      name
    );

  if (!state) {
    return;
  }

  state.stopped = true;
  state.runToken += 1;
}

function stopAllLoops() {
  for (const state of playgroundRuntime.liveLoops.values()) {
    state.stopped = true;
    state.runToken += 1;
  }
}

async function runLiveLoop(state) {
  try {
    while (!state.stopped) {
      state.currentFn = state.nextFn;
      state.cursorBeat = Math.max(
        state.cursorBeat,
        currentBeat()
      );
      currentLoopContext = state;
      await state.currentFn();
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Run stopped"
    ) {
      // no-op
    } else {
      console.error(error);
      logLine(
        `[liveLoop:${state.name}] ${error?.stack ?? String(error)}`
      );
      setStatus(
        `Loop error: ${state.name}`
      );
    }
  } finally {
    if (
      playgroundRuntime.liveLoops.get(
        state.name
      ) === state
    ) {
      playgroundRuntime.liveLoops.delete(
        state.name
      );
    }

    currentLoopContext = null;
  }
}

function commitLiveLoops(
  loopDefinitions
) {
  const activeNames = new Set(
    loopDefinitions.keys()
  );

  for (const [name, state] of playgroundRuntime.liveLoops.entries()) {
    if (!activeNames.has(name)) {
      stopLoop(name);
    }
  }

  for (const [name, fn] of loopDefinitions.entries()) {
    const existing =
      playgroundRuntime.liveLoops.get(
        name
      );

    if (existing) {
      existing.nextFn = fn;
      continue;
    }

    const state = {
      name,
      currentFn: fn,
      nextFn: fn,
      stopped: false,
      runToken: 1,
      cursorBeat: currentBeat(),
    };
    playgroundRuntime.liveLoops.set(
      name,
      state
    );
    void runLiveLoop(state);
  }
}

function scale(
  root,
  name,
  octaves = 1
) {
  const intervals =
    SCALE_INTERVALS[name];

  if (!intervals) {
    throw new Error(
      `Unknown scale: ${name}`
    );
  }

  const rootMidi =
    parseNoteName(root);
  const notes = [];

  for (
    let octave = 0;
    octave < octaves;
    octave += 1
  ) {
    for (const interval of intervals) {
      notes.push(
        midiToNoteName(
          rootMidi +
            octave * 12 +
            interval
        )
      );
    }
  }

  return notes;
}

function choose(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      "choose() requires a non-empty array"
    );
  }

  return values[
    Math.floor(Math.random() * values.length)
  ];
}

function rand() {
  return Math.random();
}

function randInt(min, max) {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return (
    Math.floor(
      Math.random() *
        (high - low + 1)
    ) + low
  );
}

function midiToNoteName(midi) {
  const names = [
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
  const note =
    names[
      ((midi % 12) + 12) % 12
    ];
  const octave =
    Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

async function runCode() {
  currentRunToken += 1;
  const runToken =
    currentRunToken;
  runButton.disabled = true;
  clearConsole();

  try {
    await ensureReady();
    clearRunFxChain();
    setStatus("Running...");
    setRuntimeState("Running");
    const evaluationState = {
      loopDefinitions: new Map(),
    };
    const fx = createFxApi();
    const livePrepareApi = {
      fm: synth,
      fx,
      log: (...args) => {
        logLine(
          formatLogArgs(args)
        );
      },
    };
    const playgroundConsole = {
      log: (...args) => {
        logLine(
          formatLogArgs(args)
        );
      },
      warn: (...args) => {
        logLine(
          `[warn] ${formatLogArgs(args)}`
        );
      },
      error: (...args) => {
        logLine(
          `[error] ${formatLogArgs(args)}`
        );
      },
    };
    const pg = {
      fm: synth,
      fx,
      presets:
        MEGADRIVE_FM_PRESETS,
      livePrepare: (name, fn) =>
        livePrepare(name, fn, livePrepareApi),
      play: (note, options) =>
        play(note, options),
      sleep: (seconds) =>
        sleep(seconds, runToken),
      beat,
      nextBeat,
      setBpm,
      liveLoop: (name, fn) =>
        liveLoop(
          name,
          fn,
          evaluationState
        ),
      stopLoop,
      stopAllLoops,
      stopAll,
      choose,
      rand,
      randInt,
      scale,
      log: (...args) => {
        logLine(
          formatLogArgs(args)
        );
      },
    };

    const api = {
      console:
        playgroundConsole,
      pg,
      fm: synth,
      fx,
      livePrepare: (name, fn) =>
        pg.livePrepare(name, fn),
      play: (note, options) =>
        pg.play(note, options),
      sleep: (seconds) =>
        pg.sleep(seconds),
      beat: pg.beat,
      nextBeat: pg.nextBeat,
      setBpm: pg.setBpm,
      liveLoop: (name, fn) =>
        pg.liveLoop(name, fn),
      stopLoop: pg.stopLoop,
      stopAllLoops: pg.stopAllLoops,
      stopAll: pg.stopAll,
      choose: pg.choose,
      rand: pg.rand,
      randInt: pg.randInt,
      scale: pg.scale,
      MEGADRIVE_FM_PRESETS,
      log: pg.log,
    };

    const AsyncFunction =
      Object.getPrototypeOf(
        async function () {}
      ).constructor;
    const userFunction =
      new AsyncFunction(
        ...Object.keys(api),
        `"use strict";\n${getEditorValue()}`
      );

    await userFunction(
      ...Object.values(api)
    );
    commitLiveLoops(
      evaluationState.loopDefinitions
    );

    if (runToken === currentRunToken) {
      setStatus(
        evaluationState.loopDefinitions.size > 0
          ? `Running ${evaluationState.loopDefinitions.size} live loop(s).`
          : "Done."
      );
      setRuntimeState("Audio ready");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Run stopped"
    ) {
      setStatus("Stopped.");
      setRuntimeState("Audio ready");
    } else {
      console.error(error);
      setStatus(
        `Error: ${error.message}`
      );
      setRuntimeState("Error");
      logLine(
        error?.stack ?? String(error)
      );
    }
  } finally {
    if (runToken === currentRunToken) {
      runButton.disabled = false;
    }
  }
}

function stopRun() {
  currentRunToken += 1;
  stopAllLoops();
  stopAll();
  clearRunFxChain();
  megaDrive.stopRecordingPlayback?.();
  setStatus("Stopped.");
  setRuntimeState("Audio ready");
  runButton.disabled = false;
}

function loadExample() {
  const nextCode =
    EXAMPLES[
      exampleSelect.value
    ] ?? EXAMPLES.single;
  setEditorValue(nextCode);
  setStatus(
    `Loaded example: ${exampleSelect.value}`
  );
}

function decodeBase64Source(
  encodedSource
) {
  if (!encodedSource) {
    return null;
  }

  try {
    const normalized =
      String(encodedSource)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
    const padding =
      normalized.length % 4 === 0
        ? ""
        : "=".repeat(
            4 -
              (normalized.length %
                4)
          );
    const binary = atob(
      normalized + padding
    );
    const bytes =
      Uint8Array.from(
        binary,
        (char) =>
          char.charCodeAt(0)
      );

    return new TextDecoder().decode(
      bytes
    );
  } catch (error) {
    console.warn(error);
    setStatus(
      "Failed to decode ?src=..."
    );
    return null;
  }
}

function applyInitialSourceFromQuery() {
  const params =
    new URLSearchParams(
      window.location.search
    );
  const encodedSource =
    params.get("src");

  if (encodedSource) {
    const decodedSource =
      decodeBase64Source(
        encodedSource
      );

    if (decodedSource !== null) {
      setEditorValue(
        decodedSource
      );
      setStatus(
        "Loaded code from ?src=..."
      );
      return;
    }
  }

  const exampleName =
    params.get("ex");

  if (
    exampleName &&
    EXAMPLES[exampleName]
  ) {
    exampleSelect.value =
      exampleName;
    setEditorValue(
      EXAMPLES[exampleName]
    );
    setStatus(
      `Loaded example from ?ex=${exampleName}`
    );
    return;
  }

  exampleSelect.value =
    "live-loop";
  setEditorValue(
    EXAMPLES["live-loop"]
  );
}

runButton.addEventListener(
  "click",
  () => {
    void runCode();
  }
);

stopButton.addEventListener(
  "click",
  () => {
    stopRun();
  }
);

loadExampleButton.addEventListener(
  "click",
  () => {
    loadExample();
  }
);

consoleTab?.addEventListener(
  "click",
  () => {
    setBottomTab("console");
  }
);

helpersTab?.addEventListener(
  "click",
  () => {
    setBottomTab("helpers");
  }
);

operatorTabButton?.addEventListener(
  "click",
  () => {
    setBottomTab("operator");
  }
);

for (const tabButton of [
  consoleTab,
  helpersTab,
  operatorTabButton,
]) {
  tabButton?.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveBottomTabFocus(
          tabButton,
          1
        );
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveBottomTabFocus(
          tabButton,
          -1
        );
      }
    }
  );
}

applyInitialSourceFromQuery();
clearConsole();
setBottomTab("console");
setRuntimeState("Audio idle");
void initializeMonacoEditor();
