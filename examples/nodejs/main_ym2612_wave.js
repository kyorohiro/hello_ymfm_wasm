/** Node.js で YM2612 の単音を生成し、16 bit ステレオ WAV に保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createYm2612, YM2612_CLOCK } from "../../web/ym2612.js";
import { YM2612Synth, YM2612DirectTransport } from "../../web/ym2612synth.js";
import { FM_PRESETS } from "../../web/megadrive-fm-presets.js";
import { hzToBlockFnum } from "../../web/pitch.js";
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
    const channel = 0; // 物理 CH1。MIDI チャンネルではない。

    synth.setPreset(channel, FM_PRESETS["sine"]);
    const { block, fnum } = hzToBlockFnum(440, YM2612_CLOCK);
    synth.noteOn(channel, block, fnum);

    // 実時間で待たず、Key On の状態で1秒分の PCM を計算する。
    const tone = chip.generateStereo(Math.round(sampleRate * 1));
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
    const output = process.argv[2] ?? new URL("./ym2612.wav", import.meta.url);
    await writeFile(output, encodeStereoWav(left, right, sampleRate));
    console.log(`Saved: ${output instanceof URL ? fileURLToPath(output) : output}`);
    console.log(`${sampleRate} Hz, ${frames} frames`);
  } finally {
    chip.dispose();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
