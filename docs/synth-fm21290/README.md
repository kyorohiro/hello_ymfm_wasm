# Tetorica FM21290 Synth

[Browser版](index.html) · [レジスタと根拠](registers.md) · [作業状況](../issues/todo_fm21290_synth_01.md)

この開発版は同じDX7音色を、実験用OPS/EGSコアまたは既存MSFAで演奏する。ローカルで使う場合はリポジトリのルートで `python3 -m http.server --directory docs 8080` を実行し、`http://localhost:8080/synth-fm21290/` を開く。

最初の音色はオリジナルの **GLASS STEP**。Codeの **Run** でCH1の低音とCH2のベルが始まる。`0x30c1` への書き込みを36から12に変え、**Apply** するとCH2のOP2による変調が深くなる。**Stop** で停止する。KeyboardではAからKの列とその間の黒鍵で演奏する。Waveform / SpectrumはMaster後の出力を観測する。

**Return Steps** はAlgorithm 4の帰還を聴き比べるCodeサンプル。Filesでサンプルをダウンロードし、同じFilesで読み込む。OPS / EGSで空き音色枠を選んでRunすると、その枠に音色を設定する。同じ4音をCH1（FB 0）とCH2（FB 7）が交互に演奏する。[Return Stepsのコード](examples/return-steps.js)

**Operators** の図では実線の矢印が変調先、OUTにつながるOPがキャリア、橙の破線がフィードバック経路を示す。OPをクリックするかTabで選んでEnterを押すと、そのOPの編集欄に切り替わる。Algorithm 4ではOP6 → OP5 → OP4を通り、OP4からOP6へ戻る。

**Oscillator key sync** は各音色の設定。OPS / EGSでオンにすると押鍵時に6つのOPが位相ゼロから始まる。オフにすると、同じ物理CHでも打鍵間隔によって波形の開始位置が変わる。LFOのKey syncは別に設定できる。

**LFO** は全声共通。独自エンジンで音高の揺れを試すには、Sine、Speed 40、Pitch depth 40、Pitch sensitivity 4にして鍵盤を長押しする。振幅の揺れはAmplitude depthと各OPのAM sensitivityで調整する。Register writesにはAMとPMの現在のバイト値が出る。MSFA経路は同梱エンジンのLFO実装を使う。

**Pitch envelope** は各声の音高を押鍵から離鍵まで変化させる。INIT音色でL1〜L3を82、L4を50、R1を60にしてA4を長押しすると、440 Hzから880 Hzまで上昇する。あとから弾いた鍵は、その鍵の押鍵時点から上昇する。

## JavaScript

- `await useSoundChip('dx7')` は現在選択中のエンジンで `noteOn(note, velocity)`、`noteOff(note)`、`getPreset()`、`setPreset(preset)`、`setOperator(1..6, patch)`、`setFeedback(0..7)` を使う。
- 実験用エンジンで `await useSoundChip('fm21290')` を使うと、上記に加えて `keyOn(CH1, 60, 100)`、`keyOff(CH1)`、`writeRegister(address, byte)` を使用できる。CodeのCH定数は0始まり、画面のCH表示は1始まり。アルゴリズムはAPIで0..31、画面で1..32。
- 独自コアのCodeでは `chip.setSustain(true)` を呼び、`noteOn` → `noteOff` で鍵を離しても音を保持できる。`chip.setSustain(false)` でペダルを戻す。物理CHを指定する `keyOff(CH1)` は即座にゲートを切る。
- AUTOは16声から空いた発音枠を探索する。物理CH指定は同じ枠を再トリガする。MSFA選択時は自動割り当てを使う。

## MIDI出力

CodeからはPlaygroundと同じ出力ハンドルを使える。以下は選択中の音色でC4とG4を1拍ずつ鳴らす。

```js
const out = midi.output('tetorica-fm21290', {channel: CH4});
await out.play('C4', {duration: 1, velocity: 90});
await out.noteOn('G4', {velocity: 80});
await beat(1);
await out.noteOff('G4');
```

この出力のノートはAUTOで割り当てる。CH4は論理MIDIチャンネルで、物理ボイスの指定には従来の `chip.keyOn(CH4, ...)` を使う。

外部機器にもノートを送るには、**MIDI output → Find MIDI outputs → Device** でポートを選ぶ。外部送信の初期値はOff。鍵盤・SMFの選択パート・従来のCode APIは **Send channel**、上の出力ハンドルは指定したMIDIチャンネルを使う。同一チャンネル・同音のゲートは最後の離鍵で閉じる。ポート切替時は旧ポートを離鍵し、新しいポートには次の打鍵から送る。サステインは離鍵時刻に反映する。外部送信に対応するメッセージはNote On／Offで、音色は受信機側で選ぶ。Web MIDIが利用できるブラウザで使用する。

## Keyboard・Code・MIDIを重ねて演奏する

独自コアのAUTOでは同じ音高でも入力ごとに別の物理CHを使う。CodeのStopはCodeの音、Stop MIDIと曲末はMIDIの音だけを離鍵する。MIDIのCC64とCodeの `setSustain` は各入力のノートに作用する。物理CHを明示して再打鍵すると新しい演奏がそのCHを引き継ぎ、以前の演奏から遅れて届いた離鍵を無視する。

MSFAは同じ音高へのNote Offで該当する全声を解放するため、異なる入力で重なる同音は最初の打鍵を共有し、最後の入力が離した時点で解放する。独自コアの音色・ピッチベンド・生レジスタは共有で、直接 `0x30f1` に書く操作は指定した物理CHに届く。

## レジスタの記録と再演

OPS / EGSで **Record from reset** を押すと現在の演奏を止め、リセットと選択音色の適用から記録する。その後Keyboard、Code、MIDI、または手動レジスタ書き込みで演奏し、**Finish recording** を押す。**Export trace** でJSONに保存し、**Load trace → Replay** で再演できる。再演開始時にも現在の演奏は止まる。

**Event index** で各書き込みのサンプル位置・番地・値を参照できる。**Inspect physical voice** では選択したCHのアルゴリズム、FB、ピッチワード、OP1〜6の出力バイトとモデル上のEG段階を演奏中・再演中に確認できる。記録は最大20万イベント。同じサンプルレートを使用する。Master以降の音量は再演時の設定に従う。

## Files

単音色SysExは選択中の枠に取り込み、バンクSysExは32枠を置き換える。Export voice / bankでYamahaのバイナリとして保存する。Cassette ZIPは32音色、選択中の枠、Code、読み込んだMIDIの原本をまとめて復元できる。ページを閉じる前に保存する。

MIDIはSMF形式0/1・PPQNに対応し、選択したパートを現在の音色で再生する。テンポ、ノート、ベロシティ、サステインを扱う。独自コアのベンド幅は暫定で±2半音。MSFA経路のベンド、プログラムチェンジ、途中シークは今後の対象。

## 検証

`node --test docs/synth-fm21290/*.test.mjs`。A4の定常区間の周波数、16声のゲート、32アルゴリズムの出力、時刻付き書き込み列のPCM再現、Cassette往復を検証する。全32アルゴリズムの定常音は `node scripts/compare_fm21290_spectrum.mjs` で同梱MSFAと第8倍音まで比較できる。単一OPのFB 0〜7とAlgorithm 4/6の帰還経路も検査する。実機の帰還量とスロットタイミングは未測定。

新規実装はリポジトリのBSD-3-Clause。アルゴリズム表はGoogle MSFAのApache-2.0ソースから移植した。JS音色変換と比較用WASMも既存アダプタのライセンスを引き継ぐ。[MSFAライセンス](../js/msfa_dx7/LICENSE) · [第三者表記](../js/msfa_dx7/THIRD_PARTY_NOTICES.md)
