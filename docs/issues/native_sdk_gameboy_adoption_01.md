# Native SDK Game Boy取り込み

2026-10-25。Game Boyの選択中／独立追加音源に共通のNative接続とMAME由来APUを、同梱済みの固定SDKへ参照を切り替えた。
着手時は本体`77d93c0489669eed4cdb81edf0b9f8e2f0f77e8a`、Tauri`0191864a00a278a4314d97bc4a6372306793fcd0`、
SDK`affd1059599f3c7598191c14f5a864b44963d4aa`で、すべてcleanだった。
PWM／HuC6280移行の5構成CI成功とその記録は、この基準コミットまでに保存済み。
ローカル検証終了時点ではGame Boy差分のcommit／pushと新しいCIは未実施だった。
その後、本体`62fc578e...`、Tauri`407a75b3...`へ保存済み。NES＋FDS移行と合わせた5構成CIの結果は末尾に記録する。
先行する全5構成成功run `40162092207`は、このGame Boy参照切替を含まない。

## ビルド境界

| 用途 | SDK内のパス |
| --- | --- |
| 選択中／独立追加の共通Native接続 | `native/reference/tauri/native_genesis_gameboy.cpp`／`.h` |
| MAME由来のAPU | `vendor/mame-gameboy/gameboy_apu.cpp`／`.h` |

接続cpp／headerとAPU cpp／headerの4入力は旧コピーとbyte一致。
APU headerは従来Native版の状態観測用`NativeGameboyAccess` friendを含む同じ内容で、Browser原本headerとの差を今回追加したものではない。DSPは変更しない。
既存の`tetorica_native_gameboy` archive内で接続とAPUを各1回ずつコンパイルし、
C++17・O2・MSVC `/EHsc`・`-fwrapv`・`-fno-strict-aliasing`・`-ffp-contract=off`とリンク順序を保持する。
SDK接続とAPUをCargoの監視対象にし、実行ソースやRust埋め込み素材の参照がなくなった旧スナップショットのソース監視を外す。
旧接続、スナップショット、`PINNED`、README等の原典・ハッシュ記録と既存のライセンス同梱先は保持する。
旧コピーやsyncスクリプトの更新だけでは、実際にコンパイルするSDKは変わらない。
Rustの書込み予約、owner・寿命・台数・予算、PCM、Stop／reset・試奏、Mixer／FX、CPALとWebView／JS APIは維持する。

SDKは`0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`の374ファイルをそのまま使う。
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK本体・取り込み記録、Browser／npmのWASMとTauriの`dist/`は変更しない。

## ローカル検証

macOS ARM64／Clang・Nodeで、音声デバイスを開かずに確認した。
旧／SDKを別々にコンパイルし、同じ入力のstdoutのbyte一致を確認してから、実配布WASMと比較した。

| 対象 | Native入力数（suite内） | Nativeフレーム | 実WASM比較回数 | 比較フレーム |
| --- | ---: | ---: | ---: | ---: |
| 選択中Game Boy | 42 | 396,912 | 42 | 396,912 |
| 追加Game Boy | 48 | 439,056 | 144 | 1,317,168 |

両suiteの36入力はsample rate・frame数・命令列SHAが同じで、PCMのSHAも一致した。
延べ90入力・835,968フレームに対し、重複を除いた固有Native入力は54件・488,208フレーム。
追加側の各入力を3通りのWorklet block分割で比較し、実WASM比較は計186回・1,714,080フレームで差0だった。
比較回数を固有Native入力へ加算しない。

- 接続cpp／headerとAPU cpp／headerの4入力はbyte一致し、SDK manifest・取り込み記録・旧5件のpinは変更していない。
- Tauriの既存fixtureとSDK既存の検証fixtureを旧／SDKへ実行し、constructor境界、不正入力のrollback、3 rate×3 clock×4 voiceのStop、NR52／DMG波形RAM・source maskの保持、半clockでのvoice別held PCMと全体Stop、独立インスタンス、観測readと位相を確認した。
- 公開state ABIの60バイトとoffsetを確認し、render中のallocation／freeは0。状態・位相・callbackの自己試験はPCM比較と別で、毎フレームのprivate全状態dumpやWASM内部状態の比較ではない。
- 既定のSDKコンパイル経路2本と実行ファイルをinline指定する経路が成功。不正な`--fixture`の6形式をコンパイル前に拒否し、入力のパスとハッシュを記録した。再確認の入力は集計へ加算していない。
- 実配布WASM SHA-256は`ae2bccd3ed8f0c776fc8be198fa9fddebeb18db5654b9160eeef239c9a3faabd`。

`npm test`は31／31成功。Rust全試験は723成功・0失敗・明示実行用4件ignored。
MCPのローカルTCP bindを必要とするため、今回は初めから制限外で実行しており、sandbox内での失敗や製品修正はない。
ログは`/private/tmp/tetorica-sdk-gameboy-npm-test.log`と`/private/tmp/tetorica-sdk-gameboy-cargo-test-unrestricted.log`。
再生ライフサイクルは22 mode・604,032フレーム・88 Run／Stopが成功し、runnerはexit code 0、`deviceOpened: false`。
追加音源混合試験も3混合構成・7単独音源、受入れ／16台制限で17台目の拒否が成功し、
受入れ・台数制限の双方でStop後の予約予算が0へ戻った。runnerはexit code 0、`deviceOpened: false`。
入力監査・比較集計は`/private/tmp/tetorica-sdk-gameboy-adoption/source-audit.json`と`parity-summary.json`、
再生レポートは`/private/tmp/tetorica-sdk-gameboy-stability.json`。
混合レポートは`/private/tmp/tetorica-sdk-gameboy-extra-stability.json`。

比較コマンドはそれぞれのリポジトリから実行する。

```sh
# Playground Tauriのルート
node scripts/check_native_gameboy.mjs --source /path/to/hello_ymfm

# 本体hello_ymfmのルート
node scripts/check_native_gameboy.mjs
node scripts/check_native_extra_gameboy.mjs
```

同梱SDKと配布ソースの手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。
文書確定後の対応ソースZIPは全1,796ファイル、SHA-256は
`1db0c76e87d531e9daf300bc3dc985d92b672e51425c72a65009168c3258575c`。
`/private/tmp/tetorica-sdk-gameboy-sources.json`で全22件の固定記録・SDK374ファイル・ZIPの照合が成功した。
着手時のソースマニフェストとの差は、Tauriの`src-tauri/build.rs`、`scripts/check_native_gameboy.mjs`、
README、NATIVE-SOURCES、取り込みガイドの5ファイルのみ。
`/private/tmp/tetorica-sdk-gameboy-adoption/source-manifest-delta.json`へ差分を、`summary.json`へ最終結果を集約した。
ガイド自身へZIPの自己ハッシュは埋め込んでいない。
ここまでのローカル検証では、新しい各OSのCI、sanitizer、実機の音声出力やインストール後の起動は確認していない。

## Game Boy／NES＋FDS移行後の5構成CI — 全5構成成功

2026-10-25、[Build Desktop — run 40168462256](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40168462256)を、
NES＋FDS移行まで保存したTauriの`main`、`a70e86d2061349a396de7e4816a5438fea5dcb4f`へ`workflow_dispatch`で実行した。
attempt 1は`completed`／`success`で終了し、macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の全5構成で検証とインストーラービルドが成功した。CIのためのコード修正は不要だった。

- 全5構成で`npm test`のPython 22件とNode 31件が成功。CargoはWindowsが726成功・0失敗・3件ignored、ほか4構成が723成功・0失敗・4件ignored。
- 22件の固定記録・SDK374ファイル・対応ソースZIP1,796ファイルを照合し、Game Boy／NESを含む22 mode・604,032フレーム・88 Run／Stopが成功。
- 既存の3混合構成・7単独音源、受入れ／16台制限で17台目の拒否とStop後の予約予算0が成功。両runnerはexit code 0、`deviceOpened: false`。この混合構成はGame Boy／NES専用の組合せを追加したものではない。
- 検証レポート5組のJSONと取得ZIPのdigestを照合。検証5件・インストーラー5件の計10アーティファクトは対象run／commitと一致し、有効期限内・非空だった。全5ジョブのドラフトリリース添付stepはskipped。

証拠は`/private/tmp/tetorica-gb-nes-ci-40168462256/`の`final-ci-summary.json`、`inspection-summary.json`、`test-log-summary.json`、`native-artifact-metadata.json`。
取得したのは検証レポートZIPだけで、インストーラーと対応ソースZIPのダウンロード・起動・独立照合はしていない。
OS間のPCM一致、各OSでのWASM比較、実機の聴音・ノイズ・UI操作は別の確認。先行するローカル比較結果と区別する。
今回のCI開始後に製品コード・試験は変更せず、記録だけを更新した。アプリ版は`0.90.1`のままで、新しいcommit／push・タグ・releaseは作成していない。
