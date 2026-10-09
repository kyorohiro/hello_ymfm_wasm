# Virtual Files 実験ページ

リポジトリーのルートで `python3 -m http.server 8083 -d docs` を起動し、
`http://localhost:8083/examples/virtual-files/` を開く。

ライブラリーは import map で `docs/js/tetorica_virtual_files/` から読み込む。
ソースを変更したら `npm run build:virtual-files` で更新する。

- テキストを編集し、`cat /index.js` で同じ内容が読めることを確認する。
- `mkdir /work`、`cp /lib/notes.js /work/notes.js`、`mv`、`rm` で操作する。
- `write /lib/notes.js 'export const notes = [62, 65, 69];'` でエディター側の更新を見る。
- バイナリの表示やコピー、空フォルダーも試す。
- 保存後にページを再読み込みし、復元ボタンでファイル一式を戻す。

保存先は、このページ用の IndexedDB `tetorica-virtual-files-example`。
Playground の自動保存とは別のデータベースを使い、復元はボタン操作で行う。
Git や JavaScript の実行は追加していない。
