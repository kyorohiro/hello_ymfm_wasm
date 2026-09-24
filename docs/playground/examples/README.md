# Playground examples

FILES の `examples/` を開き、フォルダー内の `.js` を選択して Run を押す。
ファイルを選ぶとエディターと Run file の両方が切り替わる。
サンプルはプロジェクト内で編集でき、Cassette Export にも保存される。

| Folder | 内容 |
| --- | --- |
| basic | 最初の発音、音階、liveLoop、context |
| fm | FM API、レジスタ操作、CH3 special、音色 |
| midi | MIDI FM/PSG、固定 CH、和音、CC・Pitch Bend |
| psg | トーン・ノイズ |
| dac | YM2612 DAC のバイト列再生 |
| noise | 海・風・雨などのノイズ |
| samples | サンプル音声の読み込み・再生 |
| fx | エフェクトとルーティング |

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
