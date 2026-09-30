/** Node.js: PCMを一度登録し、名前で2回再生してWAVへ保存する。 */
import {readFile, writeFile} from 'node:fs/promises';
import {createYm2612} from '../../web/ym2612.js';
import {YM2612Synth, YM2612DirectTransport} from '../../web/ym2612synth.js';
import moduleFactory from '../../docs/generated/ym2612_wasm.js';
import {encodeStereoWav} from '../../docs/vgm_analyzer/vgm_wav.js';
import {downsamplePreview} from './preview_pcm.js';

const chip = await createYm2612(moduleFactory, {
  wasmBinary: await readFile(new URL('../../docs/generated/ym2612_wasm.wasm', import.meta.url)),
});
try {
  const transport = new YM2612DirectTransport(chip);
  const synth = new YM2612Synth({transport});
  const sampleRate = 11025;
  // unsigned 8-bit mono PCM。128が無音。WAVのファイル全体は渡さない。
  const pcmBytes = Uint8Array.from({length: sampleRate / 2}, (_, i) => {
    const fade = Math.min(1, i / 110, (Math.floor(sampleRate / 2) - 1 - i) / 110);
    return Math.round(128 + 80 * fade * Math.sin(2 * Math.PI * 440 * i / sampleRate));
  });
  await synth.dac.setSample('voice', pcmBytes, {sampleRate});
  // 左右には同じモノラル信号を出力。左右別々のPCMを鳴らす機能ではない。
  await synth.dac.playFromSample('voice');
  await synth.dac.playFromSample('voice', {when: 0.75});

  // DACのタイムラインも進めるため、chip.generateStereoではなくtransportで生成する。
  const nativeRate = chip.sampleRate();
  const pcm = transport.generateStereo(Math.ceil(nativeRate * 1.5));
  const outputRate = 48000;
  const output = process.argv[2] ?? new URL('./ym2612_dac_sample.wav', import.meta.url);
  await writeFile(output, encodeStereoWav(
    downsamplePreview(pcm.left, nativeRate, outputRate),
    downsamplePreview(pcm.right, nativeRate, outputRate), outputRate,
  ));
  console.log(`Saved: ${output}`);
} finally {
  chip.dispose();
}
