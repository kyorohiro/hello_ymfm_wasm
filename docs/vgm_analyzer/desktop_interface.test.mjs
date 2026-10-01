import test from 'node:test';
import assert from 'node:assert/strict';
import {connectDesktop} from './desktop_interface.js';

test('ordinary web and incompatible shells keep their normal file picker', () => {
  for (const host of [{}, {__tetoricaDesktop: {version: 2, available: true}}]) {
    const desktop = connectDesktop({openFiles() { throw Error('unexpected import'); }}, host);
    assert.equal(desktop.available, false);
    desktop.disconnect();
  }
});
test('desktop receiver passes lazy files to the existing importer and disconnects', async () => {
  let receiver, reads = 0, disconnected = false;
  const host = {__tetoricaDesktop: {version: 1, available: true, connect(handler) {
    receiver = handler; return () => { disconnected = true; };
  }}};
  const desktop = connectDesktop({openFiles: async files => {
    assert.equal(reads, 0);
    assert.equal(files[0].name, 'album/01.vgm');
    await files[0].arrayBuffer();
  }}, host);
  assert.equal(desktop.available, true);
  await receiver([{name: 'album/01.vgm', arrayBuffer: async () => { reads++; return new ArrayBuffer(4); }}]);
  assert.equal(reads, 1);
  desktop.disconnect(); assert.equal(disconnected, true);
});
