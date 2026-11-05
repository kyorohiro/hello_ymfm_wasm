# リリース手順

配布物の作成・検証・公開を行うメンテナー向けの手順です。コマンドはリポジトリーのルートから実行します。

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

DMG／2A03／SPU／SCSPの配布は、`docs/`のJavaScript／CSSを元のファイル分割・
コメント・識別子のままコピーします。`copy_readable_modules.mjs`は依存関係の
調査だけにesbuildを使い、bundleやminifyされた出力を配布しません。
`synth-*/`、`js/`、共有UIのファイルを直接編集して試せます。
生成済みWASMとローダーには、対応するC/C++と再ビルド手順を同梱します。

```sh
sh scripts/package_itch_dmg_synth.sh VERSION
sh scripts/package_itch_2a03_synth.sh VERSION
sh scripts/package_itch_spu_synth.sh VERSION
sh scripts/package_itch_scsp_synth.sh VERSION
```

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
