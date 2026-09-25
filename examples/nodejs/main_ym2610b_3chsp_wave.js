/** Node.js で YM2610B のCH3 specialで4 Operatorの周波数を独立設定してWAVに保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { downsamplePreview } from "./preview_pcm.js";
import { Ym2610B, YM2610B_CLOCK } from "../../web/ym2610b.js";
import { YM2610BSynth, YM2610BDirectTransport } from "../../web/ym2610bsynth.js";
import { FM_PRESETS } from "../../web/megadrive-fm-presets.js";
import { hzToBlockFnum } from "../../web/pitch.js";
import { encodeStereoWav } from "../../docs/vgm_analyzer/vgm_wav.js";
import moduleFactory from "../../docs/generated/ym2610b_wasm.js";

async function main() {
  const chip = await Ym2610B.create({
    moduleFactory,
    moduleOptions: { wasmBinary: await readFile(new URL("../../docs/generated/ym2610b_wasm.wasm", import.meta.url)) },
  });

  try {
    const synth = new YM2610BSynth({
      transport: new YM2610BDirectTransport(chip),
    });
    const sampleRate = chip.sampleRate(YM2610B_CLOCK);
    const channel = 2; // 物理 CH3 限定。添字は0始まり。
    synth.setPreset(channel, FM_PRESETS["sine"]);
    // Algorithm 7 は4 Operatorが全てキャリア。独立した4音を聴き比べる。
    // 同一CHの音量が加算されるので、各OperatorのTLを20に抑える。
    synth.setAlgo(channel, 7, 0);
    synth.setChannel3SpecialMode(true);
    const frequencies = [220, 277.182631, 329.627557, 440]; // A3, C#4, E4, A4
    frequencies.forEach((hz, operator) => {
      synth.setOperator(channel, operator, { multi: 1, dt: 0, tl: 20 });
      const { block, fnum } = hzToBlockFnum(hz, YM2610B_CLOCK);
      synth.setChannel3SpecialFrequency(operator, block, fnum);
    });
    // noteOn()は通常CHの周波数（OP4）も書き換えるため、ここではkeyOn()。
    synth.keyOn(channel);
    const tone = chip.generateStereo(Math.round(sampleRate * 3));
    synth.keyOff(channel);
    const tail = chip.generateStereo(Math.round(sampleRate * 0.5));
    synth.setChannel3SpecialMode(false);

    const frames = tone.left.length + tail.left.length;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left.set(tone.left);
    left.set(tail.left, tone.left.length);
    right.set(tone.right);
    right.set(tail.right, tone.right.length);

    // 引数で保存先を指定できる。省略時はこのスクリプトの隣に保存する。
    const output = process.argv[2] ?? new URL("./ym2610b_3chsp.wav", import.meta.url);
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
