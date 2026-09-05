VGM → JavaScript Export に、現在の Note-ish High とは別に「簡易版 / Compact Note-ish」出力モードを追加してください。

目的は、MML化や音楽的な量子化ではありません。
現在の Note-ish High の再生結果・タイミング・KEY ON/OFF・音色を可能な限り維持したまま、人間が読みやすいJavaScriptへ機械的に簡略化することです。

重要:

* BPM推定しない
* 音符長へ量子化しない
* sleepSamples() のsample値を丸めない
* KEY ON/OFFのタイミングを変更しない
* 和音・コード・小節・フレーズを推測しない
* MMLへ変換しない
* 音楽的意味を推測して最適化しない

現在このようなコードがあります。

fm.setFrequency(CH1, 3, 1284);
await sleepSamples(3);
fm.setOperators(CH1, [
  [OP1, { tl: 30 }],
  [OP3, { tl: 27 }],
  [OP2, { tl: 30 }],
  [OP4, { tl: 38 }],
]);
await sleepSamples(2);
fm.keyOn(CH1);
await sleepSamples(7342);
fm.keyOff(CH1);
await sleepSamples(12498);
fm.setFrequency(CH1, 3, 1284);
await sleepSamples(3);
fm.setOperators(CH1, [
  [OP1, { tl: 30 }],
  [OP3, { tl: 27 }],
  [OP2, { tl: 30 }],
  [OP4, { tl: 38 }],
]);
await sleepSamples(2);
fm.keyOn(CH1);
await sleepSamples(5137);
fm.keyOff(CH1);
await sleepSamples(1473);

同じfrequencyや同じoperator設定が前回から変わっていない場合、それを毎回出力しないようにしてください。

まず各CHについて現在状態を追跡してください。

例:

* frequency / BLOCK / FNUM
* operator parameters
* algorithm / feedback
* pan
* LFO関連
* その他、再生結果に影響するYM2612状態

register writeまたはfm APIの値が現在状態と同じなら、JavaScript出力から省略できるか検討してください。

ただし、単純に同じ値だから削除するのではなく、YM2612上でそのwrite自体に副作用がある場合は削除しないでください。

さらにKEY ON/OFFについて、出力専用helperを使用して簡略化してください。

例えば:

async function keySamples(channel, samples) {
  fm.keyOn(channel);
  await sleepSamples(samples);
  fm.keyOff(channel);
}

これにより、

fm.keyOn(CH1);
await sleepSamples(7342);
fm.keyOff(CH1);
await sleepSamples(12498);

を、

await keySamples(CH1, 7342);
await sleepSamples(12498);

と出力できます。

Note-ish modeでは、既に音名へ変換可能なfrequencyについては、

setNoteFrequency(CH1, "E4", 3);

など、既存のNote-ish表現を維持してください。

最終的には例えば、

setNoteFrequency(CH1, "E4", 3);
fm.setOperators(CH1, [
  [OP1, { tl: 30 }],
  [OP3, { tl: 27 }],
  [OP2, { tl: 30 }],
  [OP4, { tl: 38 }],
]);
await keySamples(CH1, 7342);
await sleepSamples(12501);
await keySamples(CH1, 15427);
await sleepSamples(3678);
await keySamples(CH1, 7342);
await sleepSamples(12498);
await keySamples(CH1, 5137);
await sleepSamples(1473);
await keySamples(CH1, 5140);
await sleepSamples(1470);

のように、同じ音・同じ音色が続く場合は、それらを繰り返し書かず、KEY ON/OFFと時間の変化が中心に見える出力を目標にしてください。

今回は配列化、

notes([...])

や、

pattern(...)

のような高レベルな独自記法までは作らないでください。

まずは「既存JavaScriptの意味を維持したまま、冗長な状態設定を除去する」だけにしてください。

既存の Raw / Note-ish High は変更せず、新しい Compact Note-ish モードとして追加してください。

実装後、同じVGMについて

1. Note-ish High
2. Compact Note-ish

を生成し、再生結果が同じになることを確認してください。
特にKEY ON/OFFタイミング、pitch、TL変更、patch変更が失われていないか確認してください。
## 補足：意味を維持するための実装条件

### 削除対象は確認済みの設定に限定する

「その他、再生結果に影響するYM2612状態」を一括して最適化しない。
まず、同じ値の再書き込みに副作用がないと確認できた設定だけを許可リストで扱う。
対象と判断根拠は実装時に明記する。

KEY操作、DAC、タイマー、特殊モード制御などは同値でも削除しない。
LFOも単なる値比較で削除可能とは仮定しない。
不明なraw writeは維持し、関係する追跡状態が不確かになる場合はその状態を無効化する。
全体へ影響する操作はCH単位の状態だけで判断しない。

周波数には上位・下位レジスターのラッチ動作がある。
単独の上位書き込みを「同値」として消さず、確定したBLOCK/FNUMの組と、
その書き込みが後続のラッチ利用へ与える影響を含めて判定する。
判断できない書き込みは元のまま残す。

Note-ish Highとの比較を基準とするため、音名へ丸めた後の実際のBLOCK/FNUMを追跡する。
音名だけが同じという理由では省略しない。

### ループ先頭の設定を保護する

各CHの各設定について、周回内の最初の設定は残す。
前周回の終了時には別の音程・音色になっている可能性があり、初回再生だけを見た
最適化では2周目以降の結果が変わる。

開始時の既定音色や前回のRun状態にも依存しない。
省略判定の初期状態は「不明」とし、生成コードが実際に設定した内容から追跡する。
周回をまたぐ設定の除去は今回の対象外とする。

### 待ち時間を失わない

状態設定を削除しても、前後のsleepSamplesのサンプル数は保持する。
削除によって隣接した待ち時間は、整数のサンプル数を正確に加算してまとめてよい。

例の3 samples、2 samplesも次のKEY ONまでの時間に含まれる。
音色設定やKEY操作を、短い待ち時間をまたいで移動しない。
全CHで共通の時間原点を維持し、CH分割後も元の絶対時刻とイベント順を保持する。

本文の最終コード例は出力の見た目を示すイメージであり、冒頭のコードと同値な
変換結果ではない。発音回数・待ち時間の具体値をその例に合わせて変更してはいけない。

### keySamples()へ置換できる条件

まず、対象CHの完全なKEY ON、待ち時間、完全なKEY OFFという厳密な並びだけを置換する。
間に音程・TL・音色変更、再KEY ON、その他の操作がある場合は元のコードを維持する。
部分オペレーターのKEY操作は今回helper化しない。

CH非分割の出力では、他CHやglobalの操作が挟まる場合もまとめない。
CH分割の出力でも、同期や同時刻の順序が変わらないことを検証する。
helperは既存と同じsleepSamplesをawaitし、独自タイマーを追加しない。

### 比較テスト

Note-ish Highを基準に、生成した両方のJavaScriptを実行して比較する。
重複設定を削除するため、全register write列の単純な一致は完了条件にしない。

- KEY ON/OFFの回数、マスク、絶対サンプル時刻、順序が一致する。
- 各観測時点の実際のBLOCK/FNUM、TL、音色設定が一致する。
- 同値でも副作用がある書き込みや、不明な操作が失われない。
- 待ち時間の合計と、周回の長さが一致する。
- CH分割あり／なし、同時刻イベント、2周以上のループで比較する。
- 周回末と先頭で異なる音色・音程、周波数ラッチの利用、部分KEY操作、
  発音中のTL・pitch変更など、省略やhelper化してはいけないケースを含める。

数値・状態のテストに加えて、同じVGMの両出力を聴き比べる。
実際の音声比較を行っていない場合は、テストだけで再生結果を確認済みとは報告しない。


## 初期実装の範囲

PlaygroundのVGM Importに独立した `Compact Note-ish` を追加。YM2612入力・出力が対象で、
Note-ishを常に使用する。既存HighのNote-ishチェック状態には依存しない。

- 全CHの元のイベント順で状態追跡し、省略判定後にCHを分割する。
- 同値除去は0x30〜0x8Fの通常オペレーターパラメーター、ALG/FB、PAN/AMS/PMSに限定。
  これらの同値書き込みは通常のレジスター設定であり、KEYやタイマーのような発火操作ではない。
  SSG-EG、LFO、KEY、DAC、タイマー、特殊モード等は除去しない。
- 周波数は全書き込みが隣接した上位・下位の組で、特殊モードがない場合だけ同値の組を省略。
  次の周波数操作も上位から書くため、省略した上位ラッチを後続が参照しないことを条件にする。
  生のBLOCK/FNUMが同じ場合のみ省略する保守的な実装で、異なる値が同じ音名へ丸まる場合は残す。
- 未知の操作は保持して追跡状態を無効化。KEYとDACデータは追跡対象の設定を変えないため例外。
- 各設定の初回書き込みを保持。周回末から先頭への最適化は行わない。
- 待ち時間は保持したイベントの絶対サンプル時刻から生成し、削除された操作の時間を失わない。
- `keySamples()` は整形後の完全KEY ON・sleepSamples・完全KEY OFFの3行だけを置換。
  部分KEYや途中の操作はそのまま残す。

生成JavaScriptを実行し、2周回・CH分割あり／なしで状態変化、KEYイベント、
総サンプル時間を比較する。周波数ラッチ、LFO重複、部分KEY、発音中TL変更も確認する。
ブラウザでの実音比較は未実施。
