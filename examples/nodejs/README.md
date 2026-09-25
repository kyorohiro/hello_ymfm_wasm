# Node.js の利用例

## OPN 系の独立サンプル

各ファイルに初期化・音色設定・発音・PCM 生成・WAV 保存・解放までを記載している。
サンプルは FM の A4（約440 Hz）を対象とし、SSG・ADPCM の演奏例ではない。

| チップ | 実行ファイル | 補足 |
| --- | --- | --- |
| YM2203 | [main_ym2203_wave.js](main_ym2203_wave.js) | FM 3 CH。標準分周72に合わせて音程を計算 |
| YM2608 | [main_ym2608_wave.js](main_ym2608_wave.js) | FM 6 CHを有効化。SSG・ADPCMをミュートし、ROM不要 |
| YM2610 | [main_ym2610_wave.js](main_ym2610_wave.js) | YM2610Bラッパーを `variant: false` で使用。物理 CH2で発音 |
| YM2610B | [main_ym2610b_wave.js](main_ym2610b_wave.js) | FM 6 CH版 |
| YM2612 | [main_ym2612_wave.js](main_ym2612_wave.js) | OPN2 |
| YM3438 | [main_ym3438_wave.js](main_ym3438_wave.js) | チップ固有の出力処理を使用 |
| YMF276 | [main_ymf276_wave.js](main_ymf276_wave.js) | チップ固有の出力処理を使用 |
| YMF288 | [main_ymf288_wave.js](main_ymf288_wave.js) | FM 6 CHを有効化。リズムROM読み込みは未対応 |

```sh
node examples/nodejs/main_ym2203_wave.js
node examples/nodejs/main_ym2608_wave.js
node examples/nodejs/main_ym2610_wave.js
node examples/nodejs/main_ym2610b_wave.js
```

出力は各スクリプトの隣の `{chip名}.wav`。引数で保存先を指定できる。
必要な WASM は `scripts/build_{chip名}_wasm.sh` で生成する。
YM2610 と YM2610B は `build_ym2610b_wasm.sh` の生成物を共有する。
YMF288 も `node examples/nodejs/main_ymf288_wave.js` で生成できる。
ビルドは `sh scripts/build_ymf288_wasm.sh`。既定クロックは比較用の8 MHz、
ネイティブ生成レートは500 kHzで、他のサンプルと同様48 kHzへ変換して保存する。
`YMF288Synth.reset()` はレジスタ0x29のbit 7を設定して全6 FM CHを有効にする。
SSGは低レベルレジスタ操作から利用できるが、今回のサンプルと音色APIはFMのみ。
リズムROMの読み込み・実曲再生・Analyzerへの接続は今回の範囲に含めない。

試聴用 WAV は 48,000 Hz に変換して保存する。チップの生成自体はネイティブレート
（YM2203 / YM2608 は現在 1,000,000 Hz、YM2610 / YM2610B は 500,000 Hz）で行う。
`preview_pcm.js` はこの440 Hz単音向けの区間平均による簡易ダウンサンプリング。
広い帯域を持つ音色の精密な比較には、帯域制限した高品質な変換器またはネイティブPCMを使う。
WAV ヘッダーのレートだけを書き換えると音程・速度が変わる。

試聴しやすいよう、`sine` の発音 Operator（添字3）の TL を32から0に変更している。
元のプリセットオブジェクトは変更しない。発音3秒＋Key Off後0.5秒の計3.5秒。

## YM2612 → WAV

YM2612 の通常FM・DAC・CH3 special を、独立したスクリプトで試せる。

| 機能 | サンプル | 生成する音 |
| --- | --- | --- |
| 通常 FM | [main_ym2612_wave.js](main_ym2612_wave.js) | CH1 の A4 |
| DAC | [main_ym2612_dac_wave.js](main_ym2612_dac_wave.js) | CH6 に8 bit PCMのサイン波を供給 |
| CH3 special | [main_ym2612_3chsp_wave.js](main_ym2612_3chsp_wave.js) | CH3 の4 Operatorで A3 / C#4 / E4 / A4 |

リポジトリーのルートで実行する。

```sh
node examples/nodejs/main_ym2612_wave.js
```

`examples/nodejs/ym2612.wav` に、A4（440 Hz）のサイン波を3秒、
Key Off 後の余韻を0.5秒生成する。出力は16 bitステレオ WAV。
同名ファイルは上書きする。保存先を指定することもできる。

```sh
node examples/nodejs/main_ym2612_wave.js /tmp/ym2612.wav
```

### DAC / CH3 special

```sh
node examples/nodejs/main_ym2612_dac_wave.js
node examples/nodejs/main_ym2612_3chsp_wave.js
```

出力はそれぞれ `ym2612_dac.wav` / `ym2612_3chsp.wav`。
他の例と同じく第1引数で保存先を指定でき、既存ファイルは上書きする。
どちらも発音3秒＋終了後0.5秒、48 kHz・16 bitステレオで保存する。
同じ `ym2612_wasm` を使うので、追加のWASMビルドは不要。

DAC版は `setDacEnabled(true)` と `writeDac(value)` を使う。
物理CH6のFM出力をDACに切り替え、中心値128のunsigned 8 bit PCMを
22,050 Hzで書き込む。各書き込み後に次のサンプル時刻まで `generateStereo()`
でチップを進める。PCMをWAVに直接保存する例ではなく、実際にチップのDAC経路を通す。
DACの供給レート・チップの生成レート・保存するWAVのレートは別々に扱う。

CH3 special版は `setChannel3SpecialMode(true)` と
`setChannel3SpecialFrequency(operator, block, fnum)` を使う。
Algorithm 7で全Operatorをキャリアにし、個別の音程が分かりやすい和音にする。
CH3だけの特殊機能で、通常FMのCHが4つ増えるわけではない。
`noteOn()` はOP4の周波数も書き換えるため、この例では設定後に `keyOn(2)` を使う。
Key Off後の余韻を生成してからspecialモードを解除する。

### YM3438 / YMF276 との比較

各チップのファイルに、初期化から WAV 保存までを独立した例として記載している。
共通ランナーやチップ選択オプションは使わず、使いたいチップの例を直接実行する。

```sh
node examples/nodejs/main_ym3438_wave.js
node examples/nodejs/main_ymf276_wave.js
```

それぞれ隣に `ym3438.wav` / `ymf276.wav` を保存する。
各スクリプトとも、末尾に保存先を指定できる。
新しいコアをビルドする場合は Emscripten を用意して実行する。

```sh
sh scripts/build_ym3438_wasm.sh
sh scripts/build_ymf276_wasm.sh
```

YM3438 / YMF276 は `OPNFMSynth` の音色・発音操作を共有するが、
WASM 側ではそれぞれ `ymfm::ym3438` / `ymfm::ymf276` を使う。
DAC・出力の処理が違うため、YM2612 の別名として扱ってはいない。
比較用クロックは YM2612 と同じ 7,670,454 Hz。実際の機器を再現する場合は、
対象機器のクロックを音程変換と `sampleRate(clock)` の両方に指定する。

今回の範囲は低レベルチップ API・FM Synth・Node.js WAV 生成。
Analyzer の機種判定や Playground の選択肢には追加していない。
YMF288 も低レベルチップ API・FM Synth・Node.js サンプルまで対応。

`node --test web/opn_variant.test.mjs` で、新規コアの全6 CH、音程、パン、
Key Off、リセット再現性、DAC 出力差を検証する。実機との音質一致や試聴は別途確認が必要。

生成済みの `docs/generated/ym2612_wasm.js` と `ym2612_wasm.wasm` が必要。
ない場合はビルド環境を用意し、`sh scripts/build_ym2612_wasm.sh` で生成する。

サンプルは次の順に処理する。

1. `createYm2612()` で WASM チップを初期化する。
2. `YM2612DirectTransport` で `YM2612Synth` をチップに接続する。
3. `setPreset()` と `noteOn()` で音色と音程を設定する。
4. `chip.generateStereo()` で PCM を取り出す。
5. `noteOff()` 後も生成し、余韻をつなぐ。
6. `encodeStereoWav()` と `writeFile()` で保存し、`dispose()` で解放する。

`generateStereo()` の引数は左右1組を1フレームとするフレーム数。
秒数に `chip.sampleRate()` を掛けて求める。44,100 Hz と決め打ちしない。
オフライン計算なので、AudioContext・AudioWorklet・実時間の待機は不要。

音色は `FM_PRESETS["sine"]`、音程は `hzToBlockFnum(440, ...)` を変えて試せる。
余韻の長さは音色に合わせて調整する。
WAV 変換には現在の共通利用可能な関数として Analyzer の
`docs/vgm_analyzer/vgm_wav.js` を使用している。

## 名前からチップを生成する

```sh
node examples/nodejs/main_soundchip.js
```

YM2151 / YMF262 の初期化とPCM生成を確認する最小例です（リセット直後なので無音）。
`createSoundChip` と必要なチップだけ登録するFactoryの使い方は
[Sound chip factories](../../web/soundchip.md) を参照してください。
