# リリース手順

配布物の作成・検証・公開を行うメンテナー向けの手順です。コマンドはリポジトリーのルートから実行します。

## itch.io向けを共通の版番号で一括作成

通常配布用とブラウザー公開用を、同じ版番号でまとめられます。

```sh
sh scripts/package_itch_all.sh 20261114
sh scripts/package_itch_all_for_run.sh 20261114
```

- 通常配布用：`release/itch_all_20261114/`
- ブラウザー公開用：`release/itch_all_20261114_for_run/`

各フォルダーには、8種類のSynth、VGM Analyzer、Playgroundの個別ZIPを10本と、
`manifest.json`、`SHA256SUMS`、`README.txt`をまとめます。各製品のitchプロジェクトへ
対応するZIPを個別にアップロードしてください。まとめ先のフォルダー自体はアプリのZIPではありません。

ブラウザー公開用フォルダー内の10本は、すべて名前を`*_for_run.zip`にします。
例えばDMGは通常配布用が`tetorica_dmg_synth_20261114_itch.zip`、ブラウザー公開用が
`tetorica_dmg_synth_20261114_itch_for_run.zip`です。
ZIPの内容が異なるのはPlaygroundだけで、通常配布用はソースを含むダウンロード版、
ブラウザー公開用は実行用の`*_itch_playground_for_run.zip`を選びます。他の9製品は
同じバイト列を別名でコピーします。`release/`直下の元ZIP名や個別スクリプトの出力名は変わりません。
Game Boy／NESの互換コマンドはDMG／2A03と重複するため、一括実行では省きます。

最初の実行で全10製品を作成し、各ZIP名にも共通の版番号を含めます。
同じ版番号でもう一方のコマンドを実行すると、完了記録
`release/itch_all_20261114.json`と全11本のZIPのハッシュを検証して再利用します。
旧形式のブラウザー公開用フォルダーも、同じ版番号で再実行すると更新できます。
内容を検証してから旧フォルダーを`*.before-for-run-names`へ退避し、全ZIP名に
`_for_run`を付けたフォルダーへ切り替えます。製品をビルドし直す必要はありません。
ソースを変更した後に作り直す場合は、新しい版番号を指定してください。
版番号は必須で、英数字から始まる1〜80文字の英数字・`.`・`_`・`+`・`-`を使えます。

完了記録がない状態で同じ版番号のZIPや出力先が既にある場合は、
子コマンドを開始する前に停止します。子コマンドの失敗時は製品名と
`release/itch_all_20261114_logs/`内のログを示し、作成済みのファイルを保持します。
途中の出力を確認するか、新しい版番号で再実行してください。
同じ版番号の並行実行も防ぎます。中断後にロックが残っている場合は、エラーに表示されたパスと実行状況を確認します。

既存の個別パッケージスクリプトの上書き方針は変わりません。
個別生成やGitHub Actionsの配布物については[Web release ZIPs](docs/itch_web_release.md)を参照してください。

## 各Tauriアプリの取り込み時に版番号を更新

各`w/tetorica-*-tauri/`の既存コマンドへ`--version`を追加できます。
例えばFM2612 Synthでは、次のように実行します。

```sh
cd w/tetorica-fm2612-synth-tauri
npm run import:release -- /path/to/xxx.zip --version 1.2.3
```

`1.2.3`は実行時に設定するアプリ版です。ZIP名・Web版とは独立しています。
ZIPの取り込み成功と一緒に`package.json`、`package-lock.json`、
`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`内のアプリ版、
`src-tauri/tauri.conf.json`を更新します。依存パッケージの版は変更しません。
`--version`を省略すれば、従来どおりZIPだけ取り込みます。
`--check`や`--record-local-changes`との同時指定はできません。

2A03、DMG、HuC6280、S-DSP、SID、SPU、FM2612 Synth、VGM Analyzer、Playgroundの
9リポジトリで同じオプションを使えます。各リポジトリ単体で実行でき、
親リポジトリのスクリプトには依存しません。
取り込み後にテスト・リリースビルドを行い、更新した設定・lockと取り込んだファイルを
最終commitに含めてからタグを付けてください。取り込みコマンド自体はbuild・commit・tagを行いません。

## 補助ツール：Tauri 9アプリをローカルで一括ビルド

`VERSION`は、実行時に指定する**Tauriアプリの共通版番号**です。
`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、
`src-tauri/Cargo.lock`の自分のcrate、`src-tauri/tauri.conf.json`へ反映します。
Web ZIPの版番号を検索する引数ではありません。取り込むWeb配布物は
`--web-dir`で別に指定し、フォルダー内のmanifestから製品ごとのZIPを選びます。
例えばWeb配布物が`20261114`でも、アプリ版は`1.2.3`にできます。

```sh
# VERSIONを今回のアプリ版（数字のX.Y.Z）に、パスを取り込むWeb配布物へ置き換える
sh scripts/release_tauri_all.sh --plan VERSION --web-dir release/itch_all_20261114
sh scripts/release_tauri_all.sh --prepare VERSION --web-dir release/itch_all_20261114
# ビルド結果を確認してから、最終commitとvVERSIONタグを作る
sh scripts/release_tauri_all.sh --commit VERSION
```

`--plan`は読み取りだけです。9リポジトリの未commit変更や既存タグ、Web ZIPのハッシュを、
取り込み前にまとめて確認します。変更がある場合は、先にそのリポジトリで整理してください。
`dist/`の直接編集や`local-changes.json`も自動で消しません。
`--web-dir`には通常配布用の`itch_all_*/`を指定します。
Playgroundも改造用ソースを含む通常版を使うため、`_for_run/`は指定できません。

`--prepare`は各リポジトリの取り込み処理を使ってJavaScriptを反映し、版番号を揃え、
`npm ci`、`npm test`、配布lock検証、`cargo test --locked`を実行してから、
既存の`deploy_mac.sh`でIntel／Apple Siliconの`.app`と`.dmg`を作ります。
既存の`--locked`付きビルドにも対応するため、自分のcrateのlock版もビルド前に揃え、
依存crateが変わっていないことと最終lockの整合をビルド後に確認します。
署名、appの公証チケット、CPU種別と版番号を検証し、
`release/tauri_VERSION/`へapp ZIP、DMG、SHA256、ログ、進行記録を集めます。

Python 3.11以降、Node/npm、Rust、両CPUのRust target、Xcodeのツールと、
各`deploy_mac.sh`が使うローカルMacの署名証明書が必要です。
`APPLE_PASSWORD`を環境変数に設定済みなら使用し、未設定なら実行時に非表示で入力します。
パスワードはローカルのdeploy子プロセスへだけ渡し、ファイル、ログ、コマンド引数には保存しません。
証明書やパスワードをGitHubへ登録する処理はありません。

`--commit`は全ビルドの完了と、以降にソース・成果物・HEADが変わっていないことを確認し、
各アプリで最終commitと注釈付きタグを作ります。pushやGitHub公開は別作業です。
commit／tagの途中で止まった場合は、進行記録を使って同じ`--commit`を再実行できます。
ビルド失敗時は変更と記録を保持し、自動resetや再取り込みはしません。
原因を直して各アプリの変更を確認・整理し、途中の`release/tauri_VERSION/`を退避してから再実行します。
停電等で`release/.tauri_release.lock`が残った場合も、実行中の処理がないことを確認してから扱ってください。

対象は2A03、DMG、FM2612 Synth、SPU、HuC6280、S-DSP、SID、VGM Analyzer、Playgroundです。
Windows／Linuxの配布とGitHub公開の一括化は後続作業です。
現行ActionsはMac成果物もアップロードするため、ローカル署名済み成果物を置き換えないよう
workflow側を整理してから公開してください。

## npmパッケージ

パッケージごとの版番号更新、検証、公開手順は、次の文書を参照してください。

| パッケージ | 手順 | バージョンの設定先 | packコマンド |
|---|---|---|---|
| `tetorica-vgm` | [READMD_RELEASE_VGM.md](READMD_RELEASE_VGM.md) | `packages/vgm/package.json` | `npm run pack:vgm` |
| `tetorica-fm2612` | [READMD_RELEASE_FM2612.md](READMD_RELEASE_FM2612.md) | `packages/fm2612/package.json` | `npm run pack:fm2612` |

ルートの`package.json`は`private: true`の開発用ワークスペースです。配布用の情報とnpmのREADMEは`packages/vgm/`、`packages/fm2612/`にあり、実装は`tetorica_src/cli/`、`tetorica_src/runtime/`、`tetorica_src/node/`とAnalyzerの共有モジュールにあります。

```sh
npm run build:vgm       # dist/vgm/
npm run pack:vgm        # tetorica-vgm-VERSION.tgz
npm run build:fm2612    # dist/fm2612/
npm run pack:fm2612     # tetorica-fm2612-VERSION.tgz
```

各ビルドは、自分の出力フォルダーだけを置き換えます。`build`、`pack`、`pack:check`はVGM向けの別名です。公開時は、検証済みのtgzを明示的に指定します。

## 生成済みWASMの確認

生成物の正本は`tetorica_src/runtime/generated/`です。33件のSDKビルドとNative FXを、[共通manifest](tetorica_src/runtime/generated/runtime-artifacts.json)で管理します。通常のチップビルドは正本を更新して公開用コピーを同期し、出力先を明示した比較ビルドは公開用コピーを変更しません。

```sh
npm run check:runtime-artifacts
```

不足、loader／WASMとビルド記録の不一致、古い公開用コピーがあれば配布を止めます。検証済みの正本からコピーを更新する場合は`npm run sync:runtime-artifacts`を実行し、変更した音声処理に必要な測定・検証を行ってください。同期コマンドはWASMを再コンパイルしません。

`docs/generated/`、DX7のvendorパス、Native FXの既存URLは同期先です。配布スクリプトは正本から必要な生成物を選び、既存の配布パスへ配置します。

## SynthとTauriへ渡すソース

DMG／2A03／HuC6280／SPU／SCSP／SIDの配布は、`docs/`のJavaScript／CSSを元のファイル分割・
コメント・識別子のままコピーします。`copy_readable_modules.mjs`は依存関係の
調査だけにesbuildを使い、bundleやminifyされた出力を配布しません。
`synth-*/`、`js/`、共有UIのファイルを直接編集して試せます。
生成済みWASMとローダーには、対応するC/C++と再ビルド手順を同梱します。

```sh
sh scripts/package_itch_dmg_synth.sh VERSION
sh scripts/package_itch_2a03_synth.sh VERSION
sh scripts/package_itch_huc6280_synth.sh VERSION
sh scripts/package_itch_spu_synth.sh VERSION
sh scripts/package_itch_scsp_synth.sh VERSION
sh scripts/package_itch_sid_synth.sh VERSION
```

SIDの配布は別receipt付きの6581 WASMとmatching source kitを使い、固定SDK snapshotは変更しません。
`npm run test:sid-synth`と`npm run test:sid-synth:browser`で確認できます。
SID SynthのZIPは`release/tetorica_sid_synth_VERSION_itch.zip`へ生成され、同名ZIPは上書きしません。
展開したZIPも、`node scripts/check_sid_synth_browser.cjs --root 展開先 --entry /index.html`で検証できます。

Tauriリポジトリでは、新しいZIPを`npm run import:release -- /path/to/ZIP`で取り込み、
`dist/`と`release.lock.json`を一緒にcommitします。配布元の元ソースZIPとreceiptも保持します。
FM2612／SPU／DMGのTauri版では、`dist/`を直接編集した後に`npm run record:edits`を実行し、
`npm run dev`または`npm run build`で試せます。ローカルの変更記録は
`local-changes.json`へ保存され、元の配布lockと区別されます。
詳細は各TauriリポジトリのREADMEを参照してください。

## Webランタイムのアーカイブ

`web_runtime`と`web_runtime_exsample`には、`tetorica_src/runtime/`ランタイム全体を収録します。OPN、OPM、OPL、PSG、PCMのラッパー・音声エンジン、Synthヘルパー、全33件のSDK生成物とNative FXを含みます。高水準Synth APIの対応範囲はチップごとに異なります。

`web_runtime_exsample`には既存のブラウザーデモページも含みます。`tetorica_src/runtime/`の外にあるAnalyzer専用実装と、外部の音色・サンプルROMは含みません。

```sh
sh scripts/package_web_runtime_release.sh dev
sh scripts/package_web_runtime_exsample.sh dev
```

`dev`は出力名に使う版番号の例です。リリース時は実際の版番号へ読み替えます。

出力先：

- `release/hello_ymfm_wasm_<version>_web_runtime.zip`
- `release/hello_ymfm_wasm_<version>_web_runtime_exsample.zip`

どちらのスクリプトも、必要なWASMの組が欠けている場合は失敗します。ZIP作成前に、配置済みファイルのインポート、標準チップローダーのパス、WASMの読み込みを検証します。

各アーカイブには`RUNTIME.md`、`runtime-manifest.json`、第三者ライセンスの通知を含めます。アプリ向けに一部のランタイムだけを配布する場合も、その依存ファイルと適用されるライセンスを含めてください。
