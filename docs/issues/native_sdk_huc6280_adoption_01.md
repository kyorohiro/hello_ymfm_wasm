# Native SDK HuC6280取り込み

2026-10-25。PC Engineの選択中／独立追加HuC6280を、同梱済みの固定SDKへ参照を切り替えた。
着手時は本体`2b1b8cf1b3a6003b34693887153718c989a3a74d`、Tauri`39a0278660cc985a1b32333553bd9ee1eaffcfea`、
SDK`affd1059599f3c7598191c14f5a864b44963d4aa`で、すべてcleanだった。PWM移行はこれらの基準コミットに保存済み。
ローカル実装・検証の終了時点では、HuC6280差分のcommit／pushと新しいCIは未実施だった。
その後ユーザーが本体`a8169ac2b5cf884e59304a55f2388da0ae1c21e4`、Tauri`2125896b7173c5c662c6eaf2f2b69b4a010f12b7`へcommit／pushした。
両作業ツリーがcleanでremote mainと一致することを確認し、PWM／HuC6280を含む5構成CIを実行した。全5構成が成功し、結果は後述のCI記録を参照。
先行する全5構成成功run `40148943609`はPSG／RF移行の確認であり、PWMも今回のHuC6280も含まない。

## ビルド境界

| 用途 | SDK内のパス |
| --- | --- |
| 選択中／独立追加の共通Native接続 | `native/reference/tauri/native_genesis_huc6280.cpp`／`.h` |
| 接続が直接includeするコア | `vendor/mame-huc6280/huc6280.cpp`／`.h` |

接続cppはinclude先の2行だけが旧コピーと異なり、従来スナップショットの相対参照をSDKのコアへ向ける。
接続headerとコアcpp／headerはbyte一致。`huc6280.cpp`の直接includeを維持し、別の翻訳単位として重複コンパイルしない。
既存の`tetorica_native_huc6280` archive、C++17・O2・MSVC `/EHsc`・`-fwrapv`・`-fno-strict-aliasing`・`-ffp-contract=off`とリンク順序を保持する。
SDK接続とコアをCargoの監視対象にし、旧接続・スナップショットは由来とBrowser比較用として保持する。
旧コピーやsyncスクリプトの更新だけでは、実際にコンパイルするSDKは変わらない。
旧スナップショット、`PINNED`、README等の原典・ハッシュ記録と既存のライセンス同梱先は変更しない。
Rustの書込み予約、owner・寿命・台数・予算、PCM、Stop／reset・試奏、Mixer／FX、CPALとWebView／JS APIは維持する。

SDKは`0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`の374ファイルをそのまま使う。
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK本体・取り込み記録、Browser／npmのWASMとTauriの`dist/`は変更しない。

## ローカル検証

macOS ARM64／Clang・Nodeで、音声デバイスを開かずに確認した。
旧／SDKを別々にコンパイルし、同じ入力のstdoutのbyte一致を確認してから、実配布WASMと比較した。

| 対象 | Native入力数（suite内） | Nativeフレーム | 実WASM比較回数 | 比較フレーム |
| --- | ---: | ---: | ---: | ---: |
| 選択中HuC6280 | 39 | 239,616 | 39 | 239,616 |
| 追加HuC6280 | 51 | 438,912 | 153 | 1,316,736 |

選択中の39入力は追加側51入力の部分集合で、sample rate・frame数・命令列SHAとPCMのSHAで重複を確認した。
両suiteでは延べ90入力・678,528フレームを実行したが、重複を除いた固有Native入力は51件・438,912フレーム。
追加側の各入力を3通りのWorklet block分割で比較し、実WASM比較は計192回・1,556,352フレームで差0だった。
これらの比較回数を固有Native入力へ加算しない。

- 接続cppの差分はinclude先2行だけ。C ABI headerとコアcpp／headerはbyte一致し、SDK manifest・取り込み記録・旧pinは変更していない。
- Tauriの既存fixtureとSDK既存の検証fixtureを旧／SDKへ実行し、constructor境界、不正入力、5 rate×4 clock×6 voice、32バイト波形コピー、stereo／LFO／noise、held PCM、Stop／reset、独立インスタンスと観測readを確認した。
- 公開state ABIは352バイト、Native本体の確保量は704バイト。render中のallocation／freeは0。状態・callbackの自己試験はPCM比較と別で、毎フレームのprivate全状態dumpやWASM内部状態の比較ではない。
- 既定のSDKコンパイル経路2本、実行ファイルをinline指定する経路が成功。不正な`--fixture`の6形式をコンパイル前に拒否した。再確認の入力は上の集計へ加算していない。
- 実配布WASM SHA-256は`7df1e220f9e20eae024cc2035884326abece729f1c0bdb1a4a50022dc5a92073`。

`npm test`は31／31成功。Rust全試験は723成功・0失敗・明示実行用4件ignored。
MCPのローカルTCP bindを必要とするため、今回は初めから制限外で実行しており、sandbox内での失敗や製品修正はない。
再生ライフサイクルは22 mode・604,032フレーム・88 Run／Stopが成功した。
追加音源混合試験も3混合構成・7単独音源、受入れ／16台制限で17台目の拒否が成功し、
受入れ・台数制限の双方でStop後の予約予算が0へ戻った。両runnerはexit code 0、`deviceOpened: false`。

`source-audit.json`／`parity-summary.json`と関連レポートは`/private/tmp/tetorica-sdk-huc6280-adoption/`に保存した。
ホスト試験ログは`/private/tmp/tetorica-sdk-huc6280-npm-test.log`と`/private/tmp/tetorica-sdk-huc6280-cargo-test-unrestricted.log`。
再生／混合レポートは`/private/tmp/tetorica-sdk-huc6280-stability.json`と`/private/tmp/tetorica-sdk-huc6280-extra-stability.json`。

本体`hello_ymfm`のルートから比較する。

```sh
node scripts/check_native_huc6280.mjs
node scripts/check_native_extra_huc6280.mjs
```

同梱SDKと配布ソースの手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。
文書確定後の対応ソースZIPは全1,796ファイル、SHA-256は
`dcbc9710d9d89db204fec2d1841e82ca0976c73c192db7fc37a599a232a1c865`。
`/private/tmp/tetorica-sdk-huc6280-sources.json`で全22件の固定記録・SDK374ファイル・ZIPの照合が成功した。
着手時のソースマニフェストとの差は、Tauriの`src-tauri/build.rs`、README、NATIVE-SOURCES、取り込みガイドの4ファイルのみ。
`/private/tmp/tetorica-sdk-huc6280-adoption/source-manifest-delta.json`へ差分を、`summary.json`へ最終結果を集約した。
ガイド自身へZIPの自己ハッシュは埋め込んでいない。
上記のローカル検証は各OSのCI、sanitizer、実機の音声出力やインストール後の起動を含まない。

## PWM／HuC6280の5構成CI — 全5構成成功

ユーザーの指示で[Build Desktop — run 40162092207](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40162092207)を
`workflow_dispatch`で`main`へ実行した。attempt 1、対象は`2125896b7173c5c662c6eaf2f2b69b4a010f12b7`。
PWMとHuC6280のSDK参照切替を含む。attempt 1は`completed`／`success`で終了した。
macOS ARM64・macOS x86_64・Windows x86_64・Linux ARM64・Linux x86_64の全5ジョブで、
sources／Cargo／再生ライフサイクル／追加音源混合とインストーラービルドが成功した。
macOSはDMG、WindowsはNSIS、Linux両構成はDEB／AppImageを生成した。

全5構成の検証レポートZIPを取得し、GitHubのdigestと一致することを確認して各3件のJSONを監査した。

- 各構成でSDK374ファイルを含む22件の固定記録と、対応ソースZIP1,796ファイルの照合が成功。
- 22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限で17台目の拒否とStop後の予約予算0への回収が成功。
- 両runnerはexit code 0、`deviceOpened: false`。アプリ版は`0.90.1`。
- 検証5件・インストーラー5件の計10アーティファクトは対象run／commitに一致し、有効期限内・非空だった。全5ジョブのドラフトリリース添付stepはskipped。

CIの対応ソースZIPは非Windows4構成が上記`dcbc9710...`と一致し、Windowsは
`167ae8219491e94f1624330875be1d2ecdecf64cd87e3b571c4c81994ad826b2`だった。
それぞれのCIでmanifestとcheckoutの照合は成功しており、ハッシュの差だけで原因を断定しない。
今回のCI開始後にコードや試験を変更せず、結果記録だけを更新した。追加のcommit／push、新しいタグやreleaseは作成していない。
結果用ガイドの更新後の対応ソースZIPも全1,796ファイルで、SHA-256は
`229d8eb929c1504baa65085be4bf38ca966966e42c69b3546b1de1361002f495`。
`local-final-sources.json`で全22件の固定記録・SDK374ファイル・ZIPの照合が成功し、
`local-final-source-delta.json`でCI入力との差が`docs/native-sdk-ym2612.md`だけと確認した。
コードと試験のコンパイル入力はCI対象から変えていない。
証拠は`/private/tmp/tetorica-pwm-huc-ci-40162092207/`の`final-ci-summary.json`、`inspection-summary.json`、
`jobs-audit.json`、`artifact-metadata.json`、`native-artifact-metadata.json`に保存した。
取得したのは検証レポートZIPのみ。インストーラー・対応ソースZIPのダウンロードや起動・独立照合、実機の聴音・UI操作、OS間PCM一致や各OSでのWASM比較は別の確認とする。

```sh
gh run view 40162092207 --repo kyorohiro/tetorica-fm2612-playground-tauri
```
