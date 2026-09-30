# 複数音源と明示的な取得：useSoundChip 設計案

状態：相談内容をまとめた実装方針。`useSoundChip()` は未実装。既存 API の廃止や、サンプル・VGM 変換コードの一括移行は行わない。

関連：[機能一覧](../feature-status.md)／[Game Boy API](gameboy_api_01.md)／[RF5C164 VGM 変換](rf5c164_vgm_javascript.md)

## 背景と目的

Playground は現在、`fm`・`psg`・`midi`・`fx` などをユーザーコードからそのまま使える形で提供している。一方、追加音源は `await createSoundChip(...)` で明示的に生成する。

チップが増えてもコードの先頭で「何を使うか」を示せるように、ランタイムが取得・再利用を管理する `useSoundChip(name, options?)` を追加する方針とする。

当初案の `context.fm ??= await createSoundChip(...)` は、再利用の意図を示せる一方、並行初期化や失敗時の再試行をユーザー側で扱う必要がある。今案では、その管理をランタイムに任せる。

## ユーザーに見せたい書き方

```js
// 提案コード：useSoundChip は未実装。
const fm = await useSoundChip("ym2612");

fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
await play("C4", { channel: CH1, duration: 0.3 });
await sleep(0.1);
```

追加音源も同じ入口から取得する。

```js
const pcm = await useSoundChip("rf5c164");
```

既存の宣言なしの `fm`、`psg`、`play()`、`sleep()`、`liveLoop()` などは引き続き利用可能にする。`play()` を `fm.play()` へ変えるような API 再設計は今回行わない。

## createSoundChip と useSoundChip の役割

| API | 役割 |
|---|---|
| `createSoundChip(name)` | 新しいインスタンスを生成する既存 API |
| `useSoundChip(name, options?)` | この実行環境で使用する音源を取得し、ランタイムの寿命に沿って再利用する新 API |

同じ実行環境・同じ音源の再取得では、原則として同一オブジェクトを返す。

```js
const a = await useSoundChip("ym2612");
const b = await useSoundChip("ym2612");
console.log(a === b); // true を期待

const [c, d] = await Promise.all([
  useSoundChip("rf5c164"),
  useSoundChip("rf5c164"),
]);
// 初期化中の Promise も共有し、二重生成しない。
```

再利用範囲は既存ランタイムのライフサイクルに合わせる。Stop を越えて保持する永続キャッシュにはしない。

## 今回の対応範囲

| 音源 | 方針 |
|---|---|
| `ym2612` | 暗黙に提供される既存 `fm` と同じ underlying instance/API を取得する。取得のためだけに二重生成しない |
| `rf5c164`・`ym2608`・`gameboy` | 既存 `createSoundChip()` と追加音源の管理・停止処理を利用する。大規模な再設計が必要なら問題点を報告する |
| `sn76489` など | 今回まとめて対応を増やす必要はない |

現行 Playground の `createSoundChip` の受付対象は `rf5c164`・`ym2608`・`gameboy`。`useSoundChip("ym2612")` の追加は、`createSoundChip("ym2612")` の新規生成対応を意味しない。

既定音源が YM2612 以外の場合の扱いは、実装前に確認する。初期対応では明確なエラーを返す案を推奨する。別チップの `fm` を YM2612 として返したり、既定音源を暗黙に切り替えたりしない。

`midi` は MIDI 入出力・演奏支援、`fx` はエフェクトの機能として扱い、音源ファクトリーに無理に統合しない。PSG の独立生成や複数チップ構成の表現は別途検討する。既存 `dac`・`write`・予約再生 API の対象も今回勝手に変更しない。

## 型と補完：チップ別の関数には分けない

基本形は `useSoundChip("ym2612")` とし、補完のために `useSoundChipYm2612()` などの関数をチップごとに増やす必要はない。

Monaco にチップ名と戻り値型の対応を提供すれば、文字列リテラルからチップ固有 API を推論できる。オーバーロードや型マップなど、既存の型提供方法に合う形で定義する。

```js
const fm = await useSoundChip("ym2612");
//                           ↑ 対応するチップ名を補完
fm.setPreset(CH1, FM_PRESETS["one-op-basic"]);
// ↑ YM2612 のメソッドと引数を補完

const name = "ym2612";
const sameType = await useSoundChip(name);
// name がリテラル型を保持していれば、同様に型を絞れる。
```

実行時に決まる任意の文字列では、戻り値を特定のチップ型に絞れない場合がある。動的な名前の扱いは型定義と実行時検証で整合させ、無条件に YM2612 型を返す定義にはしない。

- 対応する4音源について、チップ名・メソッド・引数の補完を確認対象にする。
- ユーザーが毎回 JSDoc を付けなくても、`await useSoundChip(...)` から型を得られる形を目指す。
- JSDoc は明示が必要な場合の補助とし、存在しない型名や仮の import パスをサンプルに書かない。
- `context` への保存を利用者の必須手順にしない。直接取得する形なら、自由なプロパティを持つ `context` を介した型の消失も避けやすい。

## ライフサイクルと競合

既存の音源追跡・Stop/dispose・context clear をできるだけ再利用する。

| 状況 | 方針・確認事項 |
|---|---|
| ライブ編集・再評価 | 同じランタイムが生きている範囲で再利用し、不要な再生成を避ける |
| 通常の再実行 | 現行の停止・再生成の境界を調べ、それに従う |
| 並行取得 | 初期化中の Promise を共有し、同一音源の二重生成を防ぐ |
| 初期化失敗 | 失敗した Promise をキャッシュから除き、次回取得で再試行可能にする |
| 初期化中の Stop | 遅れて完成した追加音源も解放し、停止済み環境へ登録しない |
| Stop | 既存の消音・予約キャンセル・dispose・context clear を維持し、取得キャッシュも無効化する |
| 複数ループからの取得 | 1つのループの終了だけで、共有音源を破棄しない |
| 利用者による dispose | ランタイム管理音源に対する手動破棄の扱いと、破棄済みオブジェクトを再取得させない方針を確認する |

現行 Worker は生成した追加音源を追跡し、Stop 時に dispose して `context` をクリアしている。新しい管理機構が同じ音源を重複所有・重複破棄しないようにする。

## options と複数インスタンス

将来は次の形も検討するが、今回の必須範囲にはしない。

```js
// 将来案：今回の対応を保証しない。
const fm1 = await useSoundChip("ym2612", { id: "fm1" });
const fm2 = await useSoundChip("ym2612", { id: "fm2" });
```

現行構造で無理なく対応できる場合を除き、複数インスタンスは保留とする。将来、音源名と ID を組み合わせて管理できる設計を妨げない。

未対応の `id` やその他のオプションは黙って無視せず、明確なエラーにする。異なる ID を指定したのに同じ音源が返る動作は避ける。初期対応の `options` の受け付け範囲は実装時に明記する。

## 実装前に調査する場所と論点

入口は [メイン側ランタイム](../../web/playground_runtime.js) と [Worker 側ランタイム](../../web/playground_logic_worker.js)。Monaco の API 型提供箇所も調査する。

1. グローバル `fm`／既定音源の生成場所・所有者・選択チップとの関係。
2. Main／Worker 双方の `createSoundChip()` と追加音源の追跡方法。
3. Stop/dispose、context clear、ライブ編集・通常再実行時の寿命。
4. 初期化中の競合・失敗・停止を扱う既存の仕組み。
5. API の評価スコープと型・補完の提供方法。

特に、注入されたグローバル `fm` とユーザーの `const fm` が衝突しないことを必須にする。提示した新コードと、宣言なしで `fm` を使う既存コードの両方が動く評価方式にする。

## 確認するテスト

- `const fm = await useSoundChip("ym2612")` → `setPreset` → 既存 `play("C4", ...)` が動く。
- 従来のグローバル `fm.setPreset(...)` → `play(...)` が変わらず動く。
- YM2612 は既存グローバルと同一 API を返し、追加生成されない。
- 追加音源の取得・逐次再取得・並行取得で、生成数とオブジェクト同一性を確認する。
- 初期化失敗後の再試行、初期化中の Stop、停止後の再実行でリークや古い参照の再利用がない。
- ライブ編集中の再利用と、共有音源を使う複数の `liveLoop` を確認する。
- 未対応チップ・オプション、既定音源との不一致を確認する。
- 対応する4音源の型推論・補完と、`const fm` の名前衝突がないことを確認する。
- 既存サンプル、VGM 再生・変換、Schedule／Write／High、CH 分割、DAC／PSG、Stop に回帰がないことを確認する。

音源の取得方式を追加しても、RF5C164 の共有 RAM・チャンネル選択レジスターの制約は変わらない。音源インスタンスの管理と、CH 別の独立再生は別の問題として扱う。

今回の文書更新は方針の整理のみ。実装時は調査結果と問題点を説明してから、既存構造を大きく変えずに追加する。既存サンプルや VGM 変換コードの一括変更は不要とする。
