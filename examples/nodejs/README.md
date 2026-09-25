# Node.js の利用例

FM / PSG / PCM は、チップを生成 → `new XxxSynth({transport: new XxxDirectTransport(chip)})`
で接続 → 操作 → `chip.generateStereo()` → WAV保存、という共通の流れにする。
チップの解放は呼び出し側の `finally` で `chip.dispose()` を行う。
既存の `createSegaPsgApi` / `createRf5c164Control` は互換窓口として同じSynthを利用する。
RF5C164のPCM形式変換は `web/rf5c164_pcm.js`、通信は `web/playground_rf5c164.js` に分離している。

## OPN 系の独立サンプル

各ファイルに初期化・音色設定・発音・PCM 生成・WAV 保存・解放までを記載している。
以下の表は通常 FM の例。YM2203 / YM2608 の SSG / CH3 special は後述する。YM2608のADPCM-B例も後述する。

| チップ | 実行ファイル | 補足 |
| --- | --- | --- |
| YM2203 | [main_ym2203_wave.js](main_ym2203_wave.js) | FM 3 CH。標準分周72に合わせて音程を計算 |
| YM2608 | [main_ym2608_wave.js](main_ym2608_wave.js) | FM 6 CHを順番・同時に発音。ROM不要 |
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

## YM2203 → WAV（FM / SSG / CH3 special）

```sh
node examples/nodejs/main_ym2203_wave.js
node examples/nodejs/main_ym2203_ssg_wave.js
node examples/nodejs/main_ym2203_3chsp_wave.js
```

出力はそれぞれ `ym2203.wav` / `ym2203_ssg.wav` / `ym2203_3chsp.wav`。
第1引数で保存先を指定できる。同名ファイルは上書きする。
既存の `ym2203_wasm` で動作し、追加ビルドは不要。

同じ `YM2203Synth({transport: new YM2203DirectTransport(chip)})` から、
FM は既存メソッド、SSG は `synth.ssg` で操作する。

```javascript
synth.ssg.reset(); // SSGのみ。FMの状態は維持
synth.ssg.tone(0, {frequency: 440, volume: 12});
// chip.generateStereo(...) で時間を進める
synth.ssg.off(0);
```

- SSG例はトーン3秒・ノイズ1秒・ハードウェアエンベロープ1秒。各区間後に0.5秒の無音。
- SSGのCHは0..2、音量は0..15（0が無音）。FMのSSG-EGとは別機能。
- `noise(ch, options)`、`setMixer(ch, {tone, noise})`、`setVolume(ch, volume, envelope)`、
  `setEnvelope({period, shape})` も使える。ノイズ周期とエンベロープは3 CHで共有する。
- Hz指定は標準分周・既定4 MHz前提。別クロックはSynthの `clock` にも指定する。
  分周レジスタを直接変える場合は `synth.ssg.clock`（実効SSGクロック）も合わせるか、生の `period` を指定する。
- 生レジスタ操作は `synth.write(0, register, value)` または `synth.ssg.write(register, value)` を使う。
  `chip.write()` で直接変更するとSynthのミキサー状態追跡を迂回する。
- CH3 special例は既存の `setChannel3SpecialMode` / `setChannel3SpecialFrequency` を利用。
  Algorithm 7の4 Operatorを独立した音程で鳴らし、発音3秒＋余韻0.5秒を保存する。
  YM2203のFM分周72に合わせ、`hzToBlockFnum` にはマスタークロックの2倍を渡す。

ここではNode.jsのSynthとWAV生成を対象とする。PlaygroundのSSG操作UI追加は含まない。

## YM2608 → WAV（FM 6 CH / SSG / CH3 special）

```sh
node examples/nodejs/main_ym2608_wave.js
node examples/nodejs/main_ym2608_ssg_wave.js
node examples/nodejs/main_ym2608_3chsp_wave.js
```

出力は `ym2608.wav` / `ym2608_ssg.wav` / `ym2608_3chsp.wav`。
各スクリプトの第1引数で保存先を指定でき、同名ファイルは上書きする。
3例とも48 kHz・16 bitステレオ。既存の `ym2608_wasm` を使い、リズムROMは不要。

- 通常FM：CH1..6を順に各0.5秒＋余韻0.25秒、その後6 CHを同時に2秒＋余韻0.5秒（計7秒）。
  CH1..3は左、CH4..6は右へ出力する。
- SSG：440 Hzのトーン・ノイズ・660 Hzのエンベロープ付きトーン（計6.5秒）。
- CH3 special：Algorithm 7で4 Operatorを A3 / C#4 / E4 / A4 に設定（計3.5秒）。

`YM2608Synth({transport: new YM2608DirectTransport(chip)})` で接続する。
初期化と `reset()` でFM 6 CHを有効化する。SSGはYM2203と同じ `synth.ssg` APIを使い、
SSGだけの `reset()` はFMを停止しない。生レジスタ操作はSynthを経由して状態追跡を維持する。

標準分周では実効SSGクロックはマスターの1/4（既定8 MHz → 2 MHz）。
YM2203の1/2とは異なる。別クロックはSynthの `clock` にも指定し、分周変更時は
`ssg.clock` を合わせるか生の `period` を使う。FMの `hzToBlockFnum` にはマスタークロックをそのまま渡す。

`node --test web/ym2608synth.test.mjs` で全6 CHの音程・パン・停止、CH3 special、
SSGの音程・状態追跡・FMとの混合を実WASMで検証する。
Playgroundの操作UIは今後の対象。

### YM2608 内蔵リズム → WAV

```sh
node examples/nodejs/main_ym2608_rhythm_wave.js /tmp/ym2608_rhythm.wav /path/to/ym2608_adpcm_rom.bin
```

第1引数は出力先（省略時はスクリプトの隣の `ym2608_rhythm.wav`）、
第2引数は8 KiBのリズムROM（省略時はリポジトリー直下の `ym2608_adpcm_rom.bin`）。
実機の内蔵ROMに相当するデータを呼び出し側で用意する。このサンプルにはROMを同梱しない。
WAVやADPCM-Bのデータはここへ渡さない。

```javascript
const rhythm = synth.rhythm;
rhythm.loadRom(romBytes); // Uint8Array / Node.js Buffer、8192 byte
rhythm.setVolume(48); // 全体のレベル 0..63
rhythm.setVoice("snare", {volume: 24, left: true, right: true});
rhythm.keyOn("snare");
// chip.generateStereo(...) でチップを進める
rhythm.keyOff("snare");
```

- 音名は `bassDrum` / `snare` / `cymbal` / `hiHat` / `tom` / `rimShot`。順に数値0..5でも指定可能。
- 個別レベルは0..31、全体レベルは0..63。大きいほど大音量。確実な停止には `keyOff` を使う。
- `setVoice` の省略項目は維持する。初期状態では左右出力が無効なので、パンも指定する。
- `keyOn(["bassDrum", "hiHat"])` で同時発音。再呼び出しはROMの固定開始位置から再トリガー。
  `keyOff` も配列に対応する。停止はFMのリリースと異なり、次の生成更新で止まる。
- `rhythm.reset()` はリズムだけを停止・初期化する。ROMやFM・SSG・ADPCM-Bは維持する。
- ROM転送は `YM2608DirectTransport` が担当する。独自Transportは `loadRhythmRom(bytes)` の実装が必要。
  RuntimeSynth / WorkerのROM転送API追加は今回の範囲外。

サンプルは6音を順に各0.75秒＋無音0.25秒、その後2秒の短いパターン、最後に0.5秒の無音（計8.5秒）。
スネアを左、ハイハットを右に振り分ける例も含む。保存先の同名ファイルは上書きする。
自動テストは独自の合成ADPCM-Aデータを使い、実ROMの音色そのものの正しさは試聴で確認する。

### YM2608 ADPCM-B → WAV

```sh
node examples/nodejs/main_ym2608_adpcm_wave.js
node examples/nodejs/main_ym2608_adpcm_wave.js /tmp/ym2608_adpcm.wav
```

外部ROMは不要。デモ内の簡単なエンコーダーで440 Hzのサイン波をADPCM-Bへ変換し、
チップの外部サンプルメモリー経由で再生する。WAVは計3.75秒、48 kHz・16 bitステレオ。
ワンショット → 左でリピート → 右で2倍速（880 Hz）→ 停止、の順。
省略時はスクリプトの隣の `ym2608_adpcm.wav` に保存。同名ファイルは上書きする。

```javascript
const adpcm = synth.adpcm;
adpcm.loadMemory(adpcmBytes, 0); // Uint8Array / ArrayBuffer。変換済みADPCM-B。
adpcm.reset(); // サンプルメモリーは保持
adpcm.setSample({start: 0, end: adpcmBytes.length});
adpcm.setPlaybackRate(16000); // 復号PCMのsamples/second。バイト/秒ではない。
adpcm.setVolume(200); // 0..255、0は無音
adpcm.setPan(true, true);
adpcm.keyOn({repeat: true});
// chip.generateStereo(...) で時間を進める
adpcm.keyOff();
```

- メモリー容量は2 MiB。転送アドレスはバイト単位。転送だけでは発音しない。
- `setSample` の範囲は `[start, end)`（endは排他的）。両端32 byte境界で、空範囲・範囲外はエラー。
  高レベルAPIは8-bit DRAMモードと全メモリーのlimitを設定する。再生範囲は停止中に変更する。
- サンプルのパディングは呼び出し側で行う。32 byteに切り上げた分も音声として復号されるので、
  WAVのヘッダーや適当なゼロ列をそのまま足す前提にはしない。
- `setPlaybackRate` は標準分周を前提にDelta-Nへ変換し、量子化後の実レートを返す。
  既定8 MHzでは最大約55.55 ksample/s。表現できないレートはエラー。
  生の `setDeltaN(1..65535)` も使える。分周変更時は生の値を使うか換算条件を合わせる。
- 再生速度・音量・左右出力は再生中に変更可能。速度変更で音程と長さも変わる。
- `keyOn()` は選択範囲の先頭から再トリガー。省略時はワンショットで終端停止。
  `repeat: true` は範囲全体を繰り返す。別のループ開始位置は持たない。
- `keyOff()` はデコーダーを停止・初期化。`adpcm.reset()` はADPCM-Bの制御を初期化するが、
  メモリーとFM・SSG・リズムには触れない。再生の再開には速度・音量・パン・範囲を設定する。
- 生レジスタ操作は `synth.write(1, register, value)` を使う。メモリーモードやlimitを直接変更すると
  高レベルAPIの32 byte単位の前提と異なるため、再度 `setSample` で設定を揃える。
- `YM2608DirectTransport.loadAdpcmMemory` が転送を担当する。独自Transportでも同名メソッドが必要。
  RuntimeSynth / Workerへのメモリー転送、WAV/FLAC読み込み、汎用エンコーダー、録音・直接DACは今回の対象外。

サンプルのエンコーダーはymfmのADPCM-B復号式に合わせた誤差最小のニブル選択で、
上位ニブルから格納する。内蔵リズム用ADPCM-Aとは互換ではない。

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

## Sega PSG → WAV

```sh
node examples/nodejs/main_segapsg_wave.js
node examples/nodejs/main_segapsg_wave.js /tmp/segapsg.wav
```

[main_segapsg_wave.js](main_segapsg_wave.js) は、A4の単音3秒、3 CHの和音1秒、
ホワイトノイズ1秒を、それぞれの後に0.5秒の無音を入れて生成する。
既定の出力はスクリプトの隣の `segapsg.wav`。48 kHz・16 bitステレオ、計6.5秒。
同名ファイルは上書きする。生成物がない場合は `sh scripts/build_segapsg_wasm.sh` でビルドする。

`SegaPSG` は低レベルのチップ操作・PCM生成を担当し、
`SegaPSGSynth({transport: new SegaPSGDirectTransport(chip)})` が高級関数を提供する。
YM2612と同じSynth＋DirectTransportの形で、`tone()` / `off()` /
`noise()` / `noiseOff()` をNode.jsでもそのまま使える。

- トーンCHは0..2。`tone(ch, {note: "A4"})`、`frequency`、`period`で音程を指定する。
- `attenuation` は0が最大音量、15が消音。`volume` は0..1で指定できる。
- ノイズは独立したCHで、`noise({type: "white", rate: "medium"})` のように操作する。
- 音名・Hzからの周期変換は `SEGAPSG_CLOCK` 前提。サンプルも同じクロックを使う。
- PSGは矩形波なので、YM2612のサイン波とは異なる音になる。

## RF5C164 → WAV

```sh
node examples/nodejs/main_rf5c164_wave.js
node examples/nodejs/main_rf5c164_wave.js /tmp/rf5c164.wav
```

[main_rf5c164_wave.js](main_rf5c164_wave.js) は、波形RAMに1周期のサイン波を書き込み、
約440 Hz → 約660 Hz → 左約440 Hz・右約660 Hzを各1秒、その後0.5秒の無音を生成する。
出力はスクリプトの隣の `rf5c164.wav`（48 kHz・16 bitステレオ）。同名ファイルは上書きする。
WASMがない場合は `sh scripts/build_rf5c164_wasm.sh` でビルドする。

`Rf5c164` がチップ本体、`RF5C164Synth` が操作・レジスタ生成を担当する。
`web/rf5c164synth.js` の `RF5C164DirectTransport(chip)` で接続し、Playgroundと処理を共有する。
Node.jsでは直接接続するので、`loadMemory` / `setChannel` / `keyOn` / `keyOff` は同期操作。
Playgroundの通信クライアントが返すPromiseとは異なる。

例ではファイルのデコードを使わず、RF5C164固有の符号・振幅表現で波形を作る。
末尾の `0xff` は `loopStart` へ戻るマーカー。stepによる飛び越しを避けるため、
この例では8 byte連続配置する。2つの物理CHから同じ波形RAMを読める。
ループ周期は内部更新単位で丸められるため、音程は指定Hzに対する近似になる。
`step` を変えると再生速度と音程が変わる。例のHz換算式は1周期の波形用で、
任意の録音サンプルを音名へ変換する式ではない。

## 名前からチップを生成する

```sh
node examples/nodejs/main_soundchip.js
```

YM2151 / YMF262 の初期化とPCM生成を確認する最小例です（リセット直後なので無音）。
`createSoundChip` と必要なチップだけ登録するFactoryの使い方は
[Sound chip factories](../../web/soundchip.md) を参照してください。
