# WonderSwanのSDK集約と0.1.4準備

2026-10-27。`w/tetorica-soundchip-native`へWonderSwan原本を集約し、SDK 0.1.4のソース・Native／WASMビルド・配布検証を準備した。
アプリの固定SDK更新とTauri Native Audio backend接続は次の段階。

## 追加・更新

- `vendor/mame-wonderswan/`：本体の原本6ファイルをbyte一致で収録。MAME revision・BSD-3-Clause・変更点を保持。
- `tetorica::wonderswan`：20番目のNativeライブラリ。`<tetorica/wonderswan.hpp>`から`tetorica::WonderSwan`として同じraw C++ classを利用できる。
- 4CH波形／左右音量、Noise、Sweep、Voice PCM、16 KiB RAMと同期read／write／PCM。Tauri用の新しいC ABIやスケジューラーは作成していない。
- `native/tests/wonderswan_fixture.cpp`と、オリジナルデータを鳴らす3秒・48 kHz stereo WAV例。
- 28番目のWASM recipeと共通`build-info.json`。本体のC ABI wrapperをbyte保持で収録し、SDKローカルソースだけでビルドする。
- ソース原産・ライセンス・差異・外部向け英文ガイド。SDK版とCMake版を0.1.4へ揃えた。
- 配布ZIPの監査・Native必須ターゲット・WASM smokeを更新。CIはNative 5構成＋YM2612／WonderSwanのWASM 2ジョブへ拡張した。

rawコアの音量・unipolar出力は維持する。WAV例だけ20 Hz DC除去・gain 0.7・fadeを明記して適用する。
PlaygroundのSpeaker補正やMixer校正をSDK coreへ移していない。

## 検証結果

- SDK inventory：23 chip IDs／28 WASM recipes／2 JS references／286 imported-file records。
- Python 67試験成功。Windowsの単一／複数configurationの必須fixture・WAV検査にもWonderSwanを含めた。
- ソースZIPだけを別フォルダーへ展開して、Native全20ライブラリ・25 CTest・19 WAV例が成功。
- WonderSwan fixtureは71,515 checks。2,048 hot blocksでC++ `new`／`new[]`の計測値0。直接の`malloc`は計測対象外。
- ASan／UBSan、公開headerだけを使うC++14 consumerとSega PSGの同時リンクも成功。
- Emscripten 6.0.6のWonderSwan出力は、本体JS／WASMとbyte一致。配布版とソースZIPからの再ビルド版で、各52,228ステレオフレームのABI／RAM／Noise／Sweep／PCM／分割生成検査が成功。
- 既存YM2612も配布版と展開ソースからの再ビルドで、同期read・発音・save/loadのPCM継続・resetのsmokeが成功。
- 最終ZIPの監査・hash・対応ソース埋め込み・Node実行が成功。Nativeをビルドしたソースとの差は、その結果を追記した`docs/verification.md`だけ。

今回はmacOS上のローカル検証。SDK 0.1.4の新しい7ジョブをremoteで実行した結果ではなく、実機精度・聴感・callback期限の測定でもない。
WASMの他26 artifactは今回再ビルドしていない。

## 配布準備物

ローカル生成先は`/private/tmp/ws-sdk-014-releases/`。

- `tetorica-soundchip-native-0.1.4-sources.zip`：395ファイル。
  SHA256 `f173092241badd27c84d6846a69bd175375f080a57fdaf4983c56751c201f65e`。
- `tetorica-soundchip-native-0.1.4-wasm.zip`：WonderSwanの新規生成物と対応ソースZIP。
  SHA256 `35887ba7847882ee4f974a5165391183f30cba97cfaefeb1000939c657798631`。

詳細は[JSON記録](wonderswan_sdk_014_01.json)。SDK内の`docs/verification.md`にも英文で記録した。
SDKのcommit／push／tag・GitHub Release／npm公開は行っていない。本体とTauriの固定SDKは0.1.2のまま維持する。

## 次の作業

1. SDK側をcommit／pushし、`v0.1.4`タグで既存Actionsの自動公開を行う。新Native 5構成・WASM 2構成の結果を確認する。
2. 正式source ZIPを本体とTauriへ固定取り込みする。本体のSDK検証を28 artifact／55出力へ拡張し、全receiptを新SDKから生成し直す。WonderSwanの一時的な独立receiptもSDK由来へ移行して比較する。
3. 固定SDKのWonderSwanを利用して、Tauri Native backendの主音源・追加音源・Speaker補正・Keyboard／Inspector・停止／所有管理を接続する。

CPU／BIOS／ROM／DMA／Hyper Voice／VGM再生／save stateはこの追加に含めない。

## 前回の本体CI

CI修正はユーザーが本体`23f1328260d38a67aad74894fe914b54a6578c81`へcommit／push済み。
[WASM SDK build and parity run 40379809938](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/40379809938)が
`completed / success`で完了したことをAPIで確認した。今回のSDK 0.1.4のCIとは区別する。
