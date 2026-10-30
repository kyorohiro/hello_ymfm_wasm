# SCSP共通コアの初期実装 — 2026-10-30

[SCSP対応TODO](todo_scsp_01.md)の段階1に着手し、自作SineをNative／WASMで同じPCMとして生成するところまで完了。
実装は作業用SDK `w/tetorica-soundchip-native` 内にある。親repoとは別Git管理で、どちらも未commit。
現在の配布用`third_party/tetorica-soundchip-native`、consumer pin、ブラウザruntime、公開版は変更していない。

## 実装

- MAME revision `a64a5d6602b19f67e091a4491f0c851a9dacf79d` のBSD-3-Clause SCSP／DSPを移植。
  原本4 files、revision、SHA-256、ライセンスをSDKの`vendor/mame-scsp/upstream`等に保存。
- 32 slots、private 512 KiB RAM、固定44,100 Hz stereo float出力。
  `<tetorica/scsp.h>`の`scsp_*` C ABIと`tetorica::scsp` CMake targetを追加。
- レジスターのmasked word read/write、RAM upload/readback、reset、caller-owned renderを提供。
  PCM8はsigned、PCM16のRAMはbig endian。ホスト転送は境界検証、内部chip読み取りは512 KiBでwrapする。
- MAME framework・音声device・scheduler依存を外した。render中に確保／ファイルI/Oをしない。
  slot monitorは1 sampleごとに更新し、render blockの区切りによる状態差を避ける。
- CPU timer／IRQ／DMA／serial MIDI、外部入力は提供しない。対応外のレジスター操作は拒否する。
- 元のslot PCM／loop／EG／LFO／FM ring／DSP処理を保持。乱数はinstanceごとの決定的xorshiftに変更。
  **FM／LFO／DSPの挙動はまだ未検証**。上流のEG／DSP精度の限界も継承する。

SDKのcatalog、出典inventory、`build-wasm.sh scsp`とinput hash付きbuild receiptを追加。
既存PS1のみのcatalogを引き続き検証できるようにした。SCSP用の配布archive監査とCIは後続。
現行のWASM配布監査の許可リストにはまだSCSPを加えていないため、その配布対応を完了したとは扱わない。

## 検証結果

[測定・source hash・WASM build receipt](scsp_core_01.json)。

- 自作64-frame PCM16 Sineを8,192 stereo frames生成。Native／WASMがfloat PCMでbit一致。
  peakは0.25。1 cycleは64 samplesで、OCT=0／FNS=0では44100 / 64 Hz。
- 一括と127-frame分割のWASM renderが一致。Nativeでは7-frame分割とも一致。
- Native fixtureはPCM8、左右panとslot31、32-slot加算の有限性／DAC clip、Release、reset時のRAM保持／消去、
  instance独立、masked writes、範囲外／未対応入力の拒否を確認。
- Native CMake／CTest成功。同fixtureのAddressSanitizer／UndefinedBehaviorSanitizer実行も成功。
  このsanitizer実行は初期PCM fixtureの経路が対象で、全DSP命令の安全性保証ではない。
- SDK source inventory検証成功。既存release unit 101 tests＋SCSP catalog guard 4 tests成功。
  SCSP追加後も汎用chip IDsは24のまま、独立instrumentはPS1とSCSPの2つ。
- Native／WASM比較は移植の再現性を確認したもの。実機比較・人の耳での試聴は行っていない。

## 再開・再現

親repoから：

```sh
cmake -S w/tetorica-soundchip-native -B /private/tmp/tetorica-scsp-cmake -DBUILD_TESTING=ON -DTETORICA_NATIVE_BUILD_EXAMPLES=OFF
cmake --build /private/tmp/tetorica-scsp-cmake --target tetorica_scsp_fixture -j 2
ctest --test-dir /private/tmp/tetorica-scsp-cmake -R tetorica.scsp --output-on-failure
sh w/tetorica-soundchip-native/scripts/build-wasm.sh scsp /private/tmp/tetorica-scsp-wasm
node w/tetorica-soundchip-native/tests/scsp_wasm_smoke.mjs --wasm-dir /private/tmp/tetorica-scsp-wasm --native-fixture /private/tmp/tetorica-scsp-cmake/native/tetorica_scsp_fixture --out /private/tmp/scsp-core-smoke.json
python3 w/tetorica-soundchip-native/scripts/check_sdk.py
python3 -m unittest discover -s w/tetorica-soundchip-native/tests -p 'test_*release.py'
```

最後のtest discoveryには新しいSCSP catalog testsも含む。今回の101＋4件は追加前後に別実行した記録。
Emscriptenのcache書き込みには、この環境ではsandbox外実行の許可が必要だった。
生成WASMとNative executableは一時領域のみ。配布成果物ではない。

次はSCSPを含む配布archive監査・CIを整え、固定SDKの通常導入手順へ進む。
その後、共通JS wrapper／音色API、自作波形によるPlaygroundの最初の発音を実装する。
Synth、TauriのNative音声callback接続、SSF playerはまだ対応していない。
