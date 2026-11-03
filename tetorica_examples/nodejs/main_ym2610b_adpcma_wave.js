/** Node.js で YM2610B のADPCM-Aの6 CHを発音を生成し、16 bit ステレオ WAV に保存する。 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { downsamplePreview } from "./preview_pcm.js";
import { Ym2610B, YM2610B_CLOCK } from "../../web/ym2610b.js";
import { YM2610BSynth, YM2610BDirectTransport } from "../../web/ym2610bsynth.js";
import { encodeStereoWav } from "../../docs/vgm_analyzer/vgm_wav.js";
import moduleFactory from "../../docs/generated/ym2610b_wasm.js";

// ADPCM-Aは12 bitの予測値と49段階のステップを使う。デモ用の誤差最小エンコーダー。
function encodeSine(hz) {
  const steps = [16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552];
  const increments = [-1,-1,-1,-1,2,5,7,9];
  const bytes = new Uint8Array(4096); // 256 byte境界。
  const rate = YM2610B_CLOCK / 432; // ADPCM-Aの固定復号レート。
  let accumulator=0, index=0;
  for (let i=0;i<bytes.length*2;i++) {
    const target=Math.round(1400*Math.sin(2*Math.PI*hz*i/rate)*Math.exp(-i/(rate*0.15)));
    let best=Infinity, code=0, next=0;
    for (let nibble=0;nibble<16;nibble++) {
      const delta=Math.floor((2*(nibble&7)+1)*steps[index]/8);
      let value=(accumulator+(nibble&8?-delta:delta))&4095;
      if (value>=2048) value-=4096;
      if (Math.abs(target-value)<best) {best=Math.abs(target-value);code=nibble;next=value;}
    }
    accumulator=next; index=Math.max(0,Math.min(48,index+increments[code&7]));
    bytes[i>>1]|=code<<(i%2?0:4);
  }
  return bytes;
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
    const adpcm = synth.adpcmA;
    adpcm.reset();
    adpcm.setVolume(48);
    const chunks=[];
    const render=seconds=>chunks.push(chip.generateStereo(Math.round(sampleRate*seconds)));
    // 6つの異なる波形を別アドレスへ配置。追加転送で以前の領域を失わない。
    for (let ch=0;ch<6;ch++) {
      const bytes=encodeSine(220*Math.pow(2,ch/6));
      const start=ch*bytes.length;
      adpcm.loadMemory(bytes,start);
      adpcm.setSample(ch,{start,end:start+bytes.length});
      adpcm.setVoice(ch,{volume:24,left:ch<3,right:ch>=3});
      adpcm.keyOn(ch);
      render(0.6);
    }
    adpcm.keyOn([0,1,2,3,4,5]);
    render(0.6);
    adpcm.keyOff([0,1,2,3,4,5]);
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
    const output = process.argv[2] ?? new URL("./ym2610b_adpcma.wav", import.meta.url);
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
