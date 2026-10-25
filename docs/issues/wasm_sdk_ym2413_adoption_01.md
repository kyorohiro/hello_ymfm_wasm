# YM2413 WASMの固定SDK参照

日付: 2026-10-26

## 変更内容

`scripts/build_ym2413_wasm.sh`を同梱SDKのWASMレシピへ切り替えた。
SDKは先行する6 artifactと同じ`0.1.1`／`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`。
固定379ファイルと取り込み記録は変更していない。
着手時の本体は`bc9c0172b76383c7cafb724b4140ea1a8f816a48`でcleanだった。

固定ファイル群をoffline検証してからSDKの`build-wasm.sh ym2413`を実行する。
出力先は呼出し側を基準に絶対化し、`EMXX`でコンパイラーを指定できる。
C++14／O2／`ASSERTIONS=1`、12 export、`cwrap`／`HEAPF32`を維持する。
旧recipeもSDK recipeもPerlによるglueの末尾空白除去は行わない。
既存の同期`read()`／`generateStereo()`、9CH、内蔵／ユーザー音色とリズム、Mixer値を変更しない。

既存のYM2413 WASM／JSには保存・復元APIがない。
作業提案の「状態復元」はこの実装では既存reset→再演奏／seekによる復帰経路へ読み替えた。
今回そのAPIを追加したり、内部状態のserialize／cross-build loadを検証したと主張したりしない。
public resetはhandleを再生成してJS mute maskを再適用し、raw resetはfree-running counterを保持する。
両方の既存動作を区別して比較した。

importerの必須入力と共有ビルド試験を拡張した。
通常出力は比較用SDK出力とbyte一致し、共有`docs/generated/build-info.json`へYM2413を追加した。
先行6音源の記録・生成物は保持した。既存CIが実行するoffline試験と公開ビルド手順も更新した。

## ソースと生成物

本体とSDKの実装・ヘッダー・ライセンス24組がbyte一致。
10翻訳単位が実際に読む23ファイルも、`src/`と`vendor/ymfm/`を対応づけると一致する。
SDKのcatalogは今回の全実依存を列挙しており、前回OKIM6258の個別catalog範囲の不足とは区別する。
入力・出力hashと実行結果は[検証JSON](wasm_sdk_ym2413_adoption_01.json)を参照する。

Emscriptenは`6.0.6-git`。生成JSは配布済み・旧recipe再ビルド・SDKの3組とも同じ32,911bytes。
旧2組のWASMは33,460bytes、SDK版は33,469bytesでhashは異なる。
SDK版ではassertionに含まれるソースパスも変わる。
旧recipeの再ビルドも配布済みWASMとhashが異なるため、バイナリー一致と実行結果一致は区別する。
旧／SDKの双方で現れる未使用OPN templateのarray-bounds警告は今回変更していない。

## 実WASM比較

`scripts/check_ym2413_wasm_sdk.mjs`で旧recipe再ビルドとSDK、配布済み版とSDKの2組を比較した。

- 各1,284比較: 生PCM 1,140＋既存AudioEngine 144。PCM・続行probe、read／status／IRQと同期フック、
  JSの残余／保持sampleを比較し、各16,133,748出力ステレオフレームで差0。
  本文15,446,016＋各シーン後の257-frame probe 687,732を含む。
- clockごとに190個のrawシーン、Engine込み計642設定、通常／不規則block分割を比較した。
  全9CH×user音色＋15内蔵音色、5打楽器・全32rhythm key mask、共有user patch、
  AM／PM／waveform／sustain、mute、pending bus latchとraw／public resetを含む。
- 通常blockの重点54設定で両ビルドをpublic resetして同じ命令列を再実行し、計108回の再演奏が一致した。
  状態を保存して途中からloadしたという意味ではない。
- Native PCMは`floor(clock / 72)`。3,579,545／4,000,000／8,000,000Hzと、
  Engineの44.1／48／96／192kHzで平均化／sample保持を比較した。
- 正の自己試験では15内蔵音色の非ゼロ出力と相互差、user AM／PM・waveform・sustainのPCM差、
  各melody／rhythmのmute→unmute後の進行一致、public再生成reset、owned配列の保持と実capacity増加を確認した。
- 別枠の実VgmPlayerで3 clock×3 rateの9構成それぞれを全曲再演奏し、各6地点から257-frame継続を比較した。
  `seekPlayback`は既存の先頭からの再構築を使い、保存checkpointは常に0件だった。
  実際にEngineが生成した773,082フレームと、playerの引渡し646,698フレームを分け、後者を重複加算しない。
- 自己試験391,674出力フレームと上記のPlayer生成フレームは、主比較16,133,748とは別集計にした。

OPLLの互換read／statusは0、IRQはfalseを返す既存仕様も実フックと合わせて確認した。
raw reset後にaddressなしでdataを書いた場合と、明示的なregister指定の場合のPCMを照合し、
pending addressが維持されることもpositive試験で確認した。
公開snapshotや生の内部状態bytesの比較は含まない。
引数検査は不正18形式をファイル読込み前に拒否し、`--help`が成功することも確認した。

## その他の検証

- Python43件成功: importer16＋YM2612のビルド経路3＋他6 artifactの各4件。
  fresh copyからの既定／相対出力、header解決、改変拒否、先行6音源の記録・bytes保持を確認した。
- 既存YM2413／Synth／Inspector／MSX複合描画・OPM混合試験37件成功。
  9CHのA4／release／再trigger、全15内蔵音色、発音中の共有user音色編集、
  5打楽器の発音・attenuation、リズムからmelodyへの復帰、PSGとの混合、seekを含む。
- Chromium／WebKitで追加生成／Master System／MSX／MSX Audioの計8経路の実Worklet出力が成功。
  聴音側をmuteし、gain`1.161877`と非有限値・範囲超過0を確認した。
- 同じ2ブラウザーでMaster Systemの既存音色／Keyboard／リズムUI試験も成功。
  A4、共有carrierの440→880Hz、CH9のKeyboard、6melody＋5drum候補、打楽器再生、Stop、PSG共存を確認した。
  最終destinationだけをzero gainへ接続する一時harnessを使用し、元の試験・本体は変更していない。
  このUI検証はmain実行のみで、Worker／Game Gearの別mode試験は含まない。
- 隔離npm tarballの803ファイル、26WASM engine、942相対参照と型・実行検証が成功。
- Analyzer ZIP作成と753ローカル参照検査が成功。
  `release/hello_ymfm_wasm_ym2413-sdk_itch_vgm_analyzer.zip`に比較済みJS／WASMを収録した。
- アクティブな校正記録には影響するhash参照がなく、再測定は不要だった。
  既存校正記録・Mixer数値と両生成器の`--check`を維持した。

SDK／Tauriリポジトリは変更していない。公開手順は[ビルド文書](../building_ym2612_wasm.md)、
再開地点は[Save Point](savePoint.md)を参照する。
remote CI、OS／機材での聴音、npm・アプリ公開は未実施。
