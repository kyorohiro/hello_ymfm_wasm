# Playground TauriへのNative SDK取り込み — YM2612

作業場所: `w/tetorica-fm2612-playground-tauri/`。
`tetorica-soundchip-native`の単体Native対応が全22種類揃った後の、最初の利用側への取り込み。

## 目的と範囲

YM2612の実装元を、版とSHA-256を固定したSDKソース配布へ切り替える。
利用側は必要なソースを同梱し、submodule、ビルド中のGitHub取得、隣接SDK checkoutを必須にしない。
SDKを更新してもTauriが使う版は自動で変えず、同期した開発を求めない。

- SDK `0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`。
- 元ZIP: `tetorica-soundchip-native-0.1.0-sources.zip`。
- 元ZIPのSHA-256: `26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
- Tauriの同梱先: `src-tauri/vendor/tetorica-soundchip-native/`。
- 取り込み記録: `src-tauri/soundchip-sdk.json`。
- 全374ファイル。記録には版、元コミット、ZIP名／SHA-256、マニフェストSHA-256とファイル数を保持する。

元コミットは取り込み時に指定する由来で、署名検証を表すものではない。
取り込み時のZIPハッシュとマニフェスト照合、取り込み後の全ファイル照合で内容を検証する。

SDK配布物全体のソース、ライセンス、NOTICE、カタログと原典記録を保持する。
今回はYM2612主音源の低レベル接続、追加YM2612接続、共有OPN providerとSSG／ADPCMを使用する。
共有providerを二重にコンパイルせず、YM2203／YM2608／YM2610等の既存接続もそれを参照する。
これらの他音源の接続までSDKへ移行したわけではない。

Genesisのgain／DC除去／PSG混合、Rustの予約・owner／COW RAM／予算と回収、CPAL、
ホストFX／liveFx、ミキサー、録音、WebView／JS APIはTauri側に残す。
Browser／npm向けWASM配布とPlaygroundの`dist/`は変更しない。

## 更新の流れ

アプリ等の開発元で確認した音源変更 → SDKソース配布へ反映 → 利用側が固定版を取り込む。
同梱ソースへ利用側独自の修正を蓄積せず、必要な差分は接続または別パッチとして由来を記録する。

Tauriの`python3 scripts/import_soundchip_sdk.py`でローカルの配布ZIPを明示的に取り込み、
`--check`で同梱内容と記録をオフライン照合する。
アプリの対応ソースZIPにも同梱SDK全体と取り込み記録を含める。
更新手順と責任範囲はTauriの[Native SDKの取り込み](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)に記載する。

## ローカルの検証結果

macOSで実施。

- [x] SDK全374ファイルと取り込み記録をオフライン照合。
- [x] 旧ソースとSDKソースの14組が一致。
- [x] 主YM2612の旧ビルド／SDKビルドが24ケース・240,000フレームでbit一致。
- [x] 追加YM2612と実WASMが198ケース・1,216,512フレームでPCM／status／IRQ／4種類のread結果まで差分0。
- [x] 主GenesisとWorkletの6項目・49,152フレーム比較が最大差`3.725290298e-9`。旧ビルドの結果から変化なし。
- [x] TauriのPython 22テスト、Node 31テストが成功。
- [x] `cargo test --locked --offline`が723件成功、明示実行用4件ignored。sandbox内で制限されたHTTP bind試験は承認済みの制限外再実行で成功し、回避用の製品変更は入れていない。
- [x] 22 modeの604,032フレーム、88回のRun／Stop遷移が成功。
- [x] 代表7音源の3混合構成、追加生成の受入れと台数制限の試験が成功。
- [x] 対応ソースZIPの1,796ファイルを照合し、SDK全374ファイル／取り込み記録／文書／ツールの収録と22件のNativeソース固定記録を確認。
- [x] インポーターが検証後に別のZIP内容を展開しないよう、読み込んだ同じバイト列から検証・展開する。回帰試験も成功。

- [x] 対応ソースZIPを独立した一時ディレクトリへ展開し、374ファイルのSDK照合、YM2612 fixtureのC++14ビルドと自己試験が成功。元のアプリ／SDK checkout、音声デバイス、ネットワークへの依存なし。
- [x] 取り込み記録とSDK補助ヘッダー更新をCargoの再ビルド監視に含め、`cargo check --locked --offline`も成功。

検証記録は`/private/tmp/tetorica-sdk-adoption-isolated.json`および
`/private/tmp/tetorica-sdk-adoption-parity/`に保存した。文書のみを更新した最終対応ソースZIPも再生成し、全1,796ファイルの照合が成功した。独立ビルドに使ったソースからの差分が手順書だけで、コンパイル入力が変わっていないことも確認した。
ここまでの実装・ローカル検証を終えた時点ではcommit／push／公開は行っていなかった。
その後、ユーザーがTauri移行を`9ef583e8e7fa9e75546b24dd89e119dab7d412c6`としてcommit／pushし、
同じコミットへ`v0.90.2+test`タグをpushした。

## GitHub Actionsの検証 — 2026-10-25

[Build Desktop — run 40125688503](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40125688503)で、
上記タグ／コミットの5環境のNative検証レポートを取得し、JSONの内容まで確認した。
重複して起動したmainの手動実行`40125700793`はキャンセルし、タグ側を追跡した。
タグ名とは別に、配布アプリの`package.json`／Tauri設定の版は`0.90.1`。

| 構成 | Native検証レポート | インストーラービルド |
| --- | --- | --- |
| macOS ARM64 | 成功 | 成功（DMG） |
| macOS x86_64 | 成功 | 成功（DMG） |
| Windows x86_64 | 成功 | 成功（NSIS） |
| Linux ARM64 | 成功 | 成功（DEB／AppImage） |
| Linux x86_64 | 成功 | 成功（DEB／AppImage） |

各環境で次を確認した。

- `sources.json`: SDK374ファイルを含む22件のソース固定記録と、対応ソースZIP全1,796ファイルが照合成功。
- `stability.json`: 全22 mode、604,032フレーム、88回のRun／Stop遷移が成功。
- `extra-stability.json`: 3つの混合構成と7つの単独音源、追加生成の受入れ・台数制限が成功。
- 全レポートで`deviceOpened: false`。音声デバイスを開かずに実Rustの生成経路を確認した。

確認したアーティファクトは各`native-validation-<platform>`。
集計は`/private/tmp/tetorica-sdk-adoption-ci-40125688503/inspection-summary.json`に保存した。
対応ソースZIPのSHA-256も環境別に記録している。Windowsと他環境でZIPのハッシュは異なるが、
各環境のマニフェストとcheckoutに対する全ファイル照合は成功している。

Actions全体と全5ジョブが`completed`／`success`で完了した。
インストーラーはDMG 2個、NSIS EXE 1個、DEB 2個、AppImage 2個の計7個を確認。
Actionsにはインストーラー5構成分とNative検証レポート5構成分の計10アーティファクトが保存されている。
リリースは`isDraft: true`で未公開。今回はインストーラーのダウンロード・インストールは行っていない。

このCIはOS間のPCM bit一致や、各OSでのWASM比較を実施したものではない。
実機の音声出力・ノイズ・Keyboard操作・インストール後の起動も別に確認する。
