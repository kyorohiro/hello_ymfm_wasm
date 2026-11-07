// Bounded, cycle-addressed SID comparison data. BSD-3-Clause.
// This is a comparison-tool format, not a new browser/runtime API.
import {open} from 'node:fs/promises';

export const SID_TRACE_LIMITS = Object.freeze({
  clockHz: 985248, maximumDurationCycles: 60 * 985248,
  maximumBytes: 32 * 1024 * 1024, maximumWrites: 1_000_000,
  maximumMetadataBytes: 64 * 1024, maximumMetadataDepth: 8,
  maximumMetadataNodes: 4096, maximumMetadataStringBytes: 16 * 1024,
});
const ROOT_KEYS = ['format', 'version', 'clockHz', 'model', 'cyclePhase', 'writeTiming',
  'durationCycles', 'sampleRate', 'engine', 'input', 'writes'];
const fail = message => { throw new TypeError(`SID trace: ${message}`); };
const integer = (value, minimum, maximum, name) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${name} must be an integer ${minimum}..${maximum}`);
  return value;
};
function record(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${name} must be a JSON object`);
  return value;
}
function fields(value, allowed, name, required = allowed) {
  record(value, name);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail(`unknown ${name} field ${String(key)}`);
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property.enumerable || !Object.hasOwn(property, 'value')) fail(`${name}.${key} must be a JSON data property`);
  }
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`missing ${name}.${key}`);
  return value;
}
function jsonMetadata(value) {
  let nodes = 0;
  const active = new Set();
  function clone(item, depth) {
    if (++nodes > SID_TRACE_LIMITS.maximumMetadataNodes) fail('engine metadata has too many values');
    if (depth > SID_TRACE_LIMITS.maximumMetadataDepth) fail('engine metadata is too deeply nested');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail('engine metadata contains a nonfinite number'); return item; }
    if (typeof item === 'string') {
      if (Buffer.byteLength(item, 'utf8') > SID_TRACE_LIMITS.maximumMetadataStringBytes) fail('engine metadata string is too large');
      return item;
    }
    if (!item || typeof item !== 'object') fail('engine metadata must contain JSON values only');
    if (active.has(item)) fail('engine metadata contains a cycle');
    active.add(item);
    let result;
    if (Array.isArray(item)) {
      if (item.length > SID_TRACE_LIMITS.maximumMetadataNodes || Reflect.ownKeys(item).length !== item.length + 1) fail('engine metadata array must be dense JSON data');
      result = Array.from({length: item.length}, (_, index) => {
        const property = Object.getOwnPropertyDescriptor(item, String(index));
        if (!property?.enumerable || !Object.hasOwn(property, 'value')) fail('engine metadata array must be dense JSON data');
        return clone(property.value, depth + 1);
      });
    } else {
      record(item, 'engine metadata');
      result = Object.fromEntries(Reflect.ownKeys(item).map(key => {
        if (typeof key !== 'string' || Buffer.byteLength(key, 'utf8') > SID_TRACE_LIMITS.maximumMetadataStringBytes) fail('engine metadata key is invalid or too large');
        const property = Object.getOwnPropertyDescriptor(item, key);
        if (!property.enumerable || !Object.hasOwn(property, 'value')) fail('engine metadata must contain JSON data properties only');
        return [key, clone(property.value, depth + 1)];
      }));
    }
    active.delete(item);
    return result;
  }
  record(value, 'engine');
  const result = clone(value, 0);
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > SID_TRACE_LIMITS.maximumMetadataBytes) fail('engine metadata exceeds 64 KiB');
  return result;
}

/** Validate the PAL/6581 v1 comparison format and return a detached JSON copy.
 * cycle is the number of completed PHI2 ticks before the write's bus cycle.
 * The write consumes one tick, whose audio uses the previous register value;
 * the byte is committed at the end of that tick. durationCycles is exclusive.
 * Registers 25..31 are retained bus writes, including read-only/reserved slots.
 * Their presence does not claim that the source physical address was unaliased.
 * @param {unknown} value
 */
export function validateSidTrace(value) {
  const trace = fields(value, ROOT_KEYS, 'trace');
  for (const [key, expected] of Object.entries({format: 'tetorica-sid-trace', version: 1,
    clockHz: SID_TRACE_LIMITS.clockHz, model: '6581', cyclePhase: 'phi2', writeTiming: 'tick-then-commit'}))
    if (trace[key] !== expected) fail(`${key} must be ${JSON.stringify(expected)}`);
  const durationCycles = integer(trace.durationCycles, 1, SID_TRACE_LIMITS.maximumDurationCycles, 'durationCycles');
  const sampleRate = integer(trace.sampleRate, 8000, 96000, 'sampleRate');
  const engine = jsonMetadata(trace.engine), input = fields(trace.input, ['sha256', 'subtune'], 'input');
  if (typeof input.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(input.sha256)) fail('input.sha256 must be 64 hexadecimal characters');
  const subtune = integer(input.subtune, 1, 256, 'input.subtune');
  if (!Array.isArray(trace.writes) || trace.writes.length > SID_TRACE_LIMITS.maximumWrites) fail('writes must be an array of at most 1000000 entries');
  if (Reflect.ownKeys(trace.writes).length !== trace.writes.length + 1) fail('writes must be a dense JSON array');
  let previous = -1;
  const writes = Array.from({length: trace.writes.length}, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(trace.writes, String(index));
    if (!property?.enumerable || !Object.hasOwn(property, 'value')) fail('writes must be a dense JSON array');
    const write = fields(property.value, ['cycle', 'register', 'value'], `writes[${index}]`);
    const cycle = integer(write.cycle, 0, durationCycles - 1, `writes[${index}].cycle`);
    if (cycle <= previous) fail('write cycles must be strictly increasing; one bus write per cycle');
    previous = cycle;
    return {cycle, register: integer(write.register, 0, 31, `writes[${index}].register`),
      value: integer(write.value, 0, 255, `writes[${index}].value`)};
  });
  const result = {format: 'tetorica-sid-trace', version: 1, clockHz: SID_TRACE_LIMITS.clockHz,
    model: '6581', cyclePhase: 'phi2', writeTiming: 'tick-then-commit', durationCycles, sampleRate,
    engine, input: {sha256: input.sha256, subtune}, writes};
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > SID_TRACE_LIMITS.maximumBytes) fail('JSON exceeds 32 MiB');
  return result;
}

/** Read a UTF-8 JSON file (path/file URL) or Uint8Array; JSON text is not a path.
 * File input is read in bounded pieces, including if it grows after stat().
 * @param {string|URL|Uint8Array} source
 */
export async function readSidTrace(source) {
  let bytes;
  if (source instanceof Uint8Array) bytes = source;
  else {
    if (!(typeof source === 'string' || (source instanceof URL && source.protocol === 'file:'))) fail('source must be a file path, file URL or Uint8Array');
    const file = await open(source, 'r');
    try {
      if ((await file.stat()).size > SID_TRACE_LIMITS.maximumBytes) fail('JSON exceeds 32 MiB');
      const chunks = []; let length = 0;
      for (;;) {
        const chunk = Buffer.allocUnsafe(Math.min(65536, SID_TRACE_LIMITS.maximumBytes + 1 - length));
        const {bytesRead} = await file.read(chunk, 0, chunk.length, null);
        if (!bytesRead) break;
        length += bytesRead;
        if (length > SID_TRACE_LIMITS.maximumBytes) fail('JSON exceeds 32 MiB');
        chunks.push(chunk.subarray(0, bytesRead));
      }
      bytes = Buffer.concat(chunks, length);
    } finally { await file.close(); }
  }
  if (bytes.byteLength > SID_TRACE_LIMITS.maximumBytes) fail('JSON exceeds 32 MiB');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch (error) { fail(`invalid UTF-8 JSON (${error.message})`); }
  return validateSidTrace(value);
}

/** Encode the bounded native renderer protocol without changing the trace.
 * @param {unknown} value
 * @param {{chunkFrames?:number,dcBlock?:boolean}} [options]
 */
export function encodeSidTraceCommands(value, options = {}) {
  fields(options, ['chunkFrames', 'dcBlock'], 'options', []);
  const chunkFrames = Object.hasOwn(options, 'chunkFrames') ? integer(options.chunkFrames, 1, 8192, 'chunkFrames') : 4096;
  const dcBlock = Object.hasOwn(options, 'dcBlock') ? options.dcBlock : true;
  if (typeof dcBlock !== 'boolean') fail('dcBlock must be a boolean');
  const trace = validateSidTrace(value);
  return [`SIDTRACE 1 ${trace.sampleRate} ${trace.clockHz} ${trace.durationCycles} ${chunkFrames} ${dcBlock ? 1 : 0}`,
    ...trace.writes.map(({cycle, register, value}) => `${cycle} ${register} ${value}`)].join('\n') + '\n';
}
