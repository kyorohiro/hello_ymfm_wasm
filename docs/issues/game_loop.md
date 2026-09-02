# Playground Game Loop

Playground を簡易ゲームの実験にも使えるようにするための作業メモ。

## 基本方針

ゲームの更新と Canvas 描画は、音楽用の `liveLoop()` だけにまとめない。

- `liveLoop()` は、譜面・SE・ゲーム状態の更新など、`sleep()` / `beat()` と同期したい処理に使う。
- 描画は `requestAnimationFrame()` 相当の `pg.gameLoop()` で行う。描画周期を音楽の待機時間に依存させない。
- `pg.gameLoop()` はフレーム間隔 `delta` をコールバックへ渡す。移動やアニメーションはフレーム数ではなく `delta` 基準で進める。
- `pg.gameLoop(name, callback)` のように名前を持たせ、同名の Run 時には置換する。
- Stop 時にはすべての game loop を解除する。Run を繰り返しても描画ループが二重化しないことを保証する。

想定する使い方:

```javascript
const canvas = pg.liveView.getCanvas({ width: 320, height: 240 });
const context = canvas.getContext("2d");

let playerX = 0;

liveLoop("game-logic", async () => {
  playerX += 1;
  await sleep(1 / 60);
});

pg.gameLoop("render", ({ delta }) => {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillRect(playerX, 100, 16, 16);
});
```

## Live View

Canvas は Playground の専用領域に表示する。通常の音楽作成では表示領域を使わないため、初期状態は非表示にする。

- Code / Live View のタブで表示を切り替える案を基本とする。
- Live View は 4:3 の表示領域にする。
- `pg.liveView.getCanvas({ width, height })` は同じ Canvas を再利用する。
- `pg.liveView.getContainer()` は Canvas を配置するコンテナを返す。
- `pg.liveView.show()` / `pg.liveView.hide()` で表示を切り替える。
- Stop 時には game loop とポインター操作を解除し、Canvas をクリアして非表示へ戻す。

## 入力

キーボードは既存の Playground キーイベントを利用する。Canvas 操作用にはポインター API を追加する。

- `pg.liveView.onPointerDown(name, callback)`
- `pg.liveView.onPointerMove(name, callback)`
- `pg.liveView.onPointerUp(name, callback)`

`PointerEvent` を使えば mouse / touch / pen を一つの API で扱える。座標は Canvas の論理解像度に変換して渡す。

## Main Thread と Worker

DOM、`HTMLCanvasElement`、`requestAnimationFrame()` は Main thread の API である。

- `pg.liveView` と `pg.gameLoop` は Main thread 実行専用にする。
- `execution: "worker"` のコードでこれらを呼んだ場合は、利用不可であることが分かるエラーにする。
- Worker 側では音源制御、ゲーム状態計算、ネットワークを伴わない計算は可能。ただし DOM 描画を直接行えない。
- 将来 `OffscreenCanvas` を使う選択肢はあるが、Canvas の作成・DOM への配置・入力取得は Main thread に残る。まずは Main thread のゲーム実験を優先する。

## 未決定

- `pg.gameLoop()` の `delta` を秒、ミリ秒のどちらで渡すか。秒を基本とする。
- game loop 内エラーの表示方法。既存の Playground 実行エラーと同じ表示へ集約する。
- Worker のゲーム状態と Main thread 描画を message で接続する必要が出た段階で、スナップショット形式・更新頻度を設計する。
- 音楽の `liveLoop()` とゲームロジックを同じループに置くか分けるかは、コードの読みやすさを優先して利用側に任せる。
