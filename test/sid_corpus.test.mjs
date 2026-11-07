import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, appendFile, rm, symlink, link} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {auditSidCorpus, corpusFingerprint} from '../scripts/check_sid_corpus.mjs';
import {createSidReferenceFixture} from './fixtures/sid-reference/fixture.mjs';
import {createPsidCiaFixture} from './helpers/psid_cia_fixtures.mjs';
import {createRsidFixture, createRsidBasicFixture} from './helpers/rsid_fixtures.mjs';
import {createPsidVbiMachineFixture} from './helpers/psid_vbi_machine_fixtures.mjs';

function tiny(program) {
  const bytes = new Uint8Array(124 + program.length), view = new DataView(bytes.buffer);
  bytes.set([80, 83, 73, 68]); view.setUint16(4, 2); view.setUint16(6, 124);
  view.setUint16(8, 0x1000); view.setUint16(10, 0x1000); view.setUint16(12, 0x1000 + program.length - 1);
  view.setUint16(14, 1); view.setUint16(16, 1); view.setUint16(118, 0x14); bytes.set(program, 124);
  return bytes;
}
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sid-corpus-test-')); t.after(() => rm(directory, {recursive: true, force: true}));
  const root = join(directory, 'music'); await mkdir(root);
  return {directory, root, checkpoint: join(directory, 'results.jsonl'), out: join(directory, 'summary.json')};
}
async function rows(path) {return (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));}

test('all local synthetic files get metadata and the default song uses real isolated VBI/CIA/RSID WASM', async t => {
  const options = await setup(t), tone = createSidReferenceFixture('tone').bytes;
  const cia = createPsidCiaFixture().bytes; new DataView(cia.buffer).setUint16(16, 2);
  const unknown = tone.slice(); new DataView(unknown.buffer).setUint16(118, 0);
  const ntsc = tone.slice(); new DataView(ntsc.buffer).setUint16(118, 0x18);
  const mos8580 = tone.slice(); new DataView(mos8580.buffer).setUint16(118, 0x24);
  const originals = new Map([
    ['01-tone.sid', tone], ['02-silent.sid', tiny([0x60, 0x60])], ['03-cia.sid', cia],
    ['04-rsid.sid', createRsidFixture('cia-irq').bytes], ['05-unknown.sid', unknown],
    ['06-ntsc.sid', ntsc], ['07-8580.sid', mos8580], ['08-basic.sid', createRsidBasicFixture().bytes],
    ['09-jam.sid', tiny([0x02, 0x60])], ['10-loop.sid', tiny([0x4c, 0, 0x10, 0x60])],
    ['11-invalid.sid', Uint8Array.of(1, 2, 3)],
  ]);
  for (const [name, bytes] of originals) await writeFile(join(options.root, name), bytes);
  await symlink(join(options.root, '01-tone.sid'), join(options.root, 'ignored.sid'));
  await symlink(options.root, join(options.root, 'ignored-directory'));
  const summary = await auditSidCorpus({...options, seconds: .15, vbiBackend: 'direct'});
  assert.equal(summary.complete, true); assert.equal(summary.completed, originals.size);
  assert.deepEqual(summary.statuses, {executed_nonzero: 4, runtime_failed: 2, unsupported: 2, executed_silent: 1, invalid: 1, needs_rom: 1});
  const result = new Map((await rows(options.checkpoint)).slice(1).map(row => [row.path, row]));
  for (const [name, bytes] of originals) {assert.deepEqual(await readFile(join(options.root, name)), Buffer.from(bytes)); assert.equal(result.get(name).input.sha256.length, 64);}
  assert.equal(result.get('03-cia.sid').selection.subtune, 2); assert.equal(result.get('03-cia.sid').execution.timing, 'cia');
  assert.equal(result.get('04-rsid.sid').execution.backend, 'rsid'); assert.equal(result.get('01-tone.sid').execution.backend, 'vbi');
  assert.deepEqual(result.get('05-unknown.sid').selection.choices, {clock: 'explicit', model: 'explicit'});
  for (const name of ['01-tone.sid', '02-silent.sid', '03-cia.sid', '04-rsid.sid']) {
    const execution = result.get(name).execution;
    assert.equal(execution.frames, 7200); assert.equal(execution.finite, true); assert.equal(execution.stopZero, true);
    assert(Number.isFinite(execution.rms)); assert(Number.isFinite(execution.peak));
  }
  assert.equal(result.get('02-silent.sid').execution.peak, 0);
  assert.equal(result.get('09-jam.sid').error.code, 10); assert.equal(result.get('09-jam.sid').error.address, 0x1000);
  assert.equal(result.get('10-loop.sid').error.code, 5); assert.equal(result.get('10-loop.sid').error.phase, 'init');
  assert(result.get('10-loop.sid').error.address >= 0x1000 && result.get('10-loop.sid').error.address <= 0x1002);
  assert.equal(result.get('08-basic.sid').status, 'needs_rom');
  assert.deepEqual(JSON.parse(await readFile(options.out, 'utf8')), summary);
  assert.doesNotMatch(await readFile(options.checkpoint, 'utf8'), /"program"|"originalBytes"|"pcm"|"registers"/);
});

test('graceful interruption checkpoints completed jobs exactly once and resume repairs only a partial final row', async t => {
  const options = await setup(t), controller = new AbortController();
  for (let i = 0; i < 6; i++) await writeFile(join(options.root, `${i}.sid`), createSidReferenceFixture('tone').bytes);
  const partial = await auditSidCorpus({...options, seconds: .1, workers: 1, signal: controller.signal,
    onProgress() {controller.abort();}});
  assert.equal(partial.interrupted, true); assert.equal(partial.completed, 1); assert.equal(partial.remaining, 5);
  await appendFile(options.checkpoint, '{"type":"result","partial":');
  const full = await auditSidCorpus({...options, seconds: .1, workers: 2, resume: true});
  assert.equal(full.complete, true); assert.equal(full.completed, 6); assert.equal(full.newResults, 5); assert(full.discardedTailBytes > 0);
  const checkpoint = await rows(options.checkpoint);
  assert.equal(checkpoint.length, 7); assert.equal(new Set(checkpoint.slice(1).map(row => row.index)).size, 6);
  const again = await auditSidCorpus({...options, seconds: .1, resume: true});
  assert.equal(again.newResults, 0); assert.equal(again.checkpoint.sha256, full.checkpoint.sha256);
});

test('resume refuses changed policy, executable sources, WASM identity and corpus bytes before reusing results', async t => {
  const options = await setup(t), path = join(options.root, 'tone.sid'), bytes = createSidReferenceFixture('tone').bytes;
  const extra = join(options.directory, 'provider-source.txt'); await writeFile(extra, 'version one\n'); await writeFile(path, bytes);
  await auditSidCorpus({...options, seconds: .1, extraSourceFiles: [extra]});
  await assert.rejects(auditSidCorpus({...options, seconds: .2, extraSourceFiles: [extra], resume: true}), /differs/);
  await writeFile(extra, 'version two\n');
  await assert.rejects(auditSidCorpus({...options, seconds: .1, extraSourceFiles: [extra], resume: true}), /differs/);
  await writeFile(extra, 'version one\n'); const changed = bytes.slice(); changed[90] ^= 1; await writeFile(path, changed);
  await assert.rejects(auditSidCorpus({...options, seconds: .1, extraSourceFiles: [extra], resume: true}), /differs/);
  await writeFile(path, bytes);
  const lines = await rows(options.checkpoint); lines[0].fingerprint.wasm.vbi.sha256 = '0'.repeat(64);
  await writeFile(options.checkpoint, lines.map(row => JSON.stringify(row)).join('\n') + '\n');
  await assert.rejects(auditSidCorpus({...options, seconds: .1, extraSourceFiles: [extra], resume: true}), /differs/);
  const fingerprint = await corpusFingerprint({policy: {test: true}});
  assert(fingerprint.sources.some(source => source.path === 'tetorica_src/wasm/sid_player_core.h'));
  assert.equal(fingerprint.wasm.vbi.sha256.length, 64);
});

test('read-only corpus and distinct regular output paths are enforced before writes', async t => {
  const options = await setup(t), path = join(options.root, 'tone.sid'), bytes = createSidReferenceFixture('tone').bytes;
  await writeFile(path, bytes);
  for (const override of [{checkpoint: path}, {out: path}, {out: options.checkpoint}, {out: `${options.checkpoint}.inputs.json`}])
    await assert.rejects(auditSidCorpus({...options, ...override}), /outside|different/);
  const alias = join(options.directory, 'alias'); await symlink(options.root, alias);
  await assert.rejects(auditSidCorpus({...options, checkpoint: join(alias, 'results.jsonl')}), /outside/);
  const link = join(options.directory, 'summary-link.json'); await symlink(path, link);
  await assert.rejects(auditSidCorpus({...options, out: link}), /outside|symlink/);
  assert.deepEqual(await readFile(path), Buffer.from(bytes));
  await assert.rejects(auditSidCorpus({...options, root: alias}), /symlink/);
});

test('hard-linked music outputs and concurrent checkpoint owners are refused, while stale PID locks recover', async t => {
  const options = await setup(t), path = join(options.root, 'tone.sid'), bytes = createSidReferenceFixture('tone').bytes;
  await writeFile(path, bytes);
  const hardLink = join(options.directory, 'hard-linked-summary.json'); await link(path, hardLink);
  await assert.rejects(auditSidCorpus({...options, out: hardLink}), /distinct/);
  const lock = `${options.checkpoint}.lock`;
  await writeFile(lock, JSON.stringify({pid: process.pid, started: Date.now()}));
  await assert.rejects(auditSidCorpus(options), /Another audit process/);
  await writeFile(lock, JSON.stringify({pid: 2147483647, started: 1}));
  const summary = await auditSidCorpus({...options, seconds: .05});
  assert.equal(summary.complete, true); assert.deepEqual(await readFile(path), Buffer.from(bytes));
  await assert.rejects(readFile(lock), {code: 'ENOENT'});
});

test('a checkpoint progress failure cancels and settles sibling jobs before closing and allows safe resume', async t => {
  const options = await setup(t);
  for (let index = 0; index < 5; index++) await writeFile(join(options.root, `${index}.sid`), createSidReferenceFixture('tone').bytes);
  await assert.rejects(auditSidCorpus({...options, seconds: .05, workers: 2, onProgress() {throw new Error('deliberate progress failure');}}), /deliberate progress failure/);
  const before = (await rows(options.checkpoint)).length;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal((await rows(options.checkpoint)).length, before, 'no late sibling appends after the writer closes');
  const resumed = await auditSidCorpus({...options, seconds: .05, resume: true});
  assert.equal(resumed.complete, true); assert.equal((await rows(options.checkpoint)).length, 6);
});

test('per-file watchdog retires its worker and checkpoints the timeout without aborting the next file', async t => {
  const options = await setup(t), tone = createSidReferenceFixture('tone').bytes;
  await writeFile(join(options.root, '1-tone.sid'), tone);
  await writeFile(join(options.root, '2-jam.sid'), tiny([0x02, 0x60]));
  const summary = await auditSidCorpus({...options, seconds: 60, timeoutMs: 500, workers: 1});
  assert.equal(summary.complete, true); assert.equal(summary.statuses.runtime_failed, 2);
  const results = (await rows(options.checkpoint)).slice(1);
  assert.equal(results[0].error.code, 'WORKER_TIMEOUT'); assert.equal(results[0].error.phase, 'worker');
  assert.equal(results[1].error.code, 6, 'a replacement C64 worker executes the second valid-header program');
});

test('oversized files have explicit bounded-header identity and corrupted complete checkpoint rows are not repaired', async t => {
  const options = await setup(t); await writeFile(join(options.root, 'large.sid'), new Uint8Array(70000));
  const summary = await auditSidCorpus({...options, seconds: .1}); assert.equal(summary.statuses.invalid, 1);
  const result = (await rows(options.checkpoint))[1];
  assert.equal(result.input.sha256, null); assert.equal(result.input.headerSha256.length, 64); assert.equal(result.input.hashScope, 'bounded-header-only-oversize');
  await appendFile(options.checkpoint, '{broken complete json}\n');
  await assert.rejects(auditSidCorpus({...options, seconds: .1, resume: true}), /Invalid checkpoint JSON/);
});

test('default C64 VBI validates a long init separately without replacing its first measured PCM window', async t => {
  const options = await setup(t), fixture = createPsidVbiMachineFixture();
  await writeFile(join(options.root, 'long-init.sid'), fixture.bytes);
  const summary = await auditSidCorpus({...options, seconds: .01});
  assert.equal(summary.complete, true); assert.equal(summary.policy.vbiBackend, 'c64');
  const result = (await rows(options.checkpoint))[1];
  assert.equal(result.status, 'executed_nonzero'); assert.equal(result.selection.timing, 'vbi');
  assert.equal(result.selection.playbackBackend, 'c64'); assert.equal(result.execution.backend, 'vbi-c64');
  assert.equal(result.execution.frames, 480); assert(result.execution.validationExtraFrames > 0);
  assert.equal(result.execution.initReturned, true); assert(result.execution.initReturnCycle > 100000);
  assert.equal(result.execution.initCycleLimit, 2000000); assert.equal(result.execution.stopStable, true);
  const direct = await auditSidCorpus({...options, checkpoint: join(options.directory, 'direct.jsonl'), seconds: .01, vbiBackend: 'direct'});
  assert.equal(direct.statuses.unsupported, 1, 'Direct VBI does not acquire real CIA/VIC accesses');
});

test('targeted path lists restrict inventory, reject traversal/symlinks and invalidate incompatible resumes', async t => {
  const options = await setup(t), tone = createSidReferenceFixture('tone').bytes;
  await mkdir(join(options.root, 'nested'));
  for (const path of ['1.sid', '2.sid', 'nested/3.sid']) await writeFile(join(options.root, path), tone);
  const pathFile = join(options.directory, 'paths.json'); await writeFile(pathFile, JSON.stringify(['nested/3.sid', '1.sid']));
  const selected = await auditSidCorpus({...options, paths: pathFile, seconds: .05});
  assert.equal(selected.inputCount, 2); assert.equal(selected.policy.pathSelection.kind, 'listed-paths');
  assert.equal(selected.policy.pathSelection.sha256.length, 64);
  assert.deepEqual((await rows(options.checkpoint)).slice(1).map(row => row.path).sort(), ['1.sid', 'nested/3.sid']);
  await assert.rejects(auditSidCorpus({...options, paths: ['1.sid'], seconds: .05, resume: true}), /differs/);
  await assert.rejects(auditSidCorpus({...options, paths: pathFile, seconds: .05, vbiBackend: 'direct', resume: true}), /differs/);
  await symlink(join(options.root, '1.sid'), join(options.root, 'alias.sid'));
  await symlink(join(options.root, 'nested'), join(options.root, 'linked'));
  for (const paths of [['../1.sid'], ['/tmp/input.sid'], ['nested/../1.sid'], ['1.sid', '1.sid'], ['alias.sid'], ['linked/3.sid'], [], ['not-present.sid']])
    await assert.rejects(auditSidCorpus({...options, paths, seconds: .05, resume: true}), /relative|Duplicate|symlink|nonempty|ENOENT/);
  assert.deepEqual(await readFile(join(options.root, '1.sid')), Buffer.from(tone));
});
