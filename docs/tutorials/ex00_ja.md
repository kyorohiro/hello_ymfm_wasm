# FM音源って何?

YM2612 の細かい話に入る前に、FM音源そのものの考え方を見るには Yamaha の説明がわかりやすいです。

- [`FM音源の登場と音楽制作時代の幕開け`](https://web.archive.org/web/20260308101521/https://jp.yamaha.com/products/contents/music_production/synth_50th/history/chapter002.html)
- [`FM音源の原理`](https://web.archive.org/web/20260728024744/https://jp.yamaha.com/products/contents/music_production/synth_50th/anecdotes/004.html)



# YM2612 について

C++ の例とビルド方法は [tutorial 一覧](./README.md)を参照してください。
レジスタを順番に追って beep を鳴らす説明は [ex03_ja.md](./ex03_ja.md)にあります。

YM2612 は Yamaha が開発した sound chip です。
Sega Mega Drive / Genesis で使われました。

この chip には次のような機能があります。

- 6 channel の 4-operator FM 音源
- 2 つの interval timer
- 正弦波の low-frequency oscillator (LFO)
- stereo output
- channel 6 で PCM 風の sample playback に使える簡単な DAC playback path


```text
http://www.chipdir.nl/pinusr/ym2612.txt


    +--()--+
GND | 1  24| 0M(CLK)
 D0 | 2  23| Vcc
 D1 | 3  22| A.Vcc
 D2 | 4  21| MOL
 D3 | 5  20| MOR
 D4 | 6  19| A.GND
 D5 | 7  18| A1
 D6 | 8  17| A0
 D7 | 9  16| /RD
  ? |10  15| /WR
/IC |11  14| /CS
GND |12  13| /IRQ
    +------+
```

## ピンの概要

- `GND`: デジタル側の ground
- `A.GND`: 音声出力まわりのアナログ側 ground
- `Vcc`: デジタル側の電源
- `A.Vcc`: 音声出力まわりのアナログ側電源
- `0M (CLK)`: マスタークロック入力

- `MOL`: 左音声出力ピン
- `MOR`: 右音声出力ピン

- `D0-D7`: 8-bit 双方向データバス
- `A0`: アドレス選択ピン
- `A1`: アドレス選択ピン

- `/RD`: 読み取り信号 active low
- `/WR`: 書き込み信号 active low
- `/CS`: チップ選択信号 active low
- `/IRQ`: 割り込み要求信号 active low
- `/IC`: リセット信号 active low

- `Pin 10`: 通常用途では未使用
  資料によっては `NC`、別資料では `TEST` ピンとされています。

## FM での音作り

PCM / DAC の前に、まずは YM2612 がどうやって FM の音を作るかを見ると理解しやすいです。

基本の考え方は次の通りです。

- `DT` `MULTI` `TL` `AR` `D1R` `D2R` `SL` `RR` などの値で、各 operator の音の性格を決める
- それらの operator を複数組み合わせて、algorithm によってさらに複雑な音を作る

まずは次のページを見ると流れを掴みやすいです。

- [`operator1.html`](../demos/operator1.html)
  1 つの operator のパラメータを変えた時に、どんな変化が出るかを見るページです。
- [`operator2.html`](../demos/operator2.html)
  2 つの operator を組み合わせて、変調や algorithm の違いを試すページです。
- [`YM2612 synth demo`](../synth/index.html)
  複数 operator / 複数 channel を組み合わせて、もう少し複雑な音作りを試せる demo です。

## FM Sound Chip での音作り

`A0` と `A1` は、どの制御ポートにアクセスするかを選びます。
address/data の切り替えと、port 0 / port 1 の切り替えに使います。

- `A1=0, A0=0`: address port 0
- `A1=0, A0=1`: data port 0
- `A1=1, A0=0`: address port 1
- `A1=1, A0=1`: data port 1

## `chip.write()` と YM2612 のピンの対応

`void ym2612::write(uint32_t offset, uint8_t data)` は、YM2612 のアクセス方法を単純化したものです。

- `offset`: `A1` と `A0` で選ばれるアクセス先に対応
- `data`: `D0-D7` に乗る 8-bit の値に対応

対応表:

- `offset = 0`: `A1=0, A0=0` -> address port 0
- `offset = 1`: `A1=0, A0=1` -> data port 0
- `offset = 2`: `A1=1, A0=0` -> address port 1
- `offset = 3`: `A1=1, A0=1` -> data port 1

例:

```cpp
chip.write(0, 0x30);
chip.write(1, 0x01);
```

これは次の意味です。

1. address port 0 でレジスタ `0x30` を選ぶ
2. data port 0 から、そのレジスタに `0x01` を書く

つまり、software 側は抽象的に音を変えているのではなく、
YM2612 固有の制御値をこの pin の組み合わせで chip に送り、
YM2612 の register に書き込んで音を作っています。

## PCM / DAC on YM2612

YM2612 は 6 channel の FM 音源として有名ですが、簡単な DAC playback path も持っています。

- `0x2A`: DAC data
- `0x2B`: DAC enable

DAC playback を有効にすると、channel 6 を通常の FM の代わりに PCM 風の sample playback に使えます。

これは後の世代の chip にあるような大きな PCM engine ではありません。
software 側が sample byte を継続して chip に書き込む、より単純な DAC 経路です。

実際には次の用途で重要です。

- voice sample
- drum hit
- YM2612 DAC streaming を含む VGM playback

この repository では、現在の browser 側 PCM 関連サポートは主に VGM playback 経由です。
VGM の DAC/stream command を読んで、その sample byte を YM2612 の DAC register write に流しています。

## よくある疑問

Q: なぜ `GND` と `A.GND` の2種類があるの?

A: YM2612 にはデジタル回路とアナログ回路があります。
アナログ回路は音声出力に使われるので、`A.Vcc` と `A.GND` は `MOL` と `MOR` の後ろにある音声出力回路のために分けられています。

Q: なぜ `/CS` が必要なの?

A: `/CS` は「今のバスアクセスは YM2612 宛てです」と伝える信号です。
これがないと、同じバス上の複数のチップが同時に反応する可能性があります。

Q: `/IRQ` は何に使うの?

A: `/IRQ` は、主に YM2612 の内部タイマーイベントが起きたことを CPU に知らせるために使われます。

Q: `/RD` と `/WR` は何?

A: `/RD` と `/WR` はデータ線ではなく制御信号です。
実際のデータは `D0-D7` を通ります。

Q: `D0-D7` は何をするの?

A: `D0-D7` は 8-bit のデータピンです。
CPU と YM2612 の間でデジタルデータをやり取りします。

Q: `/IC` は何に使うの?

A: `/IC` はリセット信号です。
チップを初期化して、レジスタをクリアします。

## 参考資料

- http://www.chipdir.nl/pinusr/ym2612.txt
- https://www.vgmpf.com/Wiki/index.php?title=YM2612
- https://gendev.spritesmind.net/forum/viewtopic.php?start=585&t=386
