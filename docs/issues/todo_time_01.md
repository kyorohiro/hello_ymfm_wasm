# Playground：時間指定 API の整理

作成：2026-10-13

状態：現状の棚卸しと検討メモ。2026-10-13 に共有拍時計と拍指定 tween の実装を追加。全 API の改名・旧名削除は未実施。
`setBpm` 変更への拍待機・音符・tween の追従を採用した。下記の現状一覧には変更前の問題点も含む。最新の動作・残課題は末尾の実装記録を参照。

## 問題

現在は秒、拍、サンプル数、ミリ秒、0〜1の進行度が API ごとに現れる。
同じ数値型でも、所要時間・素材内の位置・時計上の絶対時刻・基準からのオフセット・周期で意味が異なる。

特に、次の点は名前や型だけでは分かりにくい。

- `play` の `duration` は秒だが、MIDI output の `play` の `duration` は拍。
- FX の `rate` は毎秒の回数ではなく、1周期の拍数。
- `fx.slicer` の `phase` は位相位置ではなく、1周期の拍数。
- `sample.play` の `duration` は素材内の秒数で、再生速度によって実際の所要時間が変わる。
- `when`、`time`、`at` などは、何を基準にした位置・時刻かを覚える必要がある。
- サンプル数には VGM の44,100 Hz単位と、出力サンプルレートのフレーム数がある。
- 型定義で単位の説明が不足しているオプションもある。

秒・拍・サンプル数は、それぞれ用途があるため、すべてを一つの単位へ変換させること自体を目的にはしない。
呼び出し箇所で単位と意味を読み取れる形を検討する。

## 待機・演奏

`pg.sleep` など、同じ機能の別名は省略している。

| API・引数 | 単位 | 意味 |
|---|---|---|
| `sleep(seconds)` | 秒 | 待つ長さ |
| `createTimeline().waitUntil(seconds)` | 秒 | 作成時を0とする経過位置。読込み後に作成し、遅れを以降へ累積させず追いつく。Mainは音声時計、Workerは単調時計、BPM非依存。JS待機であり音声予約ではない |
| `sleepSamples(samples, sampleRate?)` | サンプル数 | 待つ長さ。sampleRate の既定は44,100 Hz |
| `beat(beats)` | 拍 | 待つ長さ。BPMに依存 |
| `nextBeat()` | 拍 | 次の整数拍まで待つ。時間引数はない |
| `tween(durationSeconds, onUpdate)` | 秒 | 全体の所要時間 |
| tween callback の `progress` | 0〜1 | 時間ではなく開始から終了までの進行度 |
| `play(note, {seconds})` | 秒 | 音符の長さ |
| `play(note, {beats})` | 拍 | 音符の長さ |
| `play(note, {duration})` | **秒** | 旧来の指定。既定0.2秒 |
| MIDI output の `play(note, {seconds})` | 秒 | 音符の長さ |
| MIDI output の `play(note, {beats})` | 拍 | 音符の長さ |
| MIDI output の `play(note, {duration})` | **拍** | 旧来の指定。既定1拍 |

`seconds`・`beats`・`duration` は、一つの音符で同時に指定しない。
「BPM」は速さの設定であり、待機の単位は「拍」と呼ぶ。

### tween の説明改善

以前の `tween(seconds, fn)` と callback の `t` だけでは、引数の意味が伝わりにくかった。
型定義では `durationSeconds`・`onUpdate`・`progress` を用い、引数・戻り値・例を追記した。
Monaco のホバーと引数説明にも反映した。

```js
const durationSeconds = 4;
await tween(durationSeconds, progress => {
  // 開始時0、半分まで進むと0.5、終了時1。
  const elapsedSeconds = progress * durationSeconds;
});
```

0〜1の進行度を用いることは一般的だが、すべての tween API が callback にそれを渡すという共通仕様ではない。
これは Playground の API の形であり、説明を必要とする。

## サンプル・ストリーム再生

| API・オプション | 単位 | 意味 |
|---|---|---|
| `sample.play(..., {offset})` | 素材内の秒 | 開始位置。逆再生では末尾からの距離 |
| `sample.play(..., {duration})` | 素材内の秒 | 再生する範囲の長さ。実際の所要時間は playbackRate に依存 |
| `sample.play(..., {loopStart, loopEnd})` | 素材内の秒 | 元のファイル先頭を基準にしたループ範囲 |
| `sample.play(..., {fadeIn, fadeOut})` | 秒 | フェードの長さ |
| `stream.play(..., {offset})` | 素材内の秒 | 再生開始位置 |
| `stream.play(..., {fadeIn})` | 秒 | フェードインの長さ |
| `fm.dac.play(..., {when})` / `playFromSample` | 音声時計の秒 | 絶対開始時刻。省略時は即時 |
| DAC の `{offset, size}` | サンプル数 | 8bit mono PCMの開始位置・再生する長さ |

`playbackRate` は時間ではなく再生速度の倍率。
例えば素材内の2秒分を速度2で再生すると、通常の再生では約1秒になる。
サンプル情報の `duration` など、取得結果に含まれる時間も単位の説明をそろえたい。

**要確認・整理：** `PlaygroundStreamPlayOptions` には `fadeOut` があるが、確認した `playLoadedStream` の再生処理では使用していない。
型定義と実装の対応を見直す。今回の棚卸しでは修正していない。

## FX・ノイズ

| API・オプション | 単位 | 意味 |
|---|---|---|
| パラメーターの `.rampTo(value, seconds)` | 秒 | 値を変化させる所要時間 |
| `fx.delay({time})` | 秒 | 遅延時間 |
| `fx.compressor({attack, release})` | 秒 | 応答時間 |
| `fx.gate({attack, hold, release})` | 秒 | 応答時間・保持時間 |
| `fx.flanger({time, depth})` | 秒 | 基本遅延・遅延の揺れ幅 |
| `fx.chorus({time, depth})` | 秒 | 基本遅延・遅延の揺れ幅 |
| `fx.wobble({rate})` | **拍／周期** | 揺れ1周の長さ |
| `fx.flanger({rate})` | **拍／周期** | 揺れ1周の長さ |
| `fx.chorus({rate})` | **拍／周期** | 揺れ1周の長さ |
| `fx.slicer({phase})` | **拍／周期** | 刻み1周の長さ |
| `noise.create({attack, release})` | 秒 | 音量が立ち上がる・消える時間 |
| `noiseControl(voice, {slide})` | 秒 | パラメーター変更の所要時間 |

FX の周期は、native 側へ渡す際に `1 / (周期の拍数 × 1拍の秒数)` で周波数に変換している。
公開 API の `rate` と、内部処理の Hz は区別する。
同じ `depth` でも、flanger / chorus は秒、wobble は周波数の幅であり、FX の種類ごとの説明が必要。

## 予約・譜面・スケジューラー

| API・項目 | 単位 | 意味 |
|---|---|---|
| `fm.scheduleWrites` の `time` | 音声時計の秒 | レジスター書き込みの絶対時刻 |
| `scheduleWritesSamples` の開始値・offset | 44,100 Hzのサンプル数 | 基準位置と、それからの書き込みオフセット |
| `dac.playStream` の `atSamples` | サンプル数 | 再生予約位置 |
| `dac.schedule` / `scheduleBase64` | サンプル数 | DAC書き込みの予約位置 |
| MIDI譜面イベントの `at` | 拍 | 譜面内の位置 |
| MIDI譜面イベントの `duration` | 拍 | 音符の長さ |
| MIDI曲の `tempos[].beat`・`endBeat` | 拍 | テンポ変更位置・曲の終了位置 |
| `midi.createTimeline().waitUntil(seconds)` | 秒 | タイムライン作成時を基準にした到達時刻 |
| `setTiming({lookaheadSeconds})` | 秒 | 先読み幅 |
| `setTiming({schedulerIntervalMs})` | ミリ秒 | 予約を補充する間隔 |
| `setDacLookahead(seconds)` | 秒 | DACの予約余裕 |
| YM2608 `prepareTimeline`、YM2203 `scheduleRegisters` | サンプル数 | 書き込み位置・全体の長さ |
| PWM `scheduleWrites` の `frame` | 出力サンプルレートのフレーム数 | 書き込みオフセット。VGMの44,100 Hz単位とは異なる |

予約 API を変更する前に、開始値・offset の原点、各チップの基準レート、Main / Worker の対応を個別に確認する。
`waitUntil` は JavaScript の待機であり、サンプル精度の音声予約とは区別する。

## 基準クロック・テンポ・サンプルレート

時間の長さを指定する API に加え、時間の換算や音源動作の基準を設定する API もある。

| API・項目 | 単位 | 意味 |
|---|---|---|
| YM2608 の `setClock(clock)` | Hz | 音源チップの基準クロック周波数 |
| 独立 YM2203 の `setClock(clock)` | Hz | 音源チップの基準クロック周波数 |
| NES の生成オプション `clock` | Hz | 音源エミュレーションの基準クロック |
| `setBpm(bpm)` | 拍／分 | 拍を秒へ換算するテンポ |
| `sleepSamples` の `sampleRate` | サンプル／秒 | サンプル数を待機時間へ換算する基準 |
| DAC の登録・再生オプション `sampleRate` | サンプル／秒 | PCM の再生レート |
| `hzToBlockFnum(hz, clock?)` の `clock` | Hz | 音の周波数をチップの BLOCK / F-NUM へ換算する基準 |

`setClock` の clock は「現在時刻」ではなく、チップを駆動するクロックの周波数。
同じレジスター値でも、基準クロックを変えると音程やチップ内部の時間特性が変わる。
`setClock` で `sleep` の秒や `sleepSamples` の既定44,100 Hzが自動で変わるわけではない。
呼び出せるチップは公開型・実装ごとに異なり、すべての音源に共通のメソッドとして扱わない。

基準クロック、音声出力のサンプルレート、VGM の時間単位、演奏テンポを混同しないよう、説明をそろえたい。

## チップ固有の設定値

FM の `ar`・`rr`、PSG の period、Game Boy の envelope / sweep の period、NES の envelope / sweep の period などは、秒数ではなくチップ固有の設定値。
秒・拍・サンプル数による高水準の時間指定と、raw なチップ設定を区別する。
音源の周波数 Hz や sampleRate 自体も、所要時間とは別の量として扱う。

## API の整理案

### 案A：呼び出し時に単位を明示するオブジェクト形式

```js
// 提案。現在は未実装。
await sleep({seconds: 2});
await sleep({beats: 4});
await sleep({samples: 44100, sampleRate: 44100});
await tween({beats: 4}, progress => { /* ... */ });
```

利点は、呼び出し箇所で単位が分かること。
複数単位の同時指定を拒否するルールや、BPM変更時の扱いを決める必要がある。
ユーザーからは、sleep 内の分岐による処理負荷への懸念があった。
単発の分岐は既存の待機処理に比べて小さいと考えられるが、オブジェクト生成も含め、細かい待機を大量に行う用途では計測して判断する。

### 案B：関数名で単位を明示する

```js
// 提案。sleepSamples 以外は、この名前での追加は未実装。
await sleepSeconds(2);
await sleepBeats(4);
await sleepSamples(44100);
```

単位選択の分岐や指定用オブジェクトを増やさず、内部の待機処理を共有できる。
関数名が増える点と、既存の `sleep`・`beat` との関係を整理する必要がある。

両案とも、既存コードとの互換性をどう保つかを決めてから進める。
絶対時刻と所要時間を同じ指定方法にまとめるかは、別途検討する。

## 優先したい検討・作業

- [ ] 秒・拍・サンプル数の書き方を決める。
- [ ] `duration` が秒と拍で異なる既存 API の扱いを決める。
- [ ] FX の `rate`・`phase` など、名前と意味が一致しにくい箇所を整理する。
- [ ] 予約 API の絶対時刻・相対位置・基準時計・サンプルレートを明記する。
- [ ] `setClock`・`setBpm`・`sampleRate` の役割と、変更が影響する範囲を明記する。
- [ ] サンプル再生の「素材内の秒」と「実際の所要時間」を説明する。
- [ ] 型定義にある `stream.fadeOut` と実装の不一致を確認する。
- [ ] 型定義、補完・ホバー・引数説明、例コードの表記をそろえる。
- [ ] 実装変更時は Main / Worker の両方と、既存 VGM 変換コードを確認する。
- [ ] 分岐・オブジェクト形式の性能は、代表的な実行負荷で測定する。

## 主な確認箇所

- `docs/playground/tetorica-playground-globals.d.ts`：公開 API。
- `docs/playground/playground_monaco.js`：ホバー・引数説明。
- `web/playground_clock.js`、`web/playground_logic_worker.js`：待機・tween。
- `web/native_fx.js`、`web/native_fx_engine.js`：FX の単位と周期変換。
- `web/native_sample.js`、`native/audio_effect/sample.c`：素材内の時間・フェード。
- `web/native_noise.js`、`native/audio_effect/noise.c`：ノイズの時間指定。
- `web/tetorica_audio_runtime.js`：stream の再生処理。

## 共有拍時計の実装記録（2026-10-13）

### 採用仕様

- BPM は実行中の Playground 全体で共有する。liveLoop ごとの局所 BPM は追加しない。
- `setBpm(number)` は呼び出した時点から有効。現在の拍位置を保ち、拍待機の終了時刻を再計算する。整数拍へ丸めたり、nextBeat を自動挿入したりしない。
- `beat(n)` と `nextBeat()` は、Main / Worker とも待機中の BPM 変更に追従する。
- `nextBeat()` の原点は共有の音楽時計。liveLoop では現在の拍位置とループの cursorBeat の大きい方から、次の整数拍へ進む。
- `play(..., {beats})` と MIDI output の `play(..., {beats})` は、鳴っている途中の BPM 変更に追従する。`{seconds}` は追従しない。
- `tween({beats:n}, onUpdate)` の進行度は、開始から経過した拍数 / n。`tween({seconds:n}, onUpdate)` は開始から経過した秒数 / n。
- callback の progress は0〜1。正の長さでは開始時0、単調に進み、終了時1を一度だけ呼ぶ。長さ0では1だけ。async callback を待つ。停止・失敗時は最終1を強制せず reject する。
- `sleep`・`sleepSamples`・VGM の44,100 Hz単位・音声時計の絶対予約は、BPM 変更で伸縮させない。
- `beat` / tween の長さは有限の非負数。BPM は有限の正数で、換算時刻を表現できることを検証する。文字列への暗黙変換をしない。
- 秒／拍の tween 指定と音符長は、型定義で排他的にし、実行時も競合指定を拒否する。

共有 clock と tween の計算は `web/playground_clock.js` に集約。Worker はその共通計算を利用し、既存の停止・loop 所有権の判定は各経路で維持する。
Worker の BPM 通知は Main の command queue を迂回し、待機中の Main 依頼音符にも変更が届くようにした。
ホスト用の runtime に `setBpm` / `getBpm` を追加し、Worker 実行時には変更を転送する。初回 Worker 起動時も Main の BPM を引き継ぐ。

### API・移行表

| API | 時間基準・BPM追従 | 移行 |
|---|---|---|
| `beat(n)` / `nextBeat()` | 共有拍時計。待機中も追従 | 名前は維持。待機中のテンポ変更時の動作を改善 |
| `play(note, {beats:n})` | 音符開始からの経過拍。途中変更に追従 | 明示的な拍指定を推奨 |
| `play(note, {seconds:n})` | 音符開始からの秒。非追従 | 名前は維持 |
| MIDI output の `play` | seconds / beats は通常 play と同じ動作 | 明示的な単位を推奨 |
| `tween({seconds:n}, onUpdate)` | 経過秒。非追従 | `tween(n, fn)` の標準的な置き換え |
| `tween({beats:n}, onUpdate)` | 経過拍。途中変更に追従 | 新規追加 |
| `tween(n, fn)` | 秒。非追従 | 秒指定の短い書き方として維持。非推奨扱いにしない |
| runtime の `setBpm` / `getBpm` | 実行中の共有テンポ | ホスト用に追加。コード内の pg の追加メソッドとは別 |

今回の変更では旧 `duration` の削除と既定長の統一は行っていない。
通常 play の既定は0.2秒、MIDI output は1拍。旧 duration の単位も通常 play は秒、MIDI output は拍。
これは互換用の既存仕様として残し、API 全面整理の別課題とする。
不正な beat / tween / BPM 値を暗黙に補正・変換していたコードは、明示的なエラーになる場合がある。

### 制約と残課題

- 秒の時計は Main では AudioContext.currentTime（未初期化時は performance.now）、Worker では performance.now。ブラウザが JS を止める状況も含め、サンプル精度の実行は保証しない。
- 通常 play と MIDI output.play は JS 待機後に note-off する。音声側に送信済みの絶対時刻を再予約する方式ではない。
- MIDI ファイルの再生と createSongPlayer の譜面テンポは、今回共有 BPM に追従する対象へ変更していない。録音済み音声サンプルの速度も自動変更しない。
- native FX は BPM 通知で既存周期パラメーターを Hz に再換算する。FX を作り直さず位相を保持する。反映は音声処理が通知を受けたブロックからで、JS の変更時刻との完全な同時性は保証しない。
- FX の `rate` / `phase` → `periodBeats` 改名、予約の名前整理、stream.fadeOut の整合は未実施。他音源への setClock 追加は下記の追記で対応。
- 低水準の createPlaygroundMusic / createMidiApi を別ホストで使う場合、拍追従には waitBeats の注入が必要。Playground では両経路に接続済み。未注入の既存ホストは開始時 BPM の秒換算を維持する。

### 検証

- 決定的な時計による Main / Worker テスト：拍位置維持、120→60の待機再計算、nextBeat、拍／秒 tween、通常・MIDI音符、秒／サンプルの独立、キャンセル、callback 失敗、FX 周期の Hz 換算。
- Chromium 実ブラウザ：Main / Worker とも途中で120→60へ変更。拍指定音符・beat・tween の終了が約0.85秒へ延び、0.5秒指定とサンプル数指定は約0.5秒のままになることを確認。
- 関連回帰テスト209件成功。npm パッケージビルドと JSDoc 宣言194件の生成・検査成功。NodeNext / Bundler / ブラウザ用型検証成功。
- Playground の型検証で seconds / beats の同時指定と tween の単位未指定が拒否されることを確認済み。
- npm tarball の単独インストール、15種類の音源レンダリング、23種類の WASM エンジン、公開 exports / asset URL を確認。itch.io 用 ZIP の生成と305件のローカル参照検査も成功。
- ビルド中に見つかった既存 MSM5205 constructor の clock 型注釈不足を補修。実行動作は変更していない。
- Windows / Linux の Tauri 実機は未検証。今回 Tauri の Rust コードや配布リリースは変更していない。

性能の参考計測（Node.js v25.2.1、ローカル、一回の測定）：オブジェクト生成を含む音符長検証50万回は seconds 約27.7 ms、beats 約32.2 ms。callback / await を含む長さ0の tween 2万回は数値約4.9 ms、秒オブジェクト約5.5 ms、拍オブジェクト約5.6 ms。
これは引数処理の参考値であり、実音声・大量の同時ループの負荷測定ではない。オブジェクト形式を避ける必要があるという結果にはなっていない。

新しい使用例は `/examples/basic/tempo-follow.js`。既存 slicer の tween 例と紹介ページは `{seconds}` 形式へ移行し、例コードの生成物も更新した。


## 2026-10-13 追記：Playground の10音源に setClock

`await chip.setClock(hz)` と読み取り専用の `chip.clock` を、useSoundChip / createSoundChip の全10音源へ追加。選択中の既定 FM と独立音源、Main と Worker の両経路が対象。

| 音源 | 既定クロック（Hz） |
| --- | ---: |
| YM2612 | 7,670,454 |
| YM2203 | 4,000,000 |
| YM2610 | 8,000,000 |
| YM2608 | 8,000,000 |
| YM2151 | 3,579,545 |
| Sega PSG | 3,579,545 |
| Game Boy | 4,194,304 |
| NES APU / FDS | 1,789,773（生成時の clock 指定を優先） |
| RF5C164 | 12,500,000 |
| 32X PWM | 23,011,361 |

### 動作

- 整数100,000〜100,000,000 Hzを受け付ける。NaN、Infinity、範囲外、非整数は Promise の拒否。既存 YM2203 / YM2608 の受け付け範囲もこれに拡張。
- 音声側の適用完了を await できる。チップのレジスター、音源メモリー、キーオン状態を維持し、チップを再生成しない。reset はクロック設定を維持する。
- 書き込み済みの raw 音程はクロック比に応じて上下する。チップ内部の envelope、LFO、noise、PCM 読み出しも速さが変わる。setNote / setFrequency 等の新しい高水準指定は更新後クロックで計算する（ハードウェアの表現範囲内）。FM の raw BLOCK / F-NUM や OPM の raw KeyCode / KeyFraction は変換しない。
- 通常 play と MIDI output の新しい FM 音符も更新後クロックで換算する。録音された MIDI ファイルの予約済みレジスター値を後から再計算する機能ではない。
- 出力 sampleRate、BPM、sleep / beat / tween の進行、44,100 Hz の VGM sample timeline、PWM の出力フレーム予約は変化しない。予約済み書き込みは元の時刻・値で実行する。
- 既定 YM2612 のクロックを変えても、同時に鳴る内蔵 Sega PSG のクロックは変えない。独立 PSG の setClock はその音源だけに反映する。
- NES の変更は既存 NTSC / PAL コアの進行速度の変更。途中で地域固有のテーブルを入れ替える操作ではない。PAL の初期化には引き続き生成時の clock オプションを使う。

### 実装と確認

OPN / OPM はネイティブ生成レートを変更して既存状態を維持。固定レートの GB / PSG / NES / RF5C164 はコアの進行フレーム数をクロック比で変換し、出力時間軸を維持。PWM は内部の master clock を更新。共有の検証・要求応答・固定レート変換は playground_chip_clock.js に集約した。

Monaco が読む型定義、npm 向け JSDoc 宣言、itch 配布リスト、web / docs の両実装を更新。使用例は `/examples/chip-raw/chip-clock-sweep.js`。数値版 tween の秒指定で、鳴っている PSG のクロックを連続変更する。

- 関連回帰テスト210件成功。実 GB の持続音は440→220 Hz、新しい周波数指定は440 Hzへ戻ることを確認。
- npm パッケージのビルド・JSDoc宣言195件・単独インストール・15音源 / 23 WASM・型検証、Playground型検証、itch ZIPの327参照検査が成功。
- Chromium の Main / Worker で全10音源のクロック変更・復帰・不正値拒否、および選択中 FM の変更を確認。
- Windows / Linux および Tauri 実機の音声出力は未確認。Tauri の Rust・配布物・バージョン指定は変更していない。
