/** Node.js で YM2610B のADPCM-Bでサイン波を生成し、16 bit ステレオ WAV に保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { downsamplePreview } from "./preview_pcm.js";
import { Ym2610B, YM2610B_CLOCK } from "../../web/ym2610b.js";
import { YM2610BSynth, YM2610BDirectTransport } from "../../web/ym2610bsynth.js";
import { encodeStereoWav } from "../../docs/vgm_analyzer/vgm_wav.js";
import moduleFactory from "../../docs/generated/ym2610b_wasm.js";

// デモ専用の簡単なADPCM-Bエンコーダー。各ニブルを実際に復号した誤差で選ぶ。
// WAV読み込み用APIではない。ADPCM-A（内蔵リズム）とは形式が異なる。
function encodeSine() {
  const rate = 16000, samples = 8192; // 440 Hz、0.512秒。4096 byte = 256 byte × 16。
  const bytes = new Uint8Array(samples / 2);
  const scale = [57, 57, 57, 57, 77, 102, 128, 153];
  let accumulator = 0, step = 127;
  for (let i = 0; i < samples; i++) {
    const target = Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / rate));
    let code = 0, best = Infinity, next = 0;
    for (let nibble = 0; nibble < 16; nibble++) {
      const delta = Math.floor(((nibble & 7) * 2 + 1) * step / 8);
      const value = Math.max(-32768, Math.min(32767, accumulator + (nibble & 8 ? -delta : delta)));
      if (Math.abs(target - value) < best) {
        best = Math.abs(target - value); code = nibble; next = value;
      }
    }
    accumulator = next;
    step = Math.max(127, Math.min(24576, Math.floor(step * scale[code & 7] / 64)));
    bytes[i >> 1] |= code << (i % 2 ? 0 : 4); // 上位ニブルが先。
  }
  return {bytes, rate};
}

async function main() {
  const chip = await Ym2610B.create({
    moduleFactory,
    moduleOptions: {
      wasmBinary: await readFile(
        new URL("../../docs/generated/ym2610b_wasm.wasm", import.meta.url),
      ),
    },
  });

  try {
    const synth = new YM2610BSynth({
      transport: new YM2610BDirectTransport(chip),
    });
    const sampleRate = chip.sampleRate(YM2610B_CLOCK);
    const adpcm = synth.adpcmB;
    const {bytes, rate} = encodeSine(); // 外部ROM不要。自分で生成したADPCM-Bデータ。
    adpcm.loadMemory(bytes, 0);
    adpcm.reset(); // メモリーは保持。FM・SSG・リズムには触れない。
    adpcm.setSample({start: 0, end: bytes.length}); // endは排他的、両端256 byte境界。
    adpcm.setVolume(200);
    adpcm.setPan(true, true);
    adpcm.setPlaybackRate(rate);
    const chunks = [];
    const render = seconds => chunks.push(chip.generateStereo(Math.round(sampleRate * seconds)));

    adpcm.keyOn(); // 0.512秒のワンショット。終端で自動停止。
    render(0.75);
    adpcm.setPan(true, false);
    adpcm.keyOn({repeat: true}); // 左で繰り返す。
    render(1.5);
    adpcm.setPan(false, true);
    adpcm.setPlaybackRate(rate * 2); // 再生中に2倍速・1オクターブ上へ。右へ出力。
    render(1);
    adpcm.keyOff();
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
    const output = process.argv[2] ?? new URL("./ym2610b_adpcm.wav", import.meta.url);
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
