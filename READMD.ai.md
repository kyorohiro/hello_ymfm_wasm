# Tetorica — AI/SI向け作業引継ぎ

[English](README.md) | [日本語](README.ja.md) | [AI/SI](READMD.ai.md)

更新日：2026-10-10。AIがリポジトリーを調べ、作業を再開するための入口です。
この文書は設計・作業状況の記録です。再開時は最新のユーザー依頼、実際のソース、Gitの状態を確認してください。記載された日付時点の検証結果を、最新の公開版の保証として扱わないでください。

## まず確認すること

```sh
pwd
git status --short
git diff
git diff --cached
git log -8 --oneline
```

- ユーザーが編集中・ステージ済みの変更を保持する。作業開始時の差分を確認し、自分の変更と区別する。
- 作業対象に適用される`AGENTS.md`があれば読む。
- 親リポジトリーと、ローカルの別リポジトリーを取り違えない。`w/`内の変更・commitは、親のcommitに自動では含まれない。
- ローカル実装、配布用生成物、npm公開版、GitHub / itch.ioの公開版を区別する。公開済みかどうかは、リリース記録と対象配布物で確認する。
- この文書の過去の作業記録だけを根拠に、公開・push・新しい機能の実装を開始しない。現在の依頼に対応する作業を進める。

## プロジェクトの方向性とREADMEの役割

Tetoricaは、JavaScriptでメガドライブ、ゲームボーイ、ファミコンなどのレトロゲームサウンドをライブコーディングするためのツール群です。音源チップを楽器として演奏し、自作のゲームやアプリにも組み込める環境を目指しています。古いゲーム音楽と音源技術を、調べて再構成できる形で残すことも重視しています。

2026-10-10のREADME整理で決めたこと：

- 日英のREADMEは利用者向けの導入にする。成果物の一覧、アプリへの入口、npmの簡単な利用例を置く。
- アプリの「最初の操作」やPlaygroundのライブコーディング例は、READMEには不要というユーザー方針。実際のアプリを開いてもらう。
- 「Help and bug reports／ヘルプと不具合報告」の節も、日英READMEから削除するユーザー方針。
- npmパッケージのYM2612ド・レ・ミ例は残す。これは音源APIを使うブラウザー向けの例で、Playground内のコードではない。
- 「プロジェクトの目標」は、YM2612の理解、理解のためのドキュメント、アプリ・ゲームへの組み込みのためのドキュメント、文化的な遺産としての保存という従来の4項目を維持する。ユーザーは、この具体的な目標一覧を好んでいる。
- チップごとの詳細、制約、実装・検証メモは`Memo.md`へ移す。ライセンスとクレジットはREADMEにも残す。
- ダウンロード説明と古い固定バージョン表記は削除。配布物の作成・検証・公開手順は`README_RELEASE.md`へ移す。
- ファイル名は`README.ja.md`、AI向けはユーザー指定の`READMD.ai.md`。`READMD`という綴りを勝手に変更しない。

## ドキュメントの参照先

| 調べたいこと | 参照先 |
| --- | --- |
| 利用者向けの概要 | [README.md](README.md)、[README.ja.md](README.ja.md) |
| チップ別の再生・制約・実装メモ | [Memo.md](Memo.md)（日英。元のSN76489参考リンクも保持） |
| 機能単位の対応状況 | [docs/feature-status.md](docs/feature-status.md) |
| Analyzerの対応表 | [docs/vgm_analyzer/support.html](docs/vgm_analyzer/support.html) |
| CLI / Node APIと形式別の制約 | [CLI.md](CLI.md) |
| 配布物の作成とリリース手順 | [README_RELEASE.md](README_RELEASE.md) |
| npmの公開記録と手順 | [READMD_RELEASE_FM2612.md](READMD_RELEASE_FM2612.md)、[READMD_RELEASE_VGM.md](READMD_RELEASE_VGM.md) |
| 音源パッケージのAPI・モジュール一覧 | [packages/fm2612/README.md](packages/fm2612/README.md) |
| VGMパッケージの利用例 | [packages/vgm/README.md](packages/vgm/README.md) |
| 仮想ファイルとシェルのAPI | [packages/virtual-files/README.md](packages/virtual-files/README.md) |
| 設計・個別機能の作業記録 | [docs/issues/](docs/issues/) |
| 音声出力の設計 | [docs/issues/tetorica-audio-output.md](docs/issues/tetorica-audio-output.md) |
| 仮想ファイル／シェルの設計経緯 | [docs/issues/tetorica-virtual-files.md](docs/issues/tetorica-virtual-files.md)、[docs/issues/tetorica-virtual-files-01.md](docs/issues/tetorica-virtual-files-01.md) |

`docs/issues/`には実装前の計画も残る。「未実装」「未公開」という過去の記述だけで現在の状態を決めず、ソース、テスト、更新日、公開記録を照合する。

## リポジトリーの構成

| 場所 | 役割 |
| --- | --- |
| `src/` | ymfm由来のC++音源コアなど |
| `wasm/` | JavaScriptから使うためのWASMブリッジ |
| `third_party/` | 固定した第三者コア、元ソース、ライセンス、移植記録 |
| `web/` | 再利用するJSランタイム、チップラッパー、Synth、音声エンジン、テスト |
| `node/` | Node向け音声出力・Worker・Synthアダプター |
| `docs/js/` | Webサイトへ配置する共有ランタイムのコピー |
| `docs/playground/` | PlaygroundのUI、Monaco、Cassette、仮想ファイル連携、インポート、実行例 |
| `docs/synth/` | ブラウザーシンセサイザー |
| `docs/vgm_analyzer/` | AnalyzerのUIと、CLIも使う共有解析・エクスポートモジュール |
| `docs/generated/` | ブラウザー向けの生成済みチップJS / WASM |
| `cli/` | `tetorica-vgm`のCLI / Node API実装 |
| `packages/fm2612/`、`packages/vgm/` | npm配布情報とREADME。実装全体がここにあるわけではない |
| `packages/virtual-files/src/` | `tetorica-virtual-files`の実装。仮想ファイルと軽量シェル |
| `scripts/` | ビルド、同期、パッケージ作成、検証 |
| `test/`、`web/*.test.mjs`、`docs/*/*.test.mjs` | 機能・共有エンジン・UIなどのテスト |
| `dist/`、`release/` | npm向け生成物、ブラウザー／itch向けの配置済み生成物とZIP |

ルートの`package.json`は`private: true`の開発用ワークスペース。ルートをnpm公開しない。

### 共有ランタイムを変更したとき

1. 基本の実装・JSDocは`web/`を編集する。UI固有の変更は`docs/playground/`や`docs/vgm_analyzer/`を編集する。
2. 共有JSをWebサイトへ同期する。

```sh
sh scripts/sync_web_js_to_docs.sh
```

3. 配布物を変更した場合は、対象のパッケージ生成・検証も行う。既存の`release/itch_playground_dev`は自動では更新されない。
4. 新しいモジュール依存を追加した場合は、同期対象、各配布スクリプト、モジュール一覧・Monacoの参照モデルにも必要な追加があるか調べる。

同期時にはWASMの相対パスなどを配置先に合わせて変換する。`web/`と`docs/js/`を手作業で完全一致させようとして、必要なパス変換を消さない。

### 公開トップページの言語

`docs/index.html`は英語、`docs/index-ja.html`は日本語。同じデザインとツールへのリンクを持つ静的ページで、言語切り替えとAI/SIへのリンクを置いている。ページの`lang`、title、description、Open Graph、表示文、aria-labelもそれぞれの言語に合わせる。

ツールや入門ページの追加・リンク変更は両方のトップページへ反映する。言語選択で移動するのはトップページだけで、リンク先の各アプリや入門ページまで翻訳・切り替えたわけではない。

## ローカルでブラウザー版を開く

```sh
npm ci
python3 -m http.server 8083 -d docs
```

別のターミナルでサーバーを動かし、次を開く。

- `http://localhost:8083/playground/index.html`
- `http://localhost:8083/synth/index.html`
- `http://localhost:8083/vgm_analyzer/index.html`

ブラウザーでの発音例はクリックなどのユーザー操作から開始する。npmのbare importを使うREADMEのサンプルは、Viteなどの解決環境が必要。Playgroundのユーザーコードと、npmモジュールを使う一般的なWebアプリのコードを混同しない。

## 検証コマンド

変更に関係するテストを選び、必要な範囲を実行する。以下は実行先を探すための一覧で、毎回すべてを実行する指示ではない。

```sh
git diff --check
npm test
npm run test:analyzer
npm run test:sbi
npm run test:virtual-files
```

音源パッケージ・型定義：

```sh
npm run build:fm2612
node scripts/check_fm2612_types.mjs dist/fm2612
npm run test:fm2612
npm run test:fm2612:browser
```

- `build:fm2612`は`dist/fm2612/`を生成し、JSDocから宣言ファイルを作成・検証する。
- `check_fm2612_types.mjs dist/fm2612`は、生成済みの配布物を使い、NodeNext / Bundler / Nodeのambient型なしのBrowser利用を検証する。引数なしの場合はビルドも行う。
- `test:fm2612`はtarballを独立したconsumerへ導入して検証する。リポジトリー内のimportが通っただけで、npm配布物も動くと判断しない。
- `test:fm2612:browser`は実際のブラウザーを使う。PlaywrightのChromiumが必要なら`npm run setup:browser`を使う。

VGMと仮想ファイルのビルド：

```sh
npm run build:vgm
npm run build:virtual-files
```

チップコアの変更では、対応する`scripts/build_*_wasm.sh`と対象チップのテストを確認する。Emscriptenなどの前提環境は各スクリプトを読む。JSDocやREADMEだけの変更にWASMの再ビルドは不要。

## 音声APIの前提

- Direct Transportは同期PCM生成用。PCMを生成しただけではスピーカーから音は出ない。オフラインWAV生成は曲の実時間だけ待つ必要はない。
- Worklet TransportではAudioWorkletが音声を生成する。JavaScriptの`sleep`や`beat`などは演奏の進行・継続を待つもので、それだけでサンプル精度の予約になるわけではない。
- AudifyはNodeのネイティブ音声出力。ブラウザーのWeb Audioとは別の出力経路で、パッケージ／実行環境の前提も異なる。
- `transport.flush()`はキューの処理確認・バリア。各レジスター書き込みのたびに呼ぶものではなく、曲が鳴り始めるための必須処理でもない。
- `AbortSignal`をどこかへ渡しただけで、すべての`await`が自動で中断するわけではない。各処理がsignalを監視し、必要な箇所で停止・例外を処理する。
- YM2612の`block` / `fnum`はチップの音程表現。Hzからは`pitch.js`の`hzToBlockFnum`、MIDI番号からは`createPitchFromMidi`を使える。チップの入力クロック（Hz）と音声サンプルレートは別の値。
- WASMラッパーの収録、再生エンジン、Worklet実行、高水準Synth API、VGMの採譜・音色抽出は、それぞれ対応範囲が異なる。「対応チップ一覧」だけで全APIに同じ対応があると判断しない。
- Game Boyのミキサー初期バランスは28%、他の音源は100%。ミキサーのバランス、出力gain、Masterを区別する。大きな出力によるクリッピングを、無条件にエミュレーターの不具合と判断しない。
- `createSoundChip`の`chip.id`は省略時に自動採番される。初期化前にIDを予約する設計。確率的なUUIDの衝突回避ではない。IDとミキサーの所有・解除処理は共通実装を参照する。

## 利用者READMEから外した情報

### VGMからTFIを編集する流れ

開発・検証用の確認手順として残す。利用者READMEへ自動で戻す必要はない。

1. Playgroundで対応するVGM / VGZをインポートする。
2. 仮想ファイルの`presets/<filename>/`を開き、`.tfi`を編集する。
3. FMパラメーターを変更し、入力欄からフォーカスを外して数字・文字キーで試聴する。
4. Export Cassetteで仮想ファイルを含むプロジェクトを保存する。

OPN FMのキーオン時の音色は、`/presets/song/ym2612_ch1_001.tfi`などに保存する。同じチャンネル内の重複音色はまとめ、同名ファイルの再インポートでは`song-2`などの新しいフォルダーを使う。TFIは静的FMパラメーターを保存し、パン、LFO、音程・音量の時間変化は保存しない。編集は仮想ファイルを更新し、元のディスク上のファイルへ書き戻さない。

### 配布と実装の詳細

- Webランタイム全体のアーカイブは`web_runtime` / `web_runtime_exsample`。生成コマンドと検証は`README_RELEASE.md`へ移動済み。
- チップ別のNote-ish、MIDI、SBI、OPM、MSX、NES / FDS、ADPCMなどの制約・検証記録は`Memo.md`へ移動済み。
- 以前の「ローカル0.2.0、npm公開0.1.0」という段落は古い固定情報なので削除した。復活させない。現在の版番号は各パッケージの`package.json`と公開記録で確認する。
- `READMD_RELEASE.md`は`README_RELEASE.md`への案内として残している。既存リンクを壊すために不用意に削除しない。

## 別リポジトリー：Tauriデスクトップ版

この開発環境には`w/tetorica-fm2612-playground-tauri/`という別checkoutがある。別の環境では存在しないことがあるため、まずその場所とREADMEを確認する。

- Tauri版は、親リポジトリーのPlayground配布ZIPを取り込み、展開した`dist/`をGit管理する。
- `release.lock.json`はZIPと展開内容の整合性記録。`dist/`だけを手で書き換えると`import_release.py --check`が失敗する。
- 親のランタイム変更を反映する場合は、配布ZIPを再生成し、Tauri側のインポート手順で更新する。lockの確認を無効化して済ませない。
- Cassetteの自動保存はTauriのWebViewのIndexedDB。コード・素材・編集中／実行するファイルを保存し、次回起動で復元する。通常のブラウザー版とは適用範囲が異なる。
- 音源・エフェクトはWeb Audioで処理し、選択した場合だけ最終PCMをNode/Audifyへ送る。起動時はWebView出力。

Tauri側のディレクトリーから実行するコマンド：

```sh
npm test
python3 scripts/import_release.py --check
node scripts/prepare_audio_sidecar.mjs
node scripts/check_audio_sidecar_bundle.mjs
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Windowsでは`python3`の代わりに`python`を使う。Cargoを直接実行する前にも音声リソースの準備が必要。Tauri CLIのbeforeBuildCommandだけに依存しない。

### v0.52.6までのWindows Audify修正

- WASAPIを明示して、ASIOの自動探索を避ける。
- Audify 1.10.1内のRtAudioで、WASAPI機器オブジェクトをCOM終了前に解放する修正を適用し、Windows用モジュールを再ビルドする。
- Node 22で`\\?\C:\...`形式がmain moduleの解決に渡ると、`EISDIR ... lstat 'C:'`で終了する問題があった。相対スクリプトだけでは解決しない。実行ファイルと作業ディレクトリーの両方を通常のWindowsパス形式へ変換する。
- ネイティブ側の変換は`src-tauri/src/audio.rs`、CI側は`scripts/node_resource_path.mjs`。Drive / UNC、空白、日本語パスを考慮する。
- 機器列挙だけでなく、GC・Node正常終了、分離した同梱フォルダーでのサーバー起動・JSON応答も検証する。
- 未使用時のstopは新しいNodeを起動しない。失敗時の全文はメニューとConsoleへ表示する。
- エラー時もAudifyの選択を保持し、「Copy error」でコピーできる。エラーは「Clear error」まで残す。実際の音声接続はWebViewへ戻す。

**2026-10-10時点の実機確認：macOSとWindowsはユーザーの動作確認あり。Linuxは実機がなくunchecked。Linuxをuncheckedと明記してreleaseする方針はユーザー指定。CI成功と実機の発音確認を同一視しない。**

## 別リポジトリー：npm利用例

この環境の`w/tetorica-fm2612-examples/`は、[tetorica-fm2612-examples](https://github.com/kyorohiro/tetorica-fm2612-examples)の別checkout。npmパッケージを実際に利用するWeb / Nodeの例を管理する。

音源パッケージの変更が親リポジトリーで動いても、公開npm版とexamplesには自動反映されない。公開後に依存・lockfile・配信用生成物を更新し、例の実行と停止・解放も確認する。

## 今回の作業状態と検証記録

2026-10-10時点のローカル設定（公開版の照合結果ではない）：

| 対象 | 版番号の設定 |
| --- | --- |
| `packages/fm2612/package.json` | `0.2.12` |
| `packages/vgm/package.json` | `0.2.8` |
| `packages/virtual-files/package.json` | `0.1.1` |
| Tauriのローカルcheckout | `0.52.6` |
| examplesが依存する`tetorica-fm2612` | `0.2.12` |

直近の変更・確認：

- `web/`の40ファイルで公開関数のJSDocを追加・補強し、`docs/js/`へ同期した。`createPlaygroundClock`のoptions、戻り値、秒／拍／サンプル、停止時の動作を明記。実行コードは変更していない。
- `build:fm2612`で192件の宣言ファイルを生成・型検証した。配布物のNodeNext / Bundler / Browser consumer型検証も成功。
- 時計、非同期タスク、OPN、S98、native FXの関連37テストが成功。これは今回実行した範囲であり、全テストの最新実行記録ではない。
- READMEのド・レ・ミ例は、実際のWASM / AudioWorkletの初期化、C4 / D4 / E4の発音呼び出し、再生後のAudioContext解放をブラウザーで確認した。聴感評価の記録ではない。
- READMEの整理と`Memo.md` / `README_RELEASE.md`への移動はドキュメント変更。リンク先、コードフェンス、差分の空白を確認した。
- README変更にはユーザーの編集・ステージ済み変更が含まれる。再開時にGitの状態を確認し、まとめて消したり、許可なくcommit・公開したりしない。

`/private/tmp`などの一時ブラウザー検証スクリプトは、別環境や次回セッションで存在する保証がない。再検証には、リポジトリーの検証スクリプト、対象テスト、READMEの実際のコードを使う。

## 引継ぎを更新するとき

変更した機能、確認した対象、実行した検証、未確認の範囲、公開状況、次に必要な作業を区別して記録する。版番号やテスト件数には日付を添える。機能の詳細は`Memo.md`や`docs/issues/`へ、利用者向けの説明は日英READMEへ、公開手順は`README_RELEASE.md`へ置き、同じ長い説明を複数箇所へ増やさない。
