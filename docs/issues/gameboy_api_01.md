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
3. **演奏用API**：音名・拍・音の長さ・自動CH割り当て。将来、Synthの上に追加する。

最初から全チップを同じ楽器APIにまとめず、Game Boyの制約や音作りの特徴を見える形で残す。
`play('C4', {duration: ...})` のような便宜機能やMIDI連携は別段階にする。

## 使用例（提案）

```js
const gb = await createSoundChip('gameboy');
try {
  gb.reset();
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

## 実装時に決める挙動

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
