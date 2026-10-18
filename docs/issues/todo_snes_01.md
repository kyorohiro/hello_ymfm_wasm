# SNES / SPC 対応計画

更新日: 2026-10-18

## 目的

ゲーム固有のサウンドドライバーを個別解析せず、SPC700 CPUとS-DSPを実行して、
SPCファイルの楽曲再生・BRR抽出・音色再利用を実現する。
既存のAnalyzer、AudioWorklet、Mixer、Virtual Files、Playgroundの仕組みを利用する。
大規模な共通化やゲーム機本体のエミュレーションは行わない。

## 最初の完成条件

- SPCを読み込み、ブラウザーで音を再生できる。
- Play / Pause / Stop / 再開始、音量、再生位置、メタデータを扱える。
- 音源計算はAudioWorkletで実行し、UIスレッドで継続生成しない。
- 内部32,000HzステレオPCMを出力レートへ変換する。
- 読み込み途中の停止・ファイル切り替え・再初期化・終了で古い処理を残さない。
- 合成SPCによる自動検証と、ネイティブ版とのPCM比較を通す。

BRR抽出、楽器としての演奏、詳細なDSP解析は下記の独立段階として進める。
SPC再生を、これらの全機能の完成まで待たせない。

## エンジン選定

候補:

- [snes_spc](https://github.com/blarggs-audio-libraries/snes_spc): C++、SPC CPUとDSP単独のAPI、LGPL。
- [spc700-js](https://github.com/digital-sound-antiques/spc700-js): TypeScript、ISC。上流READMEにGaussian補間、DSPの実行粒度、ダンプ中の持続音復元の近似が記載されている。

採用: **snes_spc 0.9.0 accurate DSP**、コミット `ec8ee2bbe30451614c1d02a83f7af1c97d497d45`。
C++のCPU/DSP分離とネイティブ比較のしやすさを優先した。LGPL-2.1-or-later。
fast DSP、SPC_Filter、テンポ変更、surround無効化は使用しない。
採用コードのコミット、ライセンス、変更点、ビルド方法をthird_partyに残す。
WASMを配布する場合は対応するラッパー、上流ソース、再ビルド方法も同梱する。
未検証のゲーム互換性や実機との完全一致を主張しない。

## 設計上の分離

### SPC Player

CPU・タイマー・RAM・S-DSPを含む自律した再生インスタンス。
ファイルに含まれるドライバーがDSPを操作する。BPMやWorkerの音符先読みで再生速度を変えない。

### SNES SoundChip

別のRAMとS-DSPを持つ楽器インスタンス。ゲームのCPUは実行しない。
SPC Playerと同じDSP実装を使い、BRR・ディレクトリー・ADSR/GAIN等をPlaygroundから設定する。
固定8ボイスのチャンネル指定を基本とし、自動ボイス割り当ては独立した上位機能として扱う。
SPC再生中のRAM/DSPへ楽器の命令を書き込んでドライバーと競合させない。

## 時間・PCM・状態

- CPUは採用エンジンのネイティブサイクル、DSPは32,000Hzのステレオフレームを基準とする。
- 44,100 / 48,000Hz等のデバイス出力フレームと区別する。VGMの44,100Hz待機単位を流用しない。
- 公開PCMは左右Float32Arrayを基本とし、renderIntoで呼び出し側のバッファへ書き込める。
- process()内で継続的な配列確保を行わず、分割生成でも状態と出力を維持する。
- Pauseは再生位置を維持。Stopは停止して読み込み直後へ戻す。再開始はその初期状態から再生する。
- 元のSPCファイルは完全な演奏途中チェックポイントと同一ではない。
- 正確なチェックポイントにはCPU・タイマー・RAM・DSP内部・BRR履歴・Echo・リサンプラー状態が必要。
- ミュートはCPUの実行停止やKOFFと区別し、Pitch ModulationやEchoへの影響を記録する。
- Worker lookaheadは楽器の演奏命令の予約に使う。SPC楽曲のPCMバッファと混同しない。

## Phase 1: SPC再生

- [x] 上流固定・ビルド・低レベルラッパー
- [x] ファイル検証、CPU/RAM/DSP復元、ID666とxid6メタデータ
- [x] AudioWorklet再生、内部32kHzからの出力変換
- [x] AnalyzerでSPCを開く、再生/停止/再開始、音量・時刻表示
- [x] 8ボイスのミュートと影響の仕様化
- [x] エラー、初期化取消、ファイル差し替え、終了処理

再生時間はSPCタグの情報と実際の経過時刻を区別する。
タグなしの長さは明示した既定値または上限を使い、無限に先読みしない。
SPCだけでゲーム本体からの追加転送を復元できないケースは対応範囲として記録する。

## Phase 2: BRR抽出・試聴

- [x] 選択した再生時点のRAM/DSPスナップショットから抽出
- [x] DIRと利用中SRCNを優先し、明示指定のディレクトリー項目にも対応
- [x] 開始位置、ループ位置、BRR終端、RAM参照、最大ブロック数を検証
- [x] BRRデコード、波形、単体試聴、BRR/WAVとメタデータの保存
- [x] 同じSRCNのRAM書き換えを区別できる内容識別子を保持

BRRは音色全体ではない。ループ、ADSR/GAIN、Pitch、Volume等を別に保持する。
BRRには元の基準音名がないため、C4等の音高は自動的に断定しない。
WAV単体へ情報を詰め込まず、sidecar JSONまたはcassetteへ関連情報を保存できるようにする。
無効なディレクトリー項目や終端のないデータで無限に走査しない。

## Phase 3: Playgroundで演奏

- [x] DSP単独インスタンスとBRRメモリー管理
- [x] useSoundChip / createSoundChipのMain・Worker両経路
- [x] 固定8チャンネルの発音、停止、音程、ADSR/GAIN等の設定
- [x] MIDI演奏に必要な基準音程・再生比率を明示するプリセット
- [x] Mixer、voice ownership、Stop/Run、初期化取消との整合
- [x] 型定義、Monaco、examples、npm/itch配布依存を更新

DX7/RF5C164の既存経路を参考にする。
未知チップ向けのFM用解放処理へフォールバックさせず、SNESのKOFFを適用する。
チップが独立して持つ8ボイスを超える自動スティーリングは今回必須としない。

## Phase 4: DSP解析

- [ ] DSP書き込みの時刻・順序・レジスター・値を記録
- [x] Capture時点のボイスのPitch、Volume、ADSR/GAIN、SRCN、KON/KOFF等を表示
  （Captured DSP registers内の構造化JSON。時系列のイベント表示ではない）
- [ ] Noise、Pitch Modulation、Echo/FIRの状態を表示
- [ ] 取得件数・保持時間を制限し、解析無効時のコストを抑える

まずは表示・分析用ログとする。DSP書き込みだけを完全な再生ログと呼ばない。
将来ロスレス再生へ拡張するなら、初期状態、RAM/ディレクトリーの変更と同時刻の順序も保持する。
ゲーム固有のMML/シーケンス復元や、絶対音名の自動判定は別課題。

## 検証

- ネイティブ版とWASM版の32kHz PCMを同じ初期条件で比較する。
- 生成分割数を変更してPCMが一致するか確認する。
- BRR全フィルター、ループ、ADSR/GAIN、Noise、Pitch Modulation、Echo/FIRを確認する。
- 44.1/48kHz出力、再生・Pause・Stop・再開始、切り替え、終了、複数インスタンスを確認する。
- Main/Workerの楽器操作と先読み時刻、即時Keyboardとの関係を確認する。
- UI操作・長時間再生の負荷と音切れを確認し、未検証の実機環境を明記する。
- 著作権のあるゲームのSPCをテスト配布へ混入させない。自作の合成SPCを基本にする。
- ゲーム由来SPCによる確認は利用可能なファイルで実施し、ゲーム別の追加ドライバーは作らない。
- 既存のVGM/S98再生・解析、Playground、型、配布依存の回帰を実行する。

## 調査・実装記録

2026-10-18: レビュー指摘を採用し、段階別の完成条件、CPUとDSP単独の分離、
時間単位、BRRの基準音程、RAM変更、ミュートと状態復元の注意を追記。Phase 1から実装開始。
進捗・採用エンジン・制約・検証結果はこの節へ追記する。


### 2026-10-18 実装結果

**Phase 1〜3を実装。Phase 4の時系列ログは未実装で、次の段階とする。**

SNES／SPC対応は**実験的実装**として扱う。合成データによる検証は完了しているが、
実ゲーム由来SPC、Tauri実アプリ、長時間再生の互換性確認は継続する。
検証結果に応じて新APIと挙動を調整する場合がある。

2026-10-18: `tetorica-fm2612@0.2.20`をnpmへ公開。英語READMEとリリースノートに
SNES／SPCの実験的実装を明記し、SNES／SPC／BRRのkeywordsを追加。
レジストリーの`latest = 0.2.20`と、ダウンロードしたtarballが公開元と完全一致することを確認した。

Analyzer:

- `.spc`を通常のファイル入力・プレイリストから開く。Play / Pause / Stop / Replay、seek、Vol、曲送りに対応。
- 「SPC / BRR」で8ボイスのミュート、RAM/DSPの明示Capture、SRCN指定抽出、波形、試聴、BRR / WAV / JSONの保存。
- `Scan all SRCNs`で現在のRAMの0〜255を調べ、同じ開始／ループ位置の番号をまとめて候補表示する。元のSRCN一覧と参照位置はMetadataにも保存。全曲走査や音色判定ではなく、未使用データが含まれ得る。処理量の上限で未確認の番号が残れば明示し、ファイル切替時は走査を中断する。
- ID666のtext/binaryとxid6を読み、未知フィールド・元バイト列を保持する。
- 長さとfadeがタグにあれば使用する。タグなしは180秒、UIの上限は3,600秒。末尾停止／曲送りの判定は200msポーリング。
- フェードは出力GainのAudioParamで予約し、pause／seek後に実際の経過秒から再設定する。
- stopは元のSPC（echo RAM含む）を再ロード。seekは元から0.5秒以内のnativeブロックで再実行し、途中停止できる。
- 解析用snapshotはRAM/DSPのコピー。出力位置と生成位置を区別し、リサンプラーの最大4ms程度の先読みとcore内の短いキューを含み得る。
- BRR試聴は32kHz monoデコード結果。ゲームで鳴った音の完全再現ではなく、Gaussian補間、ADSR/GAIN、echo、元のtuningは適用しない。
- 試聴モードは`Raw`と参照Voiceごとの`Voice N settings`を選べる。Rawは上記の生PCM。Voice試聴は取得RAMを独立S-DSPへコピーし、PITCH・ADSR/GAIN・左右音量とGaussian補間を適用して1秒発音＋1秒離鍵後を32kHz stereoで生成する。曲中の変更・元のEG内部状態・echo/noise/PMONは再現せず、DSP master volumeは127固定。基準音名の推定は不要。参照Voiceがない候補はRawのみ。Voice試聴中の波形は生成した音声を表示する。Stop／Play／シーク／ファイル切替・再取得で未完了の試聴もキャンセルする。BRR/WAV保存は従来どおり素材を保存する。

Playground:

- `Menu → Import → SPC…`からSong playback／Instruments／Song JavaScript／Event traceを選択可能。すべて`/spc/<元ファイル名>/`以下の新規フォルダーへ原本SPCとsourceinfoを保持し、同名の取り込みは別フォルダーにする。
- Song playbackは`useSoundChip('spc')`のloadSPC／playを使うコードを生成。SPC700プログラムとDSPを再生し、JavaScriptの音符列には変換しない。BPM／Worker先読みから独立し、Stopまで再生する。Main／Workerとも既存Mixer・FX・Master経路に接続する。
- Instrumentsは保存時点の全SRCN候補から選んだBRR・Metadata・設定JSON・試奏JSを保存。捕捉Voiceを選択でき、ない候補は既定の設定を使う。C4等は利用者が割り当てる参照音名で、元の基音を推定したものではない。初回試奏は捕捉PITCHをそのまま使い、1秒発音＋1秒離鍵する。未解決ループや独立SNES音源のRAMに収まらないBRRは理由を示し音色取り込みの対象外とする。試奏ごとに独立音源を解放し、Runの繰り返しでサンプルRAMを使い切らない。
- Song JavaScript（実験的）は指定0.1〜600秒を独立Workerで無音実行し、`loadBRR`／`setPreset`／`setPitch`／`keyOn`／`sleep`／`keyOff`で編集できるコードに変換する。元の音符名・変数名・ループ構造は推定しない。PITCH・ADSR/GAIN・左右volumeはチップのraw値を使う。初期のEG内部状態は復元できず、BRRの取得も128 native frames（最大約4ms）の区切りとなる。noise／PMONのraw global制御は保持する。echoは再配置したBRRへのRAM上書きを避けるため無効にし、初期EG・再生中BRR変更・JS時間精度等の近似をsourceinfoと生成JSへ明示する。原本と同一PCMが必要ならSong playbackまたはEvent traceを使う。
- 読みやすい変換のcontrol stepは既定20ms、0で全distinct変更を保持、上限1000ms。PITCH・volume・同一SRCNのADSR/GAIN更新は区間の最終値へ間引く。KON／KOFF／SRCN変更の境界は元の時刻を保持し、そこをまたいでcontrolをまとめない。エンジンに補間・スムージングは追加しない。20000 musical events、BRR256個／合計64512 bytesを超えたら途中データを保存せず明示エラーとする。タグfadeは推定しない。変換CancelではFilesを変更しない。
- Event trace（以前のSong JavaScript）はDSPレジスター操作とCPUによるRAM変更を時刻付きの編集可能な`events`配列に変換する。初期RAM（BRR・ディレクトリー・echo RAMを含む）とDSPレジスターは`initial.ram.bin`／`initial.dsp.bin`として保存する。100万イベントを超えたら途中データは保存せず、時間短縮かSong playbackを案内する。
- Timelineの1行は`clock, kind, address, value`の4整数。kindは0=DSPレジスター、1=RAM。clockは1,024,000Hzの**DSPが実際に観測した実行順序**を保存し、CPU命令の生時刻ではない。32 clocksがnative 32kHzの1frame。出力sampleRate・44,100HzのVGM sample単位・BPMから独立する。同一clockの行の順序も維持する。
- `snes.prepareTimeline(trace)`で初期状態とイベントを準備し、`await snes.playTimeline()`は実際の音声終了まで待機する。`stopTimeline()`／toolbar Stop／破棄／loop owner解除は待機をAbortErrorで中断する。Worker先読みは開始に一度だけ適用する。Timeline中は通常音色編集との混在を拒否し、`reset()`でBRR演奏へ戻る。再生中のJSによる逐次イベント送信を避け、WASM内でサンプル未満の時刻も処理する。
- 上流のDSP catch-upと再生中のBRR RAM書き換えにより、元のSPCエンジン自体にrender分割依存がある。通常プレイヤーと同じ128 native frames単位で録音し、端数は完全な128-frame読み込みのprefixを切り出す。録音有無で元PCMを変更しない。書き出したTimelineの再生はrender分割に依存しない。実機の完全再現や任意の他プレイヤーとの完全一致を保証するものではない。
- Event traceのRAM削減: 同じ128-frame実行を2回行う。1回目はDSPが実際に読む全RAMアドレス（BRR・ディレクトリー・echo、16bit読み出しの両byte・折り返し・無音Voiceも含む）の集合を調べ、2回目はその集合にあるRAM変更だけをイベント上限の判定前に記録する。CPUの実行自体は変えず、DSPレジスター書き込みは全部残す。元の区間で未読の作業用RAM変更がイベント上限を消費しなくなる。進捗はAnalyzing／Recordingを分ける。
- 削減後のDSP／RAM件数と参照RAMアドレス数は`sourceinfo.json`の`conversion.optimization`に記録し、取り込み完了statusと生成JS冒頭にも件数を表示する。各イベントには秒数とDSPパラメーター名を添える。保証は元の区間の再現であり、編集によって未読領域へDIR／SRCN／PITCH／echo等の参照先を変える場合、そこへ元CPUが行った省略済み更新は含まれない。曲によって削減量は異なり、元から必要なDSP操作が多い場合の100万件上限は残る。
- Song playbackの`spc.onEvent(callback, {voices, types, intervalMs})`は任意購読。戻り値の関数で解除する。SPCのDSP書込みを共通decoderで`noteOn`／`noteOff`／`pitch`／`volume`／`instrument`／`dsp`へ解釈し、MainまたはスクリプトWorkerでまとめてcallbackを呼ぶ。音声スレッド内で利用者JSを実行しない。intervalMsは16〜1000ms（既定16）の配送間隔で、controlの量子化ではない。`clock`はSPC原点から1,024,000Hz、`channel`は0〜7。global `dsp`はvoice filterの対象外。overflow診断はfilterにかかわらず通知し、欠落した履歴は補わず現在のDSPから再同期する。
- 共通decoderは同一clockのPITCH上下byte／左右volume／音色byteを集約し、同じ最終値の反復を除く。KONは同じmaskでも毎回発音要求として残し、KON/KOFF/global書込みの順序境界を越えて集約しない。KOFFは持続maskで、KON時にもbitがある場合は`keyOffHeld:true`を付ける。初期音はKON／ENVX／OUTXからの推測で`inferred:true`とし、元のkey履歴・内部EG・実際に聞こえているかは断定しない。PITCHを音名へ推定せず、volumeは符号付き値、noteOn/instrumentにはその時点のpresetを添える。rawDSPはglobal echo／noise／PMON等の追加解析にも使える。読みやすい変換はその一部を利用するが、decoder自体は省略・量子化をしない。

```javascript
const snes = await useSoundChip('snes');
const sample = await snes.loadBRR(await file('/samples/tone.brr', {type:'arrayBuffer'}), {
  rootNote:'C4', loopStartSamples:0,
});
snes.setPreset(0, {sample, adsr1:0x8f, adsr2:0xe0, volumeLeft:90, volumeRight:90});
snes.noteOn(0, 'E4');
await beat(1);
snes.noteOff(0);
```

- `useSoundChip('snes')`はStopまで再利用。`createSoundChip('snes', {id})`は独立RAM/DSP。Main／Worker共通。
- チャンネルは0〜7固定。`noteOn(channel, note?)` / `keyOn` / `keyOff`、`setFrequency`、`setNote`、raw `setPitch`。
- BRR登録時は`rootNote`と`baseFrequencyHz`の片方が必須。基準PITCHは`basePitch`（既定4096）。ループ位置は16 native samplesの境界。
- ADSR/GAINと左右volumeはraw DSP値。secondsやpercentではない。自動スムージングは追加しない。
- 同native frame内の高水準keyOnをKONマスクへ集約する。DSPのKON取り込みはハードのパイプラインに従う。極小間隔の複数voiceは単一raw KONマスクでまとめられる。
- DIR用1,024bytesを先頭に確保し、BRRは残りRAMへ追記。最大256サンプル、64KiBを超えたら拒否。unload／compaction／自動voice stealingは未実装。
- `reset()`は登録済みBRRのIDと内容を維持。echo書き込みは既定で無効。raw DSP編集ではDIR／BRR／echo領域の衝突に利用者が注意する。
- 32kHz固定で`setClock()`なし。出力はリサンプルし、BPMはbeat待機と演奏命令の予約にのみ影響する。
- Mixer／FX／Worker lookahead、owner切り替え時のKOFF、Stop時の解放に対応。
- 自作BRR付き`examples/snes/snes-brr-melody.js`、型、Monaco、README、npm/itch依存を更新。

エンジンのローカル変更:

- 上流のKOFF型muteを使わず、dry出力と新しいecho sendだけを抑えるmaskを追加。CPU、envelope、BRR、PMONは進行する。既存echo tailと生成済みキューは残る。
- mute中は将来のecho RAM内容が変わるため、echo有効時の状態を「無音化しない場合と完全同一」とはしない。
- 未定義の負数左シフト2箇所を等価なunsigned判定に置換。
- DIR / SRCNが64KiB境界を越す場合のディレクトリー参照を16bitで折り返し、領域外読み出しを防ぐ。
- ゼロmuteの4条件で、改変前の固定上流とnative PCMが一致。ラッパーと再ビルド手順、対応する変更済みソースをdocs／npm／itchへ同梱する。

検証結果:

- 読みやすい変換／onEvent追加（2026-10-18）: 関連261テスト成功。自作曲の645回のDSP書き込みを5件の演奏イベントへ整理し、生成したBRR・preset・JSを実S-DSPで再生確認。間引きの境界、同音再発音、KOFF、BRRバージョン、未解決loop、RAM／イベント上限、Cancel、観察overflowとPCM不変を検証。docs／itch配布配置のChromium／WebKit × Main／Workerで4モードの出音・Stop後peak 0・Monaco型診断0・filter／unsubscribeを確認。スクリプト終了後の非同期callbackにも既存のネットワーク制限を適用し、両経路・両ブラウザーで検証。既存Analyzer両ブラウザー回帰、WASM再ビルド、SDKビルド（226宣言）・型チェック、itch依存446参照・ZIP生成が成功。初期音だけのSPCも再生開始後に一度だけ通知し、停止中に空の通知を繰り返さない。実ゲームSPC／Tauri実アプリは未確認。読みやすい変換は同一PCMを保証せず、完全なcaptured execution再生は従来のEvent traceを使用する。
- RAM削減追加（2026-10-18）: native／trace38件と生成／capture／統合18件が成功。検証曲では194→5イベント（DSP4＋RAM1、97.4%削減）となり、原本・旧JS・削減後JSのPCMが左右全sample一致。BRR／DIR変更、echo、noise、PMON、RAM折返し、無音Voice、インスタンス分離、上限判定前の除去、両passでのCancelも確認。docs／itch配布配置のChromium／WebKit × Main／Worker、Monaco型診断0、Stop後peak 0、既存Analyzerの両ブラウザ回帰、SDKビルド／224宣言生成と型チェックが成功。実ゲームSPC・Tauri実アプリは未確認。削減率は曲に依存する。
- Song JavaScript追加（2026-10-18）: 変換・capture・生成コード33件、関連runtime／SPC／既存chip予約148件が成功。初期RAM・書き出しJS・binaryの再読込を含む元SPCとのPCM完全一致、128-frame端数切出し、32／44.1／48kHzのWorklet再生、Stop／owner解除、100万件上限とCancelを確認。docsとitch配布配置をChromium／WebKit × Main／Workerで実行し、全モードの出音・Stop後peak 0・Monaco型診断0・原本保持・取り込み先衝突回避が成功。既存Analyzerの両ブラウザ回帰、WASM再ビルド、SDKビルド／224宣言生成、型チェックも成功。実ゲームSPC・Tauri実アプリは未確認。
- SPC Import追加（2026-10-18）: 生成・SPC client・Main管理52件、関連回帰57件、型チェックが成功。itch Playground配布配置をChromium／WebKit × Main／Workerで確認し、Songの連続Run、捕捉Voice／未参照BRRの試奏、Stop後の無音、Cancel時の無変更、取り込み先の衝突回避、原本SPCの完全保持を検証。既存AnalyzerのChromium／WebKit回帰も成功。使用データは自作の合成SPCで、実ゲームSPCとTauri実アプリは今回未確認。
- core: 10/10成功、nativeとWASMのPCM完全一致。BRR、echo＋PMON、noise、CPU→DSP書込み、1 frameを含む分割、restart、RAM折返し、インスタンス分離。
- BRRデコーダー: 元のaccurate DSPのデコーダーと20,480 samples一致。全filter／shift、履歴、ランダム列を比較。
- SPC音声処理: 18/18成功。実ブラウザーはChromium／WebKit × 44.1／48kHzの4条件成功。
- SNES Worklet＋Worker: 75/75成功。PCM一致、予約境界、owner解除、未来の音のキャンセル、Stopを確認。
- Playground実ブラウザー: Chromium／WebKit × Main／Workerの4条件成功。実PCM、Mixer、FX、独立インスタンス、reset／Stopを確認。
- Analyzer実ブラウザー: Chromium／WebKitでSPC再生、全mute、pause／seek／stop、BRR WAV、タグfade、同時loadの旧処理排除、SPC→VGMを確認。
- 既存全回帰: 1,816件中1,815成功、失敗0。既存の任意`mml2mdr`コンパイラー連携1件のみskip。
- docs/playground回帰: 556/556成功。Monacoと型のpositive／negativeチェックを実施。
- npm: buildとtarballの隔離install、実PCM、NodeNext／Bundler／ブラウザー用宣言チェック成功。公開は行わない。
- itch Playground／Analyzer: 依存チェックとZIP生成を確認。生成したAnalyzer配布配置もChromium／WebKitで再生・fade・BRR保存・SPC→VGMを確認。

未確認・残課題:

- 実ゲーム由来SPC、実機比較、Tauriの実アプリ（macOS／Windows／Linux）、長時間の実機音切れ検証は未実施。
- Nintendo IPL ROMは同梱せず、上流の最小fallbackを使用。完全IPLやゲーム本体から後続転送を必要とするSPCは動かない場合がある。
- SPCはDSP内部の全位相・BRR履歴を含む完全checkpointではない。ゲームごとの復元直後の音や互換性は別途確認が必要。
- 出力リサンプラーは線形補間。高品質な変換、完全な途中checkpoint／seek cache、DSP時系列の可視化、BRRのroot推定、楽譜変換は後続課題。
- 旧式タグの文字コード・text/binary判定は曖昧な場合がある。ライブラリーの`textEncoding`／`id666Format`指定で上書き可能。Analyzer内の選択UIは未追加。
