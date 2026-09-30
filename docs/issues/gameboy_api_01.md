# Game Boy 高水準API案

全体の対応状況：[機能一覧](../feature-status.md)。この文書は本機能の詳細・作業記録。

## 状態と目的

itch.io向け **v0.40.11を公開済み**（ユーザー報告、2026-09-30）。
Game Boy音源のVGM/VGZ→JavaScript変換（raw／解説付きraw／High-level API＋raw fallback）と、
チップ判定後の変換オプション表示を含む。公開先の配布物照合・ブラウザー聴感確認は未実施。

初版実装済（2026-09-29）。自動テスト・WAV生成・Playground配布確認を実施。ブラウザーでの聴感確認は未実施。
`createSoundChip('gameboy')` でpulse／wave／noiseと既存raw APIを利用できる。
既存実装は [playground_gameboy_raw_01.md](playground_gameboy_raw_01.md) を参照。

レジスタを直接操作する入口を維持しながら、音程・音量・波形などを
チップの機能に沿った名前で設定できるようにする。
Node.jsとPlaygroundで同じ音源操作コードを使えることを目標にする。

## 即時設定APIへの改訂（2026-09-30）

音色解析で得た「発音時の設定＋発音後のレジスタ変更」をJavaScriptで表現できるよう、
設定操作と発音トリガーを分離した。以下を現行契約とし、後段の初版設計・実装記録は履歴として扱う。

### 現行APIとレジスタ対応

| API | レジスタ | 反映・副作用 |
|---|---|---|
| `pulse.setDuty(ch, duty)` | NR11 / NR21 bit 7–6 | 即時。長さ設定を保持し、再トリガーしない |
| `pulse.setEnvelope(ch, {volume, direction, period})` | NR12 / NR22 | 即時。初期音量・方向・周期をまとめて1回書く。再トリガーしない |
| `pulse.setSweep({direction, period, shift})` | NR10 | 即時。内部スイープ状態の再初期化とは別 |
| `pulse.setVoice(ch, options)` | NR11/12 または NR21/22 | 個別設定をまとめる便宜API。全引数検証後、対象レジスタへ各1回即時書き込み |
| `noise.setEnvelope({volume, direction, period})` | NR42 | pulseと同じ契約 |
| `noise.setParameters({divisor, shift, width})` | NR43 | 即時。分周・シフト・7/15bitを部分更新、再トリガーなし |
| `noise.setVoice(options)` | NR42 / NR43 | 一括即時設定。自動トリガーなし |
| `wave.stopAndSetWaveform(samples)` | NR30 / 波形RAM | 検証後DAC停止→転送。再発音は明示的なkeyOnが必要 |
| `wave.setWaveform(samples)` | 同上 | 互換エイリアス。こちらも停止する |
| `setFrequency` / `setNote` / `wave.setLevel` / pan / master | 従来どおり | 即時、再トリガーなし |
| `keyOn` / `keyOff` | 従来どおり | 保存設定を適用してトリガー／DAC停止。keyOnは長さ制御を無効化 |

`setEnvelope`のvolumeは整数0〜15、directionはup/down、periodは整数0〜7。
省略値は設定値を保持する。空オブジェクトは何も書かない。不正な値は書き込み・設定変更前に拒否する。
`setDuty`は0.125/0.25/0.5/0.75。noise各値の範囲も初版と同じ。

### エンベロープ・スイープの意味

- `setEnvelope`は現在音量を直接指定するAPIではない。発音中の書き込みは採用コアの
  ハードウェア挙動に従い、内部音量の変化やDAC停止が起こり得る。初期音量から再開始するにはkeyOnを使う。
- volume=0かつupもレジスタ値どおり送信する。初版の「volume=0なら強制消音」は撤廃。
  確実な停止はkeyOffを使う。volume=0かつdownはDAC停止となる。
- NR10への即時書き込みも内部スイープのタイマーや計算用状態をリセットしない。
  方向変更でチャンネルが停止する等のハードウェア挙動を隠さない。
- keyOff後も設定は保存する。setDutyやnoise.setParametersだけではDACを復帰しない。
  setEnvelopeは保存した残りの項目と合成してレジスタ全体を書き、DACを有効にする場合もあるが、トリガーは送らない。
- 設定状態は現在の内部音量・音程の読み出しではない。raw操作も同じSynth経由で行う。
- 即時とはtransportへ同期送信すること。Worklet適用完了やサンプル単位の時刻精度は保証しない。

### 発音中の変更例

```js
const gb = await createSoundChip('gameboy');
try {
  gb.initialize();
  gb.pulse.setDuty(0, 0.25);
  gb.pulse.setEnvelope(0, {volume: 12, direction: 'down', period: 0});
  gb.pulse.setNote(0, 'C4');
  gb.pulse.keyOn(0);
  await sleep(0.1);
  gb.pulse.setDuty(0, 0.5); // 発音を継続したままデューティ変更
  await sleep(0.1);
  gb.pulse.setEnvelope(0, {period: 2}); // レジスタ更新。自動で再トリガーしない
  gb.pulse.keyOn(0); // この例では明示的に初期音量から減衰を開始
  await sleep(0.4);
  gb.pulse.keyOff(0);
} finally {
  gb.dispose();
}
```

### 互換性と確認範囲

メソッドの削除はないが、setVoice/setSweepは遅延から即時へ変わるため挙動変更となる。
発音中に次回分を予約していたコードは、必要な時刻まで呼び出しを遅らせること。
既存の「設定→keyOn」コードはそのまま使える。初期化は引き続き無音・未トリガー。

実コアの持続音でraw書き込みとのPCM一致、トリガー非送信、無関係ビット保持、
複数エンベロープ項目の1回書き込み、不正入力の原子性、ライフサイクルを確認。
関連7テストファイルで62件成功・失敗0。Workletでの新サンプル再生とWorkerのRun/Stop/再Runも成功。
ブラウザーでの聴感確認は未実施。
音色解析画面・時間変化の抽出・FUI出力は今回の変更範囲に含めない。

参考：[Pan Docs Audio Registers](https://gbdev.io/pandocs/Audio_Registers.html)、
[Audio Details](https://gbdev.io/pandocs/Audio_details.html)。

## Playground Import VGMのチップ別変換（2026-09-30）

読み込み・VGZ展開／S98変換→チップ判定→対応するオプション画面→Convertで確定、の順に変更。
解析中・キャンセル時はプロジェクトを書き換えない。解析済み入力を確定時にも使う。

- OPN系：Schedule / Write / Highの3モードとDAC、CH分割オプションを提供。
  Import画面からCompact Note-ishと専用の発音開始補正を撤去。Highの任意のNote-ishは維持。
  OPNが1種類なら他チップとの混在もFM部分を取り込める。YM2612＋PSGはInclude PSGでPSGも変換し、
  RF5C164等の省略する他チップを画面に列挙する。
  YM2612のDACは既存のInclude DACに従う。省略対象側のデュアルチップは取り込みを妨げない。
- Game Boy：raw書き込み、時刻・レジスタ解説付き、High-level API＋raw fallbackの3方式。全4CH、1周分。
  44,100 Hzのサンプル単位で待ち時間を出力し、最後の待ち時間も残す。
- OPNが複数種類ある組み合わせ／変換対象のデュアルチップはConvertを無効化。
  Game Boyは現行Playgroundと同じ4,194,304 Hz、直接書き込みとwaitのみを対象とし、
  他チップのコマンドやストリーム等を黙って省略しない。
- Game Boyのコードは独立したcreateSoundChip('gameboy')を生成し、finallyでdisposeする。
  OPN用TFI抽出は呼ばない。元の電源操作・トリガー・波形RAM操作をそのまま残す。

解説には初期音量・エンベロープ周期・デューティ・スイープ・設定上の音程・
ノイズ設定・波形データ等を表示する。内部音量／スイープ後の現在音程の推測ではない。
High-level APIではレジスタ書き込み列が一致する操作だけを変換する。
エンベロープ・スイープ・デューティ・ノイズ・wave level・master volume・panを対象とし、
対象外ビットが変わる場合はrawを残す。周波数は同時刻に隣接する下位→上位の2書き込みで、
トリガーなし・長さ制御等の他ビットが変わらない場合だけsetFrequencyにまとめる。
単独の周波数更新、電源、トリガー、波形RAM書き込みはrawのまま保持する。
コメントには秒とVGMサンプル位置を併記する。ビブラート推定、時間グラフ、ループ反復は未実装。

`gb.adoptRegisterState()`を追加。NR52がONであることを検証し、同じSynth経由で
追跡したraw書き込みを高水準操作の設定として採用する。レジスタ送信・reset・既定値の注入はしない。
内部エンベロープ／スイープ状態の読み出しではなく、Synthを迂回したコア操作も取り込まない。
resetまたはNR52 OFF後は再び高水準操作を無効化。生成コードは各NR52 ON書き込み直後に
adoptRegisterStateを呼び、元データの電源サイクルをそのまま再現する。
sleepSamplesは非同期待ちであり、この独立チップへのサンプル精度の予約再生ではない。

自動テストでチップ別表示・確定・キャンセル・不正入力・非同期解析の競合、
VGM/VGZ、生成コードの書き込み順／時刻／終了待ち／解放、実コアPCM一致を確認。
ブラウザー接続先がなく実画面確認は未実施。既存OPN変換のDACストリームテスト1件は
本変更前からの失敗が継続している。関連4ファイルの16テストは成功。
itch.io向け配布物の生成・依存ファイル検証も成功（公開はしていない）。

## 初版設計・実装の履歴

以下は2026-09-29時点の記録。遅延設定・volume=0の扱いは上記の改訂で置き換えた。

## APIの層

1. **raw API**：`writeRegister(offset, value)`。既存の低レベル例をそのまま使える。
2. **チップ固有のSynth API**：矩形波・波形RAM・ノイズを設定し、物理CHを発音する。今回の対象。
3. **演奏用API**：拍・音の長さ・自動CH割り当て。将来、Synthの上に追加する。音名→音程の`setNote()`は初版Synthに含める。

最初から全チップを同じ楽器APIにまとめず、Game Boyの制約や音作りの特徴を見える形で残す。
`play('C4', {duration: ...})` のような便宜機能やMIDI連携は別段階にする。

## 使用例（提案）

```js
const gb = await createSoundChip('gameboy');
try {
  gb.initialize();
  gb.pulse.setVoice(0, {
    duty: 0.5,
    volume: 10,
    envelope: {direction: 'down', period: 2},
  });
  gb.setPan(0, true, true);
  gb.pulse.setFrequency(0, 440);
  gb.pulse.keyOn(0);
  await sleep(0.5);
  gb.pulse.keyOff(0);
} finally {
  gb.dispose();
}
```

`pulse` のCH番号は0 / 1（物理CH1 / CH2）。`wave`と`noise`は各1CHなので番号を取らない。
チップ全体の `setPan()` は0〜3を取り、順にpulse 1 / pulse 2 / wave / noiseへ対応する。

```js
gb.wave.setWaveform([
  0, 1, 2, 3, 4, 5, 6, 7,
  8, 9, 10, 11, 12, 13, 14, 15,
  15, 14, 13, 12, 11, 10, 9, 8,
  7, 6, 5, 4, 3, 2, 1, 0,
]);
gb.wave.setLevel(0.5);
gb.wave.setFrequency(220);
gb.wave.keyOn();
```

波形は32個の0〜15の整数を受け取り、内部で16バイトへ詰める。
Node.jsではPlaygroundの `sleep()` の代わりに `chip.generateStereo()` で時間を進める。

## 操作の整理

| API案 | 役割 |
| --- | --- |
| `gb.pulse.setVoice(ch, options)` | デューティ・初期音量・エンベロープの設定 |
| `gb.pulse.setFrequency(ch, hz)` | Hzからチップの周波数値へ変換 |
| `gb.pulse.setSweep(options)` | 物理CH1専用のスイープ。CH引数を設けず制約を明示 |
| `gb.pulse.keyOn(ch)` / `keyOff(ch)` | 発音のトリガーと停止 |
| `gb.wave.setWaveform(samples)` | 32サンプルの波形RAM設定 |
| `gb.wave.setLevel(level)` | チップが対応する段階的な出力レベル |
| `gb.wave.setFrequency(hz)` | 波形チャンネルの音程 |
| `gb.wave.keyOn()` / `keyOff()` | 波形チャンネルの発音と停止 |
| `gb.noise.setVoice(options)` | 初期音量・エンベロープ・分周・シフト・7/15 bitモード |
| `gb.noise.keyOn()` / `keyOff()` | ノイズの発音と停止 |
| `gb.setPan(ch, left, right)` | 各物理CHの左右出力の有効・無効 |
| `gb.setMasterVolume(left, right)` | チップ内の左右マスター音量。Playground全体の音量とは別 |
| `gb.writeRegister(offset, value)` | 0xFF10からの相対アドレスで直接書き込み |
| `gb.reset()` / `dispose()` | 初期化と所有リソースの解放 |

メソッド名・オプション構造は末尾の具体仕様に従う。
連続的に指定できない値は任意の数値を受けず、対応値を型と検証で明示する。
周波数の量子化・範囲外の扱い、エンベロープのperiod=0の意味も文書化する。

## 共有実装

- `GameboySynth`：レジスタ生成、設定状態、引数検証。DOMやAudioContextに依存しない。
- `GameboyDirectTransport`：既存 `GameboyApu` に同期で書き込む。Node.jsのWAV例で使用。
- Playground用transport：既存の専用MessagePortでWorkletへ書き込む。
- `createSoundChip('gameboy')` の戻り値へSynthの機能を追加し、既存raw APIとの互換性を保つ。
- 音源の生成・解放はホスト側が所有する。Direct Synthとchipの二重解放を避ける。

レジスタの読み書きと時間経過による実コアの状態を区別する。
Synthが持つ設定値を、エンベロープやスイープの現在値として返さない。

## 設計時の論点

以下は初期検討メモ。具体的な契約は末尾の「Playground向け初版の具体仕様」を参照。

- **raw操作との混在**：Synth経由のraw書き込みを設定状態へ反映し、後続の部分更新で他のビットを壊さない。
  チップへ直接書いてSynthを迂回する場合の扱いも明記する。
- **発音停止**：Game Boyには汎用的なrelease操作がないため、keyOffの実現方法を決める。
  DAC停止などを使った場合も、再keyOnで設定が復元されるようにする。
- **波形RAM更新**：再生中の書き換えをどう扱うかを定義する。停止して転送し、勝手に再発音しない案を検討。
- **長さカウンター**：チップの長さ制御と `sleep()` / 拍による停止を分ける。
  初期段階で公開するか、raw APIへ委ねるかを決める。
- **電源とreset**：NR52、音量、パン、波形RAMの初期状態を明示する。
- **通信順序**：設定→波形転送→トリガーの順序を同じポートで維持する。
  同期の「受付」と実コアへの「適用完了」は区別する。
- **タイミング**：既存の即時ポート書き込み方式を使う。サンプル単位の予約機能は今回の対象外。

## 実装・検証手順

- [x] 名前・引数範囲・初期値・keyOffと再トリガーの仕様を確定する。
- [x] GameboySynthとDirectTransportを実装する。
- [x] Node.jsに高水準API版のWAV例を追加する。既存raw例は比較用に残す。
- [x] Playgroundの戻り値へ接続し、型定義・補完・配布設定を更新する。
- [x] 高水準API用の例を追加する。`examples/chip-raw/` はraw操作の例として維持する。
- [x] 周波数・左右出力・波形パッキング・ノイズモード・無効引数をテストする。
- [x] raw操作との混在、CH1専用スイープ、停止後の再トリガー、resetをテストする。
- [x] raw版と高水準版で同じ設定の実コア出力を比較する。
- [ ] ブラウザーのWorker / メイン双方でRun・Stop・再Run・disposeを試聴確認する（Workerライフサイクル・メイン構文・Worklet発音の自動テストは実施済）。
- [ ] ブラウザーで試聴し、他の音源との併用を確認する。

最初の到達点は「raw例と同じ演奏を、レジスタ番号を使わず短く書けること」。

## Playground向け初版の具体仕様（2026-09-29・実装前レビュー案）

以下を初版の実装契約とする。末尾の補足で量子化・mute・raw同期の修正を反映した。
冒頭の使用例も、発音準備を`gb.initialize()`に更新した。
音名指定の`setNote()`は初版に含める。拍・duration・自動チャンネル割り当ては後段とする。

### Playgroundでの書き方

```js
const gb = await createSoundChip('gameboy');
try {
  gb.initialize();
  gb.pulse.setVoice(0, {
    duty: 0.5,
    volume: 10,
    envelope: {direction: 'down', period: 2},
  });
  gb.pulse.setNote(0, 'C4');
  gb.pulse.keyOn(0);
  await sleep(0.25); // 秒。拍で進める場合は既存の await beat(1)。
  gb.pulse.keyOff(0);
} finally {
  gb.dispose();
}
```

初版は各物理CHを明示して使う。pulse 0／1は矩形波CH1／CH2、waveはCH3、noiseはCH4。
同じCHで`keyOn()`すると再トリガーする。自動で空きCHを探したり、和音を割り当てたりしない。

### API契約

| API | 引数・動作 |
|---|---|
| `initialize()` | コアをresetし、電源ON・全CH停止・既定の音色／周波数／波形／パン／音量へ初期化 |
| `reset()` | 既存raw APIの意味を維持。コアをresetして電源OFFに戻す。Synth設定も未初期化へ戻す |
| `pulse.setVoice(ch, options)` | chは0／1。次回トリガー用の音色設定を部分更新。発音中のレジスタには直ちに反映しない |
| `pulse.setSweep(options)` | pulse 0専用。次回トリガー用の設定。pulse 1には適用しない |
| `pulse.setFrequency(ch, hz)` | 周波数を設定し、発音中ならトリガーせず周波数レジスタを更新。量子化後のHzを返す |
| `pulse.setNote(ch, note)` | 音名またはMIDI番号をHzに変換して`setFrequency`と同じ処理。量子化後のHzを返す |
| `pulse.keyOn(ch)` / `keyOff(ch)` | 保存した音色・音程でトリガー／DAC停止。releaseエンベロープではなく即時停止 |
| `wave.setWaveform(samples)` | 32個の4-bit値。検証後、wave DACを停止してRAMへ転送。自動再発音しない |
| `wave.setLevel(level)` | 0／0.25／0.5／1のみ。発音中にも反映する |
| `wave.setFrequency(hz)` / `setNote(note)` | トリガーせず音程更新。量子化後のHzを返す |
| `wave.keyOn()` / `keyOff()` | 保存した周波数・出力レベルでトリガー／DAC停止 |
| `noise.setVoice(options)` | 次回トリガー用の音量・エンベロープ・ノイズ設定を部分更新 |
| `noise.keyOn()` / `keyOff()` | ノイズをトリガー／DAC停止。音名指定は提供しない |
| `setPan(ch, left, right)` | chは0〜3、left／rightはboolean。他CHの左右接続を保持して即時更新 |
| `setMasterVolume(left, right)` | 左右とも整数0〜7。NR50の出力設定。0も完全消音ではない。完全消音はパンOFFまたはkeyOff |
| `writeRegister(offset, value)` | 既存API。offsetは0〜0x2f、valueは0〜255の整数。0xFF10からの相対位置 |
| `dispose()` | 既存の所有権・停止処理を維持。繰り返し呼び出し可。それ以外の操作は破棄後に例外 |

`setFrequency`／`setNote`以外の設定・トリガー操作の戻り値は`undefined`。
操作は同期受付で、Workletへの反映完了を返すPromiseではない。同一ポート内の順序は維持する。
`await createSoundChip()`以外に新しいタイマーや非同期演奏キューは導入しない。

### 値の範囲・既定値

| 設定 | 許容値 | initialize時の既定値 |
|---|---|---|
| pulse `duty` | 0.125／0.25／0.5／0.75 | 0.5 |
| pulse／noise `volume` | 整数0〜15 | 10 |
| `envelope.direction` | `'up'`／`'down'` | `'down'` |
| `envelope.period` | 整数0〜7。初版は0を自動音量変化なしとして使う | 0 |
| sweep `direction` | `'up'`／`'down'`。周波数レジスタ値の増減方向 | `'up'` |
| sweep `period`／`shift` | 各整数0〜7。実チップの設定値を直接指定 | 0／0 |
| noise `divisor` | 整数0〜7。NR43の分周コード | 3 |
| noise `shift` | 整数0〜15。NR43のシフト値 | 4 |
| noise `width` | 7／15 | 15 |
| wave `samples` | ArrayまたはUint8Array、長さ32、各要素は整数0〜15 | 16段上昇＋16段下降の三角波 |
| wave `level` | 0／0.25／0.5／1 | 0.5 |
| pulse／wave周波数 | 下記の変換可能範囲内の有限の正数 | pulse各440 Hz、wave 220 Hz |
| パン／左右マスター | boolean各2個／整数各0〜7 | 全CH両側ON／左右3 |

sweepの`'up'`は周波数レジスタ値を増やす方向で、ここでは音高が上がる方向に対応する。
period=0等の詳細なスイープ挙動は採用コアに従う。無効化の既定設定はperiod=0かつshift=0とし、
「period=0ならハードウェアのすべてのスイープ作用を無効化する」とは約束しない。
ノイズの分周コード0は、周波数0／ミュートという意味ではない。

`setVoice`／`setSweep`は省略項目を保持し、入れ子の`envelope`も部分更新する。
不明なプロパティ、NaN、Infinity、範囲外、無効なCHは例外。
各呼び出しは全引数を検証してから設定変更・送信する。波形はコピーし、呼出元による後の変更を取り込まない。

### 音名と周波数

- MIDI番号は整数0〜127。音名は`C4`／`F#4`／`Bb3`など。C4=MIDI 60、A4=440 Hz。
- MIDI→Hzは`440 * 2 ** ((midi - 69) / 12)`。noteの数値をHzとは解釈しない。
- 周波数値Nは0〜2047。pulseは`round(2048 - clock / (32 * hz))`、waveは`round(2048 - clock / (64 * hz))`。
- Playgroundの現行クロック4,194,304 Hzなら、pulseは64〜131,072 Hz、waveは32〜65,536 Hz。
  これはレジスタで表現できるHzの範囲。入力は有限かつ正数かを先に検証し、round後のNが0〜2047かで判定する。範囲外はRangeError。返り値はNから逆算する。MIDI番号が有効でも表現できない低音は例外。
- 返すHzは設定レジスタに対応する基音。スイープ後の現在音高を問い合わせるAPIではない。
- Node.jsで別クロックを使う場合、Synthに同じクロックを明示して変換する。Playgroundのクロック変更APIは別作業。

### 発音・停止・raw混在

1. 高水準操作の前に`initialize()`を呼ぶ。未初期化時は高水準操作を例外とし、raw操作は従来どおり許可する。
2. `initialize()`は無音状態で準備する。音が鳴るのは`keyOn()`から。呼び直すと全CHを停止して既定値へ戻る。
3. pulse／noiseのkeyOffはDACを停止するが、次回用の音色設定は残す。keyOnは保存した音色を再適用してDACとトリガーを復元する。
4. pulse／noiseの音量0は高水準APIでは無音として扱う。keyOn時にDACを停止し、up envelopeによる0からの立ち上がりは初版では提供しない。必要ならraw操作を使う。
5. waveのkeyOff／波形転送もDACを停止する。波形・level・周波数は次回のkeyOnに使う。
6. 高水準keyOnは長さカウンターを無効にする。停止はkeyOffか既存sleep／beatで制御する。
   rawで設定した長さ制御を高水準keyOnが引き継ぐとは約束しない。
7. raw書き込みは即時送信し、Synthが追跡する音色・周波数・パン等の設定へ反映する。
   内部keyOffのDAC停止用書き込みとは区別し、外部rawの音量0を勝手に以前の音量へ戻さない。
8. rawのNR52電源OFFは高水準状態を未初期化に戻す。再開はinitializeで行う。
9. 実コアによるスイープ・エンベロープの時間変化や長さカウンターの現在値は、JSの設定状態から読めたことにしない。
   Synthを迂回して直接コアへ書いた場合の整合性は保証せず、混在する操作は同じSynth経由へ統一する。

### 波形とノイズの例

```js
// initialize後。設定だけでは再生しない。
gb.wave.setWaveform(Array.from({length: 32}, (_, i) => i < 16 ? i : 31 - i));
gb.wave.setLevel(0.5);
gb.wave.setNote('C3');
gb.wave.keyOn();

gb.noise.setVoice({
  volume: 10,
  envelope: {direction: 'down', period: 2},
  divisor: 3, shift: 4, width: 15,
});
gb.noise.keyOn();
await beat(1);
gb.wave.keyOff();
gb.noise.keyOff();
```

Game Boyのwaveは32点の繰り返し波形。長いWAVを渡す`loadSample()`やPCMストリーミングは初版の範囲外。

### 初版に含めないもの

- `play(note, {duration})`、自動ゲート、和音／自動CH割り当て、MIDI連携。
- ハードウェア長さカウンターの専用高水準API、汎用release制御。
- 発音中の波形書き換えを無停止で行う機能、波形RAM破損グリッチの再現。
- 同期ステータス読み出し、サンプル単位の時刻予約。

### 実装時の確認項目（この仕様案の追加分）

- [x] initialize前／後、raw NR52 OFF、reset、disposeの遷移を検証する。
- [x] 音名・MIDI・Hzの境界と量子化後Hzを検証する。
- [x] setVoiceの遅延適用と、setFrequency／wave level／panの即時適用を区別する。
- [x] keyOff→keyOnの設定保持と、外部rawのDAC停止書き込みを区別する。
- [x] 長さカウンター無効化、wave更新時停止、音量0での無音を検証する。
- [x] 不正な引数で部分的に設定・レジスタを変更しないことを検証する。
- [x] 既存chip-raw例がinitializeなしでも従来どおり動くことを確認する。

DirectTransportはチップを借りるだけで解放しない。Playgroundでは既存クライアントが
ポート／音源を所有し、`dispose()`とRun／Stop／再Run時の解放責務を維持する。

## 実装契約の補足

- wave.setLevel(0)はNR32によるmute。DACは停止しない。level=0でもkeyOnはDACを有効にしてtriggerする。keyOffと波形転送はDACを停止する。
- 送信レジスタshadowと次回発音用設定を区別する。raw書き込みは両方の該当レジスタを更新し、内部keyOffは保存済みvoiceを消さない。setVoice/setSweepは次回設定のみ更新する。
- 部分更新は対象ビットのみ変更する。周波数更新はtriggerを再送せずlength enableを保持し、keyOnだけはlength enableを解除する。マスター音量更新はNR50のVINビットを保持する。
- shadowは書き込み設定の記録であり、実コアの現在状態や読み出し値ではない。raw波形RAM書き込みの発音中の制約はコアに従う。

## 実装記録（2026-09-29）

- `web/gameboysynth.js` にDOM非依存のGameboySynthと借用型GameboyDirectTransportを追加。`docs/js/`へ同一モジュールを配置。
- `playground_gameboy.js` は既存ポートへの同期write/reset/disposeをtransportとして渡す。Worklet本体とホストの所有権は変更なし。
- `#shadow` は送信した設定、`#voice` は次回発音用設定。triggerは記憶値から除外する。外部rawは両方を更新し、内部DAC停止はshadowのみ更新する。
- setVoice/setSweepは全項目の検証完了後にvoiceのみ変更。即時更新は対象ビットだけ変更し、rawのlength enableやVINを保持。keyOn時だけlength enableを解除する。
- 周波数更新は停止中も送信するがtriggerしない。実コアの発音中フラグを推測する必要がなく、raw混在でも同じ動作になる。
- wave level=0はNR32のみ変更する。採用コアではDAC出力は一定のDC値になるため、PCMの全ゼロではなく交流成分がないことをテストする。keyOffはDACを停止する。
- Playground型定義による補完、新しい`gameboy/gameboy-synth.js`例、itch配布ファイル一覧、Node.jsの`main_gameboy_synth_wave.js`を追加。raw例は維持。
- 自動テスト：状態遷移、丸め境界、音名、CH、波形packing、DAC/mute、部分更新、raw全レジスタ群、無効引数の原子性、借用所有権、rawとSynthのPCM一致、両例の実Worklet発音、Worker Run/Stop/再Runを確認。
- Node例のWAV生成とitch.io用パッケージ作成を確認。ブラウザーでの実際の聴感確認と公開は未実施。

### 検証結果

- 関連6テストファイル：67件成功、失敗0（Synth、raw/高水準例のWorklet再生、runtime、Worker、examples、補完）。
- 全体実行：1353件中1350成功、2失敗、1既存skip。うちexamplesの新フォルダー許可漏れは修正し、上記再テストで成功。
- 残る失敗は未変更の `docs/playground/vgm_export.test.mjs` の「scheduled export expands YM2612 DAC stream data while readable export omits it」。単独実行でも失敗。今回のGame Boy APIとは別件として残す。
- `node examples/nodejs/main_gameboy_synth_wave.js /tmp/gameboy-synth.wav`：48 kHzステレオ115200フレームのWAVを生成。
- `sh scripts/package_itch_playground.sh gameboy-api-check`：依存ファイル検証を含め成功。公開は行っていない。

### chip-saw examples

Playgroundに `examples/chip-saw/gameboy-saw-pulse.js`、`gameboy-saw-wave.js`、
`gameboy-saw-noise.js` を追加。矩形波のデューティと左右出力、32点の波形RAM、
7/15-bitノイズを個別に試せる。chip-sawはchip-rawの次に並べるための名前。
