/** Node.js で YM2608 の内蔵リズム6音を生成し、16 bit ステレオ WAV に保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { downsamplePreview } from "./preview_pcm.js";
import { Ym2608, YM2608_CLOCK } from "../../web/ym2608.js";
import { YM2608Synth, YM2608DirectTransport } from "../../web/ym2608synth.js";
import { encodeStereoWav } from "../../docs/vgm_analyzer/vgm_wav.js";
import moduleFactory from "../../docs/generated/ym2608_wasm.js";

async function main() {
  const chip = await Ym2608.create({
    moduleFactory,
    moduleOptions: {
      wasmBinary: await readFile(
        new URL("../../docs/generated/ym2608_wasm.wasm", import.meta.url),
      ),
    },
  });

  try {
    const synth = new YM2608Synth({
      transport: new YM2608DirectTransport(chip),
    });
    const sampleRate = chip.sampleRate(YM2608_CLOCK);
    // 実機の内蔵ROMに相当する8 KiBのデータを、エミュレーターへ渡す。
    // 第2引数がROMパス。省略時はリポジトリー直下のファイルを使う。
    const romPath = process.argv[3] ?? new URL("../../ym2608_adpcm_rom.bin", import.meta.url);
    let rom;
    try { rom = await readFile(romPath); }
    catch (cause) { throw new Error("Rhythm ROM is required: pass an 8 KiB ym2608_adpcm_rom.bin as the second argument", {cause}); }
    const rhythm = synth.rhythm;
    rhythm.loadRom(rom);
    rhythm.reset();
    rhythm.setVolume(48); // 0..63。大きいほど大音量。
    const voices = ["bassDrum", "snare", "cymbal", "hiHat", "tom", "rimShot"];
    const chunks = [];
    const render = seconds => chunks.push(chip.generateStereo(Math.round(sampleRate * seconds)));
    for (const voice of voices) {
      rhythm.setVoice(voice, {volume: 24, left: true, right: true});
      rhythm.keyOn(voice);
      render(0.75);
      rhythm.keyOff(voice);
      render(0.25);
    }
    // 配列で複数の打楽器を同時発音。左右の振り分けと連続トリガーの例。
    rhythm.setVoice("snare", {left: true, right: false});
    rhythm.setVoice("hiHat", {left: false, right: true});
    for (let step = 0; step < 8; step++) {
      rhythm.keyOn([step % 2 ? "snare" : "bassDrum", "hiHat"]);
      render(0.25);
    }
    rhythm.keyOff(voices);
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
    const output = process.argv[2] ?? new URL("./ym2608_rhythm.wav", import.meta.url);
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
