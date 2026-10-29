# SPU Sineの周期先頭の段差を改善 — 2026-10-30

ユーザー確認：修正版を試し、2026-10-30に「治った!!」と報告。報告されていた異音の解消をユーザーの実聴で確認できた。公開状況の追加報告はない。

後続公開：ユーザー指示により、この修正を含む **tetorica-fm2612 0.2.34をnpm公開済み**。
[公開・検証記録](npm_ps1_cyclic_release_01.md) を参照。WebサイトやSynth ZIPの追加公開は行っていない。

Playgroundのオシロスコープ画像で、Sineの上り側に段差、頂上付近にうねりがあると報告された。
元のPCMは正弦波だが、112サンプルを4パケットのADPCMへ変換する際、先頭28サンプルのpredictorを0に固定していた。
初期Sineではshiftも0となり、復元値が0、0.125、0.25…と粗い階段になる。
各周期の先頭に繰り返されるため、単音でも余分な倍音が混じる。
これは以前の和音飽和・出力補償による量子化誤差とは別に、元から残っていた歪み。

## 変更

周期波形専用の `encodePs1AdpcmCycle` を追加。元PCMの末尾2サンプルを予測履歴の初期候補に使い、先頭もpredictor 0〜4から選ぶ。
その候補と従来方式を、実際のSPU loop cacheと同じ「初回デコードの末尾履歴からもう1周期デコード」の誤差で比較する。
初回／ループ時のどちらかにint16オーバーフローがあれば候補を捨てる。誤差が従来より小さい場合だけ採用。
任意の描画PCMで予測が不向きな場合は、従来のパケットを使う。

112 PCMサンプル／64 ADPCMバイト／4パケット／loopStart=0／既存の音程を維持。
PlaygroundのSineボタン・初期Sine・描画PCMと、standalone SynthのSine・描画PCM・Morph・PMON波形へ適用する。
AudioWorkletではエンコードせず、prepare側でのみ実行する。初期Sineは新方式で事前生成した64バイトを同梱。

一般録音用 `encodePs1Adpcm` の出力と、読み込んだADPCMそのものは変更しない。
保存された旧editable PCMプリセットは旧方式との一致も検証して読み込み可能にし、PCMから再設定する際に新方式で変換する。
元の描画データと保存形式は維持。Software audioやSPUコア／WASM／固定SDKは変更していない。

## 実出力の比較

[WASM PCM測定](spu_cyclic_sine_pcm_01.json)、[比較画像](spu_cyclic_sine_compare_01.png)。
同じ音程・音量・ADSR・Gaussian補間を通した16bit PCMを参照として、旧／新ADPCMの実出力を比較した。

- MIDI24〜84、44100／48000 Hzの122条件すべてで、参照との差を**28.26 dB以上低減**。
- Sineのraw loop SNRは約28.82 dBから58.59 dBへ改善。
- 基準音での実出力の正弦波以外の残差は、旧方式の約−31.5 dBcから約−61.4 dBcへ改善。
- 絶対的に無歪な正弦波という意味ではない。ADPCM量子化とSPUのGaussian補間は引き続き使用する。

関連Nodeテスト251件成功。実機由来のnative decoderで新パケットの2周期復元・誤差指標・no-wrapを照合し、
Sine／小振幅／DC／最大振幅／矩形／鋸歯／ランダム波形で誤差が増えないことを確認。
実SPU出力で保持音の残差が−55 dBc未満になる回帰テストと、旧PCMプリセット互換テストを追加した。
実聴は行っていない。

## ブラウザと校正

- [Playground操作](spu_cyclic_playground_browser_01.json)：Chromium／WebKit × Main／Workerの4経路成功。波形描画、保持発音、ADSR、Reverb、Stop、追加SPU、復帰を確認。
- [最終Synth ZIP](spu_cyclic_synth_zip_browser_02.json)：Chromium／WebKitの両方で成功。Sine単音／和音、Morph、PMON、Noise、Reverb、20 MiB WAVとpreset保存／復元を確認。01は校正policy更新前のZIP。
- [PS1再校正](ps1_cyclic_chip_levels_01.json)：48条件＋YM2612 8条件成功。既存gain 0.129331を維持。
- [WonderSwan再校正](wonderswan_cyclic_chip_levels_02.json)：48条件＋YM2612 8条件成功。
- [POKEY再校正](pokey_cyclic_chip_levels_02.json)：96条件、YM2612／Sega PSG各8条件、dual組合せ8条件成功。
- 校正policy関連326テスト成功。過去のmeasurement JSONやfreshness検証は緩めず、共有モジュールの新しいhashで再測定した。
- 完成パッケージのbuild、385宣言の生成／型検査、1097ローカル参照、28 WASM engine、15 renderer、npm pack／install検証成功。

再測定による丸め差でPOKEYの生成gainは0.413029から0.413033（primaryは0.413035）へ微小変更。
Playgroundの操作検証後に生成されたpolicyの差分は、このPOKEY設定とその測定metadataだけ。PS1のgainとSPU処理ソースは同じ。
最終Synth ZIPには更新済みpolicyを含める。途中段階のWonderSwan 01と失敗したPOKEY 01は `/private/tmp` に退避した。

## 試用ZIP

`release/tetorica_spu_synth_cyclic-sine-fix-dev_itch.zip`（45ファイル、5,493,544 bytes）。
SHA256：`bc884aba3f911a2dd24611e0b091a55d8331571bba04314b00c13e1701e89fe6`。

作業時点では未commit・未公開。以前のZIPは上書きしていない。その後npm版は上記のとおり公開した。
