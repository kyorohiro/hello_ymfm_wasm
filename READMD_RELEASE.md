# tetorica-vgm の npm リリース手順

リポジトリのルートで実行する。`0.1.1` は公開済み。
以下は次のバージョン `0.1.2` を公開する例。

## 1. バージョンとドキュメントを更新する

```sh
git status --short
npm view tetorica-vgm name version maintainers
npm version 0.1.2 --no-git-tag-version
```

`--no-git-tag-version` は自動commit・tag作成を行わず、バージョンを更新する。
公開済みの同じ名前・バージョンは再利用できない。再リリース時は新しい番号にする。

次の説明を実装に合わせて更新する。

- `cli/README.md`: npm配布用README。利用者向けの導入・コマンド・API。
- `CLI.md`: 詳細な対応音源、オプション、制約、Node API。
- `README.md`: GitHubリポジトリ全体の説明。
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
npm run pack:check
npm run pack
```

`tetorica-vgm-0.1.2.tgz` がリポジトリのルートに生成される。
ファイル名のバージョンは `package.json` に従う。

専用packスクリプトはビルド後、一時ディレクトリへ配布ファイルを集め、
`cli/README.md` を配布物のルート `README.md` として配置する。
GitHub用READMEは書き換えない。

**配布物は `npm run pack` で作る。ルートで直接 `npm pack` や引数なしの
`npm publish` を使うと、GitHub用READMEが入る。**

```sh
tar -tzf tetorica-vgm-0.1.2.tgz
tar -xOf tetorica-vgm-0.1.2.tgz package/README.md
tar -xOf tetorica-vgm-0.1.2.tgz package/package.json
```

README・バージョン・WASM・LICENSE・`dist/licenses/` を確認する。
ゲームファイル、外部ROM、`w/`、キャッシュなどが含まれていないことも確認する。

現状は `prepack` とpackスクリプトの両方でビルドするため、
`Staged ...` が2回出ることがある。ビルド重複は既知の整理事項。

## 4. 生成したtarballを別ディレクトリで試す

以下の変数は、リポジトリのルートで設定する。

```sh
release_tarball="$PWD/tetorica-vgm-0.1.2.tgz"
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
npm login --registry https://registry.npmjs.org/
npm whoami --registry https://registry.npmjs.org/
```

`kyorohiro` など、パッケージの公開権限を持つアカウントであることを確認する。
認証コードやトークンはリポジトリへ保存しない。

## 6. 検証済みのtarballを公開する

まず公開なしの確認を行う。dry-runは公開権限や名前の利用可否を保証するものではない。

```sh
npm publish ./tetorica-vgm-0.1.2.tgz --access public --registry https://registry.npmjs.org/ --dry-run
```

問題なければ、同じtarballを指定して実際に公開する。
ブラウザ認証・2FAの案内が表示されたら従う。

```sh
npm publish ./tetorica-vgm-0.1.2.tgz --access public --registry https://registry.npmjs.org/
```

## 7. 公開版を確認する

```sh
npm view tetorica-vgm name version maintainers --registry https://registry.npmjs.org/
npm view tetorica-vgm@0.1.2 dist.integrity --registry https://registry.npmjs.org/

# リポジトリrootで入力の絶対パスを保存し、公開版の実行は別ディレクトリで行う。
release_nes_input="$PWD/test/fixtures/nes-tone.vgz"
release_verify_dir="$(mktemp -d)"
(
  cd "$release_verify_dir" || exit 1
  npx --yes tetorica-vgm@0.1.2 --help
  npx --yes tetorica-vgm@0.1.2 render "$release_nes_input" --output nes.wav
)
```

同名・同バージョンのpackageがあるリポジトリ内では、npxがローカルpackageを
選び、`sh: tetorica-vgm: command not found` になる場合がある。
公開版の確認は上記のように別ディレクトリで行う。
ローカルのビルドを確認する場合は `node dist/cli/main.js ...` を使う。

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
