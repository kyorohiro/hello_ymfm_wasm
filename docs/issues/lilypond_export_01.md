# LilyPond Export

VGM Analyzer の Export → LilyPond から、編集用の `.ly` を保存する。
BPM は推奨値を初期表示し、ユーザーが変更できる（整数 4–999）。推定できない場合は 120。
出力 CH をチェックボックスで選択でき、音符のない CH は初期状態で選択しない。
同じ曲でダイアログを開き直した際は変更を保持し、曲が変わった際に初期化する。

- 対象: YM2612 / YM2203 / YM2608 / YM2610(B) / YM2151 と PSG/SSG のトーン。
- MIDI / Note-ish と同じ音符抽出器を使用する。複合音源は既存抽出器の選択範囲に従う。
- CH ごとの五線譜。中央付近の音高からト音・ヘ音記号を選択。
- 16分音符グリッド、4/4 を仮定。休符、小節線、小節をまたぐタイを生成する。
- 同じキー区間で半音丸め後の音が同じなら連結する。別キーイベントは連結しない。
- 最終小節は休符で埋め、CH 間の開始・終了位置を合わせる。
- ファイル名は引用符・バックスラッシュ・制御文字を処理して文字列として出力する。

原曲の譜面を復元するものではない。拍子・調号・弱起・三連符の推定は行わない。
テンポ候補は下記のグリッド適合から求める。
PCM、ノイズ、音色、LFO、連続的な音程変化、残響的なリリースは再現しない。
不明な音程は休符になり、グリッドより短い区間は消える場合がある。
ループは展開しない。省略数と抽出器の警告は `.ly` 内のコメントへ残す。

## 検証

```sh
node --test docs/vgm_analyzer/vgm_lilypond.test.mjs docs/vgm_analyzer/operator_tabs.test.mjs
```

音名、オクターブ、休符、タイ、小節長、再キー、丸め、BPM、文字列処理、
実パーサーからの YM2612/YM2151/PSG 出力、ダウンロード操作を自動テストする。
同梱の LilyPond WASM で SVG 組版を実行確認済み。PDF 出力は未対応。
保存したファイルは LilyPond 環境で `lilypond music.ly` として組版できる形式を目指す。
実曲での可読性と組版結果は今後の確認対象。

- 実装: [vgm_lilypond.js](../vgm_analyzer/vgm_lilypond.js)
- [LilyPond 2.24 音高記法](https://lilypond.org/doc/v2.24/Documentation/notation/writing-pitches)
- [LilyPond 2.24 音価・タイ](https://lilypond.org/doc/v2.24/Documentation/notation/writing-rhythms)

## BPM 候補の推定

音符抽出結果の異なるキーオン間隔を使い、70–180 の整数 BPM を探索する。
直前だけでなく 2・4 個前のキーオンとの間隔も16分グリッドへの適合で評価する。
保持音の音程変更は新しいキーオンとして数えない。長い曲では曲全体から間隔を間引く。
有効間隔が8個未満、または平均グリッド誤差が0.09セルを超える場合は120へ戻す。
ほぼ同じ適合度なら120に近い候補を優先する。最大3候補を画面に表示する。

これはグリッド選びの補助で、原曲の正確なテンポ検出を保証しない。
半分・倍のテンポ、三連符、テンポ変化、開始位置のずれはユーザーの判断が必要。
推定は選択前の全対象CHから行い、CH選択でBPMを勝手に変更しない。
テストは合成キーオン列の候補、推定不能時の120、CH選択、手動変更保持と曲切替を含む。

## ブラウザー内 Preview

Export → LilyPond で BPM と対象 CH を選び、Preview を押すと SVG の楽譜を表示する。
Export .ly は従来どおり編集用ソースを保存する。Preview の各ページは SVG として保存できる。
生成処理は専用 Worker で実行し、キャンセル・ダイアログ終了時に破棄する。
エラーは画面へ表示し、正常生成時の診断も展開して確認できる。3分でタイムアウトする。

[hlolli/lilypond-wasm](https://github.com/hlolli/lilypond-wasm) の
0.1.0-alpha.1（LilyPond 2.27.2 / Guile 3.0.11）を使用する。
WASM とランタイムは初回 Preview 時に読み込む。約72 MiB（HTTP 圧縮前）。
楽譜データは外部へ送信しない。配布 ZIP にも依存ファイルとライセンスを含める。
取得元、固定バージョン、変更内容、ソース情報は [vendor README](../vgm_analyzer/vendor/lilypond/README.md) に記録する。

```sh
node --test docs/vgm_analyzer/lilypond_preview.test.mjs docs/vgm_analyzer/vgm_lilypond.test.mjs docs/vgm_analyzer/operator_tabs.test.mjs
node scripts/check_lilypond_wasm.mjs
sh scripts/package_itch_vgm_analyzer.sh dev
```

2026-09-15: 関連19テスト成功。Node の file fetch/self 補助環境で、配布する Worker と実 WASM を実行し、
最小4音の1ページ、およびユーザーの Jungle .ly の8ページの SVG 生成を確認した。
実曲ファイルはリポジトリに含めていない。ブラウザー操作環境を利用できなかったため、
実ブラウザーでの表示・クリック操作は未検証。生成確認と画面検証は区別する。

### 生成中の診断

途中経過と経過秒数を表示し、診断は直近200件を生成中から表示する。
音符抽出の PCM 警告は Console に繰り返さず集約する。
WASI の標準ストリームに対する fd_tell は、従来と同じ NOTCAPABLE を返しつつ
正常生成でも出る3件の例外ログを抑制する。ファイルへの権限は変更しない。
ユーザー環境での長時間停止の原因は未特定であり、このログ抑制を停止解消とは扱わない。

### WASM スタック上限の再現

`node --liftoff-only scripts/check_lilypond_wasm.mjs` で最小4音でも
`Maximum call stack size exceeded` を再現（wasm-function[6130] の再帰）。
通常の Node 実行では同じ WASM と入力で生成成功する。楽譜を小節単位でまとめても
非最適化実行時の失敗は変わらず、曲の長さだけの問題ではない。
[V8 の説明](https://v8.dev/docs/wasm-compilation-pipeline#debugging)では
DevTools を開くと WASM が Liftoff へ切り替わるため、開発者ツールを閉じて
ページを再読み込みする回避方法を画面に案内する。ユーザー環境での原因確認は継続中。
Worker の Error.stack を Diagnostics に残す。WASM 本体の再帰処理の修正は未実施。

ユーザー確認: 開発者ツールを閉じて再試行した後、Preview 表示成功の報告あり。
生成終了後に Cancel rendering が残っていた UI を修正し、生成中だけ表示する。

### Safari 向けスタック消費の低減 (2026-09-15)

元の WASM の function 6130 はローカル変数を420個持つ。
Binaryen 132 の `--coalesce-locals --vacuum` で21個に削減した。
`--all-features` は新しい出力形式まで有効にするため使わず、入力の機能を維持する。
8 MiB の線形メモリ内スタックのサイズ変更はしていない。

修正版で Node `--liftoff-only` の最小4音が1ページ、Jungle 全9段が8ページの
SVG生成に成功。変更前はどちらもスタック上限で失敗していた。
通常 Node の最小4音も成功。これは Safari 自体での成功確認とは区別する。
Safari の画面操作はユーザー操作と競合したため、実画面確認は保留。

再生成手順は `scripts/optimize_lilypond_wasm.py` と vendor の SOURCE.md に記録。
WASM URL と JS のバージョンを更新し、以前のバイナリのキャッシュと区別する。
