/** Node.js で YM2612 のDACへ8 bit PCMを供給してWAVに保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { downsamplePreview } from "./preview_pcm.js";
import { createYm2612, YM2612_CLOCK } from "../../web/ym2612.js";
import { YM2612Synth, YM2612DirectTransport } from "../../web/ym2612synth.js";
import { encodeStereoWav } from "../../docs/vgm_analyzer/vgm_wav.js";
import moduleFactory from "../../docs/generated/ym2612_wasm.js";

async function main() {
  const chip = await createYm2612(moduleFactory, {
    wasmBinary: await readFile(
      new URL("../../docs/generated/ym2612_wasm.wasm", import.meta.url),
    ),
  });

  try {
    const synth = new YM2612Synth({
      transport: new YM2612DirectTransport(chip),
    });
    const sampleRate = chip.sampleRate(YM2612_CLOCK);
    // DAC は物理 CH6 の FM 出力を置き換える。キーオンは不要。
    synth.setPan(5, true, true);
    synth.writeDac(128); // unsigned 8 bit の中心値
    synth.setDacEnabled(true);

    // 自作の PCM を 22,050 Hz で DAC に供給する。ここでは A4 のサイン波。
    const dacRate = 22050;
    const seconds = 3;
    const count = Math.round(dacRate * seconds);
    const tone = {
      left: new Float32Array(Math.round(sampleRate * seconds)),
      right: new Float32Array(Math.round(sampleRate * seconds)),
    };
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      // 冒頭・末尾10msを滑らかにし、クリック音を抑える。
      const envelope = Math.min(1, i / (dacRate * 0.01), (count - 1 - i) / (dacRate * 0.01));
      const value = Math.round(128 + 96 * envelope * Math.sin(2 * Math.PI * 440 * i / dacRate));
      synth.writeDac(value);
      // 書き込んだ値を次のDACサンプル時刻まで保持する。
      // 累積時刻から計算し、毎回の丸めによる速度のずれを防ぐ。
      const next = Math.round((i + 1) * sampleRate / dacRate);
      const chunk = chip.generateStereo(next - cursor);
      tone.left.set(chunk.left, cursor);
      tone.right.set(chunk.right, cursor);
      cursor = next;
    }
    synth.writeDac(128);
    synth.setDacEnabled(false);
    const tail = chip.generateStereo(Math.round(sampleRate * 0.5));

    const frames = tone.left.length + tail.left.length;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left.set(tone.left);
    left.set(tail.left, tone.left.length);
    right.set(tone.right);
    right.set(tail.right, tone.right.length);

    // 引数で保存先を指定できる。省略時はこのスクリプトの隣に保存する。
    const output = process.argv[2] ?? new URL("./ym2612_dac.wav", import.meta.url);
    // ネイティブPCMを実際に変換する。ヘッダーのレートだけ変えてはいけない。
    const outputRate = 48000;
    const previewLeft = downsamplePreview(left, sampleRate, outputRate);
    const previewRight = downsamplePreview(right, sampleRate, outputRate);
    await writeFile(output, encodeStereoWav(previewLeft, previewRight, outputRate));
    console.log(`Saved: ${output instanceof URL ? fileURLToPath(output) : output}`);
    console.log(`Native: ${sampleRate} Hz → WAV: ${outputRate} Hz, ${previewLeft.length} frames`);
  } finally {
    chip.dispose();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
