/** Node.js で RF5C164 の波形RAM・ピッチ・左右出力を試し、WAVに保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Rf5c164, RF5C164_CLOCK } from "../../tetorica_src/runtime/rf5c164.js";
import { RF5C164Synth, RF5C164DirectTransport } from "../../tetorica_src/runtime/rf5c164synth.js";
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
    const bytes = new Uint8Array(waveLength + 32);
    for (let i = 0; i < waveLength; i++) {
      const value = Math.sin(2 * Math.PI * i / waveLength);
      bytes[i] = Math.round(Math.abs(value) * 100) | (value >= 0 ? 0x80 : 0);
    }
    // 16 bitのstepが飛び越せる32 byte分をマーカーにして、ループを保つ。
    bytes.fill(0xff, waveLength);
    pcm.loadMemory(bytes, 0x0000); // 64 KiBの波形RAM。WAVのバイト列ではない。

    // 内部更新レートは clock / 384、stepは小数部11bitのアドレス進み幅。
    // この式は「1周期がwaveLengthサンプルの波形」をループする場合の近似。
    // マーカー検出時に位置を戻すため、実際の周期には更新単位の丸めがある。
    const stepForHz = hz => Math.round(hz * waveLength * 2048 / (RF5C164_CLOCK / 384));
    const baseStep = stepForHz(440);
    pcm.setRootNote('A4'); // baseStepで約440 Hzになる、この既知の波形の音名。
    const chunks = [];
    const render = seconds => chunks.push(chip.generateStereo(Math.round(sampleRate * seconds)));

    // 0..1秒：物理CH1（添字0）で約440 Hz、左右両方へ出力。
    pcm.setChannel(0, {
      start: 0x0000,      // 開始位置は256 byte境界。
      loopStart: 0x0000,  // 0xffに到達するとこのアドレスへ戻る。
      step: baseStep,    // 元サンプル速度を宣言。音名による変更はこの値を基準にする。
      volume: 160,       // 0..255
      pan: { left: 15, right: 15 }, // 左右それぞれ0..15
    });
    pcm.noteOn(0, 'A4');
    render(1);

    // 1..2秒：発音したままE5（約659.3 Hz）へ変更。他の設定・基準stepは維持。
    pcm.setNote(0, 'E5');
    render(1);

    // 2..3秒：同じRAMの波形を2 CHで共有。左A4、右E5。
    pcm.setNote(0, 'A4');
    pcm.setChannel(0, { pan: { left: 15, right: 0 } });
    pcm.setChannel(1, {
      start: 0, loopStart: 0, step: baseStep, volume: 160,
      pan: { left: 0, right: 15 },
    });
    pcm.noteOn(1, 'E5');
    render(1);
    pcm.noteOff(0);
    pcm.noteOff(1);
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
