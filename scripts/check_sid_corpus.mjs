// SPDX-License-Identifier: BSD-3-Clause
// Optional local-corpus audit. No audio device, music copy, PCM file or ROM dump.
import {open, readdir, readFile, mkdir, writeFile, lstat, truncate, realpath, unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {basename, dirname, relative, resolve, sep, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {validateBrowserPsid, PSID_MAX_FILE_BYTES} from '../docs/js/sid_psid.js';
import {validateBrowserRsid} from '../docs/js/sid_rsid.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const WORKER = new URL('./sid_corpus_worker.mjs', import.meta.url);
const WASM = {vbi: resolve(REPO, 'docs/generated/sid-player/sid-player.wasm'), c64: resolve(REPO, 'docs/generated/sid-rsid/sid-rsid.wasm')};
const SOURCE_FILES = [
  'scripts/check_sid_corpus.mjs', 'scripts/sid_corpus_worker.mjs',
  'docs/sid-player/core.js', 'docs/sid-player/rsid_core.js', 'docs/sid-player/roms.js',
  'docs/js/sid_psid.js', 'docs/js/sid_rsid.js',
  'tetorica_src/runtime/sid_psid.js', 'tetorica_src/runtime/sid_rsid.js',
  'docs/generated/sid-player/sid-player-build.json', 'docs/generated/sid-rsid/sid-rsid-build.json',
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digestJson = value => sha256(JSON.stringify(value));
const integer = (value, min, max, label) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer ${min}..${max}`);
  return value;
};
const count = (object, key) => {object[key] = (object[key] ?? 0) + 1;};
const sorted = object => Object.fromEntries(Object.entries(object).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
const abortError = () => new DOMException('SID corpus audit interrupted; completed rows were checkpointed', 'AbortError');

async function* files(directory) {
  const entries = (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile() && /\.sid$/i.test(entry.name)) yield path;
    // Symlinks, including linked directories, are never followed.
  }
}

async function selectedPaths(directory, selection) {
  if (selection === undefined) return null;
  let values = selection;
  if (typeof selection === 'string') {
    const file = await open(selection, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error('Path list must be a regular JSON file at most 16 MiB');
      values = JSON.parse(await file.readFile('utf8'));
    } finally {await file.close();}
  }
  if (!Array.isArray(values) || !values.length || values.length > 100000) throw new TypeError('paths must be a nonempty JSON array of at most 100000 relative SID paths');
  const unique = new Set();
  for (const path of values) {
    if (typeof path !== 'string' || !path || path.length > 1024 || isAbsolute(path) || /^[A-Za-z]:/.test(path)
      || path.includes('\\') || path.includes('\0') || !/\.sid$/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..'))
      throw new Error('Path list entries must be relative .sid paths without traversal');
    if (unique.has(path)) throw new Error(`Duplicate path list entry: ${path}`);
    unique.add(path);
    let current = directory;
    for (const part of path.split('/')) {
      current = resolve(current, part);
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Path list must not follow symlinks: ${path}`);
    }
    if (!(await lstat(current)).isFile()) throw new Error(`Path list entry is not a regular SID file: ${path}`);
  }
  return [...unique].sort();
}

function header(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = at => bytes.length >= at + 2 ? view.getUint16(at) : null;
  const flags = word(118), version = word(4);
  const text = at => new TextDecoder('windows-1252').decode(bytes.subarray(at, Math.min(at + 32, bytes.length))).split('\0')[0];
  return {format: String.fromCharCode(...bytes.subarray(0, 4)), version, songs: word(14), startSong: word(16), flags,
    clock: flags === null || version < 2 ? 'unknown' : ['unknown', 'pal', 'ntsc', 'any'][(flags >>> 2) & 3],
    model: flags === null || version < 2 ? 'unknown' : ['unknown', '6581', '8580', 'any'][(flags >>> 4) & 3],
    metadata: {name: text(22), author: text(54), released: text(86)}};
}

async function input(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat({bigint: true});
    if (!before.isFile()) throw new Error('Corpus entry is no longer a regular file');
    const oversized = before.size > BigInt(PSID_MAX_FILE_BYTES), buffer = Buffer.alloc(oversized ? 124 : PSID_MAX_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {const result = await file.read(buffer, length, buffer.length - length, null); if (!result.bytesRead) break; length += result.bytesRead;}
    const after = await file.stat({bigint: true});
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ino !== after.ino) throw new Error('Corpus entry changed while being read');
    const bytes = buffer.subarray(0, length);
    if (!oversized && BigInt(length) !== before.size) throw new Error('Corpus entry length changed while being read');
    return {bytes, identity: `${before.dev}:${before.ino}`, signature: {bytes: Number(before.size), sha256: oversized ? null : sha256(bytes),
      ...(oversized ? {headerSha256: sha256(bytes), hashScope: 'bounded-header-only-oversize', mtimeNs: String(before.mtimeNs)} : {})}, header: header(bytes), oversized};
  } finally {await file.close();}
}

export async function corpusFingerprint({policy, extraSourceFiles = []} = {}) {
  const sources = [];
  const paths = new Set(SOURCE_FILES.map(path => resolve(REPO, path))), receipts = {};
  for (const [key, path] of Object.entries(WASM)) {
    const receipt = JSON.parse(await readFile(resolve(dirname(path), key === 'vbi' ? 'sid-player-build.json' : 'sid-rsid-build.json'), 'utf8'));
    receipts[key] = receipt;
    for (const [name, expected] of Object.entries(receipt.inputs)) {
      const absolute = resolve(REPO, name), bytes = await readFile(absolute);
      if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error(`Native build receipt input changed: ${name}`);
      paths.add(absolute);
    }
  }
  for (const path of [...paths, ...extraSourceFiles.map(path => resolve(path))]) {
    const bytes = await readFile(path);
    sources.push({path: relative(REPO, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes)});
  }
  const wasm = {};
  for (const [key, path] of Object.entries(WASM)) {
    const bytes = await readFile(path); wasm[key] = {bytes: bytes.length, sha256: sha256(bytes)};
    if (wasm[key].bytes !== receipts[key].output.bytes || wasm[key].sha256 !== receipts[key].output.sha256) throw new Error(`Native build receipt WASM changed: ${key}`);
  }
  return {policy, sources, wasm, sha256: digestJson({policy, sources, wasm})};
}

function metadataResult(item, error) {
  const code = error.code ?? null, message = String(error.message ?? error);
  const status = /ROM_REQUIRED$/.test(code ?? '') ? 'needs_rom'
    : /_UNSUPPORTED$/.test(code ?? '') ? 'unsupported' : 'invalid';
  return {type: 'result', index: item.index, path: item.path, input: item.input, header: item.header,
    status, stage: 'metadata', error: {code, message, address: null, phase: 'metadata'}};
}

async function checkpointRows(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Checkpoint must be a regular file');
  if (stat.size > 256 * 1024 * 1024) throw new Error('Checkpoint exceeds the 256-MiB audit bound');
  const bytes = await readFile(path), lastNewline = bytes.lastIndexOf(10);
  if (lastNewline < 0) throw new Error('Checkpoint has no complete header');
  const lines = bytes.subarray(0, lastNewline + 1).toString('utf8').split('\n'); lines.pop();
  const rows = lines.map((line, index) => {try {return JSON.parse(line);} catch {throw new Error(`Invalid checkpoint JSON at line ${index + 1}`);}});
  return {rows, completeBytes: lastNewline + 1, discardedTailBytes: bytes.length - lastNewline - 1};
}

function createRunner({workers, timeoutMs, signal}) {
  const slots = Array.from({length: workers}, () => ({worker: null, jobs: 0})), terminations = [];
  let nextId = 0;
  function close(slot) {if (slot.worker) {terminations.push(slot.worker.terminate()); slot.worker = null; slot.jobs = 0;}}
  async function run(slot, job) {
    if (signal?.aborted) throw abortError();
    if (!slot.worker) {
      const worker = new Worker(WORKER, {workerData: {wasm: WASM}, resourceLimits: {maxOldGenerationSizeMb: 128}});
      slot.worker = worker;
      // Idle-thread failures must not become an unhandled EventEmitter error.
      const retired = () => {if (slot.worker === worker) {slot.worker = null; slot.jobs = 0;}};
      worker.on('error', retired); worker.on('exit', retired);
    }
    const worker = slot.worker, id = ++nextId;
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {clearTimeout(timer); worker.off('message', message); worker.off('error', failed); worker.off('exit', exited); signal?.removeEventListener('abort', cancelled);};
      const finish = value => {cleanup(); resolve(value);};
      const failed = error => {close(slot); finish({status: 'runtime_failed', stage: 'worker', error: {code: 'WORKER_ERROR', message: error.message, address: null, phase: 'worker'}});};
      const exited = code => {close(slot); finish({status: 'runtime_failed', stage: 'worker', error: {code: 'WORKER_EXIT', message: `Execution worker exited (${code})`, address: null, phase: 'worker'}});};
      const message = value => {if (value.id === id) {delete value.id; cleanup(); if (++slot.jobs >= 64) close(slot); resolve(value);}};
      const cancelled = () => {cleanup(); close(slot); reject(abortError());};
      worker.on('message', message); worker.once('error', failed); worker.once('exit', exited); signal?.addEventListener('abort', cancelled, {once: true});
      timer = setTimeout(() => {close(slot); finish({status: 'runtime_failed', stage: 'worker', error: {code: 'WORKER_TIMEOUT', message: `Per-file execution exceeded ${timeoutMs} ms`, address: null, phase: 'worker'}});}, timeoutMs);
      worker.postMessage({...job, id});
    });
  }
  return {slots, run, async dispose() {for (const slot of slots) close(slot); await Promise.allSettled(terminations);}};
}

async function outputPath(path, corpus) {
  const absolute = resolve(path), parts = [];
  let ancestor = absolute;
  for (;;) {
    try {await lstat(ancestor); break;}
    catch (error) {if (error.code !== 'ENOENT') throw error; parts.unshift(basename(ancestor)); ancestor = dirname(ancestor);}
  }
  const canonical = resolve(await realpath(ancestor), ...parts), inside = relative(corpus, canonical);
  if (!inside || inside !== '..' && !inside.startsWith(`..${sep}`) && !inside.startsWith(sep)) throw new Error('Audit output paths must stay outside the read-only corpus');
  try {if ((await lstat(absolute)).isSymbolicLink()) throw new Error('Audit output must not be a symlink');} catch (error) {if (error.code !== 'ENOENT') throw error;}
  return canonical;
}

/** Metadata for every file, execution for the header's default subtune only.
 * Silence is measured, not labeled broken. extraSourceFiles is fingerprint-only.
 */
async function auditSidCorpusUnlocked({root, checkpoint, out, seconds = 2, sampleRate = 48000,
  workers = 2, timeoutMs = 15000, resume = false, signal, onProgress = () => {}, extraSourceFiles = [], paths, vbiBackend = 'c64'} = {}) {
  if (typeof root !== 'string' || !root || typeof checkpoint !== 'string' || !checkpoint) throw new TypeError('Explicit root and checkpoint paths are required');
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) throw new RangeError('seconds must be greater than 0 and at most 60');
  integer(sampleRate, 8000, 96000, 'sampleRate'); integer(workers, 1, 16, 'workers'); integer(timeoutMs, 100, 300000, 'timeoutMs');
  if (!['c64', 'direct'].includes(vbiBackend)) throw new RangeError('vbiBackend must be c64 or direct');
  const requestedRoot = resolve(root), rootStat = await lstat(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Corpus root must be a real directory, not a symlink');
  const directory = await realpath(requestedRoot), destination = await outputPath(checkpoint, directory);
  const manifestPath = `${destination}.inputs.json`, output = out ? await outputPath(out, directory) : null;
  if (output && [destination, manifestPath, `${destination}.lock`].includes(output)) throw new Error('Summary, checkpoint, lock and input manifest must have different paths');
  await outputPath(manifestPath, directory);
  const listedPaths = await selectedPaths(directory, paths);
  const policy = {version: 2, seconds, sampleRate, frames: Math.round(seconds * sampleRate), timeoutMs, vbiBackend,
    pathSelection: listedPaths ? {kind: 'listed-paths', count: listedPaths.length, sha256: digestJson(listedPaths)} : {kind: 'all-sid-files'},
    psidInitValidation: 'first-window PCM retained; pending init drained separately until RTS or native deadline',
    subtunes: 'header-default-only', target: {clock: 'pal', model: '6581', unknownOrEither: 'explicit-choice', knownNtscOr8580: 'reject'},
    environment: 'minimal', maxFileBytes: PSID_MAX_FILE_BYTES, fileOrder: 'case-sensitive-codepoint-path',
    followSymlinks: false, silence: 'exact-zero; not a compatibility verdict', stopFrames: 128, workerRetireAfterFiles: 64,
    oversizedHash: 'size+mtimeNs+bounded-header; no payload read or execution'};
  const fingerprint = await corpusFingerprint({policy, extraSourceFiles}), inventory = [];
  const candidates = listedPaths ? listedPaths.map(path => resolve(directory, path)) : files(directory);
  for await (const absolute of candidates) {
    if (signal?.aborted) throw abortError();
    const entry = await input(absolute);
    inventory.push({index: inventory.length, path: relative(directory, absolute).replaceAll('\\', '/'), absolute,
      input: entry.signature, header: entry.header, oversized: entry.oversized, identity: entry.identity});
  }
  const outputIdentities = new Set();
  for (const path of [destination, manifestPath, output].filter(Boolean)) {
    try {
      const stat = await lstat(path, {bigint: true});
      if (!stat.isFile() || inventory.some(item => item.identity === `${stat.dev}:${stat.ino}`)) throw new Error('Audit output must be a regular file distinct from every corpus input');
      const identity = `${stat.dev}:${stat.ino}`;
      if (outputIdentities.has(identity)) throw new Error('Audit outputs must not be hard-linked aliases');
      outputIdentities.add(identity);
    } catch (error) {if (error.code !== 'ENOENT') throw error;}
  }
  const inputManifest = inventory.map(({index, path, input}) => ({index, path, input}));
  const manifestSha256 = digestJson(inputManifest), headerRow = {type: 'header', format: 'tetorica-sid-corpus-checkpoint', version: 1,
    root: directory, fingerprint, inputManifestSha256: manifestSha256, inputCount: inventory.length};
  const completed = new Map(); let discardedTailBytes = 0, recoveredLength = null;
  await mkdir(dirname(destination), {recursive: true});
  if (resume) {
    const old = await checkpointRows(destination); discardedTailBytes = old.discardedTailBytes;
    const first = old.rows.shift();
    if (JSON.stringify(first) !== JSON.stringify(headerRow)) throw new Error('Checkpoint policy/source/WASM/input manifest differs; use a new checkpoint for changed inputs');
    for (const row of old.rows) {
      const item = inventory[row.index];
      if (row.type !== 'result' || !item || row.path !== item.path || JSON.stringify(row.input) !== JSON.stringify(item.input) || completed.has(row.index)) throw new Error('Checkpoint result does not match the input manifest');
      completed.set(row.index, row);
    }
    if (discardedTailBytes) recoveredLength = old.completeBytes;
  } else {
    const file = await open(destination, 'wx');
    try {await file.writeFile(`${JSON.stringify(headerRow)}\n`); await file.sync();} finally {await file.close();}
  }
  const manifestText = `${JSON.stringify({format: 'tetorica-sid-corpus-inputs', version: 1, root: directory, sha256: manifestSha256, inputs: inputManifest}, null, 2)}\n`;
  if (resume) {
    if (await readFile(manifestPath, 'utf8') !== manifestText) throw new Error('Checkpoint input manifest sidecar differs');
  } else await writeFile(manifestPath, manifestText, {flag: 'wx'});
  if (recoveredLength !== null) await truncate(destination, recoveredLength);
  const controller = new AbortController(), cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once: true}); if (signal?.aborted) cancel();
  const file = await open(destination, 'a'), runner = createRunner({workers, timeoutMs, signal: controller.signal});
  let cursor = 0, interrupted = false, writeQueue = Promise.resolve(), newResults = 0;
  const save = row => {
    completed.set(row.index, row); newResults++;
    writeQueue = writeQueue.then(async () => {await file.write(`${JSON.stringify(row)}\n`); await file.sync(); onProgress({completed: completed.size, total: inventory.length, path: row.path, status: row.status});});
    return writeQueue;
  };
  const started = Date.now();
  try {
    const outcomes = await Promise.allSettled(runner.slots.map(async slot => {
      try {while (cursor < inventory.length && !controller.signal.aborted) {
        const item = inventory[cursor++]; if (completed.has(item.index)) continue;
        const entry = await input(item.absolute);
        if (JSON.stringify(entry.signature) !== JSON.stringify(item.input)) throw new Error(`Corpus input changed since inventory: ${item.path}`);
        let parsed;
        try {
          if (entry.oversized) {const error = new Error(`SID file exceeds ${PSID_MAX_FILE_BYTES} bytes`); error.code = 'SID_LIMIT'; throw error;}
          parsed = entry.header.format === 'RSID'
            ? validateBrowserRsid(entry.bytes, {clock: 'pal', model: '6581', environment: 'minimal'})
            : validateBrowserPsid(entry.bytes, {clock: 'pal', model: '6581', vbiBackend});
        } catch (error) {await save(metadataResult(item, error)); continue;}
        const backend = parsed.format === 'RSID' ? 'rsid' : parsed.timing === 'cia' ? 'cia' : parsed.playbackBackend === 'c64' ? 'vbi-c64' : 'vbi';
        const options = {subtune: parsed.subtune, clock: 'pal', model: '6581', vbiBackend, ...(backend === 'vbi' ? {} : {environment: 'minimal'})};
        const result = await runner.run(slot, {bytes: entry.bytes, backend, options, sampleRate, frames: policy.frames});
        await save({type: 'result', index: item.index, path: item.path, input: item.input, header: item.header,
          selection: {subtune: parsed.subtune, timing: parsed.timing, playbackBackend: parsed.playbackBackend ?? 'c64',
            clock: parsed.selectedClock, model: parsed.selectedModel, choices: parsed.selection}, ...result});
      }} catch (error) {controller.abort(); throw error;}
    }));
    const failed = outcomes.find(result => result.status === 'rejected' && result.reason.name !== 'AbortError');
    if (failed) throw failed.reason;
    interrupted = controller.signal.aborted;
  } catch (error) {if (error.name === 'AbortError') interrupted = true; else throw error;}
  finally {
    try {await runner.dispose(); await writeQueue;}
    finally {try {await file.close();} finally {signal?.removeEventListener('abort', cancel);}}
  }
  const finalFingerprint = await corpusFingerprint({policy, extraSourceFiles});
  if (finalFingerprint.sha256 !== fingerprint.sha256) throw new Error('Audit sources or WASM changed during execution; preserve this checkpoint but do not resume it against changed sources');
  const statuses = {}, reasons = {}, backends = {}, stages = {}, statusByBackend = {}, errorStageCode = {}, examples = {};
  for (const row of [...completed.values()].sort((a, b) => a.index - b.index)) {
    const backend = row.execution?.backend ?? 'not_run';
    count(statuses, row.status); count(backends, backend); count(stages, row.stage); count(statusByBackend, `${backend}:${row.status}`);
    if (row.error) {
      count(errorStageCode, `${backend}:${row.status}:${row.stage}:${row.error.code ?? 'none'}`);
      const key = `${row.status}: ${row.error.code ?? ''}: ${row.error.message.replace(/ \(at \$[0-9A-F]+\)/g, '')}`;
      count(reasons, key); const list = examples[key] ??= [];
      if (list.length < 3) list.push({path: row.path, subtune: row.selection?.subtune ?? row.header.startSong, address: row.error.address, phase: row.error.phase});
    }
  }
  const checkpointBytes = await readFile(destination);
  const summary = {format: 'tetorica-sid-corpus-audit', version: 1, root: directory, fingerprint,
    inputCount: inventory.length, completed: completed.size, remaining: inventory.length - completed.size,
    complete: completed.size === inventory.length, interrupted, resumed: resume, newResults, discardedTailBytes,
    policy, inputManifest: {path: manifestPath, sha256: manifestSha256},
    checkpoint: {path: destination, bytes: checkpointBytes.length, sha256: sha256(checkpointBytes)},
    statuses: sorted(statuses), backends: sorted(backends), stages: sorted(stages), statusByBackend: sorted(statusByBackend),
    errorStageCode: sorted(errorStageCode), reasons: sorted(reasons), examples,
    elapsedMs: Date.now() - started, limitations: ['Default header subtune only; other subtunes are untested.',
      'Finite PCM and Stop checks do not establish whole-song or real-hardware accuracy.',
      'Silent output is a measurement, not proof that a tune is broken; D418 digi remains unmodeled.',
      'Metadata rejection records the first failed rule, not every unsupported feature.',
      'Observed ROM access does not establish that supplied firmware would make a tune compatible.',
      'Minimal environment only; no user ROMs were loaded and no game music, ROM or PCM was copied.']};
  if (out) {await mkdir(dirname(resolve(out)), {recursive: true}); await writeFile(resolve(out), `${JSON.stringify(summary, null, 2)}\n`);}
  return summary;
}

/** One writer per checkpoint; crashed processes leave a recoverable PID lock. */
export async function auditSidCorpus(options = {}) {
  if (typeof options.root !== 'string' || typeof options.checkpoint !== 'string') throw new TypeError('Explicit root and checkpoint paths are required');
  const root = await realpath(resolve(options.root)), destination = await outputPath(options.checkpoint, root), lock = `${destination}.lock`;
  await mkdir(dirname(destination), {recursive: true}); await outputPath(lock, root);
  const token = JSON.stringify({pid: process.pid, started: Date.now()});
  let owner;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {owner = await open(lock, 'wx'); break;}
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const stat = await lstat(lock); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Audit lock must be a regular file');
      const previous = JSON.parse(await readFile(lock, 'utf8'));
      if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw new Error('Audit checkpoint lock is invalid; inspect it before retrying');
      let live = true;
      try {process.kill(previous.pid, 0);} catch (probe) {if (probe.code === 'ESRCH') live = false; else throw probe;}
      if (live) throw new Error('Another audit process owns this checkpoint');
      if (await readFile(lock, 'utf8') !== JSON.stringify(previous)) throw new Error('Audit checkpoint lock changed');
      await unlink(lock);
    }
  }
  if (!owner) throw new Error('Could not acquire the checkpoint lock');
  try {await owner.writeFile(token); await owner.sync(); return await auditSidCorpusUnlocked(options);}
  finally {await owner.close(); if (await readFile(lock, 'utf8').catch(() => null) === token) await unlink(lock);}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag === '--resume') {options.resume = true; continue;}
    if (!['--root', '--checkpoint', '--out', '--seconds', '--sample-rate', '--workers', '--timeout-ms', '--paths', '--vbi-backend'].includes(flag) || !process.argv[i + 1]) throw new Error('Usage: node scripts/check_sid_corpus.mjs --root LOCAL_C64MUSIC --checkpoint RESULTS.jsonl [--out SUMMARY.json] [--resume] [--paths RELATIVE_PATHS.json] [--vbi-backend c64|direct] [--seconds 2] [--sample-rate 48000] [--workers 2] [--timeout-ms 15000]');
    const key = {'--sample-rate': 'sampleRate', '--timeout-ms': 'timeoutMs', '--vbi-backend': 'vbiBackend'}[flag] ?? flag.slice(2);
    const value = process.argv[++i]; options[key] = ['seconds', 'sampleRate', 'workers', 'timeoutMs'].includes(key) ? Number(value) : value;
  }
  const controller = new AbortController(); options.signal = controller.signal;
  const stop = () => controller.abort(); process.on('SIGINT', stop); process.on('SIGTERM', stop);
  options.onProgress = event => {if (event.completed % 500 === 0 || event.completed === event.total) console.error(`${event.completed}/${event.total} · ${event.status} · ${event.path}`);};
  try {const summary = await auditSidCorpus(options); console.log(JSON.stringify({complete: summary.complete, completed: summary.completed, remaining: summary.remaining, statuses: summary.statuses, out: options.out ?? null}, null, 2)); if (!summary.complete) process.exitCode = 130;}
  finally {process.off('SIGINT', stop); process.off('SIGTERM', stop);}
}
