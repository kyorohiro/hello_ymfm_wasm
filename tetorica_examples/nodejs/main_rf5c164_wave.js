/** Node.js で RF5C164 の波形RAM・ピッチ・左右出力を試し、WAVに保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Rf5c164, RF5C164_CLOCK } from "../../web/rf5c164.js";
import { RF5C164Synth, RF5C164DirectTransport } from "../../web/rf5c164synth.js";
import { encodeStereoWav } from "../../docs/vgm_analyzer/vgm_wav.js";
import moduleFactory from "../../docs/generated/rf5c164_wasm.js";

async function main() {
  const chip = await Rf5c164.create({
    moduleFactory,
    moduleOptions: {
      wasmBinary: await readFile(new URL("../../docs/generated/rf5c164_wasm.wasm", import.meta.url)),
    },
    clock: RF5C164_CLOCK,
    sampleRate: 48000,
  });
  try {
    // PlaygroundのWorkletと共通のSynth。DirectTransportでチップへ直接接続する。
    // Node.jsでは同期実行なので、各CH操作にawaitは不要。
    const pcm = new RF5C164Synth({
      transport: new RF5C164DirectTransport(chip),
    });
    pcm.reset();
    chip.clearMemory();
    const sampleRate = chip.sampleRate();

    // 1周期256サンプルのサイン波を、RF5C164固有の生バイトにする。
    // bit7=正、下位7bit=振幅。0xffはループマーカーなので波形には使わない。
    const waveLength = 256;
    const bytes = new Uint8Array(waveLength + 8);
    for (let i = 0; i < waveLength; i++) {
      const value = Math.sin(2 * Math.PI * i / waveLength);
      bytes[i] = Math.round(Math.abs(value) * 100) | (value >= 0 ? 0x80 : 0);
    }
    // この例の最大stepは1更新で約5.2 byte進むため、マーカーを8 byte配置する。
    // 1 byteだけだと飛び越えてループしなくなることがある。
    bytes.fill(0xff, waveLength);
    pcm.loadMemory(bytes, 0x0000); // 64 KiBの波形RAM。WAVのバイト列ではない。

    // 内部更新レートは clock / 384、stepは小数部11bitのアドレス進み幅。
    // この式は「1周期がwaveLengthサンプルの波形」をループする場合の近似。
    // マーカー検出時に位置を戻すため、実際の周期には更新単位の丸めがある。
    const stepForHz = hz => Math.round(hz * waveLength * 2048 / (RF5C164_CLOCK / 384));
    const chunks = [];
    const render = seconds => chunks.push(chip.generateStereo(Math.round(sampleRate * seconds)));

    // 0..1秒：物理CH1（添字0）で約440 Hz、左右両方へ出力。
    pcm.setChannel(0, {
      start: 0x0000,      // 開始位置は256 byte境界。
      loopStart: 0x0000,  // 0xffに到達するとこのアドレスへ戻る。
      step: stepForHz(440),
      volume: 160,       // 0..255
      pan: { left: 15, right: 15 }, // 左右それぞれ0..15
    });
    pcm.keyOn(0);
    render(1);

    // 1..2秒：発音したままstepだけ変更する（他の設定は維持）。
    pcm.setChannel(0, { step: stepForHz(660) });
    render(1);

    // 2..3秒：同じRAMの波形を2 CHで共有。左約440 Hz、右約660 Hz。
    pcm.setChannel(0, { step: stepForHz(440), pan: { left: 15, right: 0 } });
    pcm.setChannel(1, {
      start: 0, loopStart: 0, step: stepForHz(660), volume: 160,
      pan: { left: 0, right: 15 },
    });
    pcm.keyOn(1);
    render(1);
    pcm.keyOff(0);
    pcm.keyOff(1);
    render(0.5);

    const frames = chunks.reduce((sum, chunk) => sum + chunk.left.length, 0);
    const left = new Float32Array(frames), right = new Float32Array(frames);
    let offset = 0;
    for (const chunk of chunks) {
      left.set(chunk.left, offset);
      right.set(chunk.right, offset);
      offset += chunk.left.length;
    }
    const output = process.argv[2] ?? new URL("./rf5c164.wav", import.meta.url);
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
