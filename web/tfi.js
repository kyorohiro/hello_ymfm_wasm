/**
 * One logical YM2612 operator as used by `YM2612Synth`.
 *
 * `sr` is accepted as an alias when exporting because TFI usually calls
 * register `0x70` "sustain rate", while some existing demos in this repository
 * still expose the same register as `d2r`.
 *
 * @typedef {object} TfiOperatorPreset
 * @property {number} [multi]
 * @property {number} [dt]
 * @property {number} [tl]
 * @property {number} [rs]
 * @property {number} [ar]
 * @property {number} [d1r]
 * @property {number} [d2r]
 * @property {number} [sr]
 * @property {number} [rr]
 * @property {number} [sl]
 * @property {number} [ssg]
 */

/**
 * Preset shape shared between `web/tfi.js` and `YM2612Synth.setPreset()`.
 *
 * Operators are exposed in logical order:
 * `0, 1, 2, 3`.
 *
 * @typedef {object} TfiPreset
 * @property {number} algorithm
 * @property {number} feedback
 * @property {[
 *   TfiOperatorPreset?,
 *   TfiOperatorPreset?,
 *   TfiOperatorPreset?,
 *   TfiOperatorPreset?
 * ]} operators
 */

/**
 * Minimal synth-like shape used by `applyTfiToSynth()`.
 *
 * @typedef {object} TfiTargetSynth
 * @property {(channel: number, preset: TfiPreset) => void} setPreset
 */

export const TFI_FILE_SIZE = 42;

// TFI stores operators in YM2612 physical slot order:
// S1, S3, S2, S4
//
// YM2612Synth public API uses logical operators:
// O1, O2, O3, O4
//
// This table converts one TFI operator block index into the synth's
// public logical operator number.
export const TFI_OPERATOR_FILE_ORDER = [0, 2, 1, 3];

const TFI_OPERATOR_SIZE = 10;
const TFI_OPERATOR_DATA_START = 2;

/**
 * Parse a 42-byte TFI file into a logical YM2612 preset.
 *
 * TFI stores operators in physical slot order `S1, S3, S2, S4`.
 * The returned preset converts that into logical operator order `0, 1, 2, 3`.
 *
 * @param {Uint8Array | ArrayBuffer | ArrayLike<number>} data
 * @returns {TfiPreset}
 */
export function parseTfi(data) {
  const bytes = toTfiBytes(data);

  /** @type {TfiPreset} */
  const preset = {
    algorithm: validateRange("algorithm", bytes[0], 0, 7),
    feedback: validateRange("feedback", bytes[1], 0, 7),
    operators: [],
  };

  for (let blockIndex = 0; blockIndex < TFI_OPERATOR_FILE_ORDER.length; blockIndex += 1) {
    const logicalOperator = TFI_OPERATOR_FILE_ORDER[blockIndex];
    const base = TFI_OPERATOR_DATA_START + blockIndex * TFI_OPERATOR_SIZE;

    preset.operators[logicalOperator] = {
      multi: validateRange("multi", bytes[base + 0], 0, 15),
      dt: tfiDetuneToYm2612Detune(bytes[base + 1]),
      tl: validateRange("tl", bytes[base + 2], 0, 127),
      rs: validateRange("rs", bytes[base + 3], 0, 3),
      ar: validateRange("ar", bytes[base + 4], 0, 31),
      d1r: validateRange("d1r", bytes[base + 5], 0, 31),
      d2r: validateRange("d2r", bytes[base + 6], 0, 31),
      rr: validateRange("rr", bytes[base + 7], 0, 15),
      sl: validateRange("sl", bytes[base + 8], 0, 15),
      ssg: validateRange("ssg", bytes[base + 9], 0, 15),
    };
  }

  return preset;
}

/**
 * Parse TFI data and immediately apply it to one synth channel.
 *
 * @param {TfiTargetSynth} synth
 * @param {number} channel
 * @param {Uint8Array | ArrayBuffer | ArrayLike<number>} data
 * @returns {TfiPreset}
 */
export function applyTfiToSynth(synth, channel, data) {
  if (!synth || typeof synth.setPreset !== "function") {
    throw new Error("applyTfiToSynth requires a synth with setPreset(channel, preset)");
  }

  const preset = parseTfi(data);
  synth.setPreset(channel, preset);
  return preset;
}

/**
 * Convert one logical TFI operator block into readable JavaScript object text.
 *
 * The returned text is meant to fit directly into:
 * `fm.setOperator(CH1, OP1, |here|)`
 *
 * @param {TfiOperatorPreset} operator
 * @returns {string}
 */
export function createTfiOperatorObjectText(operator) {
  const normalized = normalizeOperatorPreset(operator);
  return `{ dt: ${normalized.dt}, multi: ${normalized.multi}, tl: ${normalized.tl}, rs: ${normalized.rs}, ar: ${normalized.ar}, d1r: ${normalized.d1r}, d2r: ${normalized.d2r}, sl: ${normalized.sl}, rr: ${normalized.rr}, ssg: ${normalized.ssg} }`;
}

/**
 * Convert a parsed TFI preset into readable JavaScript object text.
 *
 * The returned text is meant to fit directly into:
 * `fm.setPreset(CH1, |here|)`
 *
 * @param {TfiPreset} preset
 * @returns {string}
 */
export function createTfiPresetObjectText(preset) {
  const normalizedPreset = normalizePreset(preset);
  const lines = [
    "{",
    `  algorithm: ${normalizedPreset.algorithm},`,
    `  feedback: ${normalizedPreset.feedback},`,
    "  operators: [",
  ];

  for (let logicalOperator = 0; logicalOperator < 4; logicalOperator += 1) {
    lines.push(
      `    ${createTfiOperatorObjectText(normalizedPreset.operators[logicalOperator])},`
    );
  }

  lines.push("  ],");
  lines.push("}");
  return lines.join("\n");
}

/**
 * Build a 42-byte TFI file from a logical YM2612 preset.
 *
 * The input preset uses logical operator numbers `0, 1, 2, 3`.
 * The produced TFI bytes are written in physical file order `S1, S3, S2, S4`.
 *
 * @param {TfiPreset} preset
 * @returns {Uint8Array}
 */
export function createTfiFromPreset(preset) {
  if (!preset || typeof preset !== "object") {
    throw new Error("preset must be an object");
  }

  const bytes = new Uint8Array(TFI_FILE_SIZE);
  bytes[0] = validateRange("algorithm", preset.algorithm ?? 7, 0, 7);
  bytes[1] = validateRange("feedback", preset.feedback ?? 0, 0, 7);

  for (let blockIndex = 0; blockIndex < TFI_OPERATOR_FILE_ORDER.length; blockIndex += 1) {
    const logicalOperator = TFI_OPERATOR_FILE_ORDER[blockIndex];
    const operator =
      preset.operators?.[logicalOperator] || {};
    const base = TFI_OPERATOR_DATA_START + blockIndex * TFI_OPERATOR_SIZE;

    bytes[base + 0] = validateRange("multi", operator.multi ?? 1, 0, 15);
    bytes[base + 1] = ym2612DetuneToTfiDetune(operator.dt ?? 0);
    bytes[base + 2] = validateRange("tl", operator.tl ?? 127, 0, 127);
    bytes[base + 3] = validateRange("rs", operator.rs ?? 0, 0, 3);
    bytes[base + 4] = validateRange("ar", operator.ar ?? 0, 0, 31);
    bytes[base + 5] = validateRange("d1r", operator.d1r ?? 0, 0, 31);
    bytes[base + 6] = validateRange(
      "d2r",
      operator.sr ?? operator.d2r ?? 0,
      0,
      31
    );
    bytes[base + 7] = validateRange("rr", operator.rr ?? 15, 0, 15);
    bytes[base + 8] = validateRange("sl", operator.sl ?? 0, 0, 15);
    bytes[base + 9] = validateRange("ssg", operator.ssg ?? 0, 0, 15);
  }

  return bytes;
}

/**
 * Convert a TFI detune value into the YM2612 register encoding.
 *
 * TFI detune values are stored as:
 * `0=-3, 1=-2, 2=-1, 3=0, 4=+1, 5=+2, 6=+3`.
 *
 * @param {number} tfiDetune
 * @returns {number}
 */
export function tfiDetuneToYm2612Detune(tfiDetune) {
  const detune = validateRange("detune", tfiDetune, 0, 6);
  const table = [7, 6, 5, 0, 1, 2, 3];
  return table[detune];
}

/**
 * Convert a YM2612 register detune value into the TFI detune encoding.
 *
 * @param {number} ym2612Detune
 * @returns {number}
 */
export function ym2612DetuneToTfiDetune(ym2612Detune) {
  const detune = validateRange("dt", ym2612Detune, 0, 7);
  const table = [3, 4, 5, 6, 3, 2, 1, 0];
  return table[detune];
}

/**
 * Normalize unknown byte-like input into a real `Uint8Array`.
 *
 * @param {Uint8Array | ArrayBuffer | ArrayLike<number>} data
 * @returns {Uint8Array}
 */
function toTfiBytes(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length !== TFI_FILE_SIZE) {
    throw new Error(`TFI data must be exactly ${TFI_FILE_SIZE} bytes`);
  }
  return bytes;
}

/**
 * @param {TfiPreset} preset
 * @returns {TfiPreset}
 */
function normalizePreset(preset) {
  if (!preset || typeof preset !== "object") {
    throw new Error("preset must be an object");
  }

  return {
    algorithm: validateRange("algorithm", preset.algorithm ?? 7, 0, 7),
    feedback: validateRange("feedback", preset.feedback ?? 0, 0, 7),
    operators: [
      normalizeOperatorPreset(
        preset.operators?.[0]
      ),
      normalizeOperatorPreset(
        preset.operators?.[1]
      ),
      normalizeOperatorPreset(
        preset.operators?.[2]
      ),
      normalizeOperatorPreset(
        preset.operators?.[3]
      ),
    ],
  };
}

/**
 * @param {TfiOperatorPreset | undefined} operator
 * @returns {Required<TfiOperatorPreset>}
 */
function normalizeOperatorPreset(operator) {
  const source = operator && typeof operator === "object" ? operator : {};

  return {
    multi: validateRange("multi", source.multi ?? 1, 0, 15),
    dt: validateRange("dt", source.dt ?? 0, 0, 7),
    tl: validateRange("tl", source.tl ?? 127, 0, 127),
    rs: validateRange("rs", source.rs ?? 0, 0, 3),
    ar: validateRange("ar", source.ar ?? 0, 0, 31),
    d1r: validateRange("d1r", source.d1r ?? 0, 0, 31),
    d2r: validateRange("d2r", source.sr ?? source.d2r ?? 0, 0, 31),
    rr: validateRange("rr", source.rr ?? 15, 0, 15),
    sl: validateRange("sl", source.sl ?? 0, 0, 15),
    ssg: validateRange("ssg", source.ssg ?? 0, 0, 15),
  };
}

/**
 * Validate an integer field against an inclusive range.
 *
 * @param {string} name
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function validateRange(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in range ${min}..${max}`);
  }
  return value;
}
