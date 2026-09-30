# 複数音源と明示的な取得：useSoundChip 設計案

状態：初版実装済み。Main／Worker に `useSoundChip()` を追加。既存 API を維持し、サンプル・VGM 変換コードの一括移行は行っていない。ブラウザー実画面・実音での確認は未実施。

関連：[機能一覧](../feature-status.md)／[Game Boy API](gameboy_api_01.md)／[RF5C164 VGM 変換](rf5c164_vgm_javascript.md)

## 背景と目的

Playground は現在、`fm`・`psg`・`midi`・`fx` などをユーザーコードからそのまま使える形で提供している。一方、追加音源は `await createSoundChip(...)` で明示的に生成する。

チップが増えてもコードの先頭で「何を使うか」を示せるように、ランタイムが取得・再利用を管理する `useSoundChip(name, options?)` を追加する方針とする。

当初案の `context.fm ??= await createSoundChip(...)` は、再利用の意図を示せる一方、並行初期化や失敗時の再試行をユーザー側で扱う必要がある。今案では、その管理をランタイムに任せる。

## ユーザーに見せたい書き方

```js
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
| `ym2612`・`ym2203`・`ym2610` | 対応する `?chip=` で選択された既存 `fm` と同じ underlying instance/API を取得する。取得のためだけに二重生成しない |
| `rf5c164`・`ym2608`・`gameboy` | 既存 `createSoundChip()` と追加音源の管理・停止処理を利用する。大規模な再設計が必要なら問題点を報告する |
| `sn76489` など | 今回まとめて対応を増やす必要はない |

現行 Playground の `createSoundChip` の受付対象は `rf5c164`・`ym2608`・`gameboy`。`useSoundChip("ym2612")` の追加は、`createSoundChip("ym2612")` の新規生成対応を意味しない。

既定FMを取得する3音源では、要求した名前と選択中のチップが異なる場合は明確なエラーを返す。別チップの `fm` を YM2612 として返したり、既定音源を暗黙に切り替えたりしない。

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

- 対応する6音源について、チップ名・メソッド・引数の補完を確認対象にする。
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
- 対応する6音源の型推論・補完と、`const fm` の名前衝突がないことを確認する。
- 既存サンプル、VGM 再生・変換、Schedule／Write／High、CH 分割、DAC／PSG、Stop に回帰がないことを確認する。

音源の取得方式を追加しても、RF5C164 の共有 RAM・チャンネル選択レジスターの制約は変わらない。音源インスタンスの管理と、CH 別の独立再生は別の問題として扱う。

既存サンプルや VGM 変換コードの一括変更は行っていない。以下に初版の調査結果と検証を記録する。


## 初版の調査結果と実装

- Main の既定音源は `megaDrive.fm` が所有し、`ensureReady()` で `synth` に保持される。`play()` もこの synth を使う。既存 FM facade を同じ synth に対して再利用し、`pg.fm` と `await useSoundChip("ym2612")` を同一オブジェクトにした。
- Worker は既存 `fm` Proxy を返す。Promise が `then` を問い合わせても FM 命令として転送しないよう、`then` は undefined にした。
- 共通の [取得キャッシュ](../../web/playground_soundchips.js) は音源名ごとの初期化 Promise を共有する。失敗時は削除。Stop時は世代を更新して消去し、古い初期化が新しいエントリーを消さないようにする。
- 追加音源の生成は既存の `createSoundChip()` を使用し、Main の `pcmDevices`、Worker の `pcmClients` による追跡・解放を維持した。取得キャッシュは別の音源所有者にはしない。
- 手動で追加音源の `dispose()` を呼んだ場合もキャッシュを削除する。次回取得は新規生成。共有利用中の手動 dispose は他の利用者にも影響するため、通常はランタイムの Stop に任せる。
- Main の再評価ではキャッシュと FM facade を再利用。Worker の再評価でも同じ run 内で再利用する。Stop 後は追加音源を作り直す。初期化が停止後に完了した場合は既存の生成処理で解放する。YM2612 自体の寿命は従来の既定音源管理に従う。
- ユーザーコードは注入グローバルを参照できる内側のブロックスコープで評価する。これにより `const fm` を宣言でき、従来の宣言なしの `fm` も使える。
- `options` は省略または空オブジェクトのみ。`id` を含む未対応設定、未対応チップ名はエラー。
- [Monaco の型定義](../playground/tetorica-playground-globals.d.ts) にチップ名→戻り値型のマップを追加。`useSoundChipYm2612()` のような別関数は追加していない。

## 初版の検証結果

- 取得キャッシュ、Main／Worker の既存・新規テストで、同一性、並行取得、追加3音源、再評価、Stop、停止中の初期化完了、再試行、手動 dispose、既存 `play()` を確認。
- Playground 関連を広く実行：299件中298件成功。失敗1件は `vgm_export.test.mjs` の「scheduled export expands YM2612 DAC stream data while readable export omits it」。変更前 HEAD のファイルだけを一時ディレクトリーへ展開して同じ失敗を再現し、今回の変更による回帰ではないことを確認した。
- [型チェック用コード](../playground/use_soundchip.types.js) を TypeScript で検証。4音源の API を推論でき、他チップのメソッドや未対応 ID は型エラーになる。
- TypeScript Language Service で、チップ名4候補と各戻り値のメソッド補完を確認。Monaco の実画面操作は未確認。
- itch.io 用パッケージを検証ビルド。公開は行っていない。

## Playground の VGM Import への適用

YM2612 を選択した Playground の OPN 系 Import では、生成 JS の先頭に次を追加する。

```js
const fm = await useSoundChip("ym2612");
```

YM2612 VGM、および YM2203／YM2608／YM2610 の FM を YM2612 向けに変換する経路が対象。YM2612 と RF5C164 の混在では FM の取得だけを追加する。取得完了後に既存の生成コードを実行する。

Write／High／Schedule、Note-ish、CH 分割、DAC／PSG のオプション・時間管理・liveLoop は既存のまま。`write()`・`play()`・DAC・予約再生は取得した FM と同じ既定音源へ接続される。`useSoundChip()` 自体が時間同期を行うわけではない。

ネイティブ YM2203／YM2610 の Import にも、選択中のチップ名で useSoundChip の取得行を追加した。ネイティブ YM2608、Game Boy、RF5C164 の生成・破棄は変更しない。特に `useSoundChip("ym2608")` は追加音源の取得であり、既定音源を操作するグローバル関数の対象を変更しないため、一括置換しない。

適用箇所は Playground の Import 保存処理。共有の VGM exporter 単体の出力は変更せず、過去に生成・保存したコードにも遡って変更しない。ページ再読み込み後の再 Import で反映される。

Write／High／Schedule × CH 分割 ON/OFF で、取得を追加する前後のレジスター列・待ち時間・ループ名の一致と、ループ登録前に1回だけ取得することを確認した。


## 既定FM取得の対象追加：YM2203 / YM2610

`?chip=ym2203` では `const fm = await useSoundChip("ym2203")`、`?chip=ym2610` では `const fm = await useSoundChip("ym2610")` を利用できる。Main／Worker とも既存グローバルの FM facade を返し、追加生成は行わない。再取得・並行取得・再評価・Stop後の実行でも既存の音源管理に従う。

返り値は FM API。YM2203 は論理3CH、Neo Geo YM2610 は論理4CHの型を提供し、YM2612専用DAC APIや全チップのSSG・ADPCM APIとしては扱わない。`ym2608` は従来どおり追加音源の取得。`ym2610b` の取得対応は今回追加していない。

要求名と選択中チップが異なる場合はエラー。YM2612モードで別のYM2610を生成する機能や、URL指定を不要にする変更ではない。ネイティブYM2203／YM2610のImportにも取得行を追加した。

関連92テスト成功。Main／Workerの既定音源との同一性、再評価、並行取得、チップ不一致、Importの取得行を検証。型チェックでFMチャンネル範囲と非対応APIも確認。実ブラウザー試聴は未確認。

## createSoundChip の OPN 追加対応

`createSoundChip()` に `ym2612`・`ym2203`・`ym2610` を追加した。対応名は `useSoundChip()` と同じ6種類。毎回独立した Worklet Node・WASM 音源・通信ポートを生成し、既存の追加音源と同じマスター入力へ接続する。Main／Worker とも既存の Stop/dispose 管理を使う。

```js
const extra = await createSoundChip("ym2612");
extra.setPreset(CH1, FM_PRESETS["one-op-basic"]);
extra.noteOn(CH1, 4, 600);
await sleep(0.3);
extra.noteOff(CH1);
```

グローバルの `play()`・`write()`・予約再生は従来どおり既定音源を操作する。追加音源では取得したオブジェクトを操作する。追加音源の予約再生・同期読み取りは今回の対応範囲に含めない。`sleep`／`liveLoop` は既存の実行時計を使用し、各ポートへの書き込みは即時コマンドとして処理される。

YM2612 は FM 6CH と DAC レジスター操作、YM2203 は FM 3CH と SSG、YM2610 は論理 FM 4CH と SSG・ADPCM-A/B の既存 Synth API を利用する。YM2610 は YM2610B バックエンドの YM2610 variant を使用する。追加 YM2612 に PSG は付属しない。

`useSoundChip()` の既定音源取得契約は変更しない。例えば YM2612 モードでも `createSoundChip("ym2610")` は生成できるが、`useSoundChip("ym2610")` は引き続き選択チップとの不一致をエラーにする。

実 WASM の2台同時生成・FM発音・状態の独立性・SSG発音・YM2610メモリー転送、初期化中の破棄、Main／Worker の生成と Stop を自動テストで確認。ブラウザーでの実音試聴は未実施。

## OPN共通の setOperators

YM2203／YM2608／YM2610／YM2610B に `setOperators(channel, entries)` を追加した。YM2612 と同様、`entries` は `[operator, params]` の配列。全入力を検証してから指定順に `setOperator()` を適用し、同じオペレーターへの繰り返し指定も保持する。不正入力ではレジスター書き込み・音色状態の更新を行わない。

```js
fm.setOperators(CH1, [
  [OP1, {tl: 20, ar: 31}],
  [OP2, {tl: 40}],
]);
```

これは時間管理を伴わない Synth API。PGAdapter は不要。既定FMと追加音源の両方で利用でき、YM2610 は論理4CHから物理CHへ変換する。Playground の型定義にも反映した。

## useSoundChip の選択チップ不一致制限を解除

上記の「要求名と選択中チップが異なる場合はエラー」という初期仕様を変更した。YM2612／YM2203／YM2610 は既定音源と一致すれば既存 `fm` を返し、不一致なら `createSoundChip()` で追加生成して再利用する。YM2608／RF5C164／Game Boy は従来どおり追加音源として再利用する。

```js
// YM2612 モードでも利用可能。
const neo = await useSoundChip("ym2610");
neo.setPreset(CH1, FM_PRESETS["one-op-basic"]);
neo.noteOn(CH1, 4, 600);
await sleep(0.3);
neo.noteOff(CH1);
```

並行取得は初期化 Promise を共有する。ライブ再評価で再利用し、Stop で追加音源とキャッシュを破棄する。追加 OPN の手動 dispose 後も次回取得で再生成する。グローバル `play()`／`write()` の対象は変更しない。

Monaco は選択中チップに応じて、既定FMと追加音源の戻り値型を区別する。例えば YM2612 モードで取得した YM2610 には SSG／ADPCM の補完も提供する。
