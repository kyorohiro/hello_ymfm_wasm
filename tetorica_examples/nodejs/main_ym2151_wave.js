/** Node.js で YM2151 (OPM) の単音を生成し、16 bit ステレオ WAV に保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { downsamplePreview } from "./preview_pcm.js";
import { Ym2151, YM2151_CLOCK } from "../../web/ym2151.js";
import { encodeStereoWav } from "../../docs/vgm_analyzer/vgm_wav.js";
import moduleFactory from "../../docs/generated/ym2151_wasm.js";

async function main() {
  const chip = await Ym2151.create({
    moduleFactory,
    moduleOptions: {
      wasmBinary: await readFile(
        new URL("../../docs/generated/ym2151_wasm.wasm", import.meta.url),
      ),
    },
  });

  try {
    // YM2151 はアドレスポート0 → データポート1の順で書き込む。
    const writeRegister = (register, value) => {
      chip.write(0, register);
      chip.write(1, value);
    };
    const sampleRate = chip.sampleRate(YM2151_CLOCK);
    const channel = 0; // 物理 CH1。MIDI チャンネルではない。
    const operator = 3; // レジスタ順 M1 / C1 / M2 / C2 の C2。
    const offset = operator * 8 + channel;

    chip.reset();
    writeRegister(0x20 + channel, 0xc0 | 7); // 左右出力、Algorithm 7、Feedback 0。
    writeRegister(0x40 + offset, 0x01); // DT1=0、MUL=1。
    writeRegister(0x60 + offset, 0x00); // TL=0（減衰なし）。
    writeRegister(0x80 + offset, 0x1f); // KS=0、AR=31。
    writeRegister(0xa0 + offset, 0x00); // AM無効、D1R=0。
    writeRegister(0xc0 + offset, 0x00); // DT2=0、D2R=0。
    writeRegister(0xe0 + offset, 0x0f); // D1L=0、RR=15。
    // OPM は OPN の Block/F-number ではなく Key Code / Key Fraction を使う。
    writeRegister(0x28 + channel, 0x4a); // 既定クロックで A4（約440 Hz）。
    writeRegister(0x30 + channel, 0x00); // Key Fraction=0。
    writeRegister(0x08, channel | (8 << 3)); // C2だけ Key On。

    // 実時間で待たず、発音3秒＋Key Off後の余韻0.5秒を計算する。
    const tone = chip.generateStereo(Math.round(sampleRate * 3));
    writeRegister(0x08, channel);
    const tail = chip.generateStereo(Math.round(sampleRate * 0.5));
    const frames = tone.left.length + tail.left.length;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left.set(tone.left);
    left.set(tail.left, tone.left.length);
    right.set(tone.right);
    right.set(tail.right, tone.right.length);

    const output = process.argv[2] ?? new URL("./ym2151.wav", import.meta.url);
    const outputRate = 48000;
    // ヘッダーだけでなくPCMもネイティブレートから48 kHzへ変換する。
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
