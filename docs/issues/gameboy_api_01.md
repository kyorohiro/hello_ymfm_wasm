# Game Boy 高水準API案

全体の対応状況：[機能一覧](../feature-status.md)。この文書は本機能の詳細・作業記録。

## 状態と目的

設計案。以下の高水準APIは未実装。
現状は `createSoundChip('gameboy')` の `writeRegister()` / `reset()` / `dispose()`
でPlaygroundからDMG音源を操作できる。
既存実装は [playground_gameboy_raw_01.md](playground_gameboy_raw_01.md) を参照。

レジスタを直接操作する入口を維持しながら、音程・音量・波形などを
チップの機能に沿った名前で設定できるようにする。
Node.jsとPlaygroundで同じ音源操作コードを使えることを目標にする。

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

メソッド名・オプション構造は実装前に確定する。
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

- [ ] 名前・引数範囲・初期値・keyOffと再トリガーの仕様を確定する。
- [ ] GameboySynthとDirectTransportを実装する。
- [ ] Node.jsに高水準API版のWAV例を追加する。既存raw例は比較用に残す。
- [ ] Playgroundの戻り値へ接続し、型定義・補完・配布設定を更新する。
- [ ] 高水準API用の例を追加する。`examples/chip-raw/` はraw操作の例として維持する。
- [ ] 周波数・左右出力・波形パッキング・ノイズモード・無効引数をテストする。
- [ ] raw操作との混在、CH1専用スイープ、停止後の再トリガー、resetをテストする。
- [ ] raw版と高水準版で同じ設定の実コア出力を比較する。
- [ ] Worker / メイン双方の実行とRun・Stop・再Run・disposeを検証する。
- [ ] ブラウザーで試聴し、他の音源との併用を確認する。

最初の到達点は「raw例と同じ演奏を、レジスタ番号を使わず短く書けること」。

## Playground向け初版の具体仕様（2026-09-29・実装前レビュー案）

以下を初版の実装基準案とする。上記の未決定事項を具体化したもので、APIの実装はまだ行わない。
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
  指定Hzをこの範囲で検証してから量子化し、黙って端へ丸め込まない。MIDI番号が有効でも低すぎる音は例外。
- 返すHzは設定レジスタに対応する基音。スイープ後の現在音高を問い合わせるAPIではない。
- Node.jsで別クロックを使う場合、Synthに同じクロックを明示して変換する。Playgroundのクロック変更APIは別作業。

### 発音・停止・raw混在

1. 高水準操作の前に`initialize()`を呼ぶ。未初期化時は高水準操作を例外とし、raw操作は従来どおり許可する。
2. `initialize()`は無音状態で準備する。音が鳴るのは`keyOn()`から。呼び直すと全CHを停止して既定値へ戻る。
3. pulse／noiseのkeyOffはDACを停止するが、次回用の音色設定は残す。keyOnは保存した音色を再適用してDACとトリガーを復元する。
4. 音量0は高水準APIでは無音として扱う。keyOn時にDACを停止し、up envelopeによる0からの立ち上がりは初版では提供しない。必要ならraw操作を使う。
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

- [ ] initialize前／後、raw NR52 OFF、reset、disposeの遷移を検証する。
- [ ] 音名・MIDI・Hzの境界と量子化後Hzを検証する。
- [ ] setVoiceの遅延適用と、setFrequency／wave level／panの即時適用を区別する。
- [ ] keyOff→keyOnの設定保持と、外部rawのDAC停止書き込みを区別する。
- [ ] 長さカウンター無効化、wave更新時停止、音量0での無音を検証する。
- [ ] 不正な引数で部分的に設定・レジスタを変更しないことを検証する。
- [ ] 既存chip-raw例がinitializeなしでも従来どおり動くことを確認する。

DirectTransportはチップを借りるだけで解放しない。Playgroundでは既存クライアントが
ポート／音源を所有し、`dispose()`とRun／Stop／再Run時の解放責務を維持する。
