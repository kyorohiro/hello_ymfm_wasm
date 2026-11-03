/** Node.js で YM2608 のFM 6 CHを順番・同時に発音し、16 bit ステレオ WAV に保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { downsamplePreview } from "./preview_pcm.js";
import { Ym2608, YM2608_CLOCK } from "../../web/ym2608.js";
import { YM2608Synth, YM2608DirectTransport } from "../../web/ym2608synth.js";
import { FM_PRESETS } from "../../web/megasynth-fm-presets.js";
import { hzToBlockFnum } from "../../web/pitch.js";
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
    // FM 6 CHはSynthの初期化・reset()で有効になる。リズムROMは不要。
    const sampleRate = chip.sampleRate(YM2608_CLOCK);
    const frequencies = [220, 277.182631, 329.627557, 440, 554.365262, 659.255114];
    const chunks = [];
    const render = seconds => chunks.push(chip.generateStereo(Math.round(sampleRate * seconds)));
    const pitches = frequencies.map(hz => hzToBlockFnum(hz, YM2608_CLOCK));
    for (let channel = 0; channel < 6; channel++) {
      synth.setPreset(channel, FM_PRESETS["sine"]);
      // 同時発音で加算されるのでTL=20。CH1..3は左、CH4..6は右。
      synth.setOperator(channel, 3, { tl: 20 });
      synth.setPan(channel, channel < 3, channel >= 3);
      const {block, fnum} = pitches[channel];
      synth.noteOn(channel, block, fnum);
      render(0.5);
      synth.noteOff(channel);
      render(0.25);
    }
    // 6 CHを同時に発音する。
    pitches.forEach(({block, fnum}, channel) => synth.noteOn(channel, block, fnum));
    render(2);
    for (let channel = 0; channel < 6; channel++) synth.noteOff(channel);
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
    const output = process.argv[2] ?? new URL("./ym2608.wav", import.meta.url);
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
