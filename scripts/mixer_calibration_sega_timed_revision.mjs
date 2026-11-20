/** Exact shared Sega PSG / OPLL timed-API promotion. Historical measurements
 * retain their original source identities and gains. Only the complete reviewed
 * predecessor can be reconstructed, with fresh muted matrices and PCM parity. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = new URL('../', import.meta.url);
export const SEGA_TIMED_REVISION_BASE_COMMIT = '24bbdeaf7eb03a44766f291d6998818213c18dc5';
export const SEGA_TIMED_REVISION_RECEIPT = 'docs/issues/sega_timed_source_revision_01.json';
export const SEGA_TIMED_REVISION_PIN = '6c6cac9c93fedd6f74cb0856b61dc4b584f0a48081e070b7a96b910d867f071f';
const runtimeNames = Object.freeze([
  'native_genesis_extra_ym2413.js', 'native_genesis_opll.js', 'native_genesis_segapsg.js',
  'playground_performance_sender.js', 'playground_segapsg.js', 'playground_segapsg_worklet.js',
  'playground_ym2413.js', 'playground_ym2413_worklet.js',
]);
export const SEGA_TIMED_REVISION_PATHS = Object.freeze([
  ...runtimeNames.flatMap(name => ['tetorica_src/runtime/' + name, 'docs/js/' + name]),
  'docs/playground/playground_monaco_definitions.js', 'docs/playground/tetorica-playground-globals.d.ts',
  ...['audio.js', 'code_declarations.js',
    ...['psg', 'opll'].flatMap(chip => ['operations', 'timed_client', 'timed_processor', 'timed_state', 'worklet'].map(part => chip + '_' + part + '.js'))]
    .map(name => 'docs/synth-smsgear/' + name),
]);
const kinds = Object.freeze(['ps1', 'wonderswan', 'pokey', 'scsp']);
export const SEGA_TIMED_REVISION_REPORTS = Object.freeze(kinds.flatMap(kind =>
  [false, true].map(verify => `docs/issues/${kind}_sega_timed_chip_levels${verify ? '_verify' : ''}_01.json`)));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => value && Number.isSafeInteger(value.bytes) && value.bytes > 0 && /^[a-f0-9]{64}$/.test(value.sha256);
const matches = (bytes, expected) => record(expected) && bytes.length === expected.bytes && digest(bytes) === expected.sha256;
const keys = (object, names) => object && typeof object === 'object' && !Array.isArray(object) &&
  Object.keys(object).length === names.length && names.every(name => Object.hasOwn(object, name));
const fail = message => {throw Error('Sega timed calibration revision changed; remeasure: ' + message);};
const readDefault = name => readFileSync(new URL(name, root));

function sourceName(path) {
  if (typeof path !== 'string') return path;
  if (path.startsWith('web/')) return 'tetorica_src/runtime/' + path.slice(4);
  if (/^(?:js|playground|synth-smsgear)\//.test(path)) return 'docs/' + path;
  return path;
}

function evidence(read) {
  const receipt = JSON.parse(read(SEGA_TIMED_REVISION_RECEIPT));
  if (digest(JSON.stringify(receipt)) !== SEGA_TIMED_REVISION_PIN || receipt.schemaVersion !== 1 ||
      receipt.scope !== 'shared-sega-timed-api-default-pcm-parity' || receipt.baseCommit !== SEGA_TIMED_REVISION_BASE_COMMIT ||
      !keys(receipt.sources, SEGA_TIMED_REVISION_PATHS) || !receipt.dependencies || typeof receipt.dependencies !== 'object') fail('receipt');
  for (const name of SEGA_TIMED_REVISION_PATHS) {
    const entry = receipt.sources[name];
    if (!record(entry?.before) || !record(entry.after) || typeof entry.before.base64 !== 'string') fail('predecessor pair: ' + name);
  }
  return receipt;
}

function validatePcmProof(receipt, read) {
  const proof = JSON.parse(read('docs/issues/sega_timed_default_pcm_01.json'));
  if (proof.schemaVersion !== 1 || proof.scope !== 'sega-timed-api-default-worklet-pcm' ||
      proof.baseCommit !== SEGA_TIMED_REVISION_BASE_COMMIT || proof.passed !== true ||
      proof.physicalAudio !== false || proof.audioContextCreated !== false || proof.maximumDifference !== 0 ||
      proof.cases?.length !== 456 || proof.totalStereoFrames !== 1867776) fail('default PCM parity coverage');
  for (const chip of ['segapsg', 'ym2413']) {
    const path = `tetorica_src/runtime/playground_${chip}_worklet.js`, pair = proof.sources?.[path], source = receipt.sources[path];
    if (!pair || !keys(pair, ['before', 'after']) || pair.before.bytes !== source.before.bytes ||
        pair.before.sha256 !== source.before.sha256 || JSON.stringify(pair.after) !== JSON.stringify(source.after)) fail('default PCM source: ' + path);
    for (const rate of [22050, 44100, 48000, 96000]) for (const clock of [3579545, 4000000]) {
      const cases = proof.cases.filter(row => row.chip === chip && row.rate === rate && row.clock === clock);
      if (cases.length !== (chip === 'segapsg' ? 22 : 35) || new Set(cases.map(row => row.scene)).size !== cases.length ||
          cases.some(row => row.maximumDifference !== 0 || row.frames !== 4096 || !/^[a-f0-9]{64}$/.test(row.pcmSha256))) fail('default PCM cases');
    }
  }
}

function validateCapture(capture, name) {
  if (!capture || capture.physicalOutputMuted !== true || capture.pilot?.continuous !== true ||
      !Array.isArray(capture.processorErrors) || capture.processorErrors.length || capture.channels?.length !== 2 ||
      capture.channels.some(channel => channel.nonfinite !== 0 || channel.overrange !== 0)) fail('muted finite continuous capture: ' + name);
}

function validateEvidence(receipt, read) {
  for (const name of SEGA_TIMED_REVISION_PATHS) if (!matches(read(name), receipt.sources[name].after)) fail(name);
  for (const [name, expected] of Object.entries(receipt.dependencies)) if (!matches(read(name), expected)) fail(name);
  validatePcmProof(receipt, read);
  for (const file of SEGA_TIMED_REVISION_REPORTS) {
    const report = JSON.parse(read(file)), kind = kinds.find(kind => file.startsWith(`docs/issues/${kind}_`)), verify = file.includes('_verify_');
    if (!report.passed || report.verify !== verify || report.completeCoverage !== true || report.physicalOutputMuted !== true ||
        report.listeningPerformed !== false || report.pcmContinuous !== true || report.rows?.length !== (kind === 'pokey' ? 96 : 48) ||
        report.anchors?.length !== 8 || !report.sources || typeof report.sources !== 'object' ||
        Array.isArray(report.sources) || Object.keys(report.sources).length < 300) fail('complete muted matrix: ' + file);
    if (JSON.stringify(report.engines) !== JSON.stringify(['chromium', 'webkit']) ||
        JSON.stringify(report.sampleRates) !== JSON.stringify([44100, 48000]) ||
        JSON.stringify(report.executions) !== JSON.stringify(['main', 'worker']) ||
        JSON.stringify(report.frequencies) !== JSON.stringify([220, 440, 880])) fail('matrix dimensions: ' + file);
    const roles = kind === 'pokey' ? ['primary', 'dual-first', 'dual-second', 'extra'] : ['primary', 'extra'];
    if (JSON.stringify(report.roles) !== JSON.stringify(roles) ||
        new Set(report.rows.map(row => [row.engine, row.requestedSampleRate, row.execution, row.role, row.frequencyHz].join('/'))).size !== report.rows.length) fail('matrix route coverage: ' + file);
    for (const [path, expected] of Object.entries(report.sources)) if (!matches(read('docs/' + path), expected)) fail('served source: ' + path);
    const rows = [...report.rows, ...report.anchors, ...(report.psgAnchors ?? [])];
    for (const row of rows) {
      if (row.actualSampleRate !== row.requestedSampleRate) fail('actual sample rate: ' + file);
      validateCapture(row.pcm, file); validateCapture(row.stopped, file);
      if (row.stopped.channels.some(channel => channel.nonzero !== 0)) fail('Stop silence: ' + file);
    }
    if (kind === 'pokey') {
      if (report.psgAnchors?.length !== 8 || report.dualChecks?.length !== 8) fail('POKEY anchor and dual coverage');
      for (const row of report.dualChecks) {
        validateCapture(row.split?.pcm, file); validateCapture(row.sum?.pcm, file); validateCapture(row.stopped, file);
        if (row.stopped.channels.some(channel => channel.nonzero !== 0)) fail('POKEY dual Stop silence');
      }
    }
    const policy = JSON.parse(read(`docs/issues/${kind}_ws_timed_chip_levels_01.json`)).calibration;
    if (report.calibration?.targetAmplitude !== policy.targetAmplitude || report.calibration.targetChanged !== false ||
        (verify && JSON.stringify(report.calibration) !== JSON.stringify(policy))) fail('retained measured policy: ' + kind);
  }
}

function restorer(read, snapshot = false) {
  let receipt, verified = false;
  return (path, bytes) => {
    const name = sourceName(path);
    if (!SEGA_TIMED_REVISION_PATHS.includes(name)) return bytes;
    receipt = snapshot ? receipt ?? evidence(read) : evidence(read);
    const entry = receipt.sources[name];
    // Earlier historical inputs and unknown future bytes gain no normalization.
    // The caller still requires an exact match with its measured source hash.
    if (!matches(bytes, entry.after)) return bytes;
    if (!verified) {validateEvidence(receipt, read); verified = snapshot;}
    const before = Buffer.from(entry.before.base64, 'base64');
    if (!matches(before, entry.before)) fail('predecessor: ' + name);
    return before;
  };
}

/** Restore exact reviewed predecessor bytes without relabelling a report. */
export function restoreMixerCalibrationSegaTimedRevision(path, bytes, {read = readDefault} = {}) {
  return restorer(read)(path, bytes);
}

/** Nested older guards consume the same authenticated predecessor snapshot. */
export function createSegaTimedRevisionReadContext(readSource = url => readFileSync(url)) {
  const originals = new Map(), predecessors = new Map();
  const read = name => {
    if (!originals.has(name)) originals.set(name, Buffer.from(readSource(new URL(name, root))));
    return originals.get(name);
  };
  const restore = restorer(read, true);
  const reader = url => {
    if (!(url instanceof URL) || url.protocol !== 'file:') return readSource(url);
    const name = relative(fileURLToPath(root), fileURLToPath(url)).replaceAll('\\', '/');
    if (!predecessors.has(name)) predecessors.set(name, restore(name, read(name)));
    return predecessors.get(name);
  };
  return {restore, readSource: reader};
}
