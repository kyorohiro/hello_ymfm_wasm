# YM2151音色のTFI変換出力とPlaygroundでの利用

## 方針（更新）

変換は **VGM AnalyzerのExportグループ** で行う。
YM2151でも既存の **All TFI ZIP / Snapshot TFI** を使えるようにし、
Playgroundでは生成したTFIを既存のOperatorエディター・鍵盤で編集・試奏する。
Playgroundの発音はYM2612／OPN専用のままとする。

以前検討していたPlaygroundへのOPMインポート、OPM専用エディター、
OPM Infoへの個別TFI変換ボタン追加は今回行わない。
既存のOPM保存は元のYM2151設定を残す用途として維持する。

```text
VGM（元チップ・クロックあり）
  → Analyzer Export
      ├─ All OPM ZIP / Snapshot OPM：元設定を保存
      └─ All TFI ZIP / Snapshot TFI：YM2612向けに近似変換
           → Playgroundの既存TFI編集・鍵盤試奏
```

## 実装済みの内容

- [x] YM2151でAll TFI ZIP / Snapshot TFIを有効化。
- [x] Allは曲全体を1回走査し、CHごとの音色変化を収集。
      All OPMと同様に、キーオン時とキーオン中の設定変更を含め、元OPM内容で重複排除する。
- [x] Snapshotはクリック時点の全8CHを保存。未発音のCHも含む。
- [x] 元のOPMと変換記録をTFI ZIPへ同梱。
- [x] 個別OPM・All OPM・Snapshot OPMの出力へ、取得できる元クロックをコメントとして付記。
- [x] 出力後のステータスとTFIボタンの説明で近似変換の制限を表示。
- [x] Analyzerの配布スクリプトへ変換モジュールを追加。

Allの走査はライブ再生位置から独立している。ループは展開しない。
Snapshotはモニターの現在値なので、音声queueの分だけ聴こえている位置より先行し得る。
第1 YM2151のみが対象。VGI出力はYM2151では引き続き無効。

## 変換方式：opm-to-ym2612-basic-v1

初期版は対応する基本音色パラメーターを移す近似変換。
元クロックは保存するが、エンベロープやDTの時間・周波数特性の補正はまだ行わない。
元と同一の音を再現するという意味ではない。

| YM2151 | TFI / YM2612への扱い |
| --- | --- |
| ALG / FB | 同じ値を移す |
| MUL / DT1 / TL | MULTI / DT / TLへ移す。DTのTFI符号化は既存変換を使う |
| KS / AR / D1R / D2R / RR / D1L | RS / AR / D1R / D2R / RR / SLへ移す |
| Operator順 | 物理スロット順から論理Operator 1,3,2,4へ対応付け、既存TFI生成関数に渡す |
| DT2 | 省略。非ゼロなら個別警告を記録。Operator間の周波数比が変わり得る |
| LFO / AMS / PMS / AM | 保存しない。変調を使う音色には個別警告を記録 |
| CH8ノイズ | 保存しない。変換後はFM音になることを警告 |
| PAN / Operatorのキーマスク | TFIに保持しない。部分キー指定は個別警告を記録 |
| SSG-EG | 0（無効）として出力 |

VGM演奏をYM2612向けに変換する既存のFNUM／BLOCK補正とは別の処理。
TFIには音高列も元クロックもなく、音高はPlaygroundの鍵盤側が設定する。
クロック比を音色の全パラメーターへ一律に掛ける処理は行わない。

## ZIPの内容

```text
CH1_001.tfi
CH1_002.tfi
...
source/CH1_001.opm
source/CH1_002.opm
...
conversion.json
```

Snapshotの音色名はCH1～CH8。AllはCHごとの連番。
Allでは異なる元音色が同一のTFIへ変換される場合もあるが、元設定との対応を残すため統合しない。

`conversion.json`には次を記録する。

- 変換方式の版、All／Snapshotの区別、元ファイル名。
- 元チップYM2151、変換先YM2612、想定する変換先クロック7,670,454 Hz。
- クロック補正が未実施であること（`clockCompensation: "none"`）。
- 各TFIと元OPMの対応、CH、元クロック。
- VGMサンプル単位（44,100 Hz）の抽出時刻。Snapshotで取得できない場合はnull。
- 変換全体の制限と音色ごとの警告。

TFI単体を持ち出すと元クロック等の情報は付かない。
調査・再変換用にはZIPと元VGMを保持する。
Playgroundの新しいOPM/JSONインポートや自動再変換は実装していない。

## OPMのクロックコメント

```text
// Tetorica-Metadata-Version: 1
// Tetorica-Source-Chip: YM2151
// Tetorica-Source-Clock-Hz: 4000000
```

既存のOPMフィールドは変更しない。
元クロックはVGMヘッダーのチップ数・派生種別フラグを除いたHz単位の値。
取得できない場合はコメントを付けず、推測値を元クロックとして記録しない。
OPMの音色重複判定にはこれらのメタデータを使わない。

以前の案にあった「外部OPMのクロック不明時に3,579,545 Hzを仮定する」処理は、
OPMインポートを今回見送ったため未実装。今回のTFI変換は元VGMのクロックを記録する。

## 検証

- 異なるOperator値を与え、生成TFIの42バイトと既存Playgroundエディターでの論理順を確認。
- Allの発音中変更・重複排除、Snapshotの8CH出力を確認。
- 元OPMのクロックコメントとconversion.jsonのCH・時刻・クロックを確認。
- 元スナップショットを変換で変更しないことを確認。
- 実際のExport関数でAll／Snapshotが別の入力を使用し、ZIPを保存することを確認。
- YM2151でのTFI有効化、ファイル未読込時の無効化、VGI無効の維持を確認。
- 既存OPM保存、OPM Info、MML、TFI編集・試奏を回帰確認する。

ブラウザーでのダウンロード・Playgroundへの実ファイル取り込みと聴感は未確認。
エンベロープ・DT・DT2等をより近づける変換は、参照実装と期待値を確認してから追加する。

## 関連ファイル

- [OPM→TFI変換とZIP内容の生成](../vgm_analyzer/opm_tfi.js)
- [変換・Exportテスト](../vgm_analyzer/opm_tfi.test.mjs)
- [OPM出力・抽出](../vgm_analyzer/opm_export.js)
- [Analyzerの保存UI](../vgm_analyzer/vgm_analyzer.js)
- [PlaygroundのTFIエディター](../playground/playground_tfi_editor.js)
- [OPNの演奏クロック補正](../../web/opn_fm_vgm.js)
- [TFI形式](../../web/tfi.js)
