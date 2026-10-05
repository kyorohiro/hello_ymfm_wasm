# tetorica-fm2612 の npm リリース手順

リポジトリのルートで実行する。以下は `0.2.0` を公開する例。
版番号を変更する場合は、tgz名と公開後の確認コマンドも読み替える。

VGM CLIの手順は [READMD_RELEASE_VGM.md](READMD_RELEASE_VGM.md) を参照。
ルートの `package.json` は `tetorica-vgm` 用。FM2612のmanifestは
`packages/fm2612/package.json` にある。

## 1. バージョンとドキュメントを更新する

```sh
git status --short
npm view tetorica-fm2612 name version versions maintainers --registry=https://registry.npmjs.org/
```

`packages/fm2612/package.json` の `version` を、公開する未使用の番号へ更新する。
現在のローカル版は `0.2.0`。この番号で公開するなら変更は不要。
公開済みの同じ名前・バージョンは再利用できない。

- `packages/fm2612/README.md`: npmに同梱する使い方、対応チップ、ブラウザのアセット配置。
- `README.md`: リポジトリ全体の案内。
- [docs/feature-status.md](docs/feature-status.md): 対応範囲・検証結果・公開状況。
- webコードを変更した場合は、必要なファイルを `docs/js/` に同期する。

```sh
sh scripts/sync_web_js_to_docs.sh
git diff --check
```

公開するソース・ドキュメントをレビューしてcommitし、対象commitを記録する。
公開予定の版の説明に「ローカル版」「未公開」が残っている場合は整理する。

## 2. パッケージを検証する

Node.js 22以上が必要。最低対応のNode.js 22と、普段使うNode.jsで確認する。

```sh
node --version
npm run test:fm2612
node --test web/megasynth.test.mjs web/playground_rf5c164.test.mjs web/playground_soundchips_main.test.mjs web/synth-worklet.test.mjs
git diff --check
```

`test:fm2612` は専用パッケージをビルドし、実際のtgzを一時ディレクトリへ
オフラインインストールして、モジュール・アセット参照、23種類のWASM、
SynthのPCM生成を確認する。npmへの公開は行わない。

必要ならNode.js 22を指定して同じ検証を行う。

```sh
npm exec --yes --package=node@22 -- node scripts/check_fm2612_package.mjs
```

Mega CD対応の実ブラウザ確認にはPlaywrightとChromiumが必要。
Playwrightを解決できる環境で、ビルド後に実行する。

```sh
node scripts/check_megacd_browser.cjs
# 別の場所にあるPlaywrightを使う場合:
node scripts/check_megacd_browser.cjs /absolute/path/to/node_modules/playwright
```

RF5C164の8CH・左右パン・FM/PSG/PCMの混合出力・Stop/Reset・終了後の再起動、
既存PlaygroundのWorker実行を確認する。失敗は原因を確認してから公開する。

## 3. 配布物を作成・確認する

```sh
npm run pack:fm2612 -- --silent
tar -tzf tetorica-fm2612-0.2.0.tgz
tar -xOf tetorica-fm2612-0.2.0.tgz package/package.json
tar -xOf tetorica-fm2612-0.2.0.tgz package/README.md
```

専用スクリプトは `dist/fm2612/` に既存webランタイムを集め、WASM・Worker・
AudioWorklet・音源データ・ライセンス文書を同梱する。npm用READMEは
`packages/fm2612/README.md` からコピーする。ルートにtgzが生成される。

配布manifestの名前が `tetorica-fm2612`、版番号が `0.2.0` であることを確認する。
`megasynth-fm-presets.js`、RF5C164のWASM/Worklet、第三者ライセンス、
Nuked-OPN2のソースとビルドスクリプト、自作OPNAリズムデータも確認する。
外部ROM・ゲームファイル・`w/`・キャッシュは含めない。

**FM2612は `pack:fm2612` で作り、tgzを指定して公開する。ルートで引数なしの
`npm publish` を実行すると `tetorica-vgm` が対象になる。**

VGMビルドは `dist/` 全体を作り直す。VGMもビルドした場合は、必要に応じて
FM2612のビルド・packを再実行する。ルートに作成済みのtgzは残る。

## 4. 公開するtgzを別ディレクトリで試す

以下の変数はリポジトリのルートで設定する。

```sh
fm2612_tarball="$PWD/tetorica-fm2612-0.2.0.tgz"
fm2612_test_dir="$(mktemp -d)"
(
  cd "$fm2612_test_dir" || exit 1
  npm install --offline --ignore-scripts --no-audit --no-fund "$fm2612_tarball" || exit 1
  node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {createSoundChip} from 'tetorica-fm2612';
import {YM2612Synth, YM2612DirectTransport} from 'tetorica-fm2612/ym2612synth';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';
const chip = await createSoundChip('ym2612');
try {
  const transport = new YM2612DirectTransport(chip);
  const fm = new YM2612Synth({transport});
  fm.setPreset(0, FM_PRESETS.sine);
  fm.noteOn(0, 4, 553);
  const {left, right} = transport.generateStereo(4096);
  assert.equal(left.length, 4096);
  assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  assert.ok(left.some(value => Math.abs(value) > 0.001));
  console.log('PASS: YM2612 Synth PCM');
} finally { chip.dispose(); }
JS
)
```

ソースを変更した場合は、テスト・pack・tgz確認からやり直す。

## 5. npmにログインする

```sh
npm login --auth-type=web --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

ブラウザで認証する。公開権限を持つアカウントであることを確認する。
認証コードやトークンはリポジトリへ保存しない。

## 6. 検証済みのtgzを公開する

```sh
# 公開しない確認
npm publish ./tetorica-fm2612-0.2.0.tgz --access public --dry-run --registry=https://registry.npmjs.org/

# 同じtgzを公開
npm publish ./tetorica-fm2612-0.2.0.tgz --access public --tag latest --registry=https://registry.npmjs.org/
```

dry-runは公開権限や名前の利用可否を保証しない。
公開時にもブラウザ認証・2FAを求められる場合がある。表示されたURLから認証する。

## 7. 公開版を確認する

```sh
npm view tetorica-fm2612 version dist-tags --registry=https://registry.npmjs.org/ --prefer-online
npm view tetorica-fm2612@0.2.0 dist.integrity --registry=https://registry.npmjs.org/ --prefer-online
```

`latest` が `0.2.0` を指していることを確認する。npmが公開後の処理中と案内した
場合は、数分待ってから確認する。反映待ちの間に同じ版を再公開しない。

```sh
fm2612_verify_dir="$(mktemp -d)"
(
  cd "$fm2612_verify_dir" || exit 1
  npm install tetorica-fm2612@0.2.0 --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/ || exit 1
  node --input-type=module <<'JS'
import {createSoundChip} from 'tetorica-fm2612';
const chip = await createSoundChip('ym2151');
try {
  console.log(chip.generateStereo(128).left.length); // 128
} finally { chip.dispose(); }
JS
)
```

[npmページ](https://www.npmjs.com/package/tetorica-fm2612)のREADMEも確認する。
公開した版・commit・テスト環境と結果を記録し、README・feature-statusの
「ローカル版」「未公開」などの状態を更新する。
