# MegaSynth の Node.js 対応案 01

更新日: 2026-10-07

## 目的

ブラウザの MegaSynth を維持しながら、Node.js でも同じ音源 WASM と nativeFX を使えるようにする。
まずオフラインの PCM / WAV 生成、その後にリアルタイム再生を検証する。
この文書は設計案であり、Node 対応の実装や依存ライブラリの採用はまだ確定していない。

## 実装状況（最初の検証）

実験用の別入口 `web/megasynth_offline.js` に `createMegaSynthOffline()` を追加した。
現在の対応範囲は YM2612 FM / DirectTransport の DAC、nativeFX、オフライン PCM 生成。
既存のブラウザ `MegaSynth` のコンストラクターやリアルタイム出力 API は変更していない。

- nativeFX の DSP を `web/native_fx_engine.js` へ分離。ブラウザの nativeFX Worklet も同じ実装を使う。
- `fm` と `fx` の操作後、`render(frames)` でサンプル時計を進めてステレオ PCM を生成する。
- `schedule(frame, {target: 'fm', method, args})` で、絶対出力フレーム位置に FM コマンドを適用する。同時刻の命令は登録順を保つ。
- YM2612 の無発音時オフセットを除去し、ブラウザ Worklet と同じサンプルレート変換を使う。
- Native FX のパラメーター ramp は既存 Worklet と同様に処理ブロックごとに進む。任意の render 分割で ramp 結果が常に同一になる保証は、まだ付けていない。
- `scripts/demo_megasynth_offline.mjs` は Node Worker 内で WASM 読み込み・発音・FX・WAV 保存を完結し、Main へは出力先とフレーム数などの情報だけを返す。

```sh
node scripts/demo_megasynth_offline.mjs /private/tmp/megasynth-native-fx.wav
```

```js
import {createMegaSynthOffline} from '../../web/megasynth_offline.js';
import {FM_PRESETS} from '../../web/megasynth-fm-presets.js';
const synth = await createMegaSynthOffline({sampleRate: 48000});
try {
  synth.fm.setPreset(0, FM_PRESETS.sine);
  const fx = synth.fx;
  fx.setChain([fx.delay({time: 0.12, mix: 0.25})]);
  synth.schedule(0, {target: 'fm', method: 'noteOn', args: [0, 4, 553]});
  synth.schedule(24000, {target: 'fm', method: 'noteOff', args: [0]});
  const pcm = synth.render(48000);
} finally { synth.close(); }
```

この API はローカルの実験実装で、npm の公開版にはまだ含まれない。
PSG / Mega CD PCM は次段階。looper の PCM キャプチャは下記の追加検証で対応。
同一入力で Node・ブラウザのオフライン処理・実際の nativeFX AudioWorklet 出力が完全一致することを Chromium で確認した。
オフラインの Worklet は初期設定を `processorOptions.initialCommands` で渡し、描画より設定メッセージが遅れる競合を避ける。
対応済み範囲を全ブラウザ・全デバイスの互換性と同一視しない。

検証コマンド:

```sh
node --test web/megasynth_offline.test.mjs test/playground_native_fx.test.mjs web/synth-worklet.test.mjs web/megasynth.test.mjs web/custom_fx.test.mjs
npm run build:fm2612
node scripts/check_megasynth_offline_browser.cjs
```

## 実装状況（リアルタイム出力の検証）

`node/megasynth.mjs` に実験用 `MegaSynthNode` を追加した。
Worker 内で同じオフライン engine を連続実行し、nativeFX を通した PCM を音声デバイスへ出力する。
Main 側は `fm` の非同期命令、nativeFX controller、状態通知だけを扱う。
ローカル配布物では `tetorica-fm2612/node` から import できる。公開済み 0.2.4 にはまだ含まれない。

- audify 1.10.1 の CoreAudio 出力を、macOS の Node Worker 内で検証した。
- 4 × 512フレームを先行生成し、デバイスの消費通知で補充する。Main が忙しくても生成・出力を続ける。
- 起動・停止には20msのフェードを使う。停止後のキューを排出し、再開時は音色・FX設定を保つ。
- 初期化中のキャンセル、非同期命令の応答、出力失敗、停止・再開、終了後の新しい Worker での再起動を検証する。
- 実デバイス確認では CoreAudio の消費フレーム数の進行と、WASM が生成した有限・非ゼロの PCM を確認した。
- audify はオプションの peer dependency。ブラウザやオフライン生成へ必須依存として追加しない。

```sh
npm install audify
node scripts/demo_megasynth_node.mjs
```

アダプターの契約・非同期 API・実行例は [node/README.md](../../node/README.md) を参照。
`@kmamal/sdl@0.11.13` は Main Thread 専用だったため採用しなかった。
audify の stream 終了後に callback 参照が残るケースがあるため、stream を閉じた後に所有 Worker を明示的に終了する。
他の OS・デバイス、長時間・高負荷での音切れは、まだ確認が必要。

## 実装状況（イベント録音・looper）

`web/megasynth_session.js` の `createMegaSynthSession()` で、オフライン engine と既存の recording / looper を接続した。
`web/sample_clock.js` のタイマーを生成フレーム数で進め、イベント時刻の境界で PCM 生成を区切る。
非同期の looper 録音終了を待てるよう、この入口の `render(frames)` は Promise を返す。
従来の `createMegaSynthOffline().render()` は同期のまま維持する。

- Node の `synth.recording` / `synth.looper` は Worker 内のオブジェクトへ RPC を送る。
- 自分で演奏した FM 操作を記録し、再演と音色復元を二重に録音しない。
- `megasynth-recording-v1` の JSON を export / import / play できる。
- 録音ループは長さのフレーム数で繰り返し、実時間タイマー用の10ms余白を加えない。
- looper は noteOn / noteOff、音色、unit、undo、再録音の自動終了を扱う。既定はイベント方式、PCM モードは下記で選択する。
- 不正な録音データを、実際の chip を変更する前に検証する。
- 停止・終了で録音と繰り返しタイマーを解放する。停止後は unit を保持するが、自動でループ再生を再開しない。
- イベント JSON はチップ内部の発振・エンベロープ位相を保存しない。イベント時刻と音色を再現する形式で、WAV の完全保存ではない。

```sh
node --test web/megasynth_session.test.mjs test/megasynth_node.test.mjs web/megasynth.test.mjs
node scripts/demo_megasynth_node_events.mjs
```

実行例は録音 JSON を `/private/tmp/megasynth-events.json` に保存し、JSON 再生と looper を短く実演する。
CoreAudio の Worker 出力で、録音・繰り返し再生・looper・undo・終了まで確認した。
ループの発音境界、累積するタイマーの解放、再開後の古いイベントのキャンセルはデバイスなしのテストでも確認する。
この機能もまだローカルの実験実装で、npm には未公開。

新しい API・examples・説明では `MegaSynth` を使う。
`MegaDriveSynth` は過去互換のために残す別名として扱う。

## 実装状況（PCM looper）

`createMegaSynthSession({looperMode: 'pcm'})` で FM の dry PCM を取り込み、native sample mixer で繰り返し再生する。
Node の指定は `new MegaSynthNode({engineOptions: {looperMode: 'pcm'}})`。
既定のイベント方式は維持する。

- FX / masterVolume / 録音済み PCM のミックス前に取り込むため、重ね録りに以前のループが混入しない。
- 再生は nativeFX を通る。現在の FX 設定を録音済みループにも適用する。
- PCM は Worker に保持し、通常の unit 応答は情報だけを返す。`looper.exportAudio(unit.id)` で明示的にコピーできる。
- サンプル境界で再生し、同一 unit・同一フレームの二重再生を防ぐ。
- undo / clear は不要な bank を解放する。停止で voice と未来の再生をキャンセルする。
- 録音中と保持済み PCM の合計は既定60秒まで（`looperMaxAudioSeconds` で最大600秒）。最大64 bank。
- FX の残響込みの最終出力やマイク入力の録音にはまだ対応しない。

```sh
node scripts/demo_megasynth_node_pcm_looper.mjs
```

実行例は nativeFX 付きで PCM ループを再生し、dry PCM を WAV に保存する。
macOS / Node 22 / CoreAudio で12288フレームの録音・繰り返し再生・WAV 保存・undo・終了を確認した。
イベント方式と PCM 方式の検証・公開状況は [node/README.md](../../node/README.md) を参照。

## package を import する examples の検証

`w/tetorica-fm2612-examples` に開発版 tarball を `--no-save --package-lock=false` で一時導入し、本体の source へ直接 import せずに実行する。
公開済み package と同じバージョン表記の開発 tarball のため、新例には「開発版 package が必要」と明記する。
依存 manifest / lockfile の公開版指定は release 後に更新する。

- `embedding/06`：Node オフライン FM / nativeFX / WAV。
- `embedding/07`：イベント JSON の録音・import・繰り返し再演。
- `embedding/08`：イベント looper・undo・停止。
- `embedding/09`：PCM looper・dry PCM export・FX 適用後の WAV。
- `embedding/10`：Node Worker 内で audify 出力・録音・PCM looper・停止・再開。

全28件の Node オフライン例で WAV 生成と非ゼロ PCM を確認した。
10番は Node 22 / CoreAudio の実デバイスで、package の `tetorica-fm2612/node` export から実行した。
Browser の既存28例は Chromium で、生成した静的サイトを repository 名の URL 配下に置いて検証する。
再生完了・非ゼロ音声出力・途中停止・AudioContext 解放を確認する。
新しい Node 専用の一覧カードには Web リンクを作らない。

```sh
# examples repository（開発版 tarball 導入後）
npm run check:node
npm run build
# 本体 repository（上で生成した dist を使う）
node scripts/check_fm2612_examples_browser.cjs
```

examples の `dist` は開発版で再生成した。公開用 `docs` の差し替えと npm release はまだ行っていない。

## 出力なし初期化・出力の後付け（次版のローカル実装）

公開済み0.2.5では、既定出力の audify がないと `start()` が失敗する。
次版のローカル実装では、audify が未導入なら音源だけを `ready` にし、`render()` で PCM / WAV を生成できるようにした。
`outputModule: null` で明示的に出力なしを選べる。あとから `connectOutput()` で既定の audify、または利用者の出力モジュールを接続する。
`disconnectOutput()` で旧デバイスを解放し、別のモジュールへ切り替えられる。

- 出力なしでは生成フレーム数でのみ時間が進む。
- 接続の失敗時も音源を保持し、PCM 生成・接続の再試行ができる。
- 既存の Main 側 speaker / PCM 出力には明示的に取得した PCM を渡す。
- 通常出力の PCM を Main に戻したくない場合は、Worker 内で利用者のアダプターを生成する。
- アダプターの Promise を返す write / start / stop / close を待ち、切り離したアダプターの遅延通知は無視する。
- 詳細・対応範囲・出力契約は [node/README.md](../../node/README.md) を参照。この変更はまだ npm に未公開。

## 現状

- `web/megasynth.js` は AudioContext / AudioWorkletNode を使うブラウザのランタイム。
- 音源 WASM と DirectTransport による PCM 生成は、既に Node から使える。
- MegaSynth から nativeFX を明示的に初期化する経路がある。現在の `prepareNativeFX()` はブラウザの AudioWorklet に依存する。
- nativeFX の DSP は WASM だが、WASM を採用しただけで Node 対応になるわけではない。読み込み・実行・音声出力の経路が必要。
- 既存の Web Audio FX を接続する API もある。nativeFX を標準にするか、既存経路をどう維持するかは別途決める。

## AudioWorklet の役割

ブラウザの AudioWorklet は、音源処理を音声スレッドで動かしつつ、Main Thread 側では AudioNode として接続できる点が強い。
処理本体を Main に戻すのではなく、Main にあるノードのハンドルを通して音声グラフへ接続する。
音声レンダリングのクロックと同期する点も、通常の Worker とは異なる。

Node の Worker は、それだけでは AudioNode にならない。
既存のブラウザ構造をそのまま持ち込むなら、AudioWorklet に対応した Node 用 Web Audio 実装と、現在の WASM / MessagePort の使い方との互換性を検証する必要がある。

## MegaSynth 単体なら Main へ PCM を戻す必要はない

MegaSynth の内部で音源・FX・最終出力まで完結するなら、通常の再生で PCM を Main Thread に送り返す必要はない。

```text
Main Thread
  MegaSynth の操作用 API
    ↓ 発音・設定・停止などのコマンド
Node Worker
  音源 WASM → ミキシング → nativeFX → 音声出力アダプター
    ↑ 状態・エラー・録音データなどの必要な通知
Main Thread
```

音声出力アダプターを Worker 内で使えるかは、選ぶライブラリ・デバイス API の制約を確認する。
Main 側で出力する必要がある実装を選ぶ場合は、PCM の共有バッファと供給・同期の設計が必要になる。

利用者が外部の Web Audio ノードへ繋ぎたい場合には AudioNode の入口が必要になる。
ブラウザの接続機能は維持し、Node 単体の再生では AudioNode の公開を必須にしない案を検討する。
WAV 保存・オフライン render・波形表示など、PCM が必要な操作では明示的に取得する。

## 分離したい責務

| 責務 | 共通部分 | 実行環境に依存する部分 |
| --- | --- | --- |
| 音源 | WASM、音源操作、PCM 生成 | WASM の読み込み、実行スレッド |
| FX | nativeFX の WASM、設定・グラフ | Worklet / Worker 上の初期化・実行 |
| 時間 | サンプル位置、イベント順序 | デバイスのレンダリング要求、オフラインのフレーム進行 |
| 出力 | 処理済み PCM | ブラウザの音声グラフ、Node の音声デバイス、WAV 保存 |
| 操作用 API | 発音・設定・録音・停止 | Main と処理スレッド間の通信 |

共通エンジンに「コマンドを適用する」「指定フレーム数を生成する」入口を持たせる案がある。
具体的なメソッド名・コンストラクター・Node 用 entry point は未確定。
Node 用の音声出力依存は、ブラウザ利用や既存の生 PCM 生成に必須の依存として追加しない。

## looper / recording

`MegaSynthRecordingManager` は音源操作と時刻を JSON に記録するイベント録音。
`MegaSynthLooper` の基本機能も noteOn / noteOff の記録と繰り返し再生であり、両方の本体に AudioContext への直接依存はない。

ただし、既定タイマーは `window.setTimeout` / `clearTimeout` を使うため、Node では時計・タイマーを注入する。
接続先 Synth の条件と、recording へのイベント取得・登録も整える必要がある。
looper の PCM キャプチャ・音声再生は、別途注入する処理に依存する。

オフライン生成では実時間のタイマーを待たず、生成したフレーム数を時計にする。
再生イベントの時刻で render を区切るなど、イベントをサンプル位置へ反映するスケジューラーが必要。
時計を差し替えるだけで既存のタイマー再生がサンプル単位になるわけではない。

## Node 用 Web Audio 実装について

Node 側にも Web Audio 実装を使う案はあるが、まだ必須の前提にはしない。
2026-10-07 の確認時点で、[`webaudio-node` の公式 README](https://github.com/monteslu/webaudio-node#️-roadmap) は AudioWorklet 対応を今後の予定として記載している。
現在の MegaSynth をそのまま動かせるとは判断できない。

AudioWorklet 相当を利用する案では、少なくとも次を実際に検証する。

- ES module の Worklet 読み込みと、依存モジュール・WASM の配置。
- WebAssembly.Module / バイト列と MessagePort の受け渡し。
- `sampleRate` / `currentFrame` / `currentTime` とコマンド実行の同期。
- nativeFX の Worklet 初期化と、音源から FX への連続した PCM 処理。
- オフラインとリアルタイムの対応範囲、遅延、バッファ不足時の挙動。
- 停止・終了・初期化キャンセル・再起動時のリソース解放。

## 進め方

1. 音源 WASM と nativeFX WASM を AudioContext なしで直列処理する最小構成を作る。
2. サンプル時計に沿ってイベントを適用し、Node で PCM / WAV を生成する。
3. 同じ入力・sample rate・設定で、ブラウザと Node の音源・FX 出力を比較する。
4. Worker 内での連続処理と音声出力アダプターを検証する。
5. looper / recording の時計・スケジューラーを接続する。
6. ブラウザの既存 API と外部 AudioNode 接続を維持しながら、Node の入口を決める。

起動・停止時の無音、DC オフセット、通常の発音、FX、録音再生、長時間再生、終了後の再起動を確認する。
まず実行経路の小さな検証を行い、Node 用 Web Audio 実装を使うか、Worker と独自の出力アダプターで完結させるかを判断する。

## チップ別 Transport の基本 examples（次版）

MegaSynth はゲーム埋め込み用として残し、基本例17件を WorkletTransport / AudifyTransport に揃える。
Web は Main に Synth / Transport、Worklet に WASM。Node は呼び出し元に chip / Synth / Transport、デバイス管理だけ内部 Worker。
DirectTransport の PCM 生成・保存は `examples/transport/direct/01-single-note` に分けた。
createSoundChip の Gameboy / SegaPSG 自動読み込みと、execution: worklet の生成入口を追加。
従来の createSoundChip の既定と既存 AudioWorkletNode / MessagePort の Transport 接続も維持する。
この変更はローカル開発版で、npm はまだ0.2.5のまま。

検証: 関連63テスト、Node 22の配布物（256参照・23 WASM・15 renderer）、Node基本例17件のCoreAudio再生・正常終了、Web29件の発音・途中停止・AudioContext解放、オフライン12件のWAV出力を確認。
利用者が追加したWorkerにSynth / WorkletTransportを置き、追加MessagePort経由で発音・YM2608メモリ応答・Mainでの終了を行う経路もChromiumで確認。
