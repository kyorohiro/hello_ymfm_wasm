# Playgroundの音源別初期音量

2026-10-24。[追加音源の混在試験](native_dynamic_stability_01.md)に続き、
既知の単音を生成して出力単位の差を測定し、PlaygroundのSystem初期値へ固定倍率を設定する。

## 基準と範囲

- FMは無変調の単一carrier、最大の定常envelopeでsin波を生成する。
  PCM／wavetableは同じ振幅のsin波を各音源の公開APIで入力する。
- Sega PSG・AY・NES pulseは50%矩形波、最大固定レベル、1 CHだけを使う。
  sin波と矩形波のRMSを同じにせず、左右それぞれの`(最大値 - 最小値) / 2`で振幅を比較する。
  波形固有のRMS、DC、量子化、周波数特性、内部の音源間バランスは維持する。
- 48 kHzの実Web Worklet／WASMを使い、FX・masterより前の出力を観測する。
  220／440／880 Hzで各経路を測り、440 Hzから倍率を計算する。
  追加22種類＋YM2612の追加Nuked経路と内蔵28経路、合計153窓。各窓はwarmup 0.2秒後の0.4秒。
- SNES／SPCの基準BRRはrange12／filter0、対称な±7 nibbleを使う。
  デコード振幅7/8を明示的に補正する。-32768が連続するBRRは実DSPのGaussian補間で
  wrapするため、基準音から除外した。この対策は測定用データだけに適用する。
  SPCも同じ単音を含む自作ファイルで固定出力単位を測り、ユーザーの曲を解析・正規化しない。
- 音色・発音数・知覚上の音量を揃える処理ではない。AGC、limiter、演奏中の測定pollingは加えない。
  複数CHや音源を重ねた際のheadroomは、従来どおり演奏・Mixer設定に依存する。

## 算出結果

Genesis内蔵YM2612の基準振幅は0.1494140625。
既存Mixerの上限2を全経路で守るため、最も小さいNES pulseの2倍である
**0.12881777435541153**を共通の目標にする。音源ごとに倍率をclampして差を残す方式は使わない。

追加生成音源の440 Hzの出力振幅と初期倍率は次のとおり。
振幅はBRRの人工的な7/8 headroomだけを補正した出力単位、倍率はMixerのVolume値。

| 音源 | 基準振幅 | 初期倍率 |
| --- | ---: | ---: |
| YM2612 | 0.166016 | 0.775938 |
| YM2203 | 0.249268 | 0.516785 |
| YM2608 | 0.124634 | 1.033570 |
| YM2610 | 0.124634 | 1.033570 |
| YM2151 | 0.249268 | 0.516785 |
| YM2413 | 0.110870 | 1.161877 |
| YM3526 | 0.124634 | 1.033570 |
| YM3812 | 0.124634 | 1.033570 |
| Y8950 | 0.124634 | 1.033570 |
| YMF262 | 0.249268 | 0.516785 |
| DX7 | 0.124003 | 1.038825 |
| Sega PSG | 0.200000 | 0.644089 |
| AY-3-8910 | 0.083333 | 1.545813 |
| YM2610B（追加6FM） | 0.124634 | 1.033570 |
| RF5C164 | 0.459595 | 0.280286 |
| OKIM6258 | 0.999756 | 0.128849 |
| Game Boy | 0.250000 | 0.515271 |
| NES | 0.064409 | 2.000000 |
| HuC6280 | 0.161301 | 0.798619 |
| 32X PWM | 1.000000 | 0.128818 |
| SNES | 0.977190 | 0.131825 |
| SPC | 0.977190 | 0.131825 |

Genesis内蔵FMは既存の0.9倍を含むため0.862153、Nuked内蔵FMは0.548744。
Genesis内蔵PSGは既存の0.35倍を含むため1.840254。
Master System／Game GearのPSGは追加生成と同じ0.644089。
Mega CD／32X／legacy Nukedは、同じ内蔵構成の実測値を引き継ぐ。

`useSoundChip()`がWeb版で追加共有音源を返す場合があるため、内蔵Genesis PSG・PC98 FM・
32X PWMは実際のprimaryを直接使って測定する。追加音源の`:shared` IDをprimaryの測定値として
登録することは、測定runnerと生成器の両方で拒否する。

## 適用と保存

`playground_mixer_defaults.js`に測定結果から生成した種類別・mode内蔵ID別の初期値を置き、
Web Audio／Native両方へ独立した`SoundChipMixer`を渡す。TFI previewも別Mixerを使う。

優先順位は、従来のlibrary初期値、Playground種類別初期値、該当する内蔵ID別初期値、
保存した`kinds`、保存したID別設定の順。Systemを選ぶと新しい初期値になる。
factory値を保存JSONへ混ぜず、既存のdefault／current／名前付きプリセットや数値を変更しない。
New Cassetteも、引き継いだdefaultの明示値を優先する。

npm向けの汎用初期値、VGM Analyzer、低レベル`generateStereo()`のPCM、C++コアの音量は変更しない。

実機での聴き比べには[全22音源の共通Example](playground_chip_comparison_01.md)を使う。

## 再実行

基準の実測JSONは[playground_chip_levels_01.json](playground_chip_levels_01.json)。
全経路・周波数・実ID・unity／中央／Muteなし／Soloの設定が揃った基準測定だけを初期値へ生成できる。

```sh
node scripts/calibrate_playground_chip_levels.cjs --out=/private/tmp/chip-baseline.json
node scripts/generate_playground_mixer_defaults.mjs --report=docs/issues/playground_chip_levels_01.json --check
node scripts/calibrate_playground_chip_levels.cjs --verify --baseline=docs/issues/playground_chip_levels_01.json --out=/private/tmp/chip-verified.json
```

`--verify`は初期値を変更せず、実出力を基準測定×固定倍率と比較する。
220／880 Hzも440 Hzと同じに平坦化せず、元の周波数特性を維持した結果を検証する。
別のブラウザー実装は`--webkit`、配布版は`--root=<Playgroundディレクトリ>`で確認できる。

## 検証結果

- 基準測定147窓が成功。補正後もChromiumの220／440／880 Hz、147窓すべてが成功した。
  基準測定×固定倍率との最大相対誤差は0.00323%。
- 最終Tauri配布物でもWebKitの440 Hz、全49経路が成功し、最大相対誤差は0.00085%。
  Nativeの物理出力の測定ではなく、実Web Worklet／WASMの確認である。
- 実C++と配布Workletの既存比較1,167ケースも成功。
  Genesis／Nuked、追加YM2612／RF5C164／DX7／4種OPLで44.1／48／96 kHzを比較し、
  最大sample差は約3e-8。物理音声デバイスは開かず、Nativeでも既存倍率と出力単位が対応することを確認した。
- JavaScript 4,855件成功、1件skip。Mode型チェック成功。
  Rust 693件成功、4件ignore。Tauriの`npm test`も成功（Node 31件）。
  RustのHTTP試験2件はサンドボックスのポート制限で一度失敗し、許可された環境で全件成功した。
- 最終配布物のChromium／WebKitで、Mixerの即時Preset選択、current非上書き、
  Set default／Save、New Cassette引継ぎ、IndexedDB／Cassette ZIP往復が成功。
  共通の混在ExampleもWeb／Native・Main／Workerで各2回、Stop／再生成を含めて成功した。
  Native画面試験のIPCはmockであり、実PCM比較とは分けている。
- SNESの音量／FX比率をChromium／WebKit、DX7の同回帰をChromiumで確認した。
  この比率試験は基準前にunityを明示し、Systemの校正値とは独立に検証する。
- 配布ZIPの875ファイル、977ローカル参照、初期コード・API・WASM・ライセンスを確認した。
  Nativeソース21組と対応ソースZIPの1,399ファイルの一致も確認済み。

## 配布物と記録

- Playground ZIP: `release/hello_ymfm_wasm_native-extra-levels_itch_playground.zip`
- SHA256: `fcb071033a3e7256d7e2921ee6f277bdae592d197dfaa668114e261292b259c6`
- Tauriの`dist`へ取り込み済み。
- 対応ソースZIP: `w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip`
- 対応ソースZIP SHA256: `e4f296ed32b9c66d0d620f894337f9c3133f922e5846810df493133a04ed97d9`

補正後の測定JSONは`/private/tmp/chip-calibration-verify-chromium.json`と
`/private/tmp/chip-calibration-verify-webkit-final.json`、Mixer／混在Exampleの記録は
`/private/tmp/chip-levels-mixer-ui/`、`/private/tmp/chip-levels-stability-ui/`に出力した。
ソースの照合結果は`/private/tmp/chip-levels-sources-final.json`。

## YM2610B追加時の確認（2026-10-24）

追加6FM版を220／440／880 Hzで実測し、既存147窓と合わせて150窓の基準とした。
440 Hzの単位振幅は0.1246337890625、System倍率は1.033570。
共通targetと既存49経路の倍率が変わらないことを照合した。RF5C164を含む既存設定へ補正を重ねない。
最終Tauri配布物のWebKitでも3周波数を再測定し、期待値との差は最大約0.0000052%。
保存値の優先規則・current／defaultの扱いは維持する。

## 追加YM2612のNuked（2026-10-24）

`createSoundChip('ym2612', {engine:'nuked'})`は別の公開名を増やさず、engineを生成時に固定する。
追加Nukedを220／440／880 Hzで実測し、440 Hzの単位振幅`0.260833740234375`からSystem初期値`0.493869`を得た。
ymfmの`0.775938`、内蔵Nukedの`0.548744`、RF5C164など他の50経路の倍率と共通targetは変更しない。
測定reportは`chipEngine`を持ち、実Mixerのengineが`nuked`と一致することを検証する。

`SoundChipMixer`の任意の`factoryEngines`をPlaygroundだけに注入し、接続時のengine metadataで初期値を選ぶ。
種類別・内蔵ID別factory値と同様に、保存したkinds／ID別の明示値がこれを上書きする。
別の倍率を重ねる処理ではなく、同じ音量値のfallbackである。current／defaultのJSON schemaは変えず、engineやfactory値も保存しない。
最終配布物のWebKitで両engineの3周波数を再測定した。結果は[追加Nukedの記録](native_dynamic_nuked_01.md)を参照。
