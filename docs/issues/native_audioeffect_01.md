# C/C++・WASM Audio Effect の実用性検証

## 最新の対応状況

独立した `docs/native_audio_effect/` で、C/WASMの以下を実装済み。
Windowsで独立ページを確認済み。Playgroundへの接続も実装し、移行後の試聴を行う段階。

| 対象 | 状態 |
| --- | --- |
| gain / eq / gate / compressor / reverb | 実装・自動検証済み |
| branch / parallel / setChain | 上限付き木構造で実装・自動検証済み |
| filter / delay / distortion / bitcrusher | 追加実装・自動検証済み |
| wobble / flanger / slicer / chorus | 追加実装・自動検証済み |
| radioTone / lofi / stereoWidth / tapeSaturation | **低優先度。今回実装しない** |
| Playgroundへの接続・Worker直接制御 | 実装済み。非対応FXは削除、音響差分は末尾参照 |

現行ページのRoutingで「追加8 FX（直列）」を選択すると追加パネルを表示する。
追加FXは初期Bypass。各パネルでチェックを外して1つずつ試聴できる。
設定変更・Bypassは再生中に操作可能。Routing変更は停止を伴う。


## 目的

音声ファイルをWebページで再生し、C/C++で実装したFXをWASM経由でかける。
音質・操作性・処理負荷を確認し、Playgroundで採用できるか判断する。
以下は構想・検証計画であり、この文書の作成時点で実装済みを意味しない。

簡単なエフェクトだけを動かすことを到達点にしない。
必要なFXと接続構造を組み合わせ、実用的な構成が成立するかを確かめる。
既存のWeb Audio標準ノードと完全に同じ音を再現することは必須としない。

## 最初の検証方法

まず独立した検証ページを作る。SoundChipやPlaygroundへの統合は後段とする。

```text
音声ファイル → デコード → AudioBufferSourceNode
                              ↓
                         AudioWorklet
                           └ WASM：C/C++のFXグラフ・PCM処理
                              ↓
                         ブラウザーの音声出力
```

リアルタイム処理でWAVを繰り返し生成するのではなく、WorkletからPCMのブロックを
WASMへ渡し、処理結果をWorkletの出力バッファへコピーする。
最初はステレオを対象とし、実際のAudioContextのサンプルレートをDSPへ渡す。

## 必須の検証対象

| 対象 | 検証内容 |
| --- | --- |
| `setChain` | 複数FXの直列接続と処理順 |
| `branch` / `parallel` | 分岐、独立したFX処理、合流・ミックス |
| gain | 入出力レベル調整、滑らかなゲイン変更 |
| EQ | bass / middle / treble の3バンド調整 |
| reverb | 残響の音質、長さ、wet/dry、負荷 |
| compressor | threshold / ratio / attack / release等の操作と音質 |
| noise gate | 小音量時のゲート動作、開閉の滑らかさ、音の減衰への影響 |

パラメーターの詳細・範囲は設計時に決める。既存の `fx.*` の名前や操作方法を
再利用できるか検討するが、内部方式まで同一とする必要はない。

最初から確認する代表構成：

```text
入力 → gain → EQ → noise gate → compressor
                                  ↓
                               parallel
                               ├ dry ───────────┐
                               └ reverb → gain ─┤
                                                ↓
                                            ミックス → 出力
```

dry/wetの合流時にはゲインとピークを確認する。二重接続や意図しない音量増加を避ける。

## 責務と接続の設計

- C/C++側：FXの状態、接続グラフ、処理順、分岐・合流、PCM処理を持つ。
- JavaScript側：グラフ生成・設定変更・再生操作を指示し、UIを提供する。
- AudioWorklet側：入力PCMとWASMの受け渡し、制御命令の適用、音声出力を担当する。
- AudioNode側：音声ファイルの入力と最終出力を担当する。FXの内部処理はWASMで行う。

初期グラフは循環のない直列・並列構成を基本とする。
リバーブ等の内部フィードバックと、グラフ上の循環接続は区別する。
同じFXインスタンスを複数箇所から使えるか、所有権・解放・再利用の規則も定義する。

リアルタイム処理中のメモリー確保やWASMメモリー拡張を避け、必要なバッファを準備する。
パラメーター変更の適用タイミングと補間を設計し、急変によるクリックを防ぐ。
接続変更はブロック境界で安全に適用する方法を検討する。
バイパス・停止・リセット時に内部状態や残響をどう扱うかを明示する。

## 処理方式で確認する点

- reverb：現在のFXはConvolverNodeを利用した畳み込み方式。
  同方式を移植するか、別の残響アルゴリズムにするかを音質・負荷・メモリーで判断する。
- compressor：現在はDynamicsCompressorNodeを利用している。
  検出方式、ステレオ連動、ゲイン変化、必要な遅延を設計し、聴感で検証する。
- noise gate：単純なサンプル値の切り捨てにせず、レベル検出と開閉制御を検討する。
  ヒステリシス・hold・attack・release等の必要性を確認する。
- EQ：各バンドの周波数・帯域・ゲインと、係数変更時の安定性を確認する。
- 共通：既存のAudioParamが担当している時間指定・滑らかな変更を、DSP側でどう扱うか決める。

既存ライブラリを採用する場合は、実装品質に加えて利用・再配布条件を確認する。

## 検証ページ

- 音声ファイルの読み込み、再生、停止、ループ再生。
- 必須FXのパラメーター操作と、現在の接続構成の表示。
- FX全体・個別のバイパスと、比較用の出力音量調整。
- 入出力レベル、ピーク、クリッピングの確認。
- 処理負荷の計測。平均だけでなく最大・上位パーセンタイル等も見る。
- 再生中のパラメーター変更、グラフ変更、停止・再開を試せるようにする。

音量が大きい方を良い音と判断しないよう、聴き比べ時のレベルを合わせる。
計測・画面更新自体が音切れの原因にならないよう、表示更新を間引く。

## 実用性の判断

- 音質：リバーブの響き、コンプレッサーの不自然な音量変動、ゲートの音切れを試聴する。
- 操作：値変更・バイパス・停止・再開でクリックや異常な音量が出ない。
- 安定性：無音、長い残響、大きな入力でもNaN・発散・メモリー増加が起きない。
- 負荷：想定する複数音源・FX構成で、音声ブロックの処理期限に余裕を持って収まる。
- 対象環境：手元の古いWindowsを含め、端末・ブラウザー・サンプルレート・構成を記録する。

数値の合格基準は対象端末と構成を決めて設定する。
WASMの処理時間だけでなく、PCMの受け渡しや制御処理を含めた実再生で判定する。
単音、打楽器、声、音楽、静かな減衰など性質の異なる素材を使う。

## 作業項目

- [ ] 独立検証ページとC/C++・WASMの配置、ビルド方法を決める。
- [ ] PCM形式、サンプルレート、ブロック長、FXの生成・破棄APIを決める。
- [ ] `setChain` / `branch` / `parallel` と必須FX一式を実装する。
- [ ] 音声ファイル → Worklet → WASM → 出力の経路を接続する。
- [ ] UIからの操作、バイパス、音量比較、計測を追加する。
- [ ] 実音で音質・動的操作・負荷を検証し、採用可否と課題を記録する。
- [ ] Node.jsでも同じDSPへPCMを渡してWAVを生成し、再現性を確認する。
- [ ] 採用可能ならSoundChipのPCM入力とPlaygroundへの統合を進める。

DSP単体ではgainの計算、直列・並列の結果、EQの周波数応答、ゲートと圧縮の
レベル変化、残響・リセット、ブロック分割を変えた際の整合性を確認する。
自動テストと試聴評価を併用する。

## Playgroundへの展開（検証後）

現在の `fx.setChain()` は共通出力へ適用され、通常はCH・liveLoop単位ではない。
将来はChipインスタンスごとのFXと、ミックス後の全体FXを分ける案を検討する。

```text
YM2612 → 個別FX ─┐
YM2151 → 個別FX ─┼→ ミックス → 全体FX → 出力
YMF262 → 個別FX ─┘
```

`createSoundChip()` のPlaygroundへの接続やSynth層の拡張は、この実用性検証の後に扱う。
既存のWeb Audio版FXを全面的に置き換えるか、併存させるかも検証結果で判断する。

## 初回疎通確認：gain

配置：`docs/native_audio_effect/index.html`。
音声ファイルの選択・ドラッグ＆ドロップ、再生・停止・ループと、C/WASM gainを実装。
AudioBufferSourceNode → AudioWorklet → WASM → 出力の経路を使う。
ゲイン変更にはC側で5msの補間を入れ、Bypassは1倍へ戻す。

- [x] C製gainのWASMビルドと検証ページを用意する。
- [x] 実WASMとWorkletのPCM処理を自動テストする。
- [ ] ブラウザーでファイル読み込み・試聴・操作を確認する。

これは接続の疎通確認。上記の必須FX一式・グラフ構成の検証範囲は維持する。
ビルド・起動方法は `docs/native_audio_effect/README.md` を参照。

### 3バンドEQ追加

- [x] C側にBass 200 Hz / Middle 1 kHz / Treble 4 kHzのbiquadを追加（各±12 dB）。
- [x] Gain → EQの経路、3スライダー、独立したEQ Bypass・リセットを追加。
- [x] 係数の10ms補間、左右独立状態、44.1/48/96 kHzの周波数応答を自動検証。
- [ ] ブラウザーで音質・スライダー変更時のクリック・負荷を確認する。

この段階の接続は固定の直列。branch / parallel / setChainの実装は未完了。

### アルゴリズム型リバーブ追加

- [x] 独立した `native/audio_effect/reverb.c` に並列comb＋直列all-passを実装。
- [x] Mix・Room・DampingとReverb Bypassを追加。Gain → EQ → Reverbで処理。
- [x] 停止で残響を消去し、自然終了では余韻を残す。
- [x] 44.1/48/96 kHzで残響・減衰・左右差・クリアを実WASMで検証。
- [ ] 実音で響き・パラメーター変更・古いPCでの負荷を確認する。

Roomはフィードバック量による残響調整で、RT60秒数指定ではない。
これは既存ConvolverNodeの音の再現ではなく、独自アルゴリズム型の候補。
汎用グラフAPI・compressor・noise gateは引き続き残件。

### Compressor追加

- [x] `native/audio_effect/compressor.c` に左右連動・先読みなし・ハードニーの圧縮を追加。
- [x] Threshold / Ratio / Attack / Release / Makeupと個別Bypassを追加。
- [x] Gain → EQ → Compressor → Reverbの固定直列へ接続。
- [x] 44.1/48/96 kHzで圧縮比・左右連動・時間応答・Makeup・Bypassを自動検証。
- [ ] 実音で低音の歪み・ポンピング・操作時の音・負荷を確認する。

瞬時ピークから目標圧縮量を計算し、dBの圧縮量を平滑化する方式。
汎用グラフAPIとnoise gateは引き続き残件。

### Noise Gate追加

- [x] `native/audio_effect/noise_gate.c` に左右連動ピークフォロワーと開閉処理を追加。
- [x] Threshold / Hysteresis / Attack / Hold / Releaseと専用Bypassを追加。
- [x] Gain → EQ → Gate → Compressor → Reverbの固定直列へ接続。
- [x] 44.1/48/96 kHzで抑制・時間応答・ヒステリシス・左右連動・Bypassを検証。
- [ ] 実音で短い音・減衰の途切れ、再生中の操作と古いPCの負荷を確認する。

必要な個別FXの試作が揃った段階。汎用branch / parallel / setChain、
複数FXインスタンスの所有権・接続切り替えはまだ実装していない。

### 接続グラフの試作

- [x] C側に直列chain/branchとparallel加算を追加。
- [x] FX状態を各種類8slotへ分離し、EQをeq.cへ切り出す。
- [x] draftの検証と一括commit。循環・同一インスタンスの重複・容量超過を拒否。
- [x] ページで直列・Dry/Wet並列・2台のCompressor並列を選択可能にする。
- [x] 加算・状態独立・不正構成の原状維持・固定直列との一致・ブロック分割を検証。
- [ ] ブラウザーで各構成の試聴と複数FXの負荷を確認する。

初期上限32ノード・各種類8slotの木構造。状態はWASMが事前確保して所有する。
接続変更は再生停止・残響消去を伴う。無停止のクリックレス切り替え、
動的な個別生成・解放、任意DAG、Playground統合は今後の課題。

## 追加FXの実装方針

ユーザー指定により `radioTone` / `lofi` / `stereoWidth` / `tapeSaturation` は低優先度とする。
それ以外の未対応FXを独立した検証ページで実装・検証してから、Playgroundに反映する。
`chorus` も今回の対象に含める（Sonic Pi標準FXとの対応有無とは別の判断）。

対象：filter / delay / distortion / bitcrusher / wobble / flanger / slicer / chorus。
既存PlaygroundやSonic Piとの音・オプション完全互換ではなく、自作C実装の実用性を評価する。

Playground統合時は、現在の「ロジックWorker → main thread → AudioNode操作」を見直す。
DSP・LFO・パラメーター補間はAudioWorklet内のWASMで実行する。
ロジックWorkerからAudioWorkletへMessagePort等で直接命令を渡す構成を検討し、
main threadでのFX操作中継をなくす。ただし異なる実行スレッド間の通信自体は残り、
AudioContext/AudioWorkletNodeの生成と初期接続は引き続きmain threadが担当する。

### 追加8 FXの実装結果

- [x] filter：LP/HP/BPのbiquad、Cutoff・Q・Mix。
- [x] delay：最大2秒のステレオ遅延、Feedback・Mix。
- [x] distortion：tanhソフトクリップ、Drive・Mix、4サブステップの簡易アンチエイリアス。
- [x] bitcrusher：ビット量子化とサンプル保持、Bits・保持レート・Mix。
- [x] wobble：サインLFOによるLPFカットオフ変調、Depthは±octave。
- [x] flanger：短い可変遅延とフィードバック、Base・Depth・Rate・Mix。
- [x] slicer：周期的な音量ゲート、Rate・Duty・Minimum Gain・Mix。
- [x] chorus：左右のLFO位相をずらす可変遅延、Base・Depth・Rate・Mix。
- [x] Cグラフへ接続し、各種類8slot・独立状態・個別Bypassに対応。
- [x] 検証ページに8パネルを追加し、WorkletからCの設定APIを呼び出す。
- [x] 44.1/48/96 kHzで効果・Bypass・状態クリアを検証。
- [x] フィルター応答、遅延・反復減衰、歪み倍音、量子化・保持、周期変調を検証。
- [x] 全FX直列の有限値・ブロック分割一致と、WASMメモリー拡張後のWorklet出力を検証。
- [x] DOM/Web Audioを模擬したページの読み込み・構成変更・制御命令を検証。
- [ ] 実ブラウザーで各FXの試聴、表示、入力ファイル形式を確認する。
- [ ] 古いWindowsを含めた実機で、全FXの同時使用・操作時の負荷を測る。

C実装は `native/audio_effect/extra_fx.c`。LFO・補間・サンプル保持・遅延処理は全てC側。
現在のLFO速度はHz指定。PlaygroundのBPM同期・beat指定や既存FXオプションとの変換は
統合時に扱う。フィルター種別変更やディレイ時間変更での音の変化も試聴対象にする。
Distortionの簡易アンチエイリアスはWeb Audioの4倍oversampleと同等品質を保証しない。

遅延バッファは初期化・設定・グラフ準備時に必要なslotだけ確保し、PCM処理中は確保しない。
WASMの初期32MiBは必要に応じて拡張する。Workletは拡張後にPCMビューを更新する。
Bypassでも内部状態を進めるので、無効化したFXの計算量がゼロになるわけではない。
負荷を減らす場合はグラフから外す。

検証コマンド：

```sh
sh scripts/build_native_audio_effect.sh
node --test test/native_audio_effect*.test.mjs
node scripts/benchmark_native_audio_effect.mjs
```

自動テスト33件が成功。ベンチマークはNodeのDSP処理時間（平均・p99・最大）と
WASMメモリーを出力する。ブラウザーのスケジューリング・PCMコピー・UI負荷を含まず、
古いPCでの実用性を保証する値ではない。実ブラウザーへの接続が利用できないため、
今回のブラウザー試聴・実機性能確認は未実施。

## Playground 統合（native FX へ移行）

Windowsで独立ページの動作を確認後、YM2612 / OPN PlaygroundのマスターFXを
native C/WASMへ切り替えた。他のアプリの従来のWeb Audio FXは変更していない。

- [x] FM / PSG / サンプル / ストリーム / ノイズの合流後に、native FX Workletを1つ接続。
- [x] `fx.branch` / `fx.parallel` / `fx.setChain` の分岐・合流をC側で処理。
- [x] メイン実行: JS controller → AudioWorklet。Worker実行: 専用MessagePortで
  Logic Worker → AudioWorklet。FX作成・変更・tempo・Stopをmain threadで中継しない。
  AudioContext生成・AudioNodeの配線・MessagePortの受け渡しはmain threadで行う。
- [x] `set()` / `get()` / `rampTo(value, seconds)` を共有APIで提供。
  ランプはWorklet内で音声ブロックごとに進め、C側の平滑化も適用する。
  `get()` はJS側で指定した目標値を返す。
- [x] BPM変更時にwobble / flanger / chorusのrate、slicerのphaseを拍→Hzへ変換。
- [x] Stopでチェーンを外して残響とランプをクリア。Worker/メイン切り替え時に
  古い制御ポートを閉じる。slot再利用時に旧FXの内部履歴をリセット。
- [x] Helper・型・補完・サンプル・itch配布の依存ファイルを更新。

### 対応と変更点

対応: gain / eq / gate / compressor / reverb / filter / delay / distortion /
bitcrusher / wobble / flanger / slicer / chorus。
`radioTone` / `lofi` / `stereoWidth` / `tapeSaturation` はPlayground APIから除外。
専用サンプルは削除、残すサンプルのtape部分はdistortionへ置換した。
古いカセットでこれらを呼ぶ場合は修正が必要。

音響的に旧Web Audio版と同一ではない。特にreverbは畳み込みからアルゴリズム型へ変更。
EQは固定周波数の3バンド、filterはlowpass/highpass/bandpassに限定。
ゲートはthreshold（線形振幅）/ hysteresis（dB）/ attack・hold・release（秒）。
compressorはkneeを持たずmakeup（dB）で補正。
chorusはtime / depth（秒）とrate（拍）/ mix。旧delay1・delay2・spreadは除外。
独立output gainは `fx.gain()` を後段に置く。
reverbはmix / room / dampingに加え、既存サンプル用のtoneをdampingへ近似変換する。
wobbleのdepth（Hz）は中心周波数からオクターブ幅へ変換するため旧版とは揺れ方が異なる。
各制御値はnative側の範囲へ制限する。数値範囲は `web/native_fx.js` とHelper型定義を参照。

1ラックあたり同種8インスタンス、チェーン/分岐ノードを含め最大32ノード。
同一FXインスタンスをグラフの複数箇所に置くことはできない。
グラフ変更や新規遅延バッファ確保は設定時に行う。PCM処理中のmallocは行わないが、
再生中の大きな構成変更が音切れしないことまでは保証しない。
音声再生とFX操作は別ポートのため、音源命令とのサンプル単位の同期は今回の対象外。

### ビルド・検証

`sh scripts/build_native_audio_effect.sh` は検証ページのWASMと
`web/native_audio_effect.wasm` / `docs/js/native_audio_effect.wasm` を更新する。
JSは `sh scripts/sync_web_js_to_docs.sh` で同期する。

追加テスト `test/playground_native_fx.test.mjs` は実WASMで全FX、分岐合流、
ランプ、Stop後の残響、ポート切り替え、配布バイナリー一致を検証する。
WorkerテストでFX命令がmain threadへ送られないことを確認する。
ブラウザーでのPlayground試聴、Windowsでの負荷・操作確認は移行後に行う。

移行時の検証結果: 対象84テスト成功、itch用ZIP生成成功。
広めに実行したPlaygroundテストではVGM DAC書き出しの既存テスト1件が失敗し、
変更前のHEADを別ディレクトリーに展開しても同じ失敗を確認した。今回のFX変更の対象外。
ブラウザー接続が利用できなかったため、移行後の実ブラウザー試聴は未確認。

## 発音命令の Worker 直結

音作りを main thread に依頼して返答を待つ経路を減らす。
表示・記録の observer 通知は維持する。

- Worker: FM/PSG のレジスタ生成、通常の `play()`、MIDI の声割り当てと制御。
- AudioWorklet: 専用 MessagePort から命令を受け、音源 WASM で PCM を生成。
- main thread: 接続の初期化、UI、記録。Worker の observer 通知では
  transport を止めて状態を反映し、同じ音を二重に発音しない。

対象は Playground の YM2612（ymfm / Nuked）と既存 OPN モードの FM。
YM2612 の PSG と MIDI API も直結する。Stop は直接キーオフと TL ミュートを送り、
次の発音時に音色の TL を戻す。古いポートの遅延メッセージは切断後に無視する。

まだ main thread を通るもの: sample / stream / noise、`midi.playFile()`、
ファイル読み込み、master volume 等。DAC と YM2612 の予約書き込みは下記の直結経路へ移行。
PSG のノイズレジスタ操作は直結対象だが、`noise.create()` の音声生成は別経路。
全APIの移行完了を意味しない。FX と音源のサンプル単位の同期も別途検討する。

検証は main thread から発音要求に返答しない Worker テスト、Stop / Run、
通常の synth とレジスタ列の一致、observer の二重発音防止、古いポートの無効化、
既存 Worklet / native FX のテストで行う。実ブラウザーでの試聴は未確認。


### DAC・予約書き込みの直結

- [x] `dac.load` / `loadBase64` のデータ準備を Worker で実行。
- [x] `dac.playStream` / `schedule` / `scheduleBase64` と
  `scheduleWritesSamples` を専用 MessagePort へ送る。
- [x] `fm.loadDacBank` / `playDacBank` / `scheduleWrites` とクリア操作も直結。
- [x] AudioWorklet が最初の予約指示を受けた音声時刻 + lookahead を基準にする。
  バンクとレジスタ予約は同じ基準を共有し、44.1 kHz のオフセットを出力レートへ変換。
  `fm.scheduleWrites` / `playDacBank` の低レベルAPIは従来どおり音声時刻（秒）。
- [x] Stop で再生中のバンク・予約をクリア。再実行時は時刻基準を作り直す。
  ロード済みバンクは再利用できる。
- [x] Nuked の Worklet にも ymfm と同じ DAC バンク・予約書き込み処理を追加。

1バイトごとに Worker タイマーを動かさず、AudioWorklet が PCM 生成の途中で
必要な位置まで進めて DAC レジスタを書き込む。発音のための main thread 往復は不要。
`setTiming` / `setDacLookahead` など設定の管理は引き続き main thread と共有する。
OPN の DAC 非対応モードの予約APIは今回の対象外。

検証: 関連85テスト成功。main の応答なしでの DAC API 完走、48 kHz 出力での
書き込み位置、Stop、時刻基準のリセット、Uint8Array の部分ビューを確認。
ymfm / Nuked の実 WASM で DAC サイン波から有限・非無音の PCM が生成されることも確認。
実ブラウザーでの聴感・負荷確認は未実施。
