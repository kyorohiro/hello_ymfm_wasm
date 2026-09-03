# VGM to Playground JavaScript: High-Level API Conversion

VGM の raw register write を、変換できる部分だけ Playground の高レベル API へ置き換える方針。

## 目的

曲全体を無理に `play()` や `fm.setPreset()` へ変換しない。
確実に意味を復元できる連続した register write だけを高レベル API にし、
判定できない部分は `write()` / `sleepSamples()` として残す。

生成コードは人が読む・編集する用途を優先する。

## 適用範囲

高レベル API 化と tiny wait の丸めは `Write` 出力だけに適用する。

- `Schedule` 出力は raw register data を読むことが目的であり、変換しない。
- `Schedule` の Import option は `Include DAC` と `DAC use Base64` だけにする。
- `Schedule + DAC use Base64` は DAC を `livePrepare()` で事前に読み込み、loop 内では `dac.playStream({ atSamples: cycleStart })` を使う。全 DAC event を予約しないため、長尺曲でも開始を待たせない。既定 ON とする。
- `Write` の Import option は `Include DAC`、`DAC use Base64`、tiny wait の丸め、高レベル API 化を持つ。
- tiny wait の丸めは既定 ON とする。

## 部分変換

最初に対象とする候補:

- 周波数の high / low (`0xa4..0xa6`, `0xa0..0xa2`) が揃う単純なノート設定。
- 明確な key-on / key-off (`0x28`)。

変換例:

```javascript
fm.setFrequency(CH1, 4, 0x283);
fm.keyOn(CH1);
await sleepSamples(3667);
fm.keyOff(CH1);
```

変換できない部分は同じコード内で raw write のまま残す。

```javascript
write(0x27, 0x40); // CH3 special mode: raw のまま
await sleepSamples(3);
write(0x28, 0xf0);
```

## 変換しない対象

初期段階では次を高レベル API にしない。

- `fm.setPreset()`。preset 化は封印し、operator parameter は raw `write()` のまま残す。
- DAC (`0x2a`, `0x2b`)。DAC を含める場合は `dac.loadBase64()` / `dac.playStream()` を使う。
- LFO、timer、CSM、CH3 special mode。
- ノート途中の operator parameter 更新。
- port や channel の意味を一意に決められない register write。
- 変換前後で write 順序を保証できない箇所。

## Tiny Wait の丸め

VGM に含まれる `sleepSamples(1)`、`sleepSamples(3)`、`sleepSamples(4)` のような短い wait は、
多くの曲では高レベル化の妨げになる細かな記録粒度として扱う。

- `Write` 出力では既定で `<= 4 samples` を `0` に丸める。
- 捨てた sample 数は次の長い wait へ加算し、曲全体・フレーズ全体の長さを維持する。
- 終端まで繰り越し先がない場合は、最後の wait へ加算する。

ただし YMFM では operator off/on 付近の短い wait が音量に影響する VGM がある。
そのため `Quantize tiny waits` は UI から OFF にできる設定にする。
検証用 VGM や音が変わる曲では OFF を使う。

## 安全条件

- 高レベル API 化は `Write` 用の opt-in `Compact high-level API` とする。
- 対象外の write と sleep は削除しない。
- 変換後にも raw export と比較できるようにする。
- 音の差が疑われる場合は、高レベル化と tiny wait の丸めをそれぞれ OFF にして切り分ける。
- `Compact loop` の完全一致圧縮とは独立した機能として扱う。
