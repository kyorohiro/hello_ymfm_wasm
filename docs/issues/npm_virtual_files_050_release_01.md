# tetorica-virtual-files 0.5.0 公開

2026-11-03。MIDI Playgroundの改善に使った共有ライブラリーの変更をnpmへ公開する。

状態：**tetorica-virtual-files 0.5.0をnpmのlatestとして公開済み**。

## TODO

- [x] npm latest 0.4.0の公開tarballと現在のソースを比較する。
- [x] バージョンを0.5.0へ更新し、変更内容をREADMEへ記載する。
- [x] 共有ライブラリーの全テスト、型生成、配布tarballの隔離インストール・型・Git APIを確認する。
- [x] 確認済みtarballをnpmへ公開し、latest・公開tarballのintegrityを照合する。

## 対象

- `git clone [--replace] [-b|--branch BRANCH] HTTPS_URL [.]`。ホスト提供HTTPを使い、完全な履歴とremote既定ブランチを取得する。既存FILESは成功後に一括更新する。
- `git remote rm/remove NAME`。
- Shellの`rm`で`-r`・`-R`・`-f`・`--recursive`・`--force`・結合オプション・`--`に対応し、ホストのrm登録にも使える`parseRmArgs()`を公開する。
- 公開0.4.0との差分は`README.md`、`src/git.js`、`src/shell.js`、`src/shell.d.ts`。同期・checkpoint等のコアは変更しない。

MIDIの`/sys`削除状態、ルート削除時の扱い、ShellのTab・Ctrlキー操作はアプリ側の機能。MIDIは共有ソースを同梱しているため、今回のnpm公開を待つ必要はない。MIDIのリリース物やバージョンはこの作業では変更しない。

## 検証・公開結果

- 共通コア全106件成功。`npm run build:virtual-files`で型とブラウザーGit bundleを再生成した。
- `scripts/check_virtual_files_package.mjs`で配布物を隔離consumerへoffline install。必須依存なし、NodeNext／Bundlerのstrict型、`parseRmArgs()`、rmオプション、任意Git peersのlocal Git・remote削除・隔離HTTPS cloneを確認した。
- 候補tarball：`/private/tmp/virtual-files-release-VOqZBp/tetorica-virtual-files-0.5.0.tgz`。23 files、44,008 bytes。
- 候補integrity：`sha512-OxCpv+/6wbmu86Z8F+pNDc+4WAbp48o4l4oMlrWkzEK8kuCQfuVJPz8dK3uOoYESbEDl+0/tY2jB+nlaktD1kg==`。
- ブラウザーでの再ログインと追加の公開認証後、確認済みtarballを公開した。npmの処理待ち後、version／latestとも0.5.0、registryのintegrity一致を確認した。公開tarballを再ダウンロードし、候補tarballとの完全なバイト一致も確認した。
- 認証情報・一時認証URLは記録しない。詳細は[検証結果JSON](npm_virtual_files_050_release_01.json)を参照。
