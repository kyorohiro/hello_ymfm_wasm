/** Node.js で YM2203 のSSGのトーン・ノイズ・エンベロープを生成し、16 bit ステレオ WAV に保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { downsamplePreview } from "./preview_pcm.js";
import { Ym2203, YM2203_CLOCK } from "../../web/ym2203.js";
import { YM2203Synth, YM2203DirectTransport } from "../../web/ym2203synth.js";
import { encodeStereoWav } from "../../docs/vgm_analyzer/vgm_wav.js";
import moduleFactory from "../../docs/generated/ym2203_wasm.js";

async function main() {
  const chip = await Ym2203.create({
    moduleFactory,
    moduleOptions: {
      wasmBinary: await readFile(
        new URL("../../docs/generated/ym2203_wasm.wasm", import.meta.url),
      ),
    },
  });

  try {
    const synth = new YM2203Synth({
      transport: new YM2203DirectTransport(chip),
    });
    const sampleRate = chip.sampleRate(YM2203_CLOCK);
    // FMと同じSynthを作り、SSGは synth.ssg から操作する。
    // FM OperatorのSSG-EGパラメーターとは別の、内蔵3 CH矩形波音源。
    const ssg = synth.ssg;
    ssg.reset(); // SSGだけ初期化。FMはリセットしない。
    const chunks = [];
    const render = seconds => chunks.push(chip.generateStereo(Math.round(sampleRate * seconds)));

    // 0..3秒：SSG CH1でA4。volumeは0が無音、15が最大（PSGのattenuationとは逆）。
    ssg.tone(0, { frequency: 440, volume: 12 });
    render(3);
    ssg.off(0);
    render(0.5);

    // 3.5..4.5秒：SSG CH2でノイズ。ノイズ周期は3 CHで共有する。
    ssg.noise(1, { period: 16, volume: 10 });
    render(1);
    ssg.off(1);
    render(0.5);

    // 5..6秒：SSG CH3の矩形波を共有エンベロープで減衰させる。
    // shape=9は減衰して0を保持。shapeの再書き込みで再トリガーできる。
    ssg.setEnvelope({ period: 4000, shape: 9 });
    ssg.tone(2, { frequency: 660, envelope: true });
    render(1);
    ssg.off(2);
    render(0.5);

    const frames = chunks.reduce((sum, chunk) => sum + chunk.left.length, 0);
    const left = new Float32Array(frames), right = new Float32Array(frames);
    let offset = 0;
    for (const chunk of chunks) {
      left.set(chunk.left, offset);
      right.set(chunk.right, offset);
      offset += chunk.left.length;
    }

    // 引数で保存先を指定できる。省略時はこのスクリプトの隣に保存する。
    const output = process.argv[2] ?? new URL("./ym2203_ssg.wav", import.meta.url);
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
