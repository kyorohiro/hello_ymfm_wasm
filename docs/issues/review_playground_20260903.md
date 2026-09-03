# Playground Review 2026-09-03

対象: `docs/playground/` と、その Playground が実行時に利用する `docs/js/playground_*.js`。

## 反映状況

- [x] P1: Main thread / Worker の top-level、liveLoop、keyboard、cleanup に実行ガードを適用。
- [x] P2: Cassette deflate を実測サイズ上限付きの stream 読込へ変更。
- [x] P2: 時間系テストを正本の `docs/js/pitch.js` に接続。
- [x] P3: `docs/playground` の clock/live/music/execution を `docs/js` 正本への re-export に変更し、itch release の重複梱包を削除。

## 最終実行結果

```sh
node --test docs/playground/*.test.mjs
```

- 54 passed / 0 failed

ブラウザ上の実音、Main thread / Worker の手動疎通は今回再実行していない。

## P1: Worker と liveLoop が実行ガードを迂回する

`executeWithPlaygroundGuards()` は Main thread のトップレベル source 評価だけを
囲んでいる。

- `docs/js/playground_runtime.js`
  - `playSource()` は source 評価を guard する。
- `docs/js/playground_live.js`
  - `liveLoop` callback は後から直接実行され、guard の解除後になる。
- `docs/js/playground_logic_worker.js`
  - Worker source は `new AsyncFunction()` で直接実行され、guard 自体を持たない。

そのため、ネットワーク禁止を仕様としている場合でも、例えば次の経路では
`fetch()` 等を実行できる。

```js
liveLoop("network", async () => {
  await fetch("https://example.com/");
  await sleep(1);
});
```

### 対応方針

- Main thread は `liveLoop`、keyboard callback、cleanup callback の実行も同じ
  guard で囲む。
- Worker にも同等の guard を実装する。少なくとも Worker global の
  `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource` を source 実行中に
  block する。
- Main thread / Worker の両方で、top-level と liveLoop からの `fetch()` が
  失敗するテストを追加する。

## P2: Cassette の展開サイズ制限を ZIP header だけで判定している

`docs/playground/playground_cassette.js` は central directory の
`uncompressedSize` を使って 16 MiB 制限を判定する。

一方、deflate 展開は `Response(stream).arrayBuffer()` で全量をメモリへ読み込んだ
後に、実際の `result.byteLength` を照合している。

header のサイズを偽った deflate data は、検証より先に大量のメモリを消費できる。
Cassette import はユーザーが任意の zip を渡せるため、タブ停止につながる。

### 対応方針

- deflate stream を chunk 単位で読み、実測した展開済みサイズが 16 MiB を超えた
  時点で cancel する。
- entry ごと、および archive 合計の実測上限を維持する。
- header 値が小さく、実データが上限を超える fixture を追加する。

## P2: `playground_time.test.mjs` が import 時点で失敗する

`docs/playground/playground_time.test.mjs` は次を import している。

```js
import { createPitchFromMidi } from "../synth/synth_keyboard.js";
```

しかし `createPitchFromMidi` は `docs/js/pitch.js` の export であり、
`synth_keyboard.js` は内部利用の import だけを行っている。

結果として、music / clock / FX の時間系テストが実行されない。

### 対応方針

- テストの import を `../js/pitch.js` に修正する。
- 全 `docs/playground/*.test.mjs` を release 前の必須検査にする。

## P3: Playground の実行系が二重管理されている

production の `docs/js/playground_runtime.js` は `docs/js/playground_clock.js`、
`docs/js/playground_live.js`、`docs/js/playground_music.js` を利用する。

一方、`docs/playground/` にも同名の別実装があり、
`scripts/package_itch_playground.sh` はその古い root 側のファイルも同梱する。
`playground_time.test.mjs` も root 側を対象にしている。

この状態では Worker / timing の修正が片側にだけ入り、テストと実際の Playground が
ずれる可能性が高い。

### 対応方針

- 実行系の正本を `docs/js/` に一本化する。
- `docs/playground/` 側の重複実装を削除または薄い re-export にする。
- package script とテストの import 先を正本へ揃える。

## 優先順

1. P2 のテスト失敗を直して、実行基盤を green に戻す。
2. P1 の guard 適用範囲を Main thread / Worker / callback で揃える。
3. P2 の Cassette 展開をストリーム上限付きにする。
4. P3 の重複実装を整理し、release script も合わせる。
