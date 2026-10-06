# Playground examples

FILES の `examples/` を開き、フォルダー内の `.js` を選択して Run を押す。
ファイルを選ぶとエディターと Run file の両方が切り替わる。
サンプルはプロジェクト内で編集でき、Cassette Export にも保存される。

| Folder | 内容 |
| --- | --- |
| basic | グローバル fm・psg・dac と、liveLoop・context・FX・MIDI・noise・samples |
| chip-raw | 音源レジスタを直接操作する例 |
| genesis | 独立 Sega PSG・Mega CD PCM（RF5C164） |
| gameboy | pulse・wave・noise・複数音源の設定 |
| pc98 | 独立 YM2608 の SSG・rhythm・ADPCM-B（PCM からの loadSample を含む） |
| x68000 | 独立 YM2151 の FM |

FILES ではこの順に表示します。機種別のサンプルは各フォルダーに直接置きます。`basic/` 内の共通機能サンプルは機能別に分類しています。
`chip-raw` は直接レジスタを書く入口として残しています。
`basic/fm`・`basic/psg`・`basic/dac` は選択中の音源や Playground のグローバル API を使います。
機種別フォルダーには `useSoundChip()` / `createSoundChip()` で独立した音源を取得する例を置きます。

`?ex=...` は廃止。`?src=...` によるコード共有は引き続き利用できる。
各サンプルの利用可能な音源・機能はコード内の API に依存する（DAC/PSG 等は YM2612 モード）。

## サンプルを追加・修正する場合

このフォルダーの JavaScript が原本。サンプル名（拡張子を除くファイル名）は重複させない。

```sh
node scripts/build_playground_examples.mjs
node scripts/build_playground_examples.mjs --check
```

生成された `playground_examples.js` は、コードを実行せず文字列として配布するためのバンドル。
直接編集しない。itch.io パッケージ生成時にも更新する。
