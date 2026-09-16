import test from 'node:test';
import assert from 'node:assert/strict';

test('renders a full (non-looped) track into a valid 16-bit stereo WAV', async () => {
  const { VgmPlayer } = await import('../../web/vgmplayer.js');
  const { vgmBytes } = await import('../../web/test-support/vgm-mock.js');
  const { MockSoundEngine } = await import('../../web/test-support/vgm-engine-mock.js');
  const { renderVgmToWav } = await import('./vgm_wav.js');
  const player = new VgmPlayer(new MockSoundEngine(8000));
  // VGM waits are always in 44100Hz-reference units: 0xac44 = 44100 -> exactly 1s.
  player.load(vgmBytes([0x61, 0x44, 0xac, 0x66]));
  player.play();
  const progress = [];
  // blockFrames divides the rendered length evenly so the natural end lands
  // on a block boundary (rendering pads a partial trailing block with
  // silence up to blockFrames, which is fine for real use but would throw
  // off an exact-length assertion here).
  const result = await renderVgmToWav(player, { maxSeconds: 5, blockFrames: 500, onProgress: p => progress.push(p) });
  assert.equal(result.truncated, false);
  assert.equal(result.seconds, 1);
  assert.equal(result.bytes.length, 44 + 8000 * 4);
  const bytes = result.bytes;
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...bytes.subarray(8, 12)), 'WAVE');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(v.getUint32(24, true), 8000); // sample rate
  assert.equal(v.getUint16(22, true), 2); // stereo
  assert.equal(v.getUint16(34, true), 16); // bits per sample
  assert.equal(v.getUint32(40, true), 8000 * 4); // data chunk size
  assert.equal(progress.at(-1), 1);
});

test('caps rendering at maxSeconds for a track that keeps producing audio (loop enabled)', async () => {
  const { VgmPlayer } = await import('../../web/vgmplayer.js');
  const { vgmBytes } = await import('../../web/test-support/vgm-mock.js');
  const { MockSoundEngine } = await import('../../web/test-support/vgm-engine-mock.js');
  const { renderVgmToWav } = await import('./vgm_wav.js');
  const player = new VgmPlayer(new MockSoundEngine(1000));
  player.load(vgmBytes([0x61, 0x10, 0x27, 0x66])); // wait 10000 (44100Hz ref) samples, then end
  player.setLoopEnabled(true); // no loop point in header -> restarts from position 0 forever
  player.play();
  const result = await renderVgmToWav(player, { maxSeconds: 1, blockFrames: 200 });
  assert.equal(result.truncated, true);
  assert.equal(result.seconds, 1);
  assert.equal(result.bytes.length, 44 + 1000 * 4);
});

test('rejects a non-positive maxSeconds', async () => {
  const { VgmPlayer } = await import('../../web/vgmplayer.js');
  const { vgmBytes } = await import('../../web/test-support/vgm-mock.js');
  const { MockSoundEngine } = await import('../../web/test-support/vgm-engine-mock.js');
  const { renderVgmToWav } = await import('./vgm_wav.js');
  const player = new VgmPlayer(new MockSoundEngine(8000));
  player.load(vgmBytes([0x66]));
  player.play();
  await assert.rejects(() => renderVgmToWav(player, { maxSeconds: 0 }), RangeError);
});
