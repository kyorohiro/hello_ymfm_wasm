import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCdda} from './cdda_native.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
}
function native({maxChunkBytes = 256 * 1024} = {}) {
  const calls = [], uploads = new Map();
  let next = 0, failChunk = false, pendingChunk = null;
  const synth = {
    session: 17, generation: 3, stopping: false, closing: false, ready: true,
    clock: {sampleRate: 48000},
    isReady() { return this.ready; },
    frameAt(seconds) {
      const frame = Math.round(seconds * 48000);
      if (!Number.isSafeInteger(frame)) throw new RangeError('Invalid Native clock frame');
      return frame;
    },
    async nativeRequest(command, args = {}) {
      calls.push({command, args: {...args}});
      if (command === 'native_genesis_cdda_load_begin') {
        if (!Number.isSafeInteger(args.bytes) || args.bytes <= 0 || args.bytes % 4 || args.bytes > 256 * 1024 * 1024) {
          throw new RangeError('Invalid Native PCM byte count');
        }
        const upload = ++next; uploads.set(upload, {bytes: args.bytes, data: [], written: 0});
        return {upload, maxChunkBytes};
      }
      if (command === 'native_genesis_cdda_load_finalize') {
        const upload = uploads.get(args.upload);
        assert(upload); assert.equal(upload.written, upload.bytes); upload.finalized = true;
      }
      return {state: 'ready', positionFrames: 0, durationFrames: 100};
    },
    async invoke(command, body, options) {
      calls.push({command, body: body instanceof Uint8Array ? body.slice() : {...body}, options});
      if (command === 'native_genesis_cdda_load_abort') { uploads.delete(body.upload); return; }
      assert.equal(command, 'native_genesis_cdda_load_chunk');
      assert(body instanceof Uint8Array, 'PCM travels as raw bytes, not a JSON array');
      assert.equal(options.headers['x-cdda-session'], '17');
      const upload = uploads.get(Number(options.headers['x-cdda-upload']));
      assert(upload); assert.equal(Number(options.headers['x-cdda-offset']), upload.written);
      const gate = pendingChunk; pendingChunk = null;
      if (gate) { gate.started.resolve(); await gate.finished.promise; }
      if (failChunk) { failChunk = false; throw new Error('Native chunk rejected'); }
      upload.data.push(body.slice()); upload.written += body.byteLength;
    },
  };
  return {synth, calls, uploads,
    failNextChunk() { failChunk = true; },
    deferNextChunk() {
      const gate = {started: deferred(), finished: deferred()}; pendingChunk = gate; return gate;
    }};
}
const chunks = fixture => fixture.calls.filter(c => c.command === 'native_genesis_cdda_load_chunk');
const actions = fixture => fixture.calls.filter(c => c.command === 'native_genesis_cdda_action');

test('Native CD-DA sends bounded raw PCM16 chunks with explicit session/upload/offset ownership', async () => {
  const fixture = native(), adapter = createNativeCdda(fixture.synth);
  const pcm = new Uint8Array(64 * 1024 * 2 + 4);
  for (let i = 0; i < pcm.length; i++) pcm[i] = i % 251;
  await adapter.prepare(pcm, 'track-2');
  assert.equal(pcm.byteLength, 131076, 'caller storage is retained and never detached');
  assert.deepEqual(chunks(fixture).map(c => c.body.length), [65536, 65536, 4]);
  assert.deepEqual(chunks(fixture).map(c => c.options.headers['x-cdda-offset']), ['0', '65536', '131072']);
  assert.deepEqual(Buffer.concat(chunks(fixture).map(c => Buffer.from(c.body))), Buffer.from(pcm));
  assert.equal(fixture.uploads.get(1).finalized, true);
  assert.equal(fixture.calls.at(-1).command, 'native_genesis_cdda_load_finalize');
  await adapter.command({type: 'play', sourceFrame: 11}, {at: .125});
  assert.deepEqual(actions(fixture).at(-1).args, {frame: 6000, action: {type: 'play', sourceFrame: 11}});
  const state=await adapter.command({type: 'state'});
  assert.equal(state.sourceRate,44100);assert.equal(state.sampleRate,48000);
  assert.equal(fixture.calls.at(-1).command, 'native_genesis_cdda_state');
  adapter.dispose(); adapter.dispose(); assert.equal(actions(fixture).filter(c => c.args.action.type === 'stop').length, 1);
});

test('Native CD-DA serializes preparations and recovers after aborting a failed upload', async () => {
  const fixture = native({maxChunkBytes: 16}), adapter = createNativeCdda(fixture.synth);
  fixture.failNextChunk();
  const old = adapter.prepare(new Uint8Array(32), 'old');
  const rejected = assert.rejects(old, /Native chunk rejected/);
  const next = adapter.prepare(new Uint8Array(20), 'new');
  await Promise.all([rejected, next]);
  const commands = fixture.calls.map(c => c.command);
  const aborted = commands.indexOf('native_genesis_cdda_load_abort');
  assert(aborted > 0); assert.equal(commands[aborted + 1], 'native_genesis_cdda_load_begin');
  assert.equal(fixture.uploads.has(1), false); assert.equal(fixture.uploads.get(2).finalized, true);
  assert.deepEqual(chunks(fixture).slice(1).map(c => c.body.length), [16, 4]);
  adapter.dispose();
});

test('Stop cancellation during an in-flight raw chunk aborts only its old upload and never finalizes it', async () => {
  const fixture = native(), controller = new AbortController(), adapter = createNativeCdda(fixture.synth);
  const gate = fixture.deferNextChunk();
  const pending = adapter.prepare(new Uint8Array(131072), 'old', {signal: controller.signal});
  const rejected = assert.rejects(pending, {name: 'AbortError'});
  await gate.started.promise; controller.abort();
  await adapter.command({type: 'stop'}); gate.finished.resolve(); await rejected;
  assert.equal(chunks(fixture).length, 1);
  assert.equal(fixture.calls.some(c => c.command === 'native_genesis_cdda_load_finalize'), false);
  const abort = fixture.calls.find(c => c.command === 'native_genesis_cdda_load_abort');
  assert.deepEqual(abort.body, {session: 17, upload: 1});
  await adapter.prepare(new Uint8Array(4), 'fresh'); assert.equal(fixture.uploads.get(2).finalized, true);
  adapter.dispose();
});

test('Native adapter retirement after a same-session generation change cannot Stop the new Run', async () => {
  const fixture = native(), adapter = createNativeCdda(fixture.synth);
  const gate = fixture.deferNextChunk();
  const pending = adapter.prepare(new Uint8Array(131072), 'old');
  const rejected = assert.rejects(pending, {name: 'AbortError'});
  await gate.started.promise; fixture.synth.generation++; gate.finished.resolve(); await rejected;
  assert.equal(fixture.calls.some(c => c.command === 'native_genesis_cdda_load_finalize'), false);
  adapter.dispose();
  assert.equal(actions(fixture).length, 0, 'stale adapter must not send wildcard Stop into replacement generation');
  await assert.rejects(async () => adapter.command({type: 'play'}), {name: 'AbortError'});
});

test('Native CD-DA rejects invalid timing, expired sessions and malformed chunk limits without resuming stale playback', async () => {
  const fixture = native({maxChunkBytes: 0}), adapter = createNativeCdda(fixture.synth);
  await assert.rejects(adapter.prepare(new Uint8Array(4), 'bad-limit'), /chunk limit/);
  assert.equal(fixture.uploads.size, 0); assert.equal(chunks(fixture).length, 0);
  await assert.rejects(async () => adapter.command({type: 'play'}, {at: Infinity}), /time/);
  await assert.rejects(async () => adapter.command({type: 'play'}, {at: Number.MAX_VALUE}), /frame/);
  fixture.synth.session++;
  await assert.rejects(async () => adapter.command({type: 'play'}), {name: 'AbortError'});
  const before = actions(fixture).length; adapter.dispose(); assert.equal(actions(fixture).length, before);
});
