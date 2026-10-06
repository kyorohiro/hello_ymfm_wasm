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
PSG / Mega CD PCM、looper / recording の統合は次段階。
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
他の OS・デバイス、長時間・高負荷での音切れ、looper / recording の統合は、まだ確認が必要。

新しい API・examples・説明では `MegaSynth` を使う。
`MegaDriveSynth` は過去互換のために残す別名として扱う。

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
