# Native SDK AY-3-8910取り込み

2026-10-25。Playground Tauriの共有AYコアと独立追加接続を、同梱済みの固定SDKからビルドするようにした。
MSX／MSX Audioの機種用接続、選択中AYのレート変換とRust側の制御・混合は維持する。
着手時は本体`4137e903...`、Tauri`4451195...`、SDK`affd1059...`ですべてcleanだった。
その後ユーザーが本体を`ce2ad30833a96607721ce8ea3122aaf5e6fefa3d`、
Tauriを`276e744ee5ed00513558b1d995e950a3ef91884c`としてcommit／pushした。
両作業ツリーがcleanであることを確認後、OPL接続移行と今回のAY移行を含む5構成CIを開始した。
CIは4ジョブ成功・macOS x86_64の1ジョブ失敗で終了した。
試験だけのローカル修正後はRust全試験と対象試験50回反復が成功した。
ユーザーが本体`a278e1d565d0ef345bcdf1532763480cd156614d`と
Tauri`842245ddf060fedaeb42e6b01d30175b488816b7`をcommit／push済み。
両作業ツリーがcleanでremote mainと一致することを確認後、修正を含む別の5構成CIを開始した。
修正版CIは`completed`／`success`で終了し、macOS x86_64を含む全5構成の検証とインストーラービルドが成功した。
全5構成の検証JSONと取得ZIPのdigest照合も成功した。CI開始後のコード変更や追加のローカル試験はしていない。

## ビルド境界

Tauriの`src-tauri/build.rs`が参照するSDK内のパスは次のとおり。

| 用途 | SDK内のパス |
| --- | --- |
| MSX／MSX Audioと独立追加AYに共通のコア | `vendor/mame-ay8910/ay8910.cpp`／`.h` |
| `createSoundChip('ay8910')`の独立接続 | `native/reference/tauri/native_genesis_ay8910.cpp`／`.h` |

4ファイルすべて旧コピーとbyte一致。独立接続は引用includeでSDK側のC ABIヘッダーを解決する。
ローカルの`src/native_genesis_msx.cpp`はSDKのAYヘッダーを解決し、従来のAYレート変換と
`NativeOpllCore`を保持する。独立追加AYは別のtick／レート変換を持ち、両者を統合しない。
既存の`tetorica_native_msx` archive内でAYコアを一度だけコンパイルし、
C++14・O2・MSVC `/EHsc`とGNU ld向けの依存順序を維持する。
共有OPL／PCM／ADPCM providerを追加で複製しない。

SDKの`vendor/mame-ay8910/`と独立接続cpp／headerをCargoの監視対象にする。
ローカルの機種用接続とOPLL helperの監視は継続し、コンパイル入力のなくなった旧`native-msx/`のソース監視は外した。
旧コピー、Browser比較用固定記録、syncスクリプトと同梱AYライセンスの参照先は保持する。
旧syncスクリプトの実行だけでは、実際にコンパイルするSDKは更新されない。

SDKは`0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`の374ファイルをそのまま使う。
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
同梱SDK・取り込み記録、Browser／npmのWASM、Tauriの`dist/`は変更していない。
Rustの予約・owner・寿命・予算・回収、CPAL、Mixer、FX／liveFx、WebView／JS APIも変更していない。

## ローカル検証

macOS ARM64／Clangで実施。音声デバイスは開かず、実機での聴感確認や締切保証とは区別する。

| 対象 | ケース | フレーム | 結果 |
| --- | --- | --- | --- |
| 選択中MSXのAY／OPLL出力 | 93 | 571,392 | 旧／SDKがbyte一致、実WASM最大差0 |
| 独立追加AYのPCM／公開状態 | 114 | 466,944 | 同上 |
| Native公開状態の別比較 | 6 | 24,576 | 104／24バイトの状態全体とPCM、毎フレーム16個のAY readが一致 |
| 共通fixtureの追加YM2413回帰 | 558 | 2,285,568 | SDKの既定ビルドで実WASM最大差0 |

移行比較は計207ケース・1,038,336フレーム。旧／SDK両方のfixtureへ同じ命令を入力し、
stdoutの完全一致を確認してから実配布のWASM Workletと比較した。
44.1／48／96 kHzで、3音tone、全tone／noise混合、全16 envelope形状、period境界、
clockのhold／平均化、明示的な音量0、保持したレベルでのStop／reset／再試奏、
I/O readとOPLLの独立制御を確認した。
既定ビルドも成功し、実際にコンパイルしたcppのパスとSHA-256を記録した。その再確認分は二重加算しない。
追加YM2413回帰は共有checkerのコンパイル入力変更に対する確認で、AYの旧／SDK比較には数えない。

Native状態比較は公開snapshotとread・PCMの比較で、非公開コア全メモリーやWASM内部状態のdumpではない。
旧／SDKのfixture自己試験も成功し、callback操作中のallocation／freeは0だった。

- Rust全試験：723成功、0失敗、明示実行用4件ignored。
- 再生ライフサイクル：22 mode、604,032フレーム、88 Run／Stop遷移が成功。MSX／MSX Audioを含む。
- 追加音源の混在：3混合構成、7単独音源、受入れ／16台制限、Stop後の予算回収が成功。
- 両report runnerはexit code 0、`deviceOpened: false`。
- SDK374ファイルのオフライン照合が成功。

本体からの再確認は次のとおり。

```sh
node scripts/check_native_msx.mjs
node scripts/check_native_extra_ay8910.mjs
node scripts/check_native_extra_ym2413.mjs
```

選択中checkerと、追加AY／YM2413の共通checkerは今回からSDKのAY入力を使う。
既存の`--fixture`で旧／SDK比較用実行ファイルも注入できる。
Cargo、再生・混合、ソース配布の手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)にある。

集計・入力監査・旧／SDK fixture・公開状態比較は`/private/tmp/tetorica-sdk-ay8910-adoption/`、
Rustログは`/private/tmp/tetorica-sdk-ay8910-cargo-test.log`、
再生／混合reportは`/private/tmp/tetorica-sdk-ay8910-stability.json`と
`/private/tmp/tetorica-sdk-ay8910-extra-stability.json`。
一時ファイルが消えても、既定checkerと既存Rust試験でSDKの動作は再確認できる。

先行する5構成CI run `40137093552`は共有OPL providerまでの移行に対するもので、
後続のOPL接続／今回のAY移行を含まない。今回のCI開始状況は下記に分けて記録する。
実機の音声出力は未確認。

ローカルで生成したCI入力の対応ソースZIPは全1,796ファイル、SHA-256は
`cf24143b1449028742ff4e8490d63e5b5d66dc272f29cf87509c90164b1fc54a`。
ソース照合結果は`/private/tmp/tetorica-sdk-ay8910-sources.json`。
ZIP内文書へ自身のハッシュを埋め込まず、本体側の本記録で保持する。

## OPL接続／AY移行後のGitHub Actions — 4構成成功、macOS x86_64失敗

- [Build Desktop — run 40142510765](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40142510765)を`main`へ`workflow_dispatch`で手動実行した。
- 対象コミットは`276e744ee5ed00513558b1d995e950a3ef91884c`。`4451195...`のOPL接続移行と今回のAY移行を含む。
- attempt 1は`completed`／`failure`。5ジョブ中4成功・1失敗で、再実行はしていない。
- アプリ版は`0.90.1`のまま。タグを作らない手動実行で、新しいドラフトリリースや一般公開は行わない。

| 構成 | ソース照合 | Rust試験・再生／混合report | インストーラービルド |
| --- | --- | --- | --- |
| macOS ARM64 | 成功 | 成功 | 成功（DMG） |
| macOS x86_64 | 成功 | Rust試験1件失敗、再生／混合reportなし | 未完了 |
| Windows x86_64 | 成功 | 成功 | 成功（NSIS） |
| Linux ARM64 | 成功 | 成功 | 成功（DEB／AppImage） |
| Linux x86_64 | 成功 | 成功 | 成功（DEB／AppImage） |

検証アーティファクト5件を取得し、ZIPのdigestがGitHubの記録と一致することを確認した。
全5構成の`sources.json`でSDK374ファイルを含む22件の固定記録とソースZIP1,796ファイルが成功。
macOS x86_64以外の4構成では、22 mode・604,032フレーム・88 Run／Stopと、
3混合構成・7単独音源・受入れ／16台制限が成功し、両runnerはexit code 0、`deviceOpened: false`。
macOS x86_64には`sources.json`だけがあり、欠けた再生／混合reportを成功とは扱わない。
GitHub APIで検証レポート5件とインストーラー4件の計9アーティファクトを確認し、すべて有効期限内・サイズ0より大きかった。
全5ジョブのドラフトリリース作成stepはskipped。インストーラーのダウンロード・起動確認はしていない。

macOS x86_64のRust試験は722成功・1失敗・4件ignoredでexit code 101。
失敗は`native_genesis::extra_snes_tests::extra_snes_completion_wait_releases_control_and_history_expires`。
CI対象の`src/native_genesis_extra_snes_tests.rs:656`の`unwrap()`が、
`Native additional SNES state changed while reading; retry`を返す`Err`でpanicした。
OPL／AYのPCM一致を否定する結果ではなく、移行との因果関係は未確定。

確認用のレポート取得先は`/private/tmp/tetorica-opl-ay-ci-40142510765/`。
集計は`inspection-summary.json`、失敗ログは`macos-intel-job.log`。
最終状態は`run-final.json`、`jobs-final.json`、`artifacts-final.json`、`jobs-audit.json`に記録した。
音声デバイスを開かない自動試験であり、OS間のPCM bit一致や各OSでのWASM比較、
実機での音声・ノイズ・UI操作・インストール後の起動を確認したという意味ではない。

```sh
gh run view 40142510765 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

## CI失敗に対するローカル修正と検証 — commit済み

Tauriの`src-tauri/src/native_genesis_extra_snes_tests.rs`だけを修正した。
既存の状態読取APIが返す上記のretryエラーに限り、5秒を上限に`yield_now()`を挟んで再読取する。
ほかのエラーはそのまま検証へ渡し、完了通知の受信待ちも200 msから5秒へ延長した。
完了前の待機、履歴失効、状態値等の意味上のassertは保持している。
音源コア・製品のRust実装・ビルド・APIは変更していない。

修正後のローカルRust全試験は723成功・0失敗・4件ignored。
対象試験の50回反復も50／50成功。結果は同じCI記録ディレクトリの`snes-test-fix-validation.json`にある。
この修正は最初のCI対象`276e744...`には含まれない。ローカル検証終了時点では未コミット・修正版CI未実行だったが、
その後ユーザーが修正とガイドを`842245dd...`としてcommit／pushした。
この追記では本体の作業記録2ファイルとTauriの取り込みガイドだけを更新した。
元のCI入力ZIPのハッシュは上記のまま保持する。
試験修正とガイド更新後のローカルZIPを再生成・照合した。全1,796ファイル、SHA-256は
`2cafb70e38ffd8eecfab984253fc5cd01e696f3221a493da44850a5396a62e06`。
CI入力とのマニフェスト差分は`docs/native-sdk-ym2612.md`と
`src-tauri/src/native_genesis_extra_snes_tests.rs`だけで、製品のソース入力は変わらない。
結果は`local-final-sources.json`と`local-final-manifest-diff.json`に保存した。

## SNES試験修正後のGitHub Actions — 全5構成成功

- [Build Desktop — run 40143851548](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40143851548)を`main`へ`workflow_dispatch`で手動実行した。
- 対象は`842245ddf060fedaeb42e6b01d30175b488816b7`。OPL接続／AY移行に加え、上記のSNES試験修正と前回CIのガイド更新を含む。
- attempt 1は`completed`／`success`。全5ジョブの検証とインストーラービルドが成功した。
- 開始前に本体`a278e1d565d0ef345bcdf1532763480cd156614d`とTauriの対象HEADがremote mainと一致し、両作業ツリーがcleanであることを確認した。追加のcommit／pushは不要だった。
- macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の全5構成で、ソース照合・Cargo・再生ライフサイクル・追加音源混合のstepが成功した。
- macOS ARM64／x86_64はDMG、Windows x86_64はNSIS、Linux ARM64／x86_64はDEB／AppImageのビルドが成功。最初のCIで失敗したIntel Macも今回はジョブ全体が成功した。
- 全5構成の検証JSONを取得・監査し、検証アーティファクトZIPのdigestがGitHubの記録と一致することを確認した。
- 最初に失敗したrun `40142510765`とは別の実行で、その失敗結果やローカル検証記録は上記に保持する。
- アプリ版は`0.90.1`のまま。タグを作らない手動実行で、新しいドラフトリリースや一般公開は行わない。
- 今回の変更は本体の2ファイルとTauriの取り込みガイド。コードは変更せず、ローカル試験も再実行していない。ガイドを含む対応ソースZIPだけ再生成した。

確認用のレポート取得先は`/private/tmp/tetorica-opl-ay-fixed-ci-40143851548/`。
`inspection-summary.json`と`native-artifact-metadata.json`で、全5構成について次を確認した。

- `sources.json`: SDK374ファイルを含む22件の固定記録と、対応ソースZIP1,796ファイルの照合が成功。
- `stability.json`: 22 mode、604,032フレーム、88 Run／Stopが成功。
- `extra-stability.json`: 3混合構成、7単独音源、受入れ／16台制限とStop後の予約予算回収が成功。
- 両runnerはexit code 0、`deviceOpened: false`。前回reportが欠けたmacOS x86_64も今回は3つのJSONが揃って成功。

CIの対応ソースZIPはmacOS／Linuxが上記の`2cafb70e...`、Windowsが
`0cbc716f7d277d2a2e0e24f42134cb0f6b6ffb15f767fe0f74ea377b84c00920`。
各環境のcheckout／マニフェストとの照合は成功し、SDK固定ハッシュも同じ。ZIPの差の原因は断定していない。
最終状態は`run-final.json`、`jobs-final.json`、`artifacts-final.json`に記録した。
GitHub APIで検証レポート5件とインストーラー5件の計10アーティファクトを確認し、すべて有効期限内・サイズ0より大きかった。
全5ジョブのドラフトリリース作成stepはskipped。インストーラーや対応ソースZIPのダウンロード、インストール後の起動・実機の音声確認はしていない。
今回の成功結果を含むガイド確定後、対応ソースZIPを再生成・照合した。全1,796ファイル、SHA-256は
`ff6d69a7c1b701c9348ba51c037ee66ecc1fd5891bc2468989ee81864b4203bc`。
CI入力からのマニフェスト差分は`docs/native-sdk-ym2612.md`だけで、製品・試験のコンパイル入力は同一。
新しい実行の記録ディレクトリに`local-final-sources.json`と`local-final-manifest-diff.json`を保存した。

```sh
gh run view 40143851548 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```
