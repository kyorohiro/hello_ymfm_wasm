# SCSP配布検証・固定SDK導入・raw JavaScript API — 2026-10-30

[初期共通コア](scsp_core_01.md)の後続。SCSP入りのsource／WASM ZIPを隔離検証し、正規importerで固定SDKへ導入した。
`web/scsp.js`から実WASMのRAM・レジスター・PCM生成を利用できる。
次は共通Synth API、その後Playground接続。[段階別TODO](todo_scsp_01.md)。

## SDKの配布経路

- SDKのWASM archive監査に、宣言されたSCSP instrumentを追加。
  archive manifest、同梱source ZIP、全build input／output hash、source closureを監査する。
- CMake File APIから、SCSP fixtureが展開source／隔離build内だけで構成されることと、実行ファイルの位置を検証する。
  `--scsp-native-parity`とSCSP選択時のsmokeで、実際のNative fixtureとWASM PCMを比較する。
  対象WASMなし／別音源だけの場合は事前拒否。古いPS1のみのarchiveとの監査互換性は維持。
- CIのWASM行列へSCSPを追加。7音源のWASM jobと、既存Native行列のCTestで検査する設定。
  **remote CIを実行したという意味ではない。**
- 正規package scriptでsourceとSCSP WASM ZIPを作成。隔離展開し、source／binary監査、Native CMake build、
  配布WASMとのbit一致、展開sourceだけからのWASM再ビルドと再比較まで成功。

SDK開発base commitは`f9f76df545e56fa4195cf345a9de507ae3bcb39b`。
今回の監査・CI差分を持つ**未公開local candidate**として、SDK 0.1.7のarchive hash・manifest hash・変更pathをpinに記録した。
version文字列を変更したり、GitHub／npmへ公開したりはしていない。
作業用SDKと親repoは別Git管理で、両方に今回の未commit変更がある。

## 固定snapshotと既存音源の保護

`scripts/import_soundchip_sdk.py`へSCSPの完全な入力集合を追加。
core／header／recipe／fixture／原本／licenseのどれかが欠けたarchiveは拒否する。
固定snapshotの直接改変を避け、正規importerで476 filesを導入した。

全33成果物を新規ビルドし、実際の新しいbuild receiptを採用した。
古いreceiptのhashだけを書き換えて更新したものではない。
**既存32成果物の63 JS／WASMファイルは、すべて従来版とbyte一致**。
新たにSCSPのJS／WASM 2 filesが加わり、全65出力になった。
PS1の追加source-bundle receiptも新pinで再生成し、完全性を確認した。

集約checkerへSCSPのABI・独立Native fixture・PCM比較を追加。
既存29コア、2 application-audio、PS1／SCSPの2 instrumentsを区別し、合計33 receiptsを要求する。
未知・重複・欠落の成果物、hashだけ取り替えた別音源のWASMも拒否する。

## raw JavaScript API

[APIと実行可能な自作Sine例](../scsp.md)、[wrapper](../../web/scsp.js)。

- `Scsp.create({moduleFactory,moduleOptions})`で、音声deviceを作らず同期C ABIへ接続。
- `write(offset,value,mask)`／`read`、`loadRam`／owned-copyの`readRam`。
- `prepare`、`renderInto`／`generateStereo`、`nativeFrames`、reset／dispose。
- RAM境界、整数・alignment、対応外register、出力範囲・重なり・WASM memory aliasを検証。
  不正なrender要求では音源を進めない。準備済みのWASM転送領域は再利用する。
- signed PCM8／big-endian PCM16、固定44.1 kHz、32物理slotsの低レベル操作が対象。
  音名・voice allocation・高レベルEG・音声file decode・resamplingはまだ追加していない。

Playground mode／AudioWorklet、専用Synth、Tauri Native音声callbackへの接続、npm公開は未実施。
ブラウザで鍵盤演奏できる段階や、`createSoundChip('scsp')`対応とは扱わない。

## 検証

[測定・pin・build receipt・入力hash・比較結果JSON](scsp_sdk_import_01.json)。

- SDK release unit 107 tests成功。SCSP catalog、parity admission、CMake executable確認等を含む。
- consumerのPython SDK tests 143成功。SCSP入力集合の欠落拒否と既存build routingを含む。
- consumerのNode tests 135成功。raw SCSP実コア5 tests、33-build receipt・ABI・CLI・DX7等を含む。
- 固定SDK集約検証成功：33 builds／65 outputs、既存29コアのPCM／API比較40,474件一致。
  PS1／SCSPとapplication-audioの別途Native比較も成功。検証中のruntime／SDK入力が不変であることも確認した。
- SCSPは自作Sine 8,192 stereo framesでNative／WASM bit一致、peak 0.25。
- PS1 source bundle：24 authenticated source inputs／28 bundle filesの整合を確認。

主要コマンド：

```sh
python3 w/tetorica-soundchip-native/tests/check_standalone_release.py --source-zip /private/tmp/scsp-sdk-stage2-release/tetorica-soundchip-native-0.1.7-sources.zip --wasm-zip /private/tmp/scsp-sdk-stage2-release/tetorica-soundchip-native-0.1.7-wasm.zip --work-dir /private/tmp/scsp-sdk-stage2-isolated --audit-only --wasm-smoke --scsp-native-parity --build-wasm scsp
sh w/tetorica-soundchip-native/scripts/build-wasm.sh all /private/tmp/scsp-sdk-all-20261030
node scripts/check_wasm_sdk.mjs --sdk-dir /private/tmp/scsp-sdk-all-20261030 --work-dir /private/tmp/scsp-fixed-sdk-parity-20261030
node --test web/scsp.test.mjs test/wasm_sdk_inventory.test.mjs test/application_audio_sdk.test.mjs test/check_wasm_sdk.test.mjs test/check_dx7_wasm_sdk_cli.test.mjs test/wonderswan_sdk_receipt.test.mjs
python3 -m unittest discover -s test -p 'test_*sdk*.py'
```

再実行時は隔離検証のwork directoryに新しい空のpathを指定する。
一時ZIPが消えた場合はpackage scriptで新候補を作り、その候補の新しいhashを検証する。
固定snapshotからの通常ビルドは`sh scripts/build_scsp_wasm.sh`。開発SDKの存在には依存しない。

実機比較・人の耳での試聴は未実施。FM／LFO／DSPは保持しているが動作検証は後続。
今回の比較成功はその初期範囲での移植・包装・APIの検証であり、SCSP全機能の忠実度を保証しない。
アプリ配布ZIP作成・公開・npm公開・commitは行っていない。
