# Native SDK RF5C164取り込み

2026-10-25。Mega CD／32Xと独立追加生成のRF5C164接続、共通decoderとraw C APIを、同梱済みの固定SDKへ切り替えた。
着手時は本体`1da2fb00abecd32bccd0b75b4fc4d965e36ee900`、Tauri`51dca52dd7ca2dd2856f9dbc8ceeeb7e7479cbc6`で、両方cleanだった。
先行するSega PSG移行はこの2コミットに保存済み。ローカル検証後、本体を`1d35f48a16dbc5b0264755f82ec3e97242e34e8a`、
Tauriを`4939ddc7f7125f47d969e29c975264eaa528d81c`へcommit／pushした。
両作業ツリーがcleanでremote mainと一致することを確認し、両移行を含む5構成CIを開始した。
CIはattempt 1で`completed`／`success`となり、全5構成の検証とインストーラービルドが成功した。
全5構成の検証JSON・取得ZIPのdigestと、計10アーティファクトのrun／commit一致も確認した。

## ビルド境界

| 用途 | SDK内のパス |
| --- | --- |
| 選択中Mega CD／32Xの接続 | `native/reference/tauri/native_genesis_rf5c164.cpp`／`.h` |
| 独立追加生成の接続 | `native/reference/tauri/native_genesis_extra_rf5c164.cpp`／`.h` |
| 選択中／raw C API共通のdecoder | `vendor/mame-rf5c164/rf5c164.cpp`／`.h` |
| raw C API | `wasm/rf5c164_wasm.cpp` |
| 状態直列化ヘッダー | `vendor/ymfm/chip_state.h` |

旧`native-megacd/README.md`自体も原典の固定対象なので原本を保持し、移行の説明は取り込みガイドへ記録する。

8ファイルすべて旧コピーとbyte一致。選択中接続・decoder・raw C APIは既存の`tetorica_native_megacd` archive内でコンパイルし、decoderは一度だけ組み込む。
追加接続は既存の`tetorica_native_opl` archive内に残し、C++14・O2・MSVC `/EHsc`とリンク順序を維持する。
SDKの実入力を監視し、実消費元のなくなった旧`native-megacd/`のソース監視を外す。旧コピー、由来、ライセンスの同梱先とsyncスクリプトは保持する。

選択中decoderと独立追加接続は、それぞれ64 KiB RAMを所有する。
追加接続には声ごとの保持出力と取り消し処理があり、選択中decoderへ統合しない。
どちらもアップロードを内部RAMへコピーする。RustのArcが持つ転送payload、予約・owner・寿命・予算・回収は引き続きホスト側。
Y8950の借用ページ構成とは異なる。gain／pan／Mixer、CPAL、FX／liveFx、WebView／JS APIも引き継ぐ。

SDKは`0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`の374ファイルを保持する。
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK本体・取り込み記録、Browser／npmのWASMとTauriの`dist/`は変更していない。
文書にあったPSGの誤った`wasm/chip_state.h`参照も、実際の`vendor/ymfm/chip_state.h`へ訂正した。ビルド自体は従来から正しいinclude先を解決していた。

## ローカル検証

macOS ARM64／Clangで音声デバイスを開かずに実施した。
旧／SDKのfixture出力をbyte一致させてから、実配布WASMと比較した。

| 対象 | ケース | フレーム | 結果 |
| --- | --- | --- | --- |
| 選択中Mega CD | 21 | 98,304 | 旧／SDKが完全一致、実WASM最大差0 |
| 独立追加生成 | 75 | 448,512 | 同上 |
| 合計 | 96 | 546,816 | |

44.1／48／96 kHz、8声、pitch／pan／gain ramp、loop／end marker、RAM末尾・絶対／bank転送、clock、Stop／reset後の保持を確認した。
追加生成は毎フレーム95項目のPCM・レジスター・clock／bank・16個の位置read・16箇所のRAMを実WASMと比較した。
追加fixture自己試験では全64 KiB転送・範囲拒否・9通りのrate／clock分離・保持出力の声別取り消し・100バイトABIとcallback中のallocation／freeゼロも確認した。
既定ビルドの2つのcheckerもSDK入力から成功し、cppパス／SHA-256を記録した。再確認分は上表へ二重加算しない。

raw C API／追加生成の別比較では、6ケース・24,576フレームでPCMと毎フレーム16個の位置readが一致した。
各ケース27回の観測点で全64 KiB RAMを独立した期待値とも照合した。
rawの65,660バイト直列化状態、追加接続の100バイト公開状態も旧／SDKで一致。
転送元バッファの書換えがRAMへ影響しないこと、bank書込み・範囲拒否・reset保持・clearを確認した。
これは同一ビルドのNative間比較で、全RAMの毎フレームdumpやWASM内部状態のdumpではない。raw状態APIのvector確保はcallbackの割当てゼロ主張と分ける。

Rust全試験は723成功・0失敗・明示実行用4件ignored。
再生は22 mode・604,032フレーム・88 Run／Stop、混合は3構成・7単独音源、受入れ／16台制限とStop後の予約予算0への回収が成功した。
両runnerはexit code 0、`deviceOpened: false`。
今回sanitizerは実行していない。

本体からの通常の再確認は次のとおり。

```sh
node scripts/check_native_megacd.mjs
node scripts/check_native_extra_rf5c164.mjs
```

集計は`/private/tmp/tetorica-sdk-rf5c164-adoption/parity-summary.json`、
完全RAM比較は`full-ram-migration.json`、入力監査は`source-audit.json`。
Rustログは`/private/tmp/tetorica-sdk-rf5c164-cargo-test.log`。
一時ファイルが消えても、既定checkerと既存Rust試験からSDKの動作は再確認できる。
固定SDKの更新と配布ソースの検証はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。
先行する5構成CI run `40143851548`は今回のPSG／RF移行を含まない。実機の音声・聴感確認は別の確認。

CI対象コミット時点のローカル対応ソースZIPは全1,796ファイル、SHA-256は`e1433b213fc340762f0578944e8b5797fcff7af26af6ad308db4febb73db353e`。
SDK374ファイルを含む22件の固定記録とZIPの照合結果は`/private/tmp/tetorica-sdk-rf5c164-sources.json`。
ZIP内文書へ自身のハッシュは埋め込まない。
最初の照合では固定対象の`native-megacd/README.md`へ移行説明を追記した差分が検出されたため、
そのファイルだけをHEADの原本へ復元してZIPを再生成した。`PINNED`を変更して照合を回避していない。
移行説明はアプリREADME、NATIVE-SOURCESと取り込みガイドへ保持し、最終照合は全22件成功した。

## Sega PSG／RF5C164移行後のGitHub Actions — 全5構成成功

- [Build Desktop — run 40148943609](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40148943609)を`main`へ`workflow_dispatch`で手動実行した。
- 対象は`4939ddc7f7125f47d969e29c975264eaa528d81c`。先行するSega PSGと今回のRF5C164のSDK移行を含む。
- attempt 1は`completed`／`success`。全5ジョブの検証とインストーラービルドが成功した。
- 開始前に本体`1d35f48a16dbc5b0264755f82ec3e97242e34e8a`とTauriの対象HEADをpushし、remote mainとの一致と両作業ツリーがcleanであることを確認した。
- pushは最初のSSH公開鍵認証で失敗したが、コマンド単位でghのHTTPS認証を使って成功した。remoteやGit設定は変更していない。
- macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の全5構成の検証JSONと取得ZIPのdigest照合が成功。macOSはDMG、WindowsはNSIS、Linuxは各DEB／AppImageのビルドが成功した。
- アプリ版は`0.90.1`のまま。タグを作らない手動実行で、新しいドラフトリリースや一般公開は行わない。
- 今回の結果記録は本体の作業記録2ファイルとTauriガイドだけ。コードは変更せず、ローカル試験も再実行していない。CI入力ZIPのハッシュは上記のまま保持し、ガイド確定後のZIPも別に再生成・照合した。

確認用のレポート取得先は`/private/tmp/tetorica-psg-rf-ci-40148943609/`。
`inspection-summary.json`は`status: passed`、5構成すべての3つのJSONが揃っている。

- `sources.json`: SDK374ファイルを含む22件の固定記録と、対応ソースZIP1,796ファイルの照合が成功。
- `stability.json`: 22 mode、604,032フレーム、88 Run／Stop遷移が成功。
- `extra-stability.json`: 3混合構成、7単独音源、受入れ／16台制限とStop後の予約予算回収が成功。
- 両runnerはexit code 0、`deviceOpened: false`。検証アーティファクトZIPのdigestは全5件ともGitHubの記録と一致。

CIの対応ソースZIPはmacOS／Linuxが上記の`e1433b21...`、Windowsが
`cac895015a0a3737fcb5116adf214c24b0ee7722d18938a4eae3c296592fe48a`。
各checkout／マニフェストとの照合は成功し、SDK固定ハッシュも同じ。ZIPの差の原因は断定していない。
最終根拠は`final-ci-summary.json`、`jobs-audit.json`、`artifact-metadata.json`。
検証レポート5件とインストーラー5件の計10アーティファクトは、すべて対象run／commitが一致し、有効期限内・サイズ0より大きかった。
全5ジョブのドラフトリリース添付stepはskipped。インストーラーや対応ソースZIPのダウンロード・起動・独立照合はしていない。
音声デバイスを開かない自動試験であり、OS間のPCM bit一致や各OSでのWASM比較、
実機の音声・ノイズ・UI操作・インストール後の起動は別の確認。

CI結果のTauriガイドは`66004f00e66e7dba2394777cd281f7feeec46da0`へcommit／push済み。
CI対象`4939ddc7...`からの変更は`docs/native-sdk-ym2612.md`だけで、コードと試験は同じ。
ガイド更新後のローカル対応ソースZIPは全1,796ファイル、SHA-256は
`77c203bb0dc928ba7da75cdf0461525c9b531a438e8eaf8398eb6826fb0260e8`。
`local-final-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合し、
`local-final-source-delta.json`でCI入力マニフェストとの差がガイド1ファイルだけと確認した。
これらは上記のCIレポート取得先に保存した。本体の最終結果記録コミットは、この文書を含む`git log`で確認する。

```sh
gh run view 40148943609 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```
