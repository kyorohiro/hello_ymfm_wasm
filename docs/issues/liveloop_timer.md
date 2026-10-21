# liveLoopの時間同期と共通スケジューラー案

## 2026-10-21 Genesisの無操作再生中のノイズ調査

Safari / TauriのGenesis modeで、以下の演奏中に時々ノイズが聞こえるという報告。
FXやUI操作を加えない状態を基準に調べる。

```js
setBpm(120);
fm.setPreset(CH1, FM_PRESETS['one-op-basic']);
liveLoop('lead', async () => {
  const notes = scale('E3', 'minorPentatonic', 2);
  await play(choose(notes), {channel: CH1, duration: 0.8});
  await beat(cycle([0.04, 0.04, 0.08]));
});
```

`duration: 0.8`は0.8秒、BPM120での休符は20 / 20 / 40ms。
UI側の常時inspector polling、meter送信、noteOn/offに連動するDOM更新、
演奏中のaudio graph再構築は、この無操作条件では確認できなかった。
公開用stage・Tauri開発用distのYM2612 / PSG WASMとWorkletはdocsの内容と一致し、
2026-10-17のWASM最適化も含まれる。

切り分けの結果:

- 実YM2612 WASMで音階の全10音×次の10音×休符20 / 40ms、計200通りを検証。
  次のKey On前にはcarrier EGと末尾PCMが0となり、再Key直後の段差も0だった。
  0.5ms休符の対照では最大約0.077の段差が発生したが、提示コードの通常の休符とは異なる。
- WebKitで音順を固定し、Main / Workerを各30秒取得。Mainの35休符は18.67〜45.33ms、
  Workerは21〜46ms。1ms未満に潰れた休符は0、WorkerのlateCommandsも0だった。
  音源直後と最終出力のPCMは一致し、NaN / clip / 取得音声フレームの欠落も0だった。
- これらの取得はWeb Audio graph内であり、実機の最終デバイス出力の欠落を否定しない。
  確認時はSpotlight等のOS処理によるCPU使用も大きかったが、ノイズとの因果は未確定。

音声スレッドの負担として、`ASSERTIONS=1`の生成glueのnumeric `cwrap`が、
各呼び出しで`ccall`経由の配列・オブジェクト・クロージャーを作る経路を確認した。
PCM viewやWASMメモリーを再利用していても、このJS割り当ては残っている。
YM2612 / PSGの数値ABIへの呼び出しを対象に、生成済み`Module._symbol`を一度bindし、
この余分な層を省く修正を行った。音の計算やWASMのassertionは変えない。
direct exportがない注入factoryには従来のcwrapを使い、optional read / IRQの欠落扱いも維持する。

同じ実Worklet / WASMを50,000×128 frames（133.33秒分）動かしたNode参考計測では、
HeapProfilerの推定JS割り当てが138,538,656 → 658,704 bytes（約99.52%減）。
silent / hold / notesの自然GC回数は70 / 66 / 67 → 6 / 0 / 1になった。
一方、平均処理時間の改善はこの計測では確認できなかった。
5,000 blocksの左右PCM SHA256は新旧とも完全一致し、reset / release / retrigger / clock、
Nuked・PSGのstereo / mute・optional APIの回帰も確認した。
これらはccall層の余分な割り当て削減を示す。Safariでのノイズ原因の確定や
実機での解消確認とは区別する。生成export自身のassertion wrapper等による割り当ても残る。

診断スクリプトは従来のE4 / 0.08秒を既定のまま、今回の音階・音長を指定できるようにした。
再現性のため音順は固定し、UI負荷やFXを入れないケースを選ぶ。

```sh
node scripts/check_playground_fm_click_browser.cjs --webkit --seconds=30 --stall-ms=0 --case=main-dry-idle --root-note=E3 --note-seconds=0.8
node scripts/check_playground_fm_click_browser.cjs --webkit --seconds=30 --stall-ms=0 --case=worker-dry-idle --root-note=E3 --note-seconds=0.8
```

修正後もWebKit Main / Worker各30秒、Chromium各6秒で、遅延命令・休符の潰れ・
取得PCMのNaN / clip / 音声フレーム欠落はなく、音源直後と最終出力PCMは一致した。
修正前も同じ範囲は正常だったため、これをノイズ解消の証拠にはしない。
参考計測中にはOSのCPU負荷も変わっており、前後の処理時間差の帰属もできない。
直近15分のcoreaudiodのoverload / underrun / skippingログにも該当はなかったが、
これでデバイス出力の途切れを否定することもできない。

音そのものの候補も別途確認した。E3 / E4 / A4の長音についてYM2612とYM3438を
同clock・同registerで比較すると、YM2612のPCMは既知のDAC ladder式を適用した
YM3438出力と1,917,612 samplesすべてで一致した。未知の非周期dropは見つからない。
一方、既存の53,267→48,000Hzのhold / box変換には規則的な高域sidebandもある。
これらが報告された聴感と同じかは未確認で、音色や変換方法はこの調査では変更しない。
同一36音・同一時刻・30秒のGenesis原版とYM3438対照のWAVを一時成果物として用意し、
リアルタイム生成の有無、DAC特性、実機出力を聴き比べられるようにした。

その後、ユーザーがGenesis原版の比較WAV Aを試聴し「ノイズは聞こえない」と確認した。
今回の症状は、事前生成した音にも常に入るDACや変換特性より、リアルタイム再生時の
生成・命令配送・graph処理・デバイス出力を優先して調べる。実機の原因確定とはまだ区別する。
提示コードはFXもKeyboard操作も使わないため、それらの操作不具合とは区別して扱う。
FX経路の比較案は取り止め、提示コードのFM命令・音声生成・出力を調査対象とする。
Mainの取得traceでは全36発音の周波数high / low / Key Onが同じframeに適用され、
35回の発音長は800〜808msだった。命令の分割だけを理由とする変更は行わない。
17回の異なるmodeのinitialize / stop / finalizeでも、所有AudioContextは17生成・17 close、
40個のnodesの接続とportが解放された（Web Audio境界をmockにした実runtime検証）。
同modeの20回Run / Stopでもcontext / nodeの増殖は確認できず、mode切替の蓄積を
今回の原因とする根拠は得られていない。

出力バッファーの候補として、インストール済みWebKit 26.6でAudioContextの
latencyHintを未指定 / interactive / balanced / playback / 0.05 / 0.1に替えて計測した。
6条件ともsampleRateは48,000Hz、baseLatencyは128 frames（約2.67ms）、
outputLatencyは約21.27msで同一だった。この環境ではhintだけを替えた比較に
実バッファーの違いがないため、製品への設定追加は行わない。

回帰検証: 2,971件の全体実行で2,969件成功。残る旧fixture2件を、現行native globalsと
ブラウザー用module queryに追従させた後、その対象19件が成功した。
追加のbinding / 可変長PCM / EG比較、268件のJSDoc宣言生成とNodeNext / Bundler型検査も成功。
VM内のcommon processor fixtureも、既存AY / OPLL / OPL registryに対応するstubを追加した。

## 2026-10-17 実装状況

Workerのスクリプト音声は500msの先読みを標準にした。Main実行とUIのKeyboard試聴は即時。
Menu → **Worker lookahead (ms)** で0〜2000msを設定し、端末のブラウザストレージへ保存する。
設定は停止中に変更できる。APIでは次のように指定する。

```js
runtime.setTiming({workerLookaheadSeconds: 0.5});
// スクリプトからは await pg.setTiming({...})。変更はStop後のRunから反映。
```

- MainでAudioContext時計と`performance.timeOrigin + performance.now()`の対応を一度取得し、
  Workerは送信時刻に先読み量を加えた絶対音声秒を付ける。受信時刻から先読み量を足す方式ではない。
- FM/PSG、native sample/noise/FX、独立SoundChipを同じ時計へ予約する。
  Workletは出力フレーム境界で処理を分割し、予約フレームで命令を適用する。
- サンプル読み込みなどの準備は即時。非同期の設定操作は受付時に応答し、
  `await`のたびに先読み量の待機が追加されないようにした。相対タイムラインの完了待ちは従来どおり。
- 既存の絶対音声時刻予約と44,100Hzサンプル予約は別経路のまま。先読み量を二重に加算しない。
  `lookaheadSeconds`（既定0.25秒）と`schedulerIntervalMs`は既存のSchedule/DAC予約用。
- `stream`のHTMLメディア再生、外部MIDI、MIDI譜面の予約は従来の経路で、
  この先読みでは自動同期しない。UI通知やログも音声より先に反映され得る。
- 同名liveLoopのHot Runは現在の周回を完了してから次の関数へ切り替え、時計と先読み量を維持する。
  除去したループは固有ownerで未適用命令を破棄し、そのownerの発音だけを解放する。
- StopはMainから各Workletのセッションを失効させ、Workerから遅れて届く古い命令を拒否する。
  新しいセッションは全Workletの応答を待ってから演奏する。AudioContextのsuspend時も停止し、
  次のRunで時計を取り直す。
- キューの容量は命令数65,536で制限。不正時刻、NaN、Infinity、古い世代を検証する。
  処理が先読み量を超えて遅れた場合は、時刻・同時刻の登録順序を保って直ちに適用する。
- 位相・EG・波形へ自動補間を加えていない。再発音・強い歪みに由来するクリックは別問題。

制約として、開始済みのYM2203/YM2608内部タイムラインは、個別liveLoopのowner取消では
中断しない。全体Stopまたは音源disposeで停止する。明示的タイムライン内部のイベント順は
この汎用Worker予約とは別管理のため、将来個別取消へ広げる場合は別途対応が必要。

当初の150ms先読みでの検証結果：Node回帰1,849件成功。npm向けJSDoc型定義208ファイルの生成・検証、
Playground/Synthの配布用ZIPの依存解決チェックも成功。
ChromeとWebKitの実ブラウザで設定保存、Hot Run、Stop/Run、即時Keyboard、
FM・native sample・FX・NESの音声フレーム一致、DX7のMain/Worker音色編集・演奏を確認した。
Keyboardの観測遅延はChrome約5.3ms、WebKit約2.7msで、150ms先読みを通っていない。
60ms程度のMain/UI負荷を繰り返すWebKitの6秒検証では、150ms予約で51回の休符がすべて残り、
80ms指定の発音は80〜86ms、予約の期限超過は0だった。
Tauri配布アプリ実機の出力デバイスでの連続再生は未検証。

### macOSの音量キー操作と既定500msへの変更

macOSの音量キー操作時にノイズが出る一方、Worker lookaheadを500ms程度にすると
収まるとのユーザー報告を受け、既定値を150msから500msへ変更した。
OSの音量表示や、Main / Worker / 音声出力のどこに遅延があるかは未確定。
この変更ではパラメーターの補間や波形のスムージングは追加しない。

- SDKのRuntimeとWeb UIは、共通の`DEFAULT_WORKER_LOOKAHEAD_SECONDS = 0.5`を使う。
- 保存済みの0ms、150ms、その他の有効値は上書きしない。設定がない、無効、またはストレージを読めない場合に500msを使う。
- 既存の保存値でノイズが出る場合は、Menu → Worker lookaheadで500msに設定し、Stop → Runする。
- スクリプトの開始・編集反映には先読み分の遅延が増える。Main実行とUI Keyboardは即時のまま。
- `check_playground_lookahead_browser.cjs`に280msの命令配送遅延を与える比較を追加した。
  これはmacOSの音量キー操作そのものの再現ではなく、予約を保てる範囲を確認する制御されたテスト。
- 150ms / 500msの比較、音符・休符・予約フレーム、Stop後の古い予約、FM / sample / FX / NESの同期と即時鍵盤を確認する。
- ブラウザー用のRuntimeとSenderの読み込み識別子を更新し、古い既定値のキャッシュを引き継がない。

検証結果:

| 制御された280ms配送遅延 | Chromium | WebKit |
| --- | --- | --- |
| 150ms先読み | 遅延命令8件、最初の音符が0msに短縮 | 遅延命令8件、最初の音符が0msに短縮 |
| 500ms先読み | 遅延命令0件、音符約80.8ms／休符約122.8ms | 遅延命令0件、音符約84ms／休符約125ms |

500msでは、命令の適用フレームが指定した絶対音声時刻のフレームと一致した。
FM / sample / FX / NESの同期、Hot Run、Stop後650msまで古い予約が残らないこと、
Keyboard入力が先読みを通らず約2.7〜5.3msで反映されることも両ブラウザーで確認した。
設定画面はBrowser／Tauri mockの両方で初期500ms、保存済み0／150ms／90msの保持を確認。
関連回帰1,586件・生成宣言210件の型チェック・403個の配布参照チェックが成功した。
古いHTTPキャッシュを残す更新と、保存データの維持もChromium / WebKitで確認済み。

検証用ZIPは`release/hello_ymfm_wasm_worker-lookahead-500-dev_itch_playground.zip`。
Tauri開発プロジェクトにも539ファイルを取り込み・照合し、識別子は`sha256-e080ea6d744c`。
実際のmacOS音量キー操作による再発有無と、音声出力デバイス上の聴感確認は未実施。

### macOS音量キーの追加切り分け

その後、ユーザー実機で500msでも再発した。メニューバーの音量スライダーでは出ず、
MacBook Airの物理音量キーで発生する。Stop中は発生せず、SafariとTauriのWeb Audioで再現。
Chromeでは有無を判断しにくい程度だった。

同じローカル診断ページでユーザーが確認した結果:

| 発音経路 | 音量キーでノイズが増える |
| --- | --- |
| 標準OscillatorNodeの持続音 | いいえ |
| 最小のJS AudioWorkletの持続音 | いいえ |
| YM2612＋PSG＋指定distortion、120秒分の音符を事前予約 | はい |
| 同じ音源・FX、MainでliveLoop | はい |
| 同じ音源・FX、WorkerでliveLoop、500ms先読み | はい |
| 同じ音符・音色・distortionを事前にWAV化しAudioBufferSourceで再生 | いいえ |
| 同じWAVをHTML audioで再生 | いいえ |

音長80ms、休符20 / 20 / 40ms。distortionは`Math.tanh(input * 60) * .03`。
WAVは本番YM2612 Workletと同じ音符時刻でオフライン生成し、再生中の音源計算・FX・
音符送信を除いた。診断ページは一時ファイルで、Playground本体には組み込まない。

事前予約でも発生するため、JSタイマーや命令配送の遅れだけでは説明できない。
実WASMのYM2612と本番FXを同じイベント位置で大小・不規則なブロックに分割した比較では、
左右のPCMは完全一致し、NaN / Infinityはなかった。
これらはリアルタイム処理の負荷・締切を調べる根拠になるが、Worklet / WebKit / OSの
どこで出力が途切れるかは未確定。音声時計の連続性だけでデバイス出力正常と判断しない。

### YM2612 / PSGのリアルタイム処理軽量化

`build_ym2612_wasm.sh`と`build_segapsg_wasm.sh`には最適化指定がなかった。
両方を`-O2 -sASSERTIONS=1`に変更し、JS glueとWASMを再生成した。
音色、EG、位相、先読み、波形補間の仕様は変更しない。`NDEBUG`やfast-mathも追加しない。

Emscripten 6.0.6-git、Nodeで143 chip frames（48kHzの128出力frames相当）を
20,000ブロック×3回測り、最小の平均処理時間を比較した参考値:

| コア | 変更前 | `-O2 -sASSERTIONS=1` |
| --- | --- | --- |
| YM2612、6音同時、sampleRate照会2回・PCM生成・IRQ確認 | 178.75µs | 17.63µs |
| PSG、tone / noise | 8.07µs | 1.87µs |

これはSafariの出力締切や物理音量キーによる改善を保証する計測ではない。
単音、6音同時、音程・Algorithm・LFO変更、Key Off、DAC、PSG全noise mode、mute / resetで
変更前後の左右PCMを比較し、差分は0。save / load後の再現も一致した。
本番Workletの提示コード相当8.18秒をWAV化した結果も変更前後で同一だった。

通常の`-O2`だけでは旧JS glue / 新WASM等の混在に初期化エラーが出たため、
速度差の小さい`ASSERTIONS=1`を採用した。この設定では両チップとも旧 / 新を双方向に
混在させた初期化・生成の確認も成功し、実行時の検査機能を維持する。

検証: web / Playground回帰1,586件、実WASM / native FX関連60件が成功。
高速化で完了後の進捗通知からキャンセルしていたテスト1件の前提が成立しなくなったため、
最初の実レンダーブロック直後に中断する検証へ変更した。製品のseek動作は変更しない。
Chromium / WebKitで最適化前後の実音源・FX・停止を確認し、配布参照403件も成功。

検証用ZIPは`release/hello_ymfm_wasm_audio-render-o2-dev_itch_playground.zip`。
Tauri開発プロジェクトへ539ファイルを取り込み・照合済み、識別子は`sha256-c80160395bda`。
インストール済みアプリのバイナリーは更新していない。
2026-10-17、ユーザーがSafariの同一診断ページで最適化前後を比較し、
「最適化版では出なくなった」と確認した。今回の物理音量キーによる再現条件では解消。
事前予約でも発生し、同じ音の事前生成PCMでは発生せず、WASM最適化で解消した結果は、
リアルタイム音声処理の余裕を増やす対策が有効だったことを示す。
OS / WebKit内のどの処理が締切を圧迫したかまでは特定していない。
Tauri開発用の取り込みは済んでいるが、Tauri実機での再確認は未実施。

以下の前半は設計時のメモ。現在の採用仕様はこの節を優先する。

## 背景

VGM Importでチャンネルを別々のliveLoopへ分割すると、特に音の展開が速い箇所で
ノイズが出るという報告がある。

各チャンネルの再開タイミングのばらつき、チャンネル分割で失われる書き込み順が
原因候補。ただし、同じVGMによる音声比較はまだ行っておらず、原因は未確定。
単に音が重なること自体を不具合とはみなさない。

## 現在の実装

主な対象：

- `web/playground_clock.js`：sleep、sleepSamples、beatなどの待機
- `web/playground_live.js`：名前付きループの管理
- `web/playground_runtime.js`：音声時刻、FM/DACスケジュールとの接続
- `web/playground_logic_worker.js`：Workerでの実行経路
- `web/ym2612vgm.js`：VGMからのコード生成

`sleepSamples()` は共通の `runtime.sampleClockStartTime` と、
各ループの `sampleCursorSeconds` から絶対的な再開予定時刻を計算している。
遅れを毎回積み上げない仕組みは既にある。

一方、待機のたびに個別の `setTimeout()` を登録している。
CHごとに永久に動くタイマーが1個ずつあるというより、各CHのawaitごとに
タイマーが作られる構造である。共通時計はあるが、共通の待ち行列はない。

Write / Highの即時書き込みはJavaScriptが再開したタイミングに影響される。
共通の開始時刻を使っても、サンプル単位で適用される保証にはならない。

## 問題を分けて扱う

1. タイマー起床・JavaScript再開のばらつき
2. 遅れた処理を追いかける際の書き込み集中
3. チャンネル分割による同時刻イベントの順序変化
4. グローバル設定、周波数レジスターなどの共有状態への影響
5. DACとFMの開始時刻・先読み量の整合性

タイマーを1つにするだけで、すべてが解消するとは限らない。
特に、同時刻の元の書き込み順は時刻情報だけから復元できない。

## 第1段階：共通タイマーと待ち行列

各liveLoopはタイマーを直接登録せず、共通スケジューラーに待機期限を登録する。

1. ループが期限・ループ識別子・実行世代・再開処理を登録する
2. 最も近い期限に対して1つのタイマーを設定する
3. 起床時に期限を迎えた待機を時刻順に取り出す
4. 同じ期限の待機を同じ処理回で再開させる
5. 残った待機の最も近い期限にタイマーを設定する

新しく登録された期限が現在のタイマーより早い場合は再設定する。
同時刻の待機には安定した順序を与える。ただし、登録順と元VGMの順序は別物である。

### 守る条件

- 各ループの論理時刻は、実際の起床時刻ではなく予定時刻から進める。
- 再開するPromiseとループコンテキストを正しく対応付ける。
  現在のグローバルなcurrentLoopContextを上書きしながら複数resolveするだけでは不十分。
  Promise継続の実行順も含めて設計・検証する。
- Stop、ループ置換、実行世代の変更で古い待機を無効化する。
- 無効化した待機のPromiseを放置せず、既存の停止処理に従って完了させる。
- 過去の期限や0待機が続いても無限処理でUIを占有しない。
- sleepの秒単位、sleepSamplesのサンプル単位、beatのテンポ追従という意味を維持する。
- メインスレッドとWorkerの両方の経路を確認する。

これは起床のばらつきとタイマー数を減らす改善であり、音声サンプル精度の保証ではない。
同じ処理回でPromiseをresolveしても、すべてのCHが物理的に同時実行されるわけではない。

## 第2段階：音声書き込みを共通キューへ予約

CH別の読みやすいコードは維持し、再生時には全CHの書き込みを共通の音声キューへ送る。

- 各操作へ論理サンプル時刻を付ける。
- `fm.setOperator()` / `fm.setOperators()`などをレジスター列へ展開する。
- AudioWorkletへ先のイベントをまとめて送る。
- AudioWorkletは音声処理時刻に基づいてレジスターへ適用する。
- DACとFMで共通の開始時刻を使う。

既存のSchedule変換・scheduleWritesSamples・DAC予約経路を調査し、再利用する。
タイマーが鳴った瞬間に音を変更する方式から、タイマーで将来の予約を補充する方式へ移す。

### 元VGMの順序

VGM Importでは、同時刻イベントに元の通し番号を保持する。
分割後の生成コードや予約データにもそれを伝える手段が必要。
音声側では時刻と通し番号によって順序を決める。

通常の手書きliveLoopには元VGMの通し番号がないため、登録順などの決定的な規則を定義する。
元VGM順序の保証と、一般のliveLoopの順序規則を混同しない。

### 先行評価の制約

任意のJavaScriptにはキーボード入力、context更新、ログ、非同期読み込みなどがある。
音声予約を先読みするために、すべての副作用まで無条件に早く実行してはいけない。
まずVGM由来の決定的な操作列を対象にし、一般のliveLoopへ適用する範囲と意味を決める。

## 外部へ公開する調整パラメーター

以下は新規API案であり、未実装。数値は検討用の例で、推奨値は計測後に決める。

```js
pg.setTiming({
  lookaheadSeconds: 0.1,
  schedulerIntervalMs: 10,
});
```

| パラメーター | 役割 | 調整による影響 |
| --- | --- | --- |
| lookaheadSeconds | 何秒先まで音声処理を予約するか | 長いほど一時的な処理遅延に強いが、予約済み部分の編集反映が遅くなる |
| schedulerIntervalMs | 音声予約を補充する間隔 | 短いほどこまめに補充できるが、起床回数と負荷が増える |

更新間隔は第2段階の予約補充用である。
第1段階の「最も近い待機期限にタイマーを設定する処理」とは分けて考える。

### 設定APIの条件

- 有限の正数、上限・下限、先読み時間と更新間隔の関係を検証する。
- 不正な設定で一部だけ更新されないようにする。
- 現在の設定を取得できるAPIも用意する。
- 再生中の変更を即時適用するか、次のRunから適用するかを明文化する。
- 再生中に基準時刻を突然変更して位置を飛ばさない。
- 初期段階は停止中の設定変更に限定することも検討する。

既存の `setDacLookahead()` / `getDacLookahead()` との関係も整理する。
互換性を保ち、共通設定とDAC個別設定の優先順位を明示する。

CH間の同期は調整パラメーターで帳尻を合わせるものではなく、共通時計とキューで成立させる。
各CHに手動オフセットを設定することを基本の解決策にはしない。

## 遅延・停止時の方針

- 予約期限に間に合わなかったイベントの扱いを決める。
- KEYや設定書き込みを安易に間引かない。
- Stop時に予約済みイベントを破棄し、停止後に再び鳴らないようにする。
- 再Run時に古い世代のイベントが混ざらないようにする。
- AudioContextのsuspend/resume、バックグラウンド化、Worker停止を考慮する。

## 検証と切り分け

まず同じVGMで以下の組み合わせを比較する。

- Schedule / Write / High
- チャンネル分割あり / なし
- DACあり / なし
- Workerあり / なし

Scheduleで改善すれば、タイマー起床・即時書き込みの影響が有力。
Scheduleでも差が出る場合は、同時刻の順序や共有レジスター、予約処理も調べる。
これだけで単一原因に断定しない。

### 自動検証

- 仮想時計を使い、1 / 2 / 3サンプルの待機を複数CHへ登録する。
- タイマー起床を意図的に遅らせ、論理時刻が累積してずれないことを確認する。
- 同時刻・異なる期限でループコンテキストが混ざらないことを確認する。
- Stopと即時Run、ループ置換、キャンセル後に古い処理が実行されないことを確認する。
- VGMイベントと適用イベントの時刻・順序・port・register・valueを比較する。
- High API展開とDAC分離を含めて検証する。
- 設定の境界値と不正値を検証する。

### 実機確認

- 症状が出るVGMの該当区間で録音・比較する。
- 通常時とUI負荷をかけた状態で確認する。
- 予約不足件数、期限超過量、キューの残り時間、起床回数を計測する。
- 改善前後のノイズ、ライブ編集の反応速度、CPU負荷を確認する。

イベント列の一致だけではブラウザ実時間の再生品質を保証しないため、音声比較も必要。

## 進め方

1. 症状の再現と、モード・分割有無による切り分け
2. 共通タイマーと待ち行列、ループコンテキスト・停止処理の検証
3. VGM操作列を対象とした共通音声予約と元イベント順序の保持
4. FM/DAC共通の調整APIと互換性の整理
5. 実機計測から既定値を決定し、一般のliveLoopへの適用範囲を拡張

## 実装状況

第1段階を実装した。

- メインスレッド・Workerで共通の期限スケジューラーを利用する。
- 最も近い期限に対するタイマーを1個だけ登録する。
- 同時刻の再開はMessageChannelの個別タスクへ順に渡す。
  各タスク間でPromiseの継続処理が完了するため、CHのコンテキストを一斉に上書きしない。
  MessageChannelがない環境では、同じ期限タイマーを順次使うフォールバックとする。
- Stop時には待機を早期に再開させ、実行世代の検査で中止する。
- Workerでサンプルカーソルが周回ごとに0へ戻っていた点を修正し、周回を通じて保持する。
- 仮想時計による6ループの同期、遅延補正、早い期限への再設定、キャンセル、
  Workerの周回時刻とStopを回帰テストで検証する。

第2段階の共通音声予約、元VGMのチャンネル間順序の保証、およびsetTiming()は未実装。
実機でのノイズ改善も未確認であり、今回の共通タイマー化だけで解消したとは判断しない。


## 追加実装: Schedule の予約キューと設定

```js
// ループを始める前に設定。await を付けると Worker / Main 共通で使える。
await pg.setTiming({ lookaheadSeconds: 0.25, schedulerIntervalMs: 10 });
console.log(await pg.getTiming());
```

- Schedule 出力 (`scheduleWritesSamples`) は全 CH 共通の予約キューを使用。
  AudioContext の現在時刻から lookaheadSeconds 先までを AudioWorklet に渡し、
  schedulerIntervalMs ごとに補充する。遅れて起床しても元の絶対時刻を保持する。
- 既定値は先読み 250ms、補充間隔 10ms。負荷が高い環境では先読みを 0.5 秒などに
  増やせる。先読みを増やすと再生開始までの待ち時間も増える。
- DAC バンクも同じ開始時刻と先読み設定を使用する。バンクは従来通り事前転送。
- 既存 setDacLookahead/getDacLookahead と先読み値を共有する。
- 設定変更は既存の予約時刻を移動しない。開始余裕の変更は Stop 後、次のループ開始前に行う。
- Worker 起動時にも設定を渡す。Worker 内での変更は await が必要。
- Stop は未転送キューと既存の Worklet 予約を破棄する。
- Write / High の通常の即時 API は先読み実行しない。前段で実装した共通タイマーを使用する。
  fm.scheduleWrites の直接呼び出しも従来通り直接予約する。
- 異なる CH から届く同時刻の書き込みは到着順。元 VGM の全 CH 横断順序の完全復元は未実装。
- JavaScript 停止が先読み時間を超える場合まで保証する機能ではない。

自動テストで先読み範囲、絶対時刻、同時刻の順序、単一補充タイマー、キャンセル、設定検証を確認。
実環境での音声確認は別途必要。

## 2026-10-17: FMのプチプチ音と制御メッセージ遅延の切り分け

v0.80.1のTauri / Web Audioで、`one-op-basic`、80ms発音、120BPMの
`beat(cycle([0.04, 0.04, 0.08]))`、`tanh(input * 60) * 0.03`のliveFxを
組み合わせた再生中のクリックが報告された。Keyboardはキー操作の瞬間にも発生する。

追加した`scripts/check_playground_fm_click_browser.cjs`は、新規の自己ホストブラウザで、
チップ出力と最終出力を同じ音声フレームで取得し、Key/Frequencyの送信時刻と
Worklet適用時刻を記録する。表示を操作するケースは400msごとにエディターとメニューを
更新し、60msのMainスレッド停止も意図的に加える。比較の再現性のため、音符の順序は固定する。

```sh
node scripts/check_playground_fm_click_browser.cjs --webkit --seconds=5
node scripts/check_playground_fm_click_browser.cjs --chromium --seconds=5
node scripts/check_playground_fm_click_browser.cjs --webkit --case=worker-distortion-ui --seconds=10
```

各エンジン9ケース（通常ループ、歪みあり・なし、Main/Worker、持続するKeyboard音、
押し直すKeyboard音）を48,000Hzで確認した。結果はOSの一時ディレクトリのJSONへ保存する。

- 通常の`noteOn/noteOff`ではOperator数値・Envelope図を更新しない。
  したがって、この固定音色のループには新しい図の継続描画は発生しない。
- 持続するA4では、UI負荷の有無ともに完全な無音ブロックはなかった。
  最長の厳密なゼロ列は1サンプル。キャプチャの音声フレーム時計も連続していた。
- 最終出力は、乾いた音ではチップ出力と一致し、歪み付きでは指定されたtanh処理と
  最大約10^-9の誤差で一致した。取得した経路には別のDSP破損は見つからなかった。
- ただし、WebKitのWorker + UI負荷では制御メッセージが最大91ms遅れた。
  Workerが86msの間隔で送ったOn/Offが音声側では176msになり、続く休符が0フレームへ
  圧縮された例がある。10秒間の94休符中12回が0フレームだった。
  これはWorkerの待機自体の短縮ではなく、送信後からWorklet適用までの遅延だった。
  ChromiumのWorkerでは同じ負荷で同程度の圧縮は観測しなかった。
- キャプチャ内のPCMが正常でも、OSの出力デバイスでのアンダーランは否定できない。
  また、これだけでWebKit自体の不具合と断定しない。

実WASMを同期実行する別の検証では、余韻が残る同一CHを短い間隔で再発音すると、
コアの位相・EG動作による段差が再現した。`one-op-basic`のRR13で、Note Offの0.5ms後に
次の音を入れると振幅差約0.083、20ms後は0だった。強い歪みはチップ固有のDACの段差や
通常の高調波も強調するため、隣接サンプル差が大きいことだけを音声欠落とみなさない。
音質を変える自動スムージングや、位相・EGの追加リセットは行っていない。

調査中、Workerの`cycle(values)`が常に先頭要素を返す別の不具合を修正した。
Mainの既存実装を共有し、0.04 → 0.04 → 0.08が循環するようにした。
呼び出し位置・ループごとの独立性、Run差し替え時の継続、Stop後の初期化を検証した。
上記の比較録音と91msの遅延計測は、このcycle修正前の実装によるもの。
cycle修正は演奏パターンの一致を直すもので、クリック解消の証明ではない。

導入前は、一般の即時FM操作へ音声予約を適用するかどうかが課題だった。
先読みは制御メッセージ遅延を吸収できるが、スクリプト音の開始・編集反映の遅延、
Keyboard優先、Stop/Run、FX・DACとの同期まで含めた設計が必要。
導入前の`pg.setTiming()`はSchedule/DAC用のみだった。現在は別項目の
`workerLookaheadSeconds`を追加し、通常のWorker演奏にも予約を適用している。

### 導入前の診断用予約試作（履歴）

導入前の診断スクリプトは、配信するWorker命令へ送信時刻を付け、既存の音声予約キューへ
150ms先の書き込みとして入れる試作だった。現在の`--lookahead-ms`は製品の
`workerLookaheadSeconds`を設定する比較オプションに変更し、診断専用のキュー挿入は削除した。
時刻変換には診断用のミリ秒精度の時計を用いるため、そのまま製品化する実装ではない。
送信時刻と適用時刻のトレースは、予約を受信した時点ではなく、実際にレジスターへ
適用した音声フレームを記録する。

cycle修正後の同じWorkerコードと60ms UI負荷で、6秒間を比較した。

| 予約 | 発音長の観測範囲 | 休符が0フレームになった回数 |
| --- | --- | --- |
| なし | 24〜170.7ms | 5 / 53 |
| 150ms | 78.3〜87.7ms | 0 / 51 |

```sh
node scripts/check_playground_fm_click_browser.cjs --webkit --case=worker-distortion-ui --seconds=6 --lookahead-ms=0
node scripts/check_playground_fm_click_browser.cjs --webkit --case=worker-distortion-ui --seconds=6 --lookahead-ms=150
```

送信側は約80msの発音長を保ち、150ms予約で今回の制御遅延を吸収できた。
これはクリック音すべての解消や、実Tauriデバイスの連続再生を保証する結果ではない。
音源の位相・EG・音量へ補間を加える対策ではない。導入する場合は開始・編集反映の
遅延を設定として明示し、即時Keyboard・Stop・Run・FXとの整合性も検証する。
