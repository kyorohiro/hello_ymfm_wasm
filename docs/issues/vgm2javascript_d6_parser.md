# VGM to Playground JavaScript: Readable Pattern Compaction

VGM から出力した Playground JavaScript を短くするための検討メモ。
目的は最小サイズではなく、人が `write()` と `sleepSamples()` を読んで調整できることを保つこと。

## 前提

VGM の `sleepSamples(1)`、`sleepSamples(3)`、`sleepSamples(4)` などの短い待機は、
Playground 側の通信遅延ではなく VGM に記録された時刻差である。

元ドライバの register write 間隔、CPU の処理周期、記録器の粒度などに由来する可能性がある。
YM2612 の必須待機かを一般に判定することは難しいため、変換時に丸めたり削除したりしない。

## 出力の役割

二つの用途を混ぜない。

- 通常出力は、人が読む・編集する JavaScript。`write()` と `sleepSamples()` をそのまま出す。
- サイズ優先のデータは、DAC の Base64 stream のような専用形式で扱う。これは可読な register 列の代替ではない。

DAC は `dac.loadBase64()` / `dac.playStream()` を使う。DAC の各 byte を JSON 配列へ展開しない。

## Compact Loop

`Compact loop` は opt-in の軽い圧縮とする。

- 同一 track 内で、隣接するブロックが完全一致した場合だけ `for` 化する。
- 比較対象には `write()` の port、register、value、`sleepSamples()` の sample 数をすべて含める。
- 3 回以上連続する同一ブロックを候補にする。
- 圧縮後の JavaScript が実際に短くなる場合だけ採用する。
- 同一でない値、短い sleep、コメントを引数化しない。少しでも異なる場合は元の列をそのまま残す。

想定する生成結果:

```javascript
for (let index = 0; index < 3; index += 1) {
  write(0xa4, 0x22);
  write(0xa0, 0x83);
  await sleepSamples(3);
  write(0x28, 0xf0);
  await sleepSamples(3667);
  write(0x28, 0x00);
}
```

## 行わないこと

次のような汎用 parser / tree / pattern function を生成コードへ出さない。

```javascript
await note({ gap, fnumHigh, fnumLow, tlDelay, length });
```

この形式は値と timing を保てても、VGM の register write 列を直接読めなくなる。
内部で完全一致候補を探すために tree や sequence index を使うことは構わないが、生成コードには露出しない。

## High-Level Compaction

`fm.setPreset()` や `play()` への変換は、音色や register write の順序を変える可能性がある。

- 通常出力・Compact loop には含めない。
- 将来追加する場合も Experimental、既定 OFF とする。
- raw `write()` 出力との比較・再生回帰確認ができることを条件にする。
