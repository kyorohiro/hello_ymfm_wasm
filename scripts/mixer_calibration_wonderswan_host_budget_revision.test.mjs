// SPDX-License-Identifier: BSD-3-Clause
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  restoreMixerCalibrationWonderSwanHostBudgetRevision as restore,
  WONDERSWAN_HOST_BUDGET_REVISION_BASE_COMMIT as commit,
  WONDERSWAN_HOST_BUDGET_REVISION_RECEIPT_PATH as receiptPath,
  WONDERSWAN_HOST_BUDGET_REVISION_RECEIPT_OBJECT_SHA256 as receiptPin,
  WONDERSWAN_HOST_BUDGET_REVISION_SOURCE_PATHS as sources,
  WONDERSWAN_HOST_BUDGET_REVISION_REPORT_PATHS as reports,
  WONDERSWAN_HOST_BUDGET_REVISION_RELATED_PATHS as related,
} from './mixer_calibration_wonderswan_host_budget_revision.mjs';
import { assertMixerCalibrationSourceFreshness as freshness } from './mixer_calibration_sources.mjs';
import * as currentTimeline from '../tetorica_src/runtime/wonderswan_timeline.js';
import * as currentConverter from '../docs/playground/wonderswan_vgm_import.js';
import { createWonderSwanVgm } from '../test/helpers/wonderswan_vgm_fixture.mjs';

const read = (path) => readFile(new URL('../' + path, import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(await read(receiptPath));
const aliases = {
  'js/wonderswan_timeline.js': 'docs/js/wonderswan_timeline.js',
  'playground/wonderswan_vgm_import.js': 'docs/playground/wonderswan_vgm_import.js',
};

test('reviewed canonical and served sources reconstruct complete measured predecessors', async () => {
  assert.equal(sha(JSON.stringify(receipt)), receiptPin);
  assert.equal(receipt.baseCommit, commit);
  assert.deepEqual(Object.keys(receipt.sources), sources);
  for (const path of sources) {
    const bytes = await read(path),
      entry = receipt.sources[path],
      before = restore(path, bytes);
    assert.equal(bytes.length, entry.after.bytes, path);
    assert.equal(sha(bytes), entry.after.sha256, path);
    assert.equal(before.length, entry.before.bytes, path);
    assert.equal(sha(before), entry.before.sha256, path);
    assert.notEqual(before, bytes, path);
    assert.equal(
      restore(path, before),
      before,
      'complete predecessor keeps its raw freshness path',
    );
    assert.equal(
      freshness({ path, bytes, record: entry.before }),
      'wonderswan-host-preparation-budget',
    );
    assert.equal(
      freshness({ path, bytes, record: entry.after }),
      'raw',
      'a new exact measurement uses its own source identity',
    );
  }
  for (const [served, path] of Object.entries(aliases)) {
    const bytes = await read(path),
      entry = receipt.sources[path];
    assert.equal(sha(restore(served, bytes)), entry.before.sha256, served);
    for (const reportPath of reports) {
      const reportBytes = await read(reportPath),
        report = JSON.parse(reportBytes);
      assert.equal(reportBytes.length, receipt.reports[reportPath].bytes, reportPath);
      assert.equal(sha(reportBytes), receipt.reports[reportPath].sha256, reportPath);
      assert.deepEqual(report.sources[served], entry.before, reportPath);
      assert.equal(
        freshness({ path: served, bytes, record: report.sources[served], report }),
        'wonderswan-host-preparation-budget',
        reportPath,
      );
    }
  }
});

test('future source bodies and changed proof dependencies cannot use the reviewed revision', async () => {
  for (const path of sources) {
    const original = await read(path),
      entry = receipt.sources[path],
      changed = Buffer.from(original);
    changed[Math.floor(changed.length / 2)] ^= 1;
    for (const bytes of [changed, Buffer.concat([original, Buffer.from('\n')])]) {
      assert.equal(restore(path, bytes), bytes, path);
      assert.throws(
        () => freshness({ path, bytes, record: entry.before }),
        /source changed; remeasure/,
        path,
      );
    }
  }
  const path = 'js/wonderswan_timeline.js',
    bytes = await read(aliases[path]);
  for (const target of [...sources, ...reports, ...related]) {
    const targetUrl = new URL('../' + target, import.meta.url).href;
    const readSource = (url) => {
      const original = readFileSync(url);
      return url.href === targetUrl ? Buffer.concat([original, Buffer.from('\n')]) : original;
    };
    assert.throws(() => restore(path, bytes, { readSource }), /dependency changed/, target);
  }
  for (const unknown of [
    '__proto__',
    'js/other.js',
    'docs/generated/wonderswan_wasm.wasm',
    'js/soundchip_mixer_presets.js',
  ])
    assert.equal(restore(unknown, bytes), bytes, unknown);
  for (const record of [
    undefined,
    {},
    { bytes: 1, sha256: '0'.repeat(64) },
    { ...receipt.sources[aliases[path]].before, sha256: '0'.repeat(64) },
  ])
    assert.throws(() => freshness({ path, bytes, record }));
});

test('the receipt itself requires its independently pinned object hash', async (t) => {
  const directory = await mkdtemp('/private/tmp/wonderswan-host-receipt-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const modulePath = join(
    directory,
    'scripts/mixer_calibration_wonderswan_host_budget_revision.mjs',
  );
  await mkdir(dirname(modulePath), { recursive: true });
  await writeFile(
    modulePath,
    await read('scripts/mixer_calibration_wonderswan_host_budget_revision.mjs'),
  );
  const destination = join(directory, receiptPath);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify({ ...receipt, feature: 'another source revision' }));
  const changed = await import(pathToFileURL(modulePath).href);
  assert.throws(
    () =>
      changed.restoreMixerCalibrationWonderSwanHostBudgetRevision(
        'js/wonderswan_timeline.js',
        readFileSync(new URL('../docs/js/wonderswan_timeline.js', import.meta.url)),
      ),
    /independently pinned SHA/,
  );
});

async function predecessorModule(path) {
  const original = restore(path, await read(path)).toString();
  const source = original.replace(
    /^(import|export)([^\n]*?) from '([^']+)'/gm,
    (_all, type, prefix, specifier) =>
      `${type}${prefix} from '${new URL(specifier, new URL('../' + path, import.meta.url)).href}'`,
  );
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('default conversion and preparation retain the measured trace and output contract', async () => {
  const beforeTimeline = await predecessorModule('tetorica_src/runtime/wonderswan_timeline.js');
  const beforeConverter = await predecessorModule('docs/playground/wonderswan_vgm_import.js');
  assert.equal(
    currentTimeline.WONDERSWAN_TIMELINE_MAX_BYTES,
    beforeTimeline.WONDERSWAN_TIMELINE_MAX_BYTES,
  );
  assert.equal(
    currentTimeline.WONDERSWAN_TIMELINE_MAX_WRITES_PER_QUANTUM,
    beforeTimeline.WONDERSWAN_TIMELINE_MAX_WRITES_PER_QUANTUM,
  );
  assert.deepEqual(
    currentConverter.WONDERSWAN_VGM_IMPORT_LIMITS,
    beforeConverter.WONDERSWAN_VGM_IMPORT_LIMITS,
  );
  for (const mode of ['wave', 'sweep', 'noise', 'voice']) {
    const bytes = createWonderSwanVgm({ mode, seconds: 0.02, loop: false });
    const trace = currentConverter.readWonderSwanVgm(bytes, { packPcm: true });
    assert.deepEqual(trace, beforeConverter.readWonderSwanVgm(bytes, { packPcm: true }), mode);
    assert.deepEqual(
      currentConverter.validateWonderSwanVgm(bytes),
      beforeConverter.validateWonderSwanVgm(bytes),
      mode,
    );
    for (const output of ['raw', 'readable', 'high'])
      assert.equal(
        currentConverter.exportWonderSwanVgm(bytes, { mode: output }),
        beforeConverter.exportWonderSwanVgm(bytes, { mode: output }),
        mode + '/' + output,
      );
    const input = {
      version: 1,
      clock: trace.clock,
      durationSamples: trace.time,
      pcmData: trace.pcmData,
      events: trace.events.map((event) =>
        event.type === 'pcm'
          ? [event.time, 2, event.offset, event.length, event.count, event.endTime]
          : [event.time, event.type === 'register' ? 0 : 1, event.address, event.value],
      ),
    };
    for (const sampleRate of [44100, 48000])
      assert.deepEqual(
        currentTimeline.prepareWonderSwanTimeline(input, { sampleRate }),
        beforeTimeline.prepareWonderSwanTimeline(input, { sampleRate }),
        mode + '/' + sampleRate,
      );
  }
  const proof = JSON.parse(await read(receipt.defaultCalibrationProof.path));
  assert.equal(proof.passed, true);
  assert.equal(proof.routes.length, 12);
  assert.equal(proof.nativeMaximumDifference, 0);
  assert.equal(proof.audioContextCreated, false);
  assert(proof.routes.every((route) => route.passed && route.keyOffSilence));
});
