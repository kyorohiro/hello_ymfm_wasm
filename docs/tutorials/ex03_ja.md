# YM2612 で Beep を鳴らす

このメモは [ex03_beep.cpp](./ex03_beep.cpp) のためのものです。
編集元は repository の `tetorica_examples/cpp/tutorials/ex03_beep.cpp` です。
このページからのダウンロードは公開用のコピーです。
ビルド方法は [tutorial 一覧](./README.md#build-and-update)を参照してください。

目的は、まだ豊かな楽器音を作ることではありません。
まずは 1 つの単純な YM2612 beep を、完成した音から逆にたどって理解することです。

## まず browser demo を見る

コードを読む前に、まずは次のページで目標の音を聞いてみてください。

- [`YM2612 Beep Demo`](https://kyorohiro.github.io/hello_ymfm_wasm/demos/beep.html)

この demo は `ex03_beep.cpp` と同じ YM2612 設定を使っています。

この tutorial の問いは、次の 2 つです。

- この beep を FM の考え方でどう説明するのか
- その設定を `ymfm` や実際の chip にどう送るのか

## やっていること

手順は次の通りです。

1. `ym2612` のオブジェクトを作る
2. `reset()` する
3. channel 1 の operator を設定する
4. algorithm と左右出力を設定する
5. 周波数を設定する
6. `Key ON` する
7. サンプルを生成する

## まず FM の考え方で beep を説明する

最初から register 番号を見るより先に、この beep を FM 的に言い直すと分かりやすいです。

- `channel 1` を使う
- `algorithm 7` を使う
- 音は left / right の両方に出す
- 4 つの operator に単純な `DT/MULTI` を入れる
- operator 1-3 は実質ほぼ無音にする
- operator 4 を audible な部分にする
- `BLOCK` + `F-Number` で 1 つの音程を決める
- 最後に `Key ON` を送る

これが、この beep の本当の内容です。
register write は、この内容を chip 固有の形式で表現しているだけです。

## channel と operator の考え方

YM2612 には 6 個の FM channel があります。
各 channel には 4 個の operator があります。

operator は小さな音の発生器です。
operator 同士を変調に使うこともできるし、そのまま最終出力に混ぜることもできます。

`ex03_beep.cpp` では channel 1 を使っています。

FM 音源では、基本的に 1 つの channel を 4 つの operator で構成します。
そのため、`0x30-0x3c` のようにアドレス範囲に幅があるのは、
4 個の operator 分の設定が並んでいるためです。

## なぜ Algorithm 7 なのか

Algorithm 7 では、4 個の operator がすべて carrier として動きます。
すべてが直接出力に行くので、最初の理解用として分かりやすいです。

唯一の方法ではありませんが、最初の beep には向いています。

## `chip.reset()` は何に対応するのか

`chip.reset()` は、実チップの `/IC` をアサートして初期化するのに近い動きです。
ただし `ymfm` では `/IC` ピンをそのままエミュレートしているわけではなく、
内部の YM2612 状態を直接リセットしています。

## この beep の目標設定

この beep を設定の意図として書くと、だいたい次のようになります。

### Channel

- channel: `1`
- algorithm: `7`
- pan: left + right

### Operators

- operator 1: 単純な周波数設定、ほぼ無音
- operator 2: 単純な周波数設定、ほぼ無音
- operator 3: 単純な周波数設定、ほぼ無音
- operator 4: 単純な周波数設定、audible

もう少し具体的には:

- operator 1-4 は `DT=0`, `MULTI=1`
- operator 1-3 は `TL=0x7f`
- operator 4 は `TL=0x00`
- operator 1-4 は速い `AR`
- operator 1-4 は単純な sustain / release 設定

### Pitch

- `0xa4 = 0x22`
- `0xa0 = 0x69`

### Trigger

- `0x28 = 0xf0`

`Key ON` を送らないと、chip の設定は終わっていても音は始まりません。

## その考え方を YM2612 write に変換する

FM 側の考え方が見えたら、次に chip 側の表現を見ます。

各レジスタ書き込みは、次の 2 段階です。

1. address port にレジスタ番号を書く
2. data port に値を書く

例:

```cpp
chip.write(0, 0x30);
chip.write(1, 0x01);
```

これは、

1. レジスタ `0x30` を選ぶ
2. レジスタ `0x30` に `0x01` を書く

という意味です。

つまり `ex03_beep.cpp` では、同時に 2 つのことをしています。

- FM の考え方で beep を設計する
- その内容を YM2612 register write に翻訳する

## `ex03_beep.cpp` で使うレジスタ

### 全体の見取り図

- `0x30-0x3c`: operator の detune と multiple
- `0x40-0x4c`: operator の total level
- `0x50-0x5c`: operator の attack rate
- `0x80-0x8c`: operator の sustain level と release rate
- `0xb0`: channel の algorithm と feedback
- `0xb4`: 左右出力の有効化
- `0xa4` と `0xa0`: 周波数
- `0x28`: key on / key off

### 1. DT / MULTI

これらのレジスタは、各 operator の detune と frequency multiple を設定します。

- `0x30`, `0x34`, `0x38`, `0x3c`

`ex03_beep.cpp` では、すべて `0x01` を設定しています。

何が起きるか:

- detune はほぼ小さいまま
- multiple は `1`
- 4 個の operator を単純な周波数関係で始めている

補足:

- `Detune (DT)` は音程をわずかにずらすための設定です
- `Multiple (MUL)` は周波数を 1 倍、2 倍、3 倍... のように大きく変える設定です
- `MUL=2` なら基本音の約 1 オクターブ上、`MUL=4` なら約 2 オクターブ上に相当します
- FM では、この倍音関係が音色の性格に強く効きます

### 2. Total Level

これらのレジスタは、各 operator の出力レベルを設定します。

- `0x40`, `0x44`, `0x48`, `0x4c`

`ex03_beep.cpp` では、operator 4 だけを大きくしています。

- `0x40 = 0x7f`
- `0x44 = 0x7f`
- `0x48 = 0x7f`
- `0x4c = 0x00`

何が起きるか:

- operator 1-3 はほぼ無音
- operator 4 は大きい
- 単純な beep として理解しやすくなる

補足:

- `Total Level (TL)` は operator の最終的な出力音量です
- carrier の TL を下げると、直接聞こえる音量が小さくなります
- modulator の TL を下げると、音のギラつきや派手さが減って丸い音になります

### 3. Attack Rate

これらのレジスタは、音がどれだけ速く立ち上がるかを設定します。

- `0x50`, `0x54`, `0x58`, `0x5c`

`ex03_beep.cpp` では、すべて `0x1f` です。

何が起きるか:

- 音が素早く立ち上がる
- 短くてはっきりした beep に聞こえやすい

補足:

- `Attack Rate (AR)` は Key On 後に最大音量へ達するまでの速さです
- 値を大きくすると「ピシッ」と速く立ち上がります
- 値を小さくすると、ゆっくり立ち上がる柔らかい音になります

### 4. Sustain / Release 周辺

これらのレジスタは、エンベロープ設定の一部です。

- `0x80`, `0x84`, `0x88`, `0x8c`

`ex03_beep.cpp` では、すべて `0x0f` です。

何が起きるか:

- エンベロープを単純なままにしている
- まだ複雑な楽器音は目指していない

補足:

- `Sustain Level (SL)` は decay の後に保たれる音量レベルです
- `Release Rate (RR)` は Key Off 後に音が消えるまでの速さです
- `RR` を大きくすると、鍵盤を離した後すぐに音が消えます
- `RR` を小さくすると、余韻が長く残ります

### 5. Algorithm

- `0xb0 = 0x07`

これは channel 1 に Algorithm 7 を設定しています。

何が起きるか:

- 4 個の operator がすべて carrier として動く
- 深い変調チェーンではなく、そのまま出力に行く

補足:

- `Algorithm (ALG)` は 4 個の operator をどうつなぐかを決めます
- 接続のしかたによって、ベース向き、ベル向き、オルガン向きのような性格が変わります
- `0xb0` には `Feedback (FB)` も入ります
- `Feedback` は operator の出力を自分自身に戻す量で、強くするとノイズっぽさや鋭さが増します

### 6. 左右出力

- `0xb4 = 0xc0`

これは left と right の両方の出力を有効にしています。

何が起きるか:

- 音が `MOL` と `MOR` の両方に送られる
- 左右両方から beep が聞こえる

補足:

- このレジスタは `PAN` の役割も持っています
- 左だけ、右だけ、両方のどこに出すかを選べます
- 左右両方を有効にすると、中央に定位したように聞こえます

### 7. Frequency

- `0xa4 = 0x22`
- `0xa0 = 0x69`

この 2 つのレジスタで音程を設定します。

何が起きるか:

- channel に 1 つの音程が設定される
- ここを変えると beep の高さが変わる

補足:

- ここは YM2612 の音高を決めるメインレジスタです
- `0xa4` 側に `BLOCK` などの上位情報
- `0xa0` 側に `F-Number` の下位情報が入り
- 2 つを組み合わせて最終的な音程を決めます

### 8. Key ON

- `0x28 = 0xf0`

これは channel 1 の operator 1-4 を ON にしています。

何が起きるか:

- 音が鳴り始める
- これを書かないと、設定しただけでは音は始まらない

補足:

- `0x28` は実際の発音トリガーです
- ここに channel 番号と、どの operator を有効にするかのビットを書きます
- Key On で発音開始、Key Off で消音フェーズに入ります

## コードをレジスタ辞書として読む

YM2612 をもう一段深く理解して、自分で設定を書けるようになりたい場合は、
`ymfm` のソースコードをそのまま読むのがかなり有効です。

このリポジトリでは、`src/ymfm_opn.h:209` がレジスタ辞書としてとても役に立ちます。

特に次の行が分かりやすいです。

- `src/ymfm_opn.h:221`
  `0x30` 系 -> `op_detune`, `op_multiple`
- `src/ymfm_opn.h:223`
  `0x40` 系 -> `op_total_level`
- `src/ymfm_opn.h:224`
  `0x50` 系 -> `op_ksr`, `op_attack_rate`
- `src/ymfm_opn.h:229`
  `0x80` 系 -> `op_sustain_level`, `op_release_rate`
- `src/ymfm_opn.h:210`
  `0xb0` -> `ch_feedback`, `ch_algorithm`
- `src/ymfm_opn.h:212`
  `0xb4` -> 左右出力 / pan 関連
- `src/ymfm_opn.h:209`
  `0xa4` + `0xa0` -> `ch_block_freq`

`0x28` の key on / key off の扱いは、`src/ymfm_opn.cpp:176` を読むと追えます。

`ex03_beep.cpp` の `write()` と、ここでの定義が頭の中でつながるようになると、
かなり自力で YM2612 の beep 設定を書ける段階に近づいています。

## 大事な考え方

beep は特別な 1 命令で出るわけではありません。

次の積み重ねで音になります。

- operator を設定する
- channel を設定する
- 周波数を設定する
- `Key ON` で発音を始める

## 自分で beep を書くときの考え方

1. どの channel を使う?
2. 4 個の operator をどう設定する?
3. どの algorithm を使う?
4. どの音程にする?
5. いつ `Key ON` / `Key OFF` を送る?

## 次の疑問

この beep 例を理解した後に自然に出てくる疑問は、たとえば次です。

- 各 operator は本当は何をしているのか?
- `0xa4` と `0xa0` は音名にどう対応するのか?
- `Key ON` と `Key OFF` の違いは何か?
- beep をどうやって楽器音にしていくのか?
