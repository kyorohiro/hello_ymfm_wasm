# tetorica-vgm の npm リリース手順

## 0.2.8 公開記録（2026-10-08）

- 公開元commit: `14ba730`。
- 共通ミキサーPCM処理を含む共有再生エンジンと、`soundchip_mixer.js`依存をnpm配布物へ同梱。
- Playgroundの別配布スクリプトに`soundchip_mixer.js`を追加。`release/itch_playground_dev`を再生成し、Chromeのlocalhost:8888画面で404解消・エディター初期化を確認。
- Node.js 25.2.1でCLI191テスト成功。Node.js 22.23.3で共有再生・複数チップ12テスト成功。Analyzer関連1186テスト成功（任意外部コンパイラー依存1件skip）は同じランタイム実装で確認済み。
- 実tarballの新規導入・Node.js 22のCLI版番号／Game Boy解析／WAV出力・publish dry-runを検証。
- npm registryのlatest 0.2.8とローカルtgzのintegrity一致を確認。公開版を新規導入し、CLI版番号・Node API解析・Game Boy WAV出力・ミキサー依存ファイルを検証。
- integrity: `sha512-bn9m63mT6ghWzGG/TQJWwDV21qZCvaopL64Qu2O3y/FdB3nhf17qqWQ1lk/qNedrXBfqYlb25WcY4wc69PW79A==`。

リポジトリのルートで実行する。以下の `0.2.4` は版番号の例。
公開済みの版を確認し、実際に公開する未使用の番号へ読み替える。

FM2612の手順は [READMD_RELEASE_FM2612.md](READMD_RELEASE_FM2612.md) を参照。

## 1. バージョンとドキュメントを更新する

```sh
git status --short
npm view tetorica-vgm name version versions maintainers
npm --prefix packages/vgm version 0.2.4 --no-git-tag-version
```

`--no-git-tag-version` は自動commit・tag作成を行わず、バージョンを更新する。
公開済みの同じ名前・バージョンは再利用できない。再リリース時は新しい番号にする。

次の説明を実装に合わせて更新する。

- `packages/vgm/README.md`: npm配布用README。利用者向けの導入・コマンド・API。
- `CLI.md`: 詳細な対応音源、オプション、制約、Node API。
- `README.md`: GitHubリポジトリ全体の説明。
- [docs/feature-status.md](docs/feature-status.md): 実装・検証状態を更新し、公開後に対象アプリ・版番号・commit・公開URL・含めた機能を記録する。
- `cli/main.js` のhelpと、関連するissueの作業記録。

## 2. テストする

Node.js 22以上が必要。最低対応のNode.js 22と、普段使うNode.jsで確認する。
Node.jsの切り替えは利用中のバージョン管理ツールで行う。

```sh
node --version
npm --version
npm test
npm run test:analyzer
git diff --check
```

`npm test` は実tarballのオフラインインストール、配布README、CLI・Node APIの
検証を含む。失敗は原因を確認してから公開する。skipがある場合も理由を確認する。

## 3. 配布物を作成・確認する

```sh
npm run pack:vgm:check
npm run pack:vgm
```

`tetorica-vgm-0.2.4.tgz` がリポジトリのルートに生成される。
ファイル名のバージョンは `packages/vgm/package.json` に従う。

専用packスクリプトは `dist/vgm/` へ依存ファイルと配布用manifestを集め、
`packages/vgm/README.md` を配布物のルート `README.md` として配置する。
GitHub用READMEは書き換えない。

**配布物は `npm run pack:vgm` で作り、検証したtgzを指定して公開する。
ルートのpackage.jsonは開発用の `private: true` で、公開対象ではない。**

```sh
tar -tzf tetorica-vgm-0.2.4.tgz
tar -xOf tetorica-vgm-0.2.4.tgz package/README.md
tar -xOf tetorica-vgm-0.2.4.tgz package/package.json
```

README・バージョン・WASM・LICENSE・配布物内の `licenses/` を確認する。
ゲームファイル、外部ROM、`w/`、キャッシュなどが含まれていないことも確認する。

packスクリプトがVGMのビルドを1回実行し、`dist/vgm/` をpackする。
ルートの `prepack` による追加ビルドは行わない。

## 4. 生成したtarballを別ディレクトリで試す

以下の変数は、リポジトリのルートで設定する。

```sh
release_tarball="$PWD/tetorica-vgm-0.2.4.tgz"
release_fixture="$PWD/test/fixtures/psg-tone.vgz"
release_test_dir="$(mktemp -d)"
(
  cd "$release_test_dir" || exit 1
  npm install --offline --ignore-scripts --no-audit --no-fund "$release_tarball" &&
  npx --offline tetorica-vgm --help &&
  npx --offline tetorica-vgm analyze "$release_fixture" --json &&
  npx --offline tetorica-vgm render "$release_fixture" --output tone.wav --max-seconds 0.1 &&
  node --input-type=module -e "import {readSource, analyzeSource} from 'tetorica-vgm'; console.log(analyzeSource(await readSource(process.argv[1])).schemaVersion)" "$release_fixture"
)
```

APIの出力は `1`。WAVとインストール結果は `$release_test_dir` で確認できる。
変更内容をレビューしてcommitし、公開するソースの状態を記録しておく。
ソースを変更した場合はテスト・packからやり直す。

## 5. npmにログインする

npmアカウントの2FAを設定し、ログインする。

```sh
npm login --auth-type=web --registry https://registry.npmjs.org/
npm whoami --registry https://registry.npmjs.org/
```

`kyorohiro` など、パッケージの公開権限を持つアカウントであることを確認する。
認証コードやトークンはリポジトリへ保存しない。

## 6. 検証済みのtarballを公開する

まず公開なしの確認を行う。dry-runは公開権限や名前の利用可否を保証するものではない。

```sh
npm publish ./tetorica-vgm-0.2.4.tgz --access public --registry https://registry.npmjs.org/ --dry-run
```

問題なければ、同じtarballを指定して実際に公開する。
ブラウザ認証・2FAの案内が表示されたら従う。

```sh
npm publish ./tetorica-vgm-0.2.4.tgz --access public --registry https://registry.npmjs.org/
```

## 7. 公開版を確認する

```sh
npm view tetorica-vgm name version versions maintainers --registry https://registry.npmjs.org/
npm view tetorica-vgm@0.2.4 dist.integrity --registry https://registry.npmjs.org/

# リポジトリrootで入力の絶対パスを保存し、公開版の実行は別ディレクトリで行う。
release_nes_input="$PWD/test/fixtures/nes-tone.vgz"
release_verify_dir="$(mktemp -d)"
(
  cd "$release_verify_dir" || exit 1
  npx --yes tetorica-vgm@0.2.4 --help
  npx --yes tetorica-vgm@0.2.4 render "$release_nes_input" --output nes.wav
)
```

npmが公開後の処理中と案内した場合は、数分待ってから確認する。
反映待ちの間に同じ版を再公開しない。

同名・同バージョンのpackageがあるリポジトリ内では、npxがローカルpackageを
選び、`sh: tetorica-vgm: command not found` になる場合がある。
公開版の確認は上記のように別ディレクトリで行う。
ローカルのビルドを確認する場合は `node dist/vgm/cli/main.js ...` を使う。

npmページで専用READMEも確認する。

https://www.npmjs.com/package/tetorica-vgm

公開したバージョン・commit・テスト環境・結果を作業記録に残す。
修正が必要になったら、次のバージョンへ上げて同じ手順を繰り返す。

## 補足

- `Unknown user config "python"` はnpm設定の警告。pack成功とは別の話なので、
  エラーの有無と終了結果を確認する。
- 初回公開前の `npm view` の404は、パッケージがまだ見つからないことを示す。
- 手動公開の認証条件: https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/
- publish仕様: https://docs.npmjs.com/cli/commands/npm-publish/

## Browserの音源対応表を更新した場合

編集元は `docs/vgm_analyzer/index.html` の `chipSupportDialog` のみ。
共有用の `docs/vgm_analyzer/support.html` は生成物なので直接編集しない。

```sh
node scripts/build_analyzer_support.mjs
node scripts/build_analyzer_support.mjs --check
node scripts/build_cli_chip_list.mjs
node scripts/build_cli_chip_list.mjs --check
```

生成したHTMLもcommitし、GitHub Pagesへ反映する。JavaScriptやダイアログ操作なしで読める。
CLIのnpm READMEには同じ表のチップ名・再生概要を自動転記する。`npm run pack:vgm`でも自動更新するため、別のチップ一覧を手で保守する必要はない。生成された`packages/vgm/README.md`もcommitする。
itch.ioの梱包でも同期チェックを行い、このページを同梱する。
公開後の案内URL: https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/support.html

## FM2612とのビルド先の関係

VGMビルドは `dist/vgm/`、FM2612ビルドは `dist/fm2612/` だけを作り直す。
相互の生成物を削除せず、どちらの順番でもbuild／packできる。

# Tetorica YM2608 rhythm replacement

Release payloads now include `tetorica_ym2608_adpcm_rom.bin` (8 KiB), an
original synthetic rhythm replacement under BSD-3-Clause. Its sound differs
from the Yamaha ROM. The original `ym2608_adpcm_rom.bin` is still excluded.

- Source: `web/tetorica_ym2608_adpcm_rom.bin`
- npm: `web/tetorica_ym2608_adpcm_rom.bin`
- Analyzer / Synth / Playground / browser examples ZIPs: `js/tetorica_ym2608_adpcm_rom.bin`
- Flat web runtime ZIP: `tetorica_ym2608_adpcm_rom.bin`
- Pages: `docs/js/tetorica_ym2608_adpcm_rom.bin`

The license, README and generator are in `assets/opna-rhythm/`
(at the npm package root or under `docs/` for Pages).
CLI and Analyzer ROM selection remains explicit. These changes apply to the
next release; the already published CLI 0.2.3 and web 0.40.7 are unchanged.

Before packaging:

```sh
node assets/opna-rhythm/generate.mjs --check
node scripts/copy_opna_rhythm.mjs docs
node --test web/opna_rhythm_rom.test.mjs
npm run pack:vgm:check
```
