# DX7 / MSFA WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

最後のDX7も、同梱`tetorica-soundchip-native` SDK `0.1.1`からビルドする形へ切り替えた。
これで全27 artifactのSDK移行が完了した。内訳は26組のES-module JS／WASMと、DX7のstandalone `msfa.wasm`。
SDK revisionは先行26件と同じ`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。379ファイルとpinは変更していない。
詳細な証跡と照合結果は[検証JSON](wasm_sdk_dx7_adoption_01.json)を参照する。

新しい`scripts/build_dx7_wasm.sh`は全SDKをoffline検証してから、そのDX7 recipeを呼ぶ。
引数なしでは`docs/generated/msfa.wasm`と共通`build-info.json`の27番目のreceiptを生成し、
同じbinaryを既存の`web/msfa_dx7/wasm/msfa.wasm`と`docs/js/msfa_dx7/wasm/msfa.wasm`へコピーする。
出力先を明示した場合は、そのディレクトリーだけへWASMとreceiptを書き、既存runtimeは変更しない。

```sh
sh scripts/build_dx7_wasm.sh
sh /path/to/checkout/scripts/build_dx7_wasm.sh ./dx7-output
```

`sync_dx7_runtime.mjs --wasm`も、JS・metadata・Monaco型の同期後に同じSDKビルドを呼ぶ形へ変更した。
別checkoutのコンパイル済みWASMをコピーする経路は廃止した。通常のJS同期は従来どおりWASMを保持する。
今回、別checkoutにある作業中のJS metadataを取り込む同期は実行していない。
通常のSDKビルドにはそのcheckoutは不要。

着手時の本体は`2871c96dd54bf21fd982203dd805a2e5dcc5056f`でcleanだった。
編集前に108ファイルと旧build receiptを記録した。
旧DX7 checkoutは`176aea739fa6b7324b1d0d77a338357fa954d3d4`に文書・package metadataの既存未コミット変更があり、
そのHEAD・状態を保持したままソースを一時領域へ凍結し、そこで旧手順の再ビルドを行った。
SDK／Tauriのリポジトリは変更していない。

## ソース・生成物・ライセンス

旧実装とSDKの実compiler入力は14翻訳単位＋18 quoted header、計32ファイルでbyte一致した。
旧`native/dx7.cc`／`dx7.h`に相当するSDK wrapperは`wasm/dx7/`にあり、MSFA coreとともにそのまま使う。
receiptの35入力はこの32ファイルとbuild dispatcher／recipe／recorder。
監査で保持した広いSDK provenanceは40ファイルだが、重複するため32へ加算しない。

C++17／O2、scalar MSFA、`-fwrapv`、`-fno-strict-aliasing`、`-ffp-contract=off`を維持する。
standalone WASMはfilesystemなし、memory growthなし、固定16 MiB memory・1 MiB stack。
DX7用C exportは12個で、generated JS loaderや`cwrap`／HEAP runtimeは生成しない。

配布済みWeb／docs、旧手順再build、SDK出力、通常の中央出力とWeb／docsの7コピーはすべてbyte一致した。

| ファイル | bytes | SHA-256 |
| --- | ---: | --- |
| `msfa.wasm` | 32,084 | `f5de761e82ea303420fb3aac79a0a59dd053773b81453b955254dd13aac77d6f` |

既存26 receiptと52個の生成JS／WASMも保持した。
vendored packageは`tetorica-msfa-dx7-wasm@0.3.1`のままで、元の25 payloadファイルとdocs側ミラーはすべて不変。
プロジェクト固有の`README.vendor.md`だけへSDKビルド方法を追記した。
MSFAとTetorica adapterのApache-2.0、LICENSE／COPYING／THIRD_PARTY_NOTICES、upstream revision
`f67d41d313b7dc85f6fb99e79e515cc9d208cfff`を保持する。
Playground ZIPの古いDX7 `0.1.0` noticeは、同梱package metadataから実際の`0.3.1`を表示するよう修正した。
今回DX7の対応ソースbundle helperを新設したものではない。完全なビルド入力は固定SDKに収録済み。

## APIと比較条件

- 公開APIは既存の`createDX7({wasmBytes, sampleRate})`、`render()`、`renderInto(Float32Array)`、音色・SysEx・発音制御。
  Playgroundの高級APIと専用AudioWorklet接続を維持し、generic `createSoundChip()`へのDX7追加は行っていない。
- coreの合成は44,100 Hz mono固定。公開APIの44,100／48,000 Hz出力をそれぞれ比較し、48 kHzの既存補間処理は変更しない。
  raw `dx7_render`の上限は1,024 frameで、公開APIが大きい要求を分割する。public最大要求は16,777,216 frame。
- 6 operator・32 algorithm、ratio／fixed frequency、envelope、LFO、velocity／scaling、feedbackを確認した。
  16 held voiceの次の発音は無視され、解放後は再利用できる既存動作を維持する。
- 選択音色・将来の発音と、既存voice identityに対するlive level／frequency／feedback更新を区別した。
  `setOperators`の一括変更、release中の編集、panic後の無音と再発音も比較した。
  急なparameter変更のクリックや補間方針を変えた作業ではない。
- 単音／bank SysExは独自に作った合成fixtureだけを使う。第三者の音色bankは含めない。
- owned出力の保持、caller buffer、独立instance、disposeと固定memoryを確認した。
  register／read／status／IRQ、native snapshotやheap拡大機能は追加していない。

## 実WASM比較

`scripts/check_dx7_wasm_sdk.mjs`を独立レビュー後にfreezeした。
最終freezeは実行・source closure 99、build snapshot 4、過去の基準記録4の計107記録。
旧／SDKのcompiler入力64件はclosureの一部であり、SDK provenance 40件・package範囲guard 15件とも重複する。
両比較の前後で、原本と凍結コピーすべてを再hashして確認した。

旧再ビルド／配布済み版をそれぞれSDKと比較した。
各90シナリオ×2 output rate×2分割の360比較、panic／再programの32再実行を含む752 render実行で、PCM・続行probe・API境界の観測の差は0。
両参照WASMは同じbinaryなので、2報告のcoverageは重複加算しない。

各報告で両buildから返った出力は次のとおり。内部blockの未返却prefetchは数えていない。

| 実出力 | monoフレーム |
| --- | ---: |
| シナリオ本文・panic再演奏 | 6,160,384 |
| 続行probe | 193,264 |
| wrapper／raw ABIの正の自己試験 | 1,300,492 |
| 合計 | 7,654,140 |

CLIは155実行。153種類の期待どおりの拒否とhelp／正常360比較が成功した。
入力上書き・alias、不正receipt／別ABI、実行中のpackage範囲変更などを拒否し、入力を保持した。
同期Node／WASM比較は、Browserのschedulingや実機の聴音を保証する試験ではない。

## Browser・配布物・既定値

- Pythonのビルド経路109件とimporter16件、計125件が成功。2つの成功コマンドの合計。
  DX7のstandalone出力・32入力・12 export・固定memory・既定のミラー／custom隔離・改変拒否と既存26 receipt保持を確認した。
- DX7／Operators・mode example・Mixer／既定値のNode 132件が成功した。
- Chromium／WebKitで公開`createDX7`の両rate計4ケース、Playground主DX7 modeのMain／Worker計4ケース、
  Operators UIのMain／Worker計4ケースを確認した。実PC key／pointer、6 operatorのlive編集・feedback・scaling・音色metadata、試聴とStop／再Runを含む。
  実installしたFM npmの追加DX7も、両rate・両browser・Main／Workerで計8ケース成功した。
  各Browser試験は最初のdestination接続前からzero Gainを入れ、測定用の信号をその手前で取得した。
- active calibrationの66 source guard、3 generator check、runtime／数値関連27ファイルは不変。
  DX7はactive Analyzer source hashの対象外。Playgroundの追加／主DX7×220／440／880 Hzを両browserで再測定し、
  12 captureのhalf peak-to-peak amplitude（最大値と最小値の差の半分）を既存のraw基準と照合した。Chromiumは全6件で一致し、WebKitの最大相対差は約0.006222%。
  聴感上の音量や実機特性の校正ではない。過去11件のlevel記録・Mixer倍率・公開JS／型は書き換えていない。
- 最終FM npmは805ファイル、26 WASM pair＋DX7 standalone、942参照を検証した。
  tarballは1,592,512 bytes、展開後5,937,815 bytes。型のNodeNext／Bundler・正負例と実installも成功した。
  versionは既存`0.2.28`のままで、npm公開は行っていない。
- Playground ZIPは886ファイル。DX7の元payload 25ファイル＋vendor noteの26項目、standalone WASMとApache noticesを照合した。
  Analyzer／YM2612 SynthにはDX7再生経路がなく、その専用ZIPへの追加や再buildは行っていない。
  receiptは中央に保持し、vendored package内部へ追加しない。

全27ビルドのSDK移行は完了。次は27件をまとめたビルド・配布確認の手順整理を進める候補がある。
SDK原本・pin、Native／Tauri、Mixer値は変更していない。commit／push・公開・remote CI・Native実行・実機聴音は実施していない。
SPCのWebKit初期化中closeは、引き続き別の未解決事項として残す。
