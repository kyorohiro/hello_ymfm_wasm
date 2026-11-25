# Tetorica FM21290 Synth

[Browser版](index.html) · [レジスタと根拠](registers.md) · [作業状況](../issues/todo_fm21290_synth_01.md)

この開発版は同じDX7音色を、実験用OPS/EGSコアまたは既存MSFAで演奏する。ローカルで使う場合はリポジトリのルートで `python3 -m http.server --directory docs 8080` を実行し、`http://localhost:8080/synth-fm21290/` を開く。

最初の音色はオリジナルの **GLASS STEP**。Codeの **Run** でCH1の低音とCH2のベルが始まる。`0x30c1` への書き込みを36から12に変え、**Apply** するとCH2のOP2による変調が深くなる。**Stop** で停止する。KeyboardではAからKの列とその間の黒鍵で演奏する。Waveform / SpectrumはMaster後の出力を観測する。

**LFO** は全声共通。独自エンジンで音高の揺れを試すには、Sine、Speed 40、Pitch depth 40、Pitch sensitivity 4にして鍵盤を長押しする。振幅の揺れはAmplitude depthと各OPのAM sensitivityで調整する。Register writesにはAMとPMの現在のバイト値が出る。MSFA経路は同梱エンジンのLFO実装を使う。

## JavaScript

- `await useSoundChip('dx7')` は現在選択中のエンジンで `noteOn(note, velocity)`、`noteOff(note)`、`getPreset()`、`setPreset(preset)`、`setOperator(1..6, patch)`、`setFeedback(0..7)` を使う。
- 実験用エンジンで `await useSoundChip('fm21290')` を使うと、上記に加えて `keyOn(CH1, 60, 100)`、`keyOff(CH1)`、`writeRegister(address, byte)` を使用できる。CodeのCH定数は0始まり、画面のCH表示は1始まり。アルゴリズムはAPIで0..31、画面で1..32。
- AUTOは16声から空いた発音枠を探索する。物理CH指定は同じ枠を再トリガする。MSFA選択時は自動割り当てを使う。

## Files

単音色SysExは選択中の枠に取り込み、バンクSysExは32枠を置き換える。Export voice / bankでYamahaのバイナリとして保存する。Cassette ZIPは32音色、選択中の枠、Code、読み込んだMIDIの原本をまとめて復元できる。ページを閉じる前に保存する。

MIDIはSMF形式0/1・PPQNに対応し、選択したパートを現在の音色で再生する。テンポ、ノート、ベロシティ、サステインを扱う。独自コアのベンド幅は暫定で±2半音。MSFA経路のベンド、プログラムチェンジ、途中シークは今後の対象。

## 検証

`node --test docs/synth-fm21290/*.test.mjs`。A4の定常区間の周波数、16声のゲート、32アルゴリズムの出力、時刻付き書き込み列のPCM再現、Cassette往復を検証する。実機測定と各アルゴリズムの倍音照合は今後の課題。

新規実装はリポジトリのBSD-3-Clause。アルゴリズム表はGoogle MSFAのApache-2.0ソースから移植した。JS音色変換と比較用WASMも既存アダプタのライセンスを引き継ぐ。[MSFAライセンス](../js/msfa_dx7/LICENSE) · [第三者表記](../js/msfa_dx7/THIRD_PARTY_NOTICES.md)
