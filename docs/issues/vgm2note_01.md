VGM -> JavaScript 変換時の Note 検出を修正してください。

現在、YM2612 の pitch register 更新途中の一時的な BLOCK/FNUM 値を、
実際に演奏された Note として出力している可能性があります。

例:

fm.keyOn(CH2);
await sleepSamples(3);

// E5: original BLOCK=5 FNUM=801
setNoteFrequency(CH2, "E5", 5);

await sleepSamples(2);

// G5: original BLOCK=5 FNUM=966
setNoteFrequency(CH2, "G5", 5);

await sleepSamples(14534);

この E5 は 2 samples しか存在せず、
その後 G5 が 14534 samples 続いています。

同様のパターンが多数あります:

- E5 -> 2 samples -> G5
- A5 -> 1 sample -> B5
- A5 -> 1 sample -> C6
- A#5 -> 1 sample -> B5
- G5(FNUM=950) -> 2 samples -> G5(FNUM=966)

これらは旋律上の Note ではなく、
YM2612 の周波数設定レジスタ更新途中の中間状態だと考えています。

YM2612 の pitch は以下の複数 register で構成されます:

- A0-A2: FNUM low
- A4-A6: BLOCK + FNUM high

そのため、片方を書いた直後に現在値から Note を計算すると、

new high + old low

または

old high + new low

の一時的な FNUM を Note として誤検出します。

修正方針:

1. A0-A2 / A4-A6 の write を単独で即 Note 化しない。
2. 同一 channel の連続する pitch register write を
   1つの frequency update transaction として扱う。
3. transaction 完了後の BLOCK/FNUM からのみ Note を生成する。
4. 単純に「5 samples 以下の Note を削除する」という実装にはしない。
   本物の高速 pitch change / effect を消してしまう可能性があるため。
5. raw VGM の timing は保持する。
6. JavaScript 出力の意味上の Note だけを整理する。

まず現在の VGM parser / note conversion code を調査し、
A0-A2 / A4-A6 がどのタイミングで Note に変換されているか確認してください。

修正後、上記のような

E5 -> 2 samples -> G5

が

G5

だけとして意味化されることをテストしてください。

また、
G5 FNUM=950 -> 2 samples -> G5 FNUM=966

のような「同じ音名だが中間 FNUM が出ているケース」も
regression test に追加してください。

既存の再生タイミングや raw register write の再現性は壊さないでください。

## 調査結果・対応（2026-09-09）

- ローカルの `src/ymfm_opn.cpp` の周波数書き込み処理を確認。
  上位レジスタはラッチへの保存だけで、下位レジスタを書いた時に音程が確定する。
  通常音程と CH3 特殊モードは別ラッチだが、それぞれのラッチは CH / port 間で共有される。
  したがって、同一 CH の隣接 write を時間幅でまとめるのではなく、この確定タイミングを使用する。
- `opn_fm_vgm.js` の OPN → YM2612 クロック変換では、従来は上位 write にも
  新しい上位 + 古い下位のペアを生成していた。上位は保持し、下位 write 時だけ変換後のペアを出すよう修正。
- Native の Note-ish / Compact 出力も、wait を挟んだ上位・下位 write や
  下位のみの write を、共有ラッチを反映した確定音程として出力する。
  CH 分割・重複削除より前に確定値を計算する。
- Native Raw / Scheduled / 通常 High のレジスタ書き込み時刻と順序は維持する。
  Note-ish は従来どおり半音への丸めを伴うため、原音の完全再現用には Raw を使う。

### 検証

`docs/playground/vgm_export.test.mjs` に回帰テストを追加。

- 旧 low が 801 / 950 の状態で high を更新し、2 samples 後に low を 966 にするケース：
  中間 BLOCK=5 FNUM=801 / 950 を出さず、確定した 966 を出力。
- 本当に low を書いて 801 / 950 を確定させた後、1〜2 samples 後に 966 にするケース：
  両方の音程更新を保持。短さや音名の一致だけでは削除しない。
- CH / port をまたぐ共有ラッチ、CH3 特殊用との分離、high のみでは未確定になる動作。
- KEY ON/OFF と待ち時間、Native Raw / Scheduled / 通常 High の write 順・時刻。
- JavaScript export と既存 MIDI / MML の関連テスト計 56 件が成功。

提示された出力例そのものの元 VGM は未検証。
元データに実際の low write がある短音は、この修正後も意図的に残す。

### Analyzer 表示と MIDI の追加確認

- Playground の Compact Note-ish はユーザー確認済み。
- Analyzer のライブモニターは別経路で、high write 時にも履歴を追加していた。
  YM2203 / YM2608 / YM2610(B) / YM2612 の表示を low write 時の確定に修正。
  ファイル読み込み・再生開始時にラッチを初期化し、CH3 特殊周波数も別ラッチで確定する。
  Analyzer エントリーのキャッシュ識別子も更新。
- MIDI 抽出は既に共有 high ラッチ + low write 確定になっていたため、実装修正は不要。
  801 / 950 → 966 の更新を離した場合と隣接させた場合で MIDI バイト列が一致し、
  実際の短い low commit は抽出に残ることを OPN 各機種の回帰テストで確認。
- Analyzer モニター・MIDI・SSG/PSG・JavaScript export の関連テスト計 56 件成功。
  ブラウザー上の見た目は未確認。

### 実ファイルでの追加調査：01 Neo-Geo Logo.vgz

提供された Fatal Fury の YM2610 VGM を展開して、サンプル時刻付きで確認した。
一瞬の上下は high / low 更新途中の誤確定ではなく、
前の音程を保持したまま KEY ON し、その直後に新しい音程を書き込む順序による。

例：CH2（時刻は VGM の 44100 Hz sample 単位）

| sample | port / register / value | 動作 |
| --- | --- | --- |
| 36150 | 0 / 28 / 01 | KEY OFF |
| 36153 | 0 / 28 / F1 | 前の G5（BLOCK=5, FNUM=926）で KEY ON |
| 36156 | 0 / A5 / 2B | high ラッチ更新（まだ音程は変わらない） |
| 36158 | 0 / A1 / 0B | E5（BLOCK=5, FNUM=779）に確定 |

旧音程の期間は 5 samples、約 0.113 ms。CH5 / CH6 にも 4〜5 samples の同様の開始区間がある。
これはレジスタ状態の確認であり、この区間が独立した音として聞こえるという意味ではない。

Analyzer の詳細表示は履歴点を同じ半径で描くため、この短い開始区間も目立つ。
MIDI 抽出にもこの区間は残る（前項の「更新途中を出さない」は high ラッチの中間値についてであり、
KEY ON 直後の旧音程区間を除去する意味ではない）。

発音開始時の設定を音楽的な一つの Note としてまとめる処理は未実装。
単純な短音削除とは分けて扱う必要があり、今回の実ファイル調査では Raw・抽出結果を変更していない。

### CH 凡例・音量の確認

- Overview の凡例が、未使用 CH を除いた配列位置を CH 番号に使っていた。
  実データは CH2 / CH3 / CH5 / CH6 のままだが、凡例だけ CH1〜4 になっていたため修正。
  描画テストで通常 6 CH・YM2610 の 4 CH・SSG のラベルを確認。
- 上記 CH2 は sample 36153 の KEY ON から 65413 の KEY OFF までの間に、
  BLOCK=5 のまま FNUM=926 → 779 に確定している。
- sample 36153 で ALG=4、全 OP の AR=15、TL はレジスタ順に 21 / 64 / 20 / 20。
  ミュート用の最大減衰ではなく、L/R とも有効。
- 同梱 YM2610 WASM でファイル先頭から再生し、他 FM CH の pan を消音、
  SSG / ADPCM をミュートして CH2 出力を確認したところ、36153〜36158 の区間にも
  非ゼロの PCM があった（例 -0.00534、+0.01379）。
  これはエミュレータでの出力確認であり、独立した G5 として聞こえることや実機一致の検証ではない。
  直前の音のリリースも含みうるため、KEY ON と音量の立ち上がりは同一視しない。

### Note-ish の発音開始表示を整理

- 表示専用の補正として、OFF → 全 OP KEY ON の直後、8 VGM samples（約 0.18 ms）以内に
  最初の low write が来た場合に、KEY ON 時の仮の旧音程点を確定音程へまとめる。
  この時間幅は音楽的な表示のための判断基準であり、チップ仕様ではない。
- グラフ・ギター指板の残像が共有する履歴と Show Notes を整理する。
  音程更新が来ない発音、保持中の再 KEY ON、期限後の更新、2 回目以降の low write は省略しない。
- 時間判定は壁時計ではなく player.processedWaitSamples を使用。
  再生音・Raw・MIDI・Playground export のデータは変更しない。
- 提供された Neo-Geo Logo を表示処理に流し、CH2 / 3 / 5 / 6 の各発音で旧音程の余分な点が
  残らず、確定音程と KEY OFF の区切りが残ることを確認。
- 関連自動テスト 88 件成功。ブラウザー上の描画は未確認。

### MIDI 発音開始補正

MIDI も Note-ish と同じ 8 samples 以内の開始補正を適用。
抽出時に「OFF → 全 OP KEY ON」と「low write による区間終了」を記録し、
MIDI 化時だけ、その最初の旧音程区間を直後の確定音程にまとめる。
開始時刻は元の KEY ON、終了時刻は元の KEY OFF を維持する。
後続の pitch bend、保持中の再 KEY ON、8 samples を超える更新は補正しない。
SSG / PSG、Raw、Playground export の動作は変更しない。

境界・ゼロ FNUM からの開始・後続 bend・保持中再 KEY ON の回帰テストを追加。
関連テスト 90 件成功。提供された Neo-Geo Logo の MIDI 書き出しも実行済み。
