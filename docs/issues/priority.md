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

今回の ON/OFF 拡張は S・A と MSX（Y8950 を含む）で一区切りとする。
YMF278B など残りのチップへの拡張は保留し、使用中に見つかった問題へ対応する。

- YM2612（S）：CH1～6 と PSG 全体は既存対応。CH6 は DAC も抑制する。
- YM2608（S）：FM CH と SSG / Rhythm / ADPCM-B は既存対応。
- YM2151（S）：8CH の ON/OFF を追加済み。コア → WASM → JS → Analyzer のボタンを接続。
  ミュート中もフィードバックを含めて計算し、出力だけを除外する。
- YMF262（S）：18CH ON/OFF を追加済み。4op はペア単位、リズムは CH7～9 のグループ単位。
- YM2413（A）：単独再生の9CH ON/OFFを追加済み。リズムは CH7～9 のグループ単位。
- YM2610（A）：既存の FM CH / SSG / ADPCM-A / ADPCM-B の検証を補強済み。
  通常 YM2610 の4FM CH、YM2610Bの6FM CHと音源別ミュート解除後の波形一致を実WASMで確認。
- YM2203（A）：FM 3CHを出力ミュートへ変更済み。キーオンを抑制せず、内部状態を維持する。
- YM2149（A）：既存 AY 3CH / 全体ミュートを検証済み。ON/OFF を再生画面の共通欄に統一し、操作時の音声 queue 更新を追加。
  AY8910 / YM2149 のトーン・ノイズ・エンベロープを実WASMで確認。
- Y8950（B / MSX）：FM 9CH・ADPCM・全体の ON/OFF を追加済み。リズムは CH7～9 のグループ単位。
- MSX 複合：搭載 AY 3CH・YM2413 9CH・Y8950 9CH / ADPCM と各音源全体を共通欄へ接続済み。
- 残りの B 以下は保留。未実装コアの導入は別の作業とする。

YM2612 / YM2608 の方式を完全に統一したわけではない。
既存方式の制約と拡張項目は [ch_on_off_01.md](ch_on_off_01.md) を参照。

## 保留：Sega PCM

Sega PCM のコア導入は当面保留。VGM のデータブロック `0x80`（ROM サンプル）と
レジスタ書き込み命令 `0xC0` は読み飛ばす。YM2151＋Sega PCM の曲は、
画面へ警告を表示して YM2151 側のみ再生する。Sega PCM の音は欠けるため完全再生ではない。

これは YM2612 の DAC 命令 `0x80`～`0x8F` とは別のもの。
データブロックは `0x67 0x66 0x80 ...` であり、このブロック内にはサンプル素材が含まれる。
外部 ROM の追加だけで対応できる問題ではない。

- 正常な未対応ブロックはサイズに従ってスキップする。
- 途中で切れたブロックは破損エラーとして扱う。
- 同種の警告はまとめて再生欄へ表示し、曲の切り替えで消す。
- 他の未対応チップ構成を一律に許可する変更ではない。
- 検証: [スキップと時刻保持](../../web/segapcm-skip.test.mjs)、
  [画面の警告・構成チェック](../vgm_analyzer/playback_warnings.test.mjs)。関連7テスト成功。

追加確認：Analyzer の構成チェック・警告関数と実 YM2151 WASM を接続した合成テストで、
Sega PCM ブロック／命令を含む入力の出力が OPM 単独の入力と一致することを確認済み。
警告はヘッダー・ブロック・命令で重複せず1件にまとめる。関連14テスト成功。


## YM2151 Operator Info

YM2151 専用の読み取り専用レジスタモニターを追加。
8CH × 4オペレーター、ALG/FB、KC/KF、左右出力、PMS/AMS、DT1/DT2、MUL、TL、KS、AR/D1R/D2R/D1L/RR、AM、LFO、ノイズを表示する。
TFI は YM2612 用として扱い、YM2151 の TFI 出力や編集機能は追加していない。

表示は再生処理が音源へ渡したレジスタ状態で、音声 queue の分だけ聴こえる位置に先行しうる。
Key は最後のキー命令であり、現在のエンベロープ段階ではない。CSMによる自動発音も推定しない。
Slot はレジスタ順（+00/+08/+10/+18）、アルゴリズム内部の順序は1/3/2/4。
再生前はゼロ初期値を表示し、曲の読み込み・リセットで状態をクリアする。

実装: `docs/vgm_analyzer/opm_monitor.js`。
レジスタ解釈の根拠は `src/ymfm_opm.h` / `src/ymfm_opm.cpp`。
関連8テスト成功、dev配布フォルダーとZIP再生成済み。ブラウザー実操作は未確認。

## YM2151 Note-ish

YM2151 の FM 8CH を Note-ish のライブ表示・曲全体タイムラインへ接続した。
`opm_notes.js` の `createOpmNoteTracker()` が KC/KF・キー命令・VGM時刻を受け取り、
ライブ表示とファイル全体の解析で同じ解釈を使う。既存OPN解析は変更していない。

- 基準クロック3579545 Hzに対する音程。実クロックの比率、KCの飛び番号、KFの1/64半音を反映。
- MIDI音高の小数値を表示に使うが、YM2151 の MIDI/MML エクスポートは未対応のまま。
- 基準音程・キー区間の推定であり、LFO・DT/MULによる変調、実際のエンベロープや余韻は再現しない。
- CH8ノイズ・部分キー指定・CSMは音程不明として扱い、タイムラインの音符から除外。
- ライブ履歴の表示は既存Viewの画面時刻に合わせるが、履歴にはVGMサンプル時刻も保持。
  音声queue分の表示先行は残る。曲全体タイムラインは44100 HzのVGM時刻を使用。
- 第1 YM2151 が対象。複数インスタンスの解析は今回の範囲外。

検証：KC/KF・クロック換算、発音と音程変化の区間、Player経由の時刻と分割再生、
リセット、Workerでのタイムライン抽出、ライブ表示への接続、タブ選択保持を自動テスト化。
関連20件＋既存Note-ish/PSG/MIDI/MML回帰44件成功。ブラウザー実操作・実曲は未確認。

- 実装: `docs/vgm_analyzer/opm_notes.js`
- テスト: `docs/vgm_analyzer/opm_notes.test.mjs`
- dev配布フォルダーとZIPも再生成し、138ローカル参照の依存ファイル検査を通過。

## YM2151 MIDI 出力

Note-ish の `extractOpmNotes()` を MIDI エクスポーターへ接続済み。
FM 8CH の基準音程・キー区間をSMF形式1へ出力し、KC/KFの音程変化はPitch BendとRPNの感度設定で表現する。
併用PSGのトーンも出力し、MIDIの打楽器チャンネルを避けて割り当てる。

音色・LFO・DT/MUL・可聴の余韻は再現しない。CH8ノイズ・部分キー指定・CSM区間は除外し、
その制限をMIDI内のテキストイベントにも記録する。ループは1周、テンポは手動指定。
YM2151のMML・音色エクスポートは引き続き未対応。

検証：SMFを独立に読み直し、8CH、ノート開始/終了、半音未満のベンド、再キーオン、
ノイズ/CSMの除外、併用PSG、UIのMIDI有効化とMML無効化を確認。
関連43テスト成功。dev配布とZIP再生成済み（139ローカル参照の検査成功）。
ブラウザー実操作・外部DAWへの読み込みは未確認。

## YM2151 OPM音色保存

Operator Info の各CHに Export OPM ボタンを追加。クリック時点のモニター状態を、
1音色（番号0）のVOPMテキストバンクとして `<曲名>_CH<n>.opm` に保存する。
4Operator、ALG/FB、PAN、AMS/PMS、LFO、CH8のノイズ設定を出力。
SLOTは現在のキービットを使用し、キーオフ時は試奏用に全4Operator（120）とする。
再生中の変更履歴・音程・エンベロープ位相・UIミュート状態は音色として保存しない。
モニターが音声queueより先行する制約は保存にも適用される。

実装: `docs/vgm_analyzer/opm_export.js`。関連13テスト成功、配布版再生成済み。
ブラウザーのダウンロード操作、VOPM/Furnaceへの実読み込み・聴感は未確認。
FurnaceのインポーターはLFO/PAN/SLOT/NEを読み捨てるため、保存した設定すべての再現は保証しない。
参照: [Furnace loadOPM](https://github.com/tildearrow/furnace/blob/master/src/engine/fileOpsIns.cpp)。

### OPM Export の配置変更

OPM保存は既存の Export グループへ移動。YM2151 のときだけ CH1～8 選択と Export OPM を表示する。
Operator Info内の個別保存ボタンは削除。曲の読み込み時はCH1へ戻す。
対象チップ・ファイル有無による有効化と、選択CHのクリック時点の保存を含め関連12テスト成功。
今後Exportが増えた場合は、チップごとの提供アクションを定義し、共通欄で表示・有効化する構成を検討する。

### All OPM ZIP

CH選択を廃止し、ExportグループのAll TFI ZIP / All VGI ZIPと同じ行にAll OPM ZIPを配置。
クリック時点の全8CHを一度に取得し、CH1.opm～CH8.opmを `<曲名>_all_opm.zip` にまとめる。
曲全体の音色変更履歴の抽出ではなく、現在値の全CH保存。無音CHも含む。
関連7テスト成功（ZIP内の8ファイル名・CH別内容とUI有効条件を確認）。

### All と Snapshot の区別（更新）

- Snapshot OPM：従来の全8CH現在値ZIPを改名。`<曲名>_snapshot_opm.zip`。
- All OPM ZIP：曲全体を1回走査し、キーオン時とキーオン中の音色設定変更を収集。
  CHごとにOPMの保存内容で重複排除し、`CH1_001.opm`等を `all_opm_patches.zip` に保存する。
  音程変更だけでは新音色を作らない。キーオフ中の設定は次のキーオンで収集する。
  各ファイルのコメントに初出のVGMサンプル時刻を記録する。
  キーオン中の連続書き込みは途中の設定も収集するため、曲によってはファイル数が多くなる。

Allはライブ音源・再生位置に依存しない。ループを展開せず、第1 YM2151のみ対象。
既存TFIはキーオン時収集であり、OPMはキーオン中の変化も追加で扱う。
関連8テスト成功。dev配布版・ZIP再生成と142ローカル依存参照の検査も完了。

## YM2151 MML 出力（更新）

Export の MML から **MXDRV (MDX)** を選び、FM 8CH（A～H）の音符と音色定義を
`.mml` に保存できるようにした。上記の「MML未対応」はこの更新で解消。
[mml2mdr](https://mml2mdr.navy-ceder.workers.dev/) に渡して MDX へ変換する構成。
MDR拡張ではなく、通常のMXDRV向けMMLを出力する。

- Note-ishと同じ音程・キー区間の抽出を使い、手動BPM、16分音符単位、半音単位で出力する。
- 音符・音程変化の境界で音色を取得し、重複を除いて最大256音色の定義と切り替えを出力する。
- 4OperatorのパラメーターとALG/FBを保存。同じキー・音色の連続した音程変化はレガートで接続する。
- PCM/PSG、CH8ノイズ、部分キー指定、CSMは対象外。ループは1周のみ。
- 保持音の途中の音色書き込み、PAN、LFO、可聴の余韻は再現しない。
  元クロックから基準音程を換算するが、4MHz向けMDXとのエンベロープ・DT等の差は残る。
- テンポはMXDRVのタイマー値に丸め、実際の換算BPMと上記制限をMML内のコメントに残す。

実装: `docs/vgm_analyzer/opm_mml.js`。
テスト: `docs/vgm_analyzer/opm_mml.test.mjs`。
8CH、音色切り替え、レガート、除外区間、チップによるMML選択肢の切り替えを検証。
関連49テスト成功。指定サイトのWASMコンパイラーでも合成入力をMDXへ変換し、
生成バイナリーの音符・長さ・音色・Operator順序を検証した。
コンパイラー統合テストは `MML2MDR_DIR` に `mml2mdr.js` と `mml2mdr.wasm` がある場合に実行し、
未指定時はスキップする。外部コンパイラーはリポジトリーへ同梱しない。
dev配布版・ZIPを再生成し、146ローカル依存参照の検査成功。
ブラウザーでの実操作・実曲の変換と聴感は未確認。

参照: [mml2mdrヘルプ](https://mml2mdr.navy-ceder.workers.dev/help)、
[MXDRV MMLコマンド資料](https://github.com/vampirefrog/mdxtools/blob/master/docs/MML.md)。
