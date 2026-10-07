# Node.js で YM2612 の音を生成する

音色探索用のデータを作るためのメモ。まずは1つの音色・音程から始める。
現在の `gen.js` はチップと Synth の初期化までで、WAV 保存はまだ行わない。
候補集の生成方針は [sound-color-02.md](../../docs/issues/sound-color-02.md) を参照。

## 実行方法

リポジトリーのルートで実行する。

```sh
node demos/sound-color/gen.js
```

`docs/generated/ym2612_wasm.js` と `ym2612_wasm.wasm` が必要。
生成済みファイルがない場合は、ビルド環境を用意して
`sh scripts/build_ym2612_wasm.sh` で生成する。

## それぞれの役割

- `createYm2612()`：WASM を初期化してチップを作る。非同期なので `await` が必要。
- `YM2612DirectTransport`：Synth のレジスタ書き込みをチップに直接渡す。
- `YM2612Synth`：音色・音程・Key On/Off を設定する。
- `chip.generateStereo()`：チップの時間を進め、左右の PCM 配列を生成する。
- `encodeStereoWav()`：PCM 配列を16 bitステレオ WAV のバイト列に変換する。
- Node.js の `writeFile()`：バイト列をファイルに保存する。

このオフライン生成では AudioContext や AudioWorklet は使わない。
スピーカーへの再生も行わない。

## WAV 保存までの例

以下は `gen.js` と同じディレクトリーで使える完全な例。
例えば `render-one.js` として保存し、`node demos/sound-color/render-one.js` で実行する。
出力は同じディレクトリーの `sine-a4.wav`。同名ファイルは上書きする。

```javascript
import { readFile, writeFile } from "node:fs/promises";
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

    // Key On の状態で1秒分を計算する。
    const tone = chip.generateStereo(Math.round(sampleRate * 1));
    synth.noteOff(channel);

    // Key Off 後も生成を続け、余韻を0.5秒分取り出す。
    const tail = chip.generateStereo(Math.round(sampleRate * 0.5));
    const frames = tone.left.length + tail.left.length;
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    left.set(tone.left);
    left.set(tail.left, tone.left.length);
    right.set(tone.right);
    right.set(tail.right, tone.right.length);

    await writeFile(
      new URL("./sine-a4.wav", import.meta.url),
      encodeStereoWav(left, right, sampleRate),
    );
  } finally {
    chip.dispose();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
```

`encodeStereoWav()` は現在 Analyzer 側のモジュールから借りている。
共通の `web/wav.js` への切り出しは今後の整理案で、まだ実施していない。

## 時間・サンプル数の注意

- `generateStereo(frames)` の引数は秒数ではなく、左右1組を1フレームとする個数。
  秒数からは `Math.round(sampleRate * seconds)` で変換する。
- サンプルレートは `chip.sampleRate()` で取得する。44,100 Hz と決め打ちしない。
  音程変換とサンプルレート計算には同じチップクロックを使う。
- 実時間で待つ必要はない。`generateStereo()` が指定フレーム数を同期的に計算する。
  `sleep()` で待つだけではチップの音声は生成されない。
- Key Off の直後に生成を終えると余韻は保存されない。必要な長さを追加で生成する。
  この例の0.5秒は固定値で、音色によっては足りない。
- 返される左右の `Float32Array` はコピーなので、次の生成や `dispose()` 後も使える。
- WAV エンコーダーは入力を −1〜1 にクリップする。比較データを作る際は
  クリップしていないか確認し、必要なら左右全体に同じゲインを適用する。

## 初期化の別表記

次の2つは同じ。短い関数でも `moduleFactory` は第1引数に渡す。

```javascript
const chip = await createYm2612(moduleFactory, moduleOptions);
// または Ym2612 を import して：
const chip = await Ym2612.create({ moduleFactory, moduleOptions });
```

`new URL("...", import.meta.url)` はスクリプトの場所を基準にするため、
実行時のカレントディレクトリーが変わっても同じ WASM を読み込める。
