# tetorica-fm2612 の npm リリース手順

## 0.2.9 公開記録（2026-10-08）

- 公開元 commit: `e57e928`（ミキサー実装: `509d03c`）。
- 共通 `SoundChipMixer` を追加。browser MegaSynth／OPN runtime／playground Main・Worker／`createSoundChip` WorkletでVolume・Pan・Mute・Reset、IDによる個別調整と生成・破棄の登録管理に対応。
- Game Boyの出力バランスは28%、他は100%。Analyzerも同じPCM処理・初期バランスを使用。生チップPCMは維持。
- Node.js 25.2.1／22.23.3でtgzの新規導入・23 WASM・15 renderer・420ファイル・型定義を検証。publish dry-run成功。
- Chromiumで音量・左右バランス・MuteのPCM、MegaSynth、単体Worklet、playground Main／Worker、Analyzer配布版を確認。CLI191テスト、Analyzer関連1186テスト成功（1件skip）。
- npm registryのlatestが0.2.9、配布integrityがローカルtgzと一致することを確認。公開版を新規導入し、音のあるSynth PCM・23 WASM・15 renderer・型定義、ChromiumのミキサーPCM／MegaSynth／単体Worklet／playground Main・Workerを検証。
- integrity: `sha512-KYEwUvXT4Ye4tclnzn0Y/znoAFSgKHfUs2ZtVgYOEoMc30iyEIc78DaXoxvAUV/S0u4M/hXWtPoARyR+FrPtwQ==`。

## 0.2.6 公開記録（2026-10-07）

- 公開元 commit: `233159c`（Transport 実装: `c575074`）。
- Worklet 内のチップ生成、YM2612 / YM2608 / Game Boy / Sega PSG / YM2151 の WorkletTransport・AudifyTransport を追加。基本例は Web / Node のリアルタイム再生に揃え、DirectTransport の PCM / WAV を専用例へ分離。
- MegaSynthNode は音声ドライバーなしの PCM 生成と出力アダプターの後付け・交換に対応。
- Node.js 22 / 25 の配布物検証、Node.js 22 の関連56テスト、publish dry-run を通過。234ファイル・23 WASM・15 renderer・257モジュール/アセット参照を確認。
- 公開前の開発配布物で Web29例、Node基本例17件のCoreAudio発音・終了、オフライン12例のWAV生成、利用者Worker→Workletの追加MessagePort接続を確認。
- npm registry の latest: 0.2.6 とローカル tgz の integrity 一致を確認。公開版を examples に新規導入し、Web29例の発音・停止・終了、Nodeリアルタイム17例のCoreAudio発音・終了、オフライン12例のPCM / WAV、追加Worker→Worklet接続を確認。依存・lockfile・配信用docsを更新。
- integrity: `sha512-i0gTwmf/PRYCoD34rB2ydNMskcz1g9PAFiQHJmfopXKPigHUGywdL4ogmS/dKkm2H8a1Wq9OwrKkMNTHdFqtjQ==`。

## 0.2.4 公開記録（2026-10-07）

- 公開元 commit: `8e2774c`（修正実装: `9093b0d`）。
- ymfm YM2612 の DAC ladder の無発音時オフセットを AudioWorklet 出力から除去。FM / PSG 初期化中は無音を維持し、起動・終了時のクリック音を軽減。生チップ PCM は変更しない。
- 関連79テスト、通常の Node.js と Node.js 22 の配布物検証を通過。23 WASM エンジン・15 renderer・229モジュール/アセット参照、218ファイルを確認。
- Chromium の Playground 共通経路で起動時・無発音時・停止後の一定出力が約0.0138から0になることと、通常の FM 発音を確認。Mega CD 8CH・左右パン・FM/PSG/PCM混合・reset・終了後の再起動・Playground Worker も検証。
- npm registry の `latest: 0.2.4` とローカル tgz の integrity 一致を確認。公開版を新規インストールし、修正 Worklet・WASM 自動読み込み・生 PCM・FM 発音・WAV 出力を確認。
- integrity: `sha512-pJVY5L8xdSWl78DTFBpsxdkVyUjawRGaCkDkBW6PIDYMjmKa90HstSXX0I6D3TCVMXFtRkfO024hW7rvsskeJw==`。

## 0.2.3 公開記録（2026-10-06）

- 公開元 commit: `2c6efea`（API 実装: `d227f88`）。
- Web / Node 共通の `encodeWav()` を追加。PCM / AudioBuffer から PCM16 WAV を生成。
- `createSoundChip()` が WASM バイト列を環境に応じて自動読み込み。明示的な WASM 指定なしで生成でき、AbortSignal にも対応。
- 関連138テスト、通常の Node.js と Node.js 22 の配布物検証を通過。23 WASM エンジン・15 renderer・229モジュール/アセット参照を確認。
- Chromium で14種類のチップの自動読み込み、Web / Node の WAV 一致、Blob、読み込み失敗を検証。既存 loadSample の実音声・終了後の再起動、Mega CD PCM・Playground Worker も確認。
- 配布物は218ファイル。npm registry の `latest: 0.2.3` とローカル tgz の integrity 一致を確認。
- 公開版を examples に再インストールし、全21例の Node PCM / WAV 出力、20例の Web 再生と Node WAV 一致、AudioWorklet の実音声・停止・再起動・エラー復帰を検証。
- integrity: `sha512-y7kX0uYtTg1fwyoX8gIKKCdNQW+kt6hW4J4NkMDOhC4HbxK+iVRowTw387W1zVpHbofVwJsMpouCIl0obHFD1A==`。

## 0.2.2 公開記録（2026-10-06）

- 公開元 commit: `eea2b5e`。
- YM2608 ADPCM-B の `loadSample()` を追加。PCM / AudioBuffer / PCM・Float WAV の mono 化、ADPCM-B 変換、メモリ転送、再生範囲・速度の設定に対応。
- AudioWorklet の ADPCM メモリ転送完了通知と、OPN Runtime の終了・再起動時の routing 解放を追加。
- 関連127テスト、通常の Node.js と Node.js 22 の配布物検証を通過。23 WASM エンジン・15 renderer・228モジュール/アセット参照を確認。
- Chromium で新しい loadSample の実音声・転送応答・終了後の再起動と、既存 FM/PSG/Mega CD PCM・Playground Worker を確認。
- 配布物は217ファイル。npm registry の `latest: 0.2.2` と integrity を確認し、公開版の再インストール後に loadSample と音のあるPCM生成を検証。
- integrity: `sha512-oetYxq6ipNGLI/I1CJVS3v4bPG1S0AkGzudmGDCWD23HtW0v9JEHvfeERoTx5Uw5x5cqeLZbIlXhmkc508kXdg==`。

## 0.2.1 公開記録（2026-10-06）

- 公開元 commit: `89cf53c`。
- Homepage を `https://github.com/kyorohiro/tetorica-fm2612-examples` に変更。
- 公開済み `0.2.0` と配布物を比較し、差分は package.json と README.md のみ。216ファイルのランタイム・アセット構成は同一。
- 通常の Node.js と Node.js 22 で配布物検証成功。23 WASM エンジン・15 renderer・Synth PCM・アセット参照を確認。
- 関連96テスト、Chromium での Mega CD 8CH・左右パン・FM/PSG/PCM混合・reset・再起動・Playground Worker の検証成功。
- npm registry の `latest: 0.2.1`、Homepage、配布物 integrity を確認。registry から再インストールし、音のあるステレオPCM生成を確認。
- integrity: `sha512-2IeRc501cOOOK3oORW4CSgsyCbEbt1e4sFerrL20+nyGsQEXfyoV6sJOfQwHvVLS0reFDF2v8mCLQI9ZV/b0CA==`。

## リリース手順

リポジトリのルートで実行する。以下は `0.2.9` を公開する例。
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
現在のローカル版は `0.2.9`。公開前に npm registry で未使用であることを確認する。
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

Mega CD対応の実ブラウザ確認には、開発用依存のPlaywrightとChromiumが必要。
初回は依存とブラウザを準備する。その後はブラウザテストのコマンドで
FM2612のビルドと検証を実行できる。

```sh
npm ci
npm run setup:browser
npm run test:fm2612:browser
```

RF5C164の8CH・左右パン・FM/PSG/PCMの混合出力・Stop/Reset・終了後の再起動、
既存PlaygroundのWorker実行を確認する。失敗は原因を確認してから公開する。

## 3. 配布物を作成・確認する

```sh
npm run pack:fm2612 -- --silent
tar -tzf tetorica-fm2612-0.2.9.tgz
tar -xOf tetorica-fm2612-0.2.9.tgz package/package.json
tar -xOf tetorica-fm2612-0.2.9.tgz package/README.md
```

専用スクリプトは `dist/fm2612/` に既存webランタイムを集め、WASM・Worker・
AudioWorklet・音源データ・ライセンス文書を同梱する。npm用READMEは
`packages/fm2612/README.md` からコピーする。ルートにtgzが生成される。

配布manifestの名前が `tetorica-fm2612`、版番号が `0.2.9` であることを確認する。
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
fm2612_tarball="$PWD/tetorica-fm2612-0.2.9.tgz"
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
npm publish ./tetorica-fm2612-0.2.9.tgz --access public --dry-run --registry=https://registry.npmjs.org/

# 同じtgzを公開
npm publish ./tetorica-fm2612-0.2.9.tgz --access public --tag latest --registry=https://registry.npmjs.org/
```

dry-runは公開権限や名前の利用可否を保証しない。
公開時にもブラウザ認証・2FAを求められる場合がある。表示されたURLから認証する。

## 7. 公開版を確認する

```sh
npm view tetorica-fm2612 version dist-tags --registry=https://registry.npmjs.org/ --prefer-online
npm view tetorica-fm2612@0.2.9 dist.integrity --registry=https://registry.npmjs.org/ --prefer-online
```

`latest` が `0.2.9` を指していることを確認する。npmが公開後の処理中と案内した
場合は、数分待ってから確認する。反映待ちの間に同じ版を再公開しない。

```sh
fm2612_verify_dir="$(mktemp -d)"
(
  cd "$fm2612_verify_dir" || exit 1
  npm install tetorica-fm2612@0.2.9 --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/ || exit 1
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
