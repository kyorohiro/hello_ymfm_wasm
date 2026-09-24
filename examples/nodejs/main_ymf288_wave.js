/** Node.js で YMF288 の単音を生成し、16 bit ステレオ WAV に保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { downsamplePreview } from "./preview_pcm.js";
import { createYmf288, YMF288_CLOCK } from "../../web/ymf288.js";
import { YMF288Synth } from "../../web/opn_variant_synth.js";
import { OPNDirectTransport } from "../../web/opn_fm_synth.js";
import { FM_PRESETS } from "../../web/megadrive-fm-presets.js";
import { hzToBlockFnum } from "../../web/pitch.js";
import { encodeStereoWav } from "../../docs/vgm_analyzer/vgm_wav.js";
import moduleFactory from "../../docs/generated/ymf288_wasm.js";

async function main() {
  const chip = await createYmf288(moduleFactory, {
    wasmBinary: await readFile(
      new URL("../../docs/generated/ymf288_wasm.wasm", import.meta.url),
    ),
  });

  try {
    const synth = new YMF288Synth({
      transport: new OPNDirectTransport(chip, { chipName: "YMF288", portCount: 2 }),
    });
    const sampleRate = chip.sampleRate(YMF288_CLOCK);
    const channel = 0; // 物理 CH1。MIDI チャンネルではない。

    synth.setPreset(channel, FM_PRESETS["sine"]);
    // sine の発音 Operator の減衰を0にし、試聴しやすい音量にする。
    synth.setOperator(channel, 3, { tl: 0 });
    const { block, fnum } = hzToBlockFnum(440, YMF288_CLOCK);
    synth.noteOn(channel, block, fnum);

    // 実時間で待たず、Key On の状態で3秒分の PCM を計算する。
    const tone = chip.generateStereo(Math.round(sampleRate * 3));
    synth.noteOff(channel);
    // Key Off 後の余韻も0.5秒分生成する。
    const tail = chip.generateStereo(Math.round(sampleRate * 0.5));

    const frames = tone.left.length + tail.left.length;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left.set(tone.left);
    left.set(tail.left, tone.left.length);
    right.set(tone.right);
    right.set(tail.right, tone.right.length);

    // 引数で保存先を指定できる。省略時はこのスクリプトの隣に保存する。
    const output = process.argv[2] ?? new URL("./ymf288.wav", import.meta.url);
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
