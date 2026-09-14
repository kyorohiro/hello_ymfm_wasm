優先	Chip	理由
S	YM2612	Mega Drive / Genesis。現在の中心
S	YM2608	PC-88/98。FM+SSG+Rhythm+ADPCM-Bで研究対象が広い
S	YM2151	X68000 + アーケード。OPM文化をほぼ代表できる
S	YMF262	DOS/AdLib/Sound Blaster方面をOPL3で広くカバー
A	YM2413	MSX + Master System。OPLLという別系統を押さえられる
A	YM2610	Neo Geo。すでに餓狼伝説を扱っているので相性がいい
A	YM2203	PC-88/98初期。OPN文化の基準点
A	YM2149	MSX/PSG。FM以前・FM併用曲の解析に重要
B	Y8950	MSX-Audio。ただしMSXを深掘りするなら上昇
B	YMF278B	OPL4/Moonsound。面白いが対象作品が限定的
B	YM3812	OPL2。YMF262対応が十分なら優先度低下
B	YMF288	後期PC-98研究には面白いがYM2608とかなり重なる
C	YM2414	TX81Z/DX11。ゲームよりシンセ研究向け
C	DS1001/VRC7	ラグランジュポイント等、対象がかなり限定
C	YM2164	OPM派生。ゲーム研究では優先度低い
D	YM2610B	YM2610との差分対応で十分
D	YM3438	YM2612互換系として後回し
D	YMF276	同上
D	YMF289B	YMF262の低電力版。研究価値はあるが優先不要
D	YM2423	OPLL派生
D	YMF281	OPLL派生
D	YM3806	ゲーム用途という目的から外れる

## CH / 音源 ON/OFF の進捗

上の優先度順で拡張する。既存対応は維持し、未対応チップを順に追加する。

- YM2612（S）：CH1～6 と PSG 全体は既存対応。CH6 は DAC も抑制する。
- YM2608（S）：FM CH と SSG / Rhythm / ADPCM-B は既存対応。
- YM2151（S）：8CH の ON/OFF を追加済み。コア → WASM → JS → Analyzer のボタンを接続。
  ミュート中もフィードバックを含めて計算し、出力だけを除外する。
- YMF262（S）：次の追加対象。18CH・4op・リズムの扱いを調査して実装する。
- A 以下：上表の順。未実装コアの導入は今回の CH ミュート拡張とは別に扱う。

YM2612 / YM2608 の方式を完全に統一したわけではない。
既存方式の制約と拡張項目は [ch_on_off_01.md](ch_on_off_01.md) を参照。
