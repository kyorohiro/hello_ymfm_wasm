import {
  TFI_OPERATOR_FILE_ORDER,
  tfiDetuneToYm2612Detune,
  ym2612DetuneToTfiDetune,
} from "./tfi.js";

export const VGI_FILE_SIZE = 43;

function bytesOf(data) {
  if (typeof data === "string") {
    throw new TypeError("VGI data is binary; read it with file(path, { type: \"arrayBuffer\" })");
  }
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data);
}

function value(name, value, maximum) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}`);
  }
  return value;
}

function operatorFromBytes(bytes, base) {
  return {
    multi: value("multi", bytes[base], 15), dt: tfiDetuneToYm2612Detune(value("detune", bytes[base + 1], 6)),
    tl: value("tl", bytes[base + 2], 127), rs: value("rs", bytes[base + 3], 3),
    ar: value("ar", bytes[base + 4], 31), d1r: value("d1r", bytes[base + 5], 31),
    d2r: value("d2r", bytes[base + 6], 31), rr: value("rr", bytes[base + 7], 15),
    sl: value("sl", bytes[base + 8], 15), ssg: value("ssg", bytes[base + 9], 15),
  };
}

export function parseVgi(data) {
  const bytes = bytesOf(data);
  if (bytes.length !== VGI_FILE_SIZE) throw new Error(`VGI data must be exactly ${VGI_FILE_SIZE} bytes`);
  const preset = { algorithm: value("algorithm", bytes[0], 7), feedback: value("feedback", bytes[1], 7), b4: bytes[2], ams: (bytes[2] >> 4) & 0x03, pms: bytes[2] & 0x07, pan: { left: (bytes[2] & 0x80) !== 0, right: (bytes[2] & 0x40) !== 0 }, operators: [] };
  for (let block = 0; block < TFI_OPERATOR_FILE_ORDER.length; block += 1) {
    preset.operators[TFI_OPERATOR_FILE_ORDER[block]] = operatorFromBytes(bytes, 3 + block * 10);
  }
  return preset;
}

export function createVgiFromPreset(preset) {
  if (!preset || typeof preset !== "object") throw new Error("preset must be an object");
  const bytes = new Uint8Array(VGI_FILE_SIZE);
  bytes[0] = value("algorithm", preset.algorithm ?? 7, 7);
  bytes[1] = value("feedback", preset.feedback ?? 0, 7);
  const pan = preset.pan || {};
  const panBits = (pan.left === undefined ? true : pan.left) ? 0x80 : 0;
  const rightBits = (pan.right === undefined ? true : pan.right) ? 0x40 : 0;
  bytes[2] = value("b4", preset.b4 ?? (panBits | rightBits | ((preset.ams ?? 0) << 4) | (preset.pms ?? 0)), 255);
  const operators = preset.operators || {};
  const oneBased = operators[0] === undefined && operators[1] !== undefined;
  for (let block = 0; block < TFI_OPERATOR_FILE_ORDER.length; block += 1) {
    const logicalOperator = TFI_OPERATOR_FILE_ORDER[block];
    const operator = operators[oneBased ? logicalOperator : logicalOperator - 1] || {};
    const base = 3 + block * 10;
    bytes[base] = value("multi", operator.multi ?? 1, 15);
    bytes[base + 1] = ym2612DetuneToTfiDetune(operator.dt ?? 0);
    bytes[base + 2] = value("tl", operator.tl ?? 127, 127);
    bytes[base + 3] = value("rs", operator.rs ?? 0, 3);
    bytes[base + 4] = value("ar", operator.ar ?? 0, 31);
    bytes[base + 5] = value("d1r", operator.d1r ?? 0, 31);
    bytes[base + 6] = value("d2r", operator.d2r ?? 0, 31);
    bytes[base + 7] = value("rr", operator.rr ?? 15, 15);
    bytes[base + 8] = value("sl", operator.sl ?? 0, 15);
    bytes[base + 9] = value("ssg", operator.ssg ?? 0, 15);
  }
  return bytes;
}
