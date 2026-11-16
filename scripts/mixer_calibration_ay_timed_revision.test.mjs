import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createPerformanceQueue} from '../tetorica_src/runtime/playground_performance_queue.js';
import {createProcessorPerformance} from '../tetorica_src/runtime/playground_performance_processor.js';
import {assertMixerCalibrationSourceFreshness} from './mixer_calibration_sources.mjs';
import {restoreMixerCalibrationLogTableCacheRevision} from './mixer_calibration_log_table_cache_revision.mjs';
import {
  restoreMixerCalibrationAyTimedRevision as restore,
  AY_TIMED_REVISION_BASE_COMMIT as baseCommit,
  AY_TIMED_REVISION_RECEIPT_PATH as receiptPath,
  AY_TIMED_REVISION_RECEIPT_OBJECT_SHA256 as pin,
  AY_TIMED_REVISION_SOURCE_PATHS as paths,
  AY_TIMED_REVISION_RELATED_PATHS as related,
  AY_TIMED_REVISION_REPORT_PATHS as reports,
} from './mixer_calibration_ay_timed_revision.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = JSON.parse(read(receiptPath));
const queuePath = 'tetorica_src/runtime/playground_performance_queue.js';
const processorPath = 'tetorica_src/runtime/playground_performance_processor.js';
const previousQueueBytes = restore(queuePath, read(queuePath));
const queueUrl = 'data:text/javascript;base64,' + previousQueueBytes.toString('base64');
const {createPerformanceQueue: previousQueue} = await import(queueUrl);
const previousProcessorText = restore(processorPath, read(processorPath)).toString()
  .replace("from './playground_performance_queue.js'", `from '${queueUrl}'`);
const {createProcessorPerformance: previousProcessor} = await import(
  'data:text/javascript;base64,' + Buffer.from(previousProcessorText).toString('base64'));

test('exact AY API receipt restores complete predecessors and preserves immutable measurements', () => {
  assert.equal(sha(JSON.stringify(receipt)), pin);
  assert.equal(receipt.baseCommit, baseCommit);
  assert.equal(read(receiptPath).toString(), JSON.stringify(receipt, null, 2) + '\n');
  assert.deepEqual(Object.keys(receipt.sources), [...paths]);
  for (const path of paths) {
    const current = read(path), original = restore(path, current), entry = receipt.sources[path];
    const reviewed = restoreMixerCalibrationLogTableCacheRevision(path, current);
    assert.equal(reviewed.length, entry.after.bytes);
    assert.equal(sha(reviewed), entry.after.sha256);
    assert.equal(original.length, entry.before.bytes);
    assert.equal(sha(original), entry.before.sha256);
    assert.equal(restore(path, original), original);
  }
  for (const path of [...related, ...reports]) {
    const expected = receipt.relatedSources[path] ?? receipt.reports[path], bytes = read(path);
    assert.equal(bytes.length, expected.bytes);
    assert.equal(sha(bytes), expected.sha256);
  }
  const path = 'docs/js/native_runtime_synth.js', bytes = read(path);
  assert.equal(assertMixerCalibrationSourceFreshness({
    path:'js/native_runtime_synth.js', bytes, record:receipt.sources[path].before,
  }), 'ay-timed-operations-default-path-revision');
  assert.deepEqual(restore('web/playground_performance_queue.js', read(queuePath)), previousQueueBytes);
  assert.deepEqual(restore('js/playground_performance_queue.js', read('docs/js/playground_performance_queue.js')),
    restore('docs/js/playground_performance_queue.js', read('docs/js/playground_performance_queue.js')));
});

test('unknown paths, future edits and detached source records receive no reviewed reconstruction', () => {
  for (const path of paths) {
    const current = read(path), edited = Buffer.from(current);
    edited[Math.floor(edited.length / 2)] ^= 1;
    for (const changed of [edited, Buffer.concat([current, Buffer.from('\n')])]) {
      assert.equal(restore(path, changed), changed, path);
    }
  }
  const path = 'docs/js/playground_performance_queue.js', bytes = read(path);
  for (const other of ['js/unknown.js', '__proto__', '../docs/js/playground_performance_queue.js', 'generated/ps1_spu_wasm.wasm']) {
    assert.equal(restore(other, bytes), bytes);
  }
  assert.throws(() => assertMixerCalibrationSourceFreshness({
    path:'js/playground_performance_queue.js', bytes,
    record:{...receipt.sources[path].before, sha256:'0'.repeat(64)},
  }), /remeasure/);
});

test('every source, new dependency, receipt and original report remains independently required', () => {
  const source = 'docs/js/native_runtime_synth.js', current = read(source);
  for (const path of [...paths, ...related, ...reports, receiptPath]) {
    const target = new URL('../' + path, import.meta.url).href;
    assert.throws(() => restore(source, current, {readSource(url) {
      const bytes = readFileSync(url);
      if (url.href !== target) return bytes;
      if (path === receiptPath) {
        const forged = JSON.parse(bytes);
        forged.sources[source].after.sha256 = '0'.repeat(64);
        return Buffer.from(JSON.stringify(forged));
      }
      return Buffer.concat([bytes, Buffer.from([0])]);
    }}), /pinned.*changed/, path);
  }
});

function queueProbe(create, sampleRate) {
  const applied = [], replies = [], discarded = [], released = [];
  let frame = 0;
  const queue = create({sampleRate, nowFrame:() => frame,
    apply:(command, _reply, at, owner) => applied.push({command, at, owner}),
    onDiscard:(command, owner) => discarded.push({command, owner}),
    onCancelOwner:(owner, session) => released.push({owner, session}),
  });
  const receive = data => queue.receive(data, value => replies.push(value));
  receive({type:'performance-start', session:1});
  for (let index = 511; index >= 0; index--) {
    const at = ((index * 73) % 2048) / sampleRate;
    receive({performance:{session:1, owner:index % 3 ? 'retained' : 'removed', time:at}, commands:[
      {method:'writeRegister', args:[13, index & 15]},
      {method:'writeRegister', args:[13, index & 15]},
    ]});
  }
  receive({performance:{session:1, owner:'bad', time:NaN}, commands:[{method:'write'}]});
  receive({type:'performance-cancel-owner', session:1, owner:'removed'});
  while (queue.nextFrame() < Infinity) {
    frame = queue.nextFrame(); queue.advance(frame);
  }
  receive({type:'performance-stop', session:1});
  receive({type:'performance-start', session:2});
  receive({performance:{session:1, owner:'stale', time:0}, commands:[{method:'write', id:42}]});
  const stats = queue.getStats();
  return {applied, replies, discarded, released, stats:Object.fromEntries(
    ['activeSession','latestSession','queuedCommands','queuedBatches','lateCommands','maxLateFrames','rejectedBatches','discardedCommands']
      .map(key => [key, stats[key]]))};
}

test('ordinary legacy queue ordering, repeated writes, cancellation and replies match the predecessor at both rates', () => {
  for (const sampleRate of [44100, 48000]) {
    const before = queueProbe(previousQueue, sampleRate), after = queueProbe(createPerformanceQueue, sampleRate);
    assert.deepEqual(after, before);
    assert.equal(after.applied.length, 682);
    assert(after.discarded.length > 0);
    assert(after.replies.some(reply => reply.type === 'performance-error'));
  }
});

function processorProbe(create, chip, sampleRate) {
  const calls = [], replies = [], pcm = [];
  const registers = new Uint8Array(16);
  let frame = 0, level = 0;
  const apply = (command, _port, at, metadata) => {
    calls.push({command, at:at ?? frame, metadata});
    if (command.method === 'writeRegister') {
      registers[command.args[0]] = command.args[1];
      level = command.args[1] / 255;
    } else if (command.method === 'noteOn' || command.method === 'keyOn') level = 0.5;
    else if (command.method === 'keyOff' || command.method === 'forceKeyOff') level = 0;
    else if (command.type === 'write') level = command.value / 255;
  };
  const processor = create({chip, rate:sampleRate, nowFrame:() => frame, getAyRegisters:() => registers, apply});
  const port = {postMessage:message => replies.push(message)};
  processor.receive({type:'performance-start', session:1}, port);
  const commands = chip === 'ay8910'
    ? [{method:'writeRegister',args:[13,8]},{method:'writeRegister',args:[13,8]},{method:'writeRegister',args:[8,9]}]
    : chip === 'ym2612'
      ? [{type:'write',port:0,register:0x28,value:0xF0},{type:'write',port:0,register:0x28,value:0xF0}]
      : [{method:'noteOn',args:[0,'C4']},{method:'noteOn',args:[0,'E4']}];
  processor.receive({performance:{session:1,owner:'old',time:31/sampleRate},commands}, port);
  processor.receive({performance:{session:1,owner:'new',time:73/sampleRate},commands}, port);
  const render = (left, right, at) => {
    for (let index = 0; index < left.length; index++) {
      left[index] = Math.fround(level * Math.sin((at + index) / 19));
      right[index] = -left[index];
    }
  };
  const block = count => {
    const left = new Float32Array(count), right = new Float32Array(count);
    processor.render(left, right, render);
    pcm.push(...left, ...right); frame += count;
  };
  block(127);
  processor.receive({type:'performance-cancel-owner',session:1,owner:'old'}, port);
  processor.beginAudition(1, 'manual');
  const manual = chip === 'ay8910' ? {method:'writeRegister',args:[9,7]}
    : chip === 'ym2612' ? {type:'write',port:0,register:0x28,value:0xF1}
      : {method:'keyOn',args:[1]};
  processor.applyImmediate(manual, port, {owner:'manual'});
  processor.receive({performance:{session:1,owner:'new',time:193/sampleRate},commands}, port);
  for (const count of [1, 19, 128, 47, 256]) block(count);
  processor.receive({type:'performance-cancel-owner',session:1,owner:'new'}, port);
  processor.endAudition(1, 'manual');
  block(128);
  processor.receive({type:'performance-stop',session:1}, port);
  return {calls, replies, pcm};
}

test('ordinary processor application and render-marker traces match prior queue/processor code with manual ownership', () => {
  for (const sampleRate of [44100,48000]) for (const chip of ['ay8910','ps1','ym2612']) {
    const before = processorProbe(previousProcessor, chip, sampleRate);
    const after = processorProbe(createProcessorPerformance, chip, sampleRate);
    assert.deepEqual(after, before, `${chip}/${sampleRate}`);
    assert(after.calls.length > 4);
    assert(after.pcm.some(value => value !== 0));
  }
});
