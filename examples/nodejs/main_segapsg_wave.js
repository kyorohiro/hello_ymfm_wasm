/** Node.js で Sega PSG の単音・和音・ノイズを生成し、16 bit ステレオ WAV に保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SegaPSG, SEGAPSG_CLOCK } from "../../web/segapsg.js";
import { createSegaPsgApi } from "../../web/segapsg_api.js";
import { encodeStereoWav } from "../../docs/vgm_analyzer/vgm_wav.js";
import moduleFactory from "../../docs/generated/segapsg_wasm.js";

async function main() {
  const chip = await SegaPSG.create({
    moduleFactory,
    moduleOptions: {
      wasmBinary: await readFile(new URL("../../docs/generated/segapsg_wasm.wasm", import.meta.url)),
    },
    clock: SEGAPSG_CLOCK, // 高級APIの音名・Hz変換と同じクロックを使用する。
    sampleRate: 48000,   // PSGコアは指定した出力レートでPCMを生成できる。
  });
  try {
    // Playground と同じ高級API。Node.jsではレジスタ書き込みをチップへ直接つなぐ。
    const psg = createSegaPsgApi({
      write: value => chip.write(value),
      reset: () => chip.reset(),
    });
    psg.reset();
    const sampleRate = chip.sampleRate();
    const chunks = [];
    const render = seconds => chunks.push(chip.generateStereo(Math.round(sampleRate * seconds)));

    // 0..3秒：物理CH1でA4の矩形波。CHの添字は0..2。
    // attenuation: 0が最大音量、15が消音。volume: 0..1でも指定可能。
    psg.tone(0, { note: "A4", attenuation: 4 });
    render(3);
    psg.off(0);
    render(0.5);

    // 3.5..4.5秒：3つのトーンCHで和音。note / frequency / period を指定できる。
    psg.tone(0, { note: "C4", attenuation: 8 });
    psg.tone(1, { frequency: 329.627557, attenuation: 8 }); // E4
    psg.tone(2, { note: "G4", attenuation: 8 });
    render(1);
    for (let channel = 0; channel < 3; channel++) psg.off(channel);
    render(0.5);

    // 5..6秒：独立したノイズCH。type: "periodic" も指定可能。
    psg.noise({ type: "white", rate: "medium", attenuation: 8 });
    render(1);
    psg.noiseOff(); // psg.off() はトーンCH用、ノイズはこちらで停止する。
    render(0.5);

    const frames = chunks.reduce((sum, chunk) => sum + chunk.left.length, 0);
    const left = new Float32Array(frames), right = new Float32Array(frames);
    let offset = 0;
    for (const chunk of chunks) {
      left.set(chunk.left, offset);
      right.set(chunk.right, offset);
      offset += chunk.left.length;
    }
    // 省略時はスクリプトの隣に保存。同名ファイルは上書きする。
    const output = process.argv[2] ?? new URL("./segapsg.wav", import.meta.url);
    await writeFile(output, encodeStereoWav(left, right, sampleRate));
    console.log(`Saved: ${output instanceof URL ? fileURLToPath(output) : output}`);
    console.log(`WAV: ${sampleRate} Hz, ${frames} frames (${frames / sampleRate} seconds)`);
  } finally {
    chip.dispose();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
