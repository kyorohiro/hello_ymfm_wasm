# リリース手順

配布物の作成・検証・公開を行うメンテナー向けの手順です。コマンドはリポジトリーのルートから実行します。

## npmパッケージ

パッケージごとの版番号更新、検証、公開手順は、次の文書を参照してください。

| パッケージ | 手順 | バージョンの設定先 | packコマンド |
|---|---|---|---|
| `tetorica-vgm` | [READMD_RELEASE_VGM.md](READMD_RELEASE_VGM.md) | `packages/vgm/package.json` | `npm run pack:vgm` |
| `tetorica-fm2612` | [READMD_RELEASE_FM2612.md](READMD_RELEASE_FM2612.md) | `packages/fm2612/package.json` | `npm run pack:fm2612` |

ルートの`package.json`は`private: true`の開発用ワークスペースです。配布用の情報とnpmのREADMEは`packages/vgm/`、`packages/fm2612/`にあり、実装は`cli/`、`web/`、`node/`とAnalyzerの共有モジュールにあります。

```sh
npm run build:vgm       # dist/vgm/
npm run pack:vgm        # tetorica-vgm-VERSION.tgz
npm run build:fm2612    # dist/fm2612/
npm run pack:fm2612     # tetorica-fm2612-VERSION.tgz
```

各ビルドは、自分の出力フォルダーだけを置き換えます。`build`、`pack`、`pack:check`はVGM向けの別名です。公開時は、検証済みのtgzを明示的に指定します。

## Webランタイムのアーカイブ

`web_runtime`と`web_runtime_exsample`には、`web/`ランタイム全体を収録します。OPN、OPM、OPL、PSG、PCMのラッパー・音声エンジン、Synthヘルパー、生成済み音源チップ／エンジンJS + WASMの全23組を含みます。高水準Synth APIの対応範囲はチップごとに異なります。

`web_runtime_exsample`には既存のブラウザーデモページも含みます。`web/`の外にあるAnalyzer専用実装と、外部の音色・サンプルROMは含みません。

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
