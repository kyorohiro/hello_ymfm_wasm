import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./vgm_analyzer.js', import.meta.url), 'utf8');
function setup(track) {
  const calls = [];
  const context = vm.createContext({
    Uint8Array, currentBuffer: track, currentChipKind: 'ym2608',
    ym2608AdpcmARomBytes: null, ym2608AdpcmARomName: '',
    engine: {loadAdpcmARom: bytes => calls.push(['rom', bytes.length])},
    player: {stop: () => calls.push(['stop'])},
    stopActiveStream: () => calls.push(['stream-stop']),
    sampleExplorer: {reset() {}},
    applySourceMutes: (_, __, mutes) => calls.push(['mutes', mutes.rhythm]),
    sourceChipKind: () => 'ym2608', effectiveSourceMutes: () => ({rhythm: false}), hasOkiSource: () => false,
    playbackWarnings: new Set(['missing']), YM2608_RHYTHM_ROM_WARNING: 'missing',
    renderPlaybackWarnings() {}, romFileStatus: {},
    setPlaybackError: () => calls.push(['clear-error']),
    updatePlaybackButtons: () => calls.push(['buttons']),
    setStatus: message => calls.push(['status', message]),
  });
  vm.runInContext(source.slice(source.indexOf('async function handleYm2608RomFile'), source.indexOf('// Playlist operations')), context);
  return {context, calls, load: size => context.handleYm2608RomFile({name: 'test.bin', arrayBuffer: async () => new ArrayBuffer(size)})};
}
test('ROM-only import prompts for music; loaded track import restores playback controls', async () => {
  for (const track of [null, new ArrayBuffer(256)]) {
    const h = setup(track);
    await h.load(8192);
    assert.ok(h.calls.some(c => c[0] === 'rom' && c[1] === 8192));
    assert.ok(h.calls.some(c => c[0] === 'mutes' && c[1] === false));
    assert.ok(h.calls.some(c => c[0] === 'buttons'));
    assert.ok(h.calls.some(c => c[0] === 'clear-error'));
    assert.match(h.calls.at(-1)[1], track ? /Press Play/ : /Next, select a VGM/);
    assert.equal(h.context.playbackWarnings.size, 0);
  }
});
test('invalid ROM does not replace valid bytes or stop playback', async () => {
  const h = setup(new ArrayBuffer(256));
  await h.load(8192);
  const previous = h.context.ym2608AdpcmARomBytes;
  h.calls.length = 0;
  await assert.rejects(h.load(8191), /8192/);
  assert.equal(h.context.ym2608AdpcmARomBytes, previous);
  assert.ok(!h.calls.some(c => c[0] === 'stop' || c[0] === 'rom'));
});
