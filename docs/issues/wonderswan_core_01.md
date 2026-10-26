# WonderSwan: 共通C++コアの単体検証

2026-10-26。最初の段階として、同じC++音源をNativeとWASMで動かせる状態にした。
ここでいうNativeは単体のC++実行ファイルであり、TauriのNative Audio backendへの接続ではない。
PlaygroundのWonderSwan Mode・高級API・Keyboard・Inspectorは次の段階。

追記：2026-10-27にBrowser／Tauri Web Audioへの接続を実施した。
続きは[Playground Modeの作業記録](playground_wonderswan_mode_01.md)を参照。以下は単体コア段階の記録。

## 追加したもの

- `third_party/mame-wonderswan/`：BSD-3-ClauseのMAME原本2ファイル、固定revision、ライセンス、単体化したC++、変更点の英文README。
- `wasm/wonderswan_wasm.cpp`：同じコアを呼び出すC ABI。
- `scripts/build_wonderswan_wasm.sh`：ローカルソースのみからビルドするレシピ。
- `docs/generated/wonderswan_wasm.{js,wasm}` と独立した `wonderswan_build-info.json`：入力・出力hashを含むビルド記録。
- `web/wonderswan.js`：同期レジスター／RAM read・write、PCM生成、channel mute、reset・dispose。
  所有コピーの `generateStereo()`、再利用する借用ビューの `generateStereoView()`、呼出側バッファー用 `generateStereoInto()` を用意した。
- Native/WASM比較、C ABI境界値とメモリー検査、Browser／DedicatedWorker比較のスクリプト。

基準clockは3,072,000Hz。4CH・32点4bit波形、左右音量、CH2 Voice PCM、CH3 Sweep、CH4 Noiseの音源部分を扱う。
波形RAMは所有する16KiB。レジスターは絶対バイトアドレス `0x80..0x9f` を指定する。

MAMEの元ファイルは次のrevisionに固定し、取得したbytesもリポジトリに含めた。

- revision: `d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2`
- [wswansound.cpp](https://github.com/mamedev/mame/blob/d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2/src/mame/shared/wswansound.cpp)
- [wswansound.h](https://github.com/mamedev/mame/blob/d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2/src/mame/shared/wswansound.h)

## 検証

`wonderswan_core_01.json` はスクリプトの実行結果。126構成でNative C++と実WASMのPCM・全32レジスターbytes・全16KiB RAMが一致した。
clockは3,072,000／4,000,001Hz、出力は44.1／48／96kHz。
所有コピー・借用ビュー・Intoの3経路と異なる生成分割、それぞれのcold reset／replayを含む3,096,576ステレオフレームの比較で最大差分0。

同じ実装同士の比較に加え、24項目の別の期待値を確認した。
波形の下位ニブル順序、初回出力遅延、左右の独立、全8種のNoise LFSR、Sweep周期と符号／wrap、PCMのhalf／full音量など。
monitor muteは位相を進め、hardware channel disableは停止することも区別した。
A4に最も近いdivisor 1830は理論値約440.367Hzで、出力PCMから測定して確認した。
設定clockの端数については、MAME同様 `floor(clock/128)` の内部更新周期になることを独立比較した。

C ABIのselftestは1,091 checks成功。null／境界／出力canary／cold reset／複数instanceを確認した。
2,048ブロック・262,144フレームのレジスター変更と生成中、計測対象のC++ `new`／`new[]` は0回。
直接の `malloc` はこのカウンターの対象外。通常ビルドとASan＋UBSanの両方が成功した。
JS側は実際のWASMメモリー拡張後のビュー再取得、所有コピーの保持、固定長ビューの再利用も確認した。

`wonderswan_core_browser_01.json` はChromium／WebKitのWindow・DedicatedWorkerの4経路。
各12シーン、合計73,728ステレオフレームをNodeの実WASMと比較し、PCM・レジスター・RAMが一致した。
音声デバイスやAudioContextは作成していない。AudioWorkletの処理期限、実機精度、聴感の検証ではない。

同じツールチェーンで出力先を変更して再ビルドしたJS／WASM／独立receiptはbytes一致。
既存の固定SDK0.1.2、27種のWASM inventory・central receipt、既存音源・Mixer値は今回変更していない。

## 再実行

Emscripten C++、Python3、Node.js、Native C++ compilerを使用する。Browser試験はPlaywrightのChromium／WebKitも必要。

```sh
npm run build:wonderswan
npm run test:wonderswan
npm run test:wonderswan:browser
```

記録と試聴WAVも出す場合：

```sh
npm run test:wonderswan -- --out docs/issues/wonderswan_core_01.json --wav-dir /private/tmp/tetorica-wonderswan-audio
npm run test:wonderswan:browser -- --out docs/issues/wonderswan_core_browser_01.json
```

WAVは4CH波形の和音・Noise・Sweep・hostから8kHzで書き込むVoice PCMの4本。48kHz stereo float WAVで、音量補正・DC除去はしていない。
Voiceの書き込みは音源のレジスター動作を試すもので、DMAを実装したものではない。

## 出力方針と未対応

現段階はMAMEのヘッドホン出力を維持する。**raw PCMはunipolarでDCを含む**。
追加ゲイン、音量正規化、DC除去、補間を入れていない。内部周期は基準clockで24kHz。
Playgroundへ接続する際は、発音／消音時のDC段差をそのままスピーカーへ送らない出力方針を別に決める。
rawコアのNative／WASM一致を維持した上で、音声出力側の責務として検証する。

元実装にはpreliminaryの注記があり、[ハードウェア資料](https://ws.nesdev.org/wiki/Sound)と挙動が異なる箇所もある。
例えばVoice有効条件、Sweep時間レジスター書き込み時のカウンター、負のSweep stepのreadbackは元コード準拠。
これらを実機完全再現と扱わない。具体的な差分は `third_party/mame-wonderswan/README.md` に記録した。
Hyper Voice、sound DMA、CPU、BIOS、ROM、内蔵mono speaker経路、VGM再生、save stateは今回含めない。

## 次の作業

1. 高級API：4CHの波形／音程／左右音量／keyOn・OffとNoise・Sweep・Voiceの明示的な操作、状態同期。
2. AudioWorklet：音声とviewを分離した更新、既存performance scheduling、Stop時の確実な消音、出力側DC方針。
3. Playground：WonderSwan Mode・初期コード・2～3 Examples・型／補完・chip／CH選択・Keyboard・Inspector・Mixer。
4. 検証済みの原本をSDKへ集約し、新版の正式な固定取り込みを経てTauri Native backendへ接続する。

この段階ではnpm公開、SDK版更新、Tauriのrelease取り込み、Modeの公開は行っていない。
