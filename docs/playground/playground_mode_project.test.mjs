import test from 'node:test';
import assert from 'node:assert/strict';
import {saveModeProject, consumeModeProject} from './playground_mode_project.js';

// The real store uses IndexedDB structured cloning, including at write time.
function memoryIndexedDB() {
  const values = new Map();
  let connections = 0, closed = 0;
  const indexedDB = {
    values,
    failure: null,
    get connections() {return connections;},
    get closed() {return closed;},
    open() {
      const request = {};
      queueMicrotask(() => {
        if (indexedDB.failure === 'open') {
          request.error = Error('open failed');
          request.onerror();
          return;
        }
        connections++;
        request.result = {
          close() {closed++;},
          transaction() {
            const transaction = {};
            const execute = (operation, key, value) => {
              const request = {};
              const copied = operation === 'put' ? structuredClone(value) : undefined;
              queueMicrotask(() => {
                if (indexedDB.failure === operation) {
                  transaction.error = Error(`${operation} failed`);
                  transaction.onabort();
                  return;
                }
                if (operation === 'put') {values.set(key, copied); request.result = key;}
                else if (operation === 'get') request.result = structuredClone(values.get(key));
                else values.delete(key);
                transaction.oncomplete();
              });
              return request;
            };
            transaction.objectStore = () => ({
              put: (value, key) => execute('put', key, value),
              get: key => execute('get', key),
              delete: key => execute('delete', key),
            });
            return transaction;
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
  return indexedDB;
}

const snapshot = () => ({
  version: 1,
  activePath: '/song.js',
  runPath: '/song.js',
  directories: ['/samples'],
  metadata: {title: 'Unsaved song'},
  hasMetadataFile: true,
  files: [
    {path: '/song.js', data: 'await play("C4"); // 未保存'},
    {path: '/samples/tone.bin', data: new Uint8Array([0, 128, 255])},
  ],
});

test('mode reload preserves the complete project and cloned binary arrays', async () => {
  const indexedDB = memoryIndexedDB(), project = snapshot(), expected = structuredClone(project);
  const token = await saveModeProject(indexedDB, 'pc98', project);
  project.files[1].data.fill(42);
  project.files[0].data = 'changed after saving';
  const restored = await consumeModeProject(indexedDB, 'pc98', token);
  assert.deepEqual(restored, expected);
  assert.ok(restored.files[1].data instanceof Uint8Array);
  assert.match(token, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  assert.equal(indexedDB.closed, indexedDB.connections);
});

test('a target mismatch leaves the project available for the intended mode', async () => {
  const indexedDB = memoryIndexedDB(), project = snapshot();
  const token = await saveModeProject(indexedDB, 'pc98', project);
  assert.equal(await consumeModeProject(indexedDB, 'genesis', token), null);
  assert.equal(indexedDB.values.size, 1);
  assert.deepEqual(await consumeModeProject(indexedDB, 'pc98', token), project);
  assert.equal(indexedDB.closed, indexedDB.connections);
});

test('successful consumption deletes the handoff and subsequent consumption is empty', async () => {
  const indexedDB = memoryIndexedDB(), project = snapshot();
  const token = await saveModeProject(indexedDB, 'genesis', project);
  assert.deepEqual(await consumeModeProject(indexedDB, 'genesis', token), project);
  assert.equal(indexedDB.values.size, 0);
  assert.equal(await consumeModeProject(indexedDB, 'genesis', token), null);
  assert.equal(indexedDB.closed, indexedDB.connections);
});

test('unsupported handoff versions and invalid snapshots remain unconsumed', async () => {
  const indexedDB = memoryIndexedDB();
  const token = await saveModeProject(indexedDB, 'genesis', snapshot());
  const saved = indexedDB.values.get(`mode-project:${token}`);
  saved.version = 2;
  assert.equal(await consumeModeProject(indexedDB, 'genesis', token), null);
  saved.version = 1;
  saved.snapshot.version = 2;
  assert.equal(await consumeModeProject(indexedDB, 'genesis', token), null);
  assert.equal(indexedDB.values.size, 1);
  assert.equal(indexedDB.closed, indexedDB.connections);
});

test('storage failures reject, close the connection and retain handoffs for a retry', async () => {
  const indexedDB = memoryIndexedDB();
  indexedDB.failure = 'open';
  await assert.rejects(saveModeProject(indexedDB, 'genesis', snapshot()), /open failed/);
  indexedDB.failure = 'put';
  await assert.rejects(saveModeProject(indexedDB, 'genesis', snapshot()), /put failed/);
  assert.equal(indexedDB.values.size, 0);
  assert.equal(indexedDB.closed, indexedDB.connections);
  indexedDB.failure = null;
  const token = await saveModeProject(indexedDB, 'genesis', snapshot());
  for (const failure of ['get', 'delete']) {
    indexedDB.failure = failure;
    await assert.rejects(consumeModeProject(indexedDB, 'genesis', token), new RegExp(`${failure} failed`));
    assert.equal(indexedDB.values.size, 1);
    assert.equal(indexedDB.closed, indexedDB.connections);
  }
  indexedDB.failure = null;
  assert.deepEqual(await consumeModeProject(indexedDB, 'genesis', token), snapshot());
});
