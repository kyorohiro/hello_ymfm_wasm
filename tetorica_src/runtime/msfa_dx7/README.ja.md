# Tetorica MSFA DX7 WASM

0.3.1 は、急な周波数・Feedback 変更のクリックを許容し、自動平滑化を追加しない
方針を明記した版です。音源処理・型・WASM は 0.3.0 と同一です。
急変操作の回帰テストを追加し、全77テストが通過しています。

Google の [music-synthesizer-for-android (msfa)](https://github.com/google/music-synthesizer-for-android)
を使う、独立した DX7 互換 FM 音源ライブラリの MVP です。
DX7 の 1 Voice／32 Voice Bank SysEx を読み込み、ブラウザの鍵盤や
JavaScript／TypeScript から演奏できます。既存の Tetorica パッケージへの依存はありません。

## npm から利用する

```sh
npm install tetorica-msfa-dx7-wasm
```

ビルド済み WASM と TypeScript 型定義を同梱しています。
利用側で Emscripten を導入する必要はありません。
PCM 生成は `tetorica-msfa-dx7-wasm`、ブラウザ再生は
`tetorica-msfa-dx7-wasm/browser` から読み込んでください。

## ビルドとデモ

必要環境は Node.js 22 以降、npm、Emscripten (`em++`) です。
ネイティブ比較には C++17 コンパイラー（既定 `clang++`）も使います。
Emscripten は `EMXX`、ネイティブコンパイラーは `CXX` で変更できます。

```sh
npm ci
npm run build:wasm
npm run dev
```

表示されたローカル URL の `/demo/` を開き、**Audio Start** を押してください。
初期音色は、このプロジェクトで作成した `INIT SINE` です。
**Load SysEx** から `.syx` を読み込むと、音色一覧から選んで演奏できます。
鍵盤はマウス／タッチ、または PC の `A W S E D F T G Y H U J K` で操作できます。
準備中は鍵盤が無効になり、失敗時は理由を表示します。
**All Notes Off** はリリース、**Panic** は残響・バッファを含めた即時消音です。

`npm run build` で WASM と配布用デモを生成します。
`dist/` はそのまま静的ホストへ配置でき、デモの入口は `/demo/` です。
AudioWorklet の利用には HTTPS または localhost が必要です。
外部の音色バンクは同梱していません。デモから `INIT SINE` の SysEx を保存できます。

## PCM を生成する API

```typescript
import { createDX7, createInitVoice, createVoiceSysex } from 'tetorica-msfa-dx7-wasm';

const synth = await createDX7({ sampleRate: 44100 });
await synth.loadSysex(createVoiceSysex(createInitVoice()));
// 実際の音色ファイルなら await synth.loadSysex(new Uint8Array(fileBytes));
synth.selectVoice(0);
synth.noteOn(60, 100); // MIDI C4, velocity 100
const pcm = synth.render(44100); // mono Float32Array: 1 秒
synth.noteOff(60);
const tail = new Float32Array(44100);
synth.renderInto(tail);
synth.dispose();
```

この API は DOM／AudioContext に依存せず、Node.js からも使えます。
WASM は同梱の `wasm/msfa.wasm` を読み込みます。
配置を変更する場合は `wasmUrl`、取得済みバイナリーを使う場合は `wasmBytes` を指定します。
音源ごとに独立した WASM インスタンスとメモリを作成します。

| API | 意味 |
| --- | --- |
| `createDX7({sampleRate?})` | 初期化完了後に音源を返す。出力レートの既定は 44,100 Hz |
| `loadSysex(bytes)` | 全体を検証して音色を読み込み、先頭の音色を選択。失敗時は既存の音色一覧を保持 |
| `voices`／`selectedVoice` | `{index, name}` の一覧と現在の選択。読み込み前の選択は `-1` |
| `selectVoice(index)` | 0 始まりの音色を選択 |
| `noteOn(note, velocity = 100)` | 音高 0〜127、velocity 0〜127 の整数。velocity 0 は Note Off |
| `noteOff(note)` | 同じ音高で押されている声をすべてリリース |
| `allNotesOff()` | 全声をリリース。音色のリリース期間は鳴り続ける |
| `panic()` | 即時消音。発音・フィルター・生成済み PCM・リサンプル履歴をリセットし、音色選択は維持 |
| `render(frames)` | 新しい、呼び出し側所有の mono `Float32Array` を返す |
| `renderInto(buffer)` | 既存の `Float32Array` 全体へ書き込み、その長さ分の時間を進める |
| `dispose()` | 音源を破棄。繰り返し呼び出してもよい |

`render` と `renderInto` は同じ音源の続きを生成します。
返された配列は後の生成や破棄で書き換わりません。
フレーム数 0 は空配列／何もしない動作です。負数、小数、非有限値、
16,777,216 を超えるフレーム数は拒否します。
`renderInto` は `Float32Array` 以外を拒否します。
破棄後の演奏・音色変更・PCM 生成はエラーになります。

## ブラウザで再生する API

```typescript
import { createDX7Node } from 'tetorica-msfa-dx7-wasm/browser';

// Audio Start などのユーザー操作内で呼ぶ。
const context = new AudioContext({ latencyHint: 'interactive' });
await context.resume();
const instrument = await createDX7Node(context);
instrument.node.connect(context.destination);
await instrument.loadSysex(syxBytes); // Worklet 側での適用完了を待つ
instrument.selectVoice(0);
instrument.noteOn(60, 100);
// …
instrument.noteOff(60);
// 終了時: instrument.dispose(); await context.close();
```

`createDX7Node` は WASM が準備できた後に返り、まだ接続されていない
mono `AudioWorkletNode` を `node` として公開します。
音声生成と出力レート変換は Worklet 内で行います。
`loadSysex` の完了は適用済みの通知です。音色選択と演奏イベントは
同じ MessagePort を順番に通り、後の Note On が前の音色選択を追い越しません。
初期化前の要求キューは設けていません。呼び出し側で初期化と読み込みを待ってください。

生の ES Modules として配布する場合は `src/` と `wasm/` の相対配置を維持してください。
Vite を使う場合はデモのように Worklet を明示的にビルドできます。

```javascript
import workletUrl from 'tetorica-msfa-dx7-wasm/worklet?worker&url';
const instrument = await createDX7Node(context, { workletUrl });
```

`workletUrl`／`wasmUrl`／`wasmBytes` の指定で独自配置にも対応します。
処理失敗を監視する場合は `onError(error)` を指定します。

## Object で音色を設定する（0.2.0）

SysEx ファイルを用意せず、JavaScript の Object から音色を作れます。
これらの API は npm パッケージの 0.2.0 で追加されました。

```javascript
const synth = await createDX7({sampleRate: 44100});
synth.setPreset({
  name: 'JS BELL',
  algorithm: 0, // 0..31。実機のアルゴリズム1..32に対応。
  operators: {
    1: {coarse: 1, outputLevel: 90},
    2: {
      coarse: 2, outputLevel: 68,
      envelope: {rates: [99, 75, 50, 80], levels: [99, 70, 0, 0]},
    },
  },
});
synth.setOperator(2, {outputLevel: 60});
synth.setOperators([[1, {fine: 25}], [2, {coarse: 3}]]);
const preset = synth.getPreset(); // 全項目を持つ独立したコピー。
synth.noteOn(60, 100);
const pcm = synth.render(44100);
synth.dispose();
```

PCM コアの音色メソッドは同期処理です。ブラウザの `createDX7Node()` と Playground では
Promise を返すので、`await synth.setPreset({...})` のように適用完了を待ちます。
音色変更と次の Note On は同じ MessagePort の順序で処理されます。

- `setPreset(preset)`: 未指定項目を INIT SINE の値で埋め、選択中の音色を置換します。
- `setOperator(op, patch)`: 現在の音色の指定 OP だけを部分更新します。
- `setOperators([[op, patch], ...])`: 全体を検証して一括反映します。同じ OP の重複はエラー、空配列は何もしません。
- `getPreset()`: 現在の音色を Object で読みます。コア／単体ブラウザで音色未作成の場合はエラーです。
- `setFeedback(value)`: 0.3.0 で追加。0..7 の Feedback を発音中／次の発音へ反映します。

音色がない状態で最初の setter を呼ぶと、INIT SINE を基準に音色0を作成します。
32音色を読み込んだ場合も、選択番号と他の31音色を保持します。
入力・取得した Object を後で変更しても、適用済みの音色は変わりません。
未知の項目、不正な値、途中に不正な要素があるバッチは、現在の音色を変更せず拒否します。

OP は論理番号 **1〜6**。チャンネル引数はありません。Object の型は
`DX7Preset`／`DX7OperatorParams`、完全な取得結果は `DX7PresetState` です。

| 項目 | 値 |
| --- | --- |
| algorithm / feedback | 0..31 / 0..7 |
| operators[op].outputLevel | 0..99。大きいほど大きな音。YM2612 TL と向きが異なります |
| coarse / fine / mode | DX7 値0..31 / 0..99 / 'ratio' または 'fixed' |
| detune | DX7 値0..14、中央は7 |
| envelope / pitchEnvelope | rates と levels、各4個の0..99。秒数ではありません |
| keyboardScaling | breakpoint・leftDepth・rightDepth: 0..99、leftCurve・rightCurve: 0..3 |
| rateScaling / velocitySensitivity | 0..7 / 0..7 |
| lfo | speed・delay・pitchModDepth・ampModDepth: 0..99、waveform: 0..5、pitchModSensitivity: 0..7、sync: boolean |
| name | 最大10文字の表示可能な ASCII |

### 発音中の変更（0.3.0）

`setOperator`／`setOperators` の `outputLevel`・`mode`・`coarse`・`fine`・`detune`
は、編集中の音色から発音した音へ即時反映します。release 中も対象です。
位相・EG 段階・キー状態・元の velocity・鍵盤スケーリングを維持します。
その他の OP 項目・algorithm・EG 形状は次の Note On から反映します。
`setFeedback(0..7)` で同じ対象の Feedback も変更できます。

音色の選択を往復しても各スロットの識別を保持します。`setPreset()` による置換と
`loadSysex()` による再読込では新しい識別になるため、以前から鳴っている音は
後の編集で書き換わりません。`selectVoice()` 自体も既存の OP・EG を変更しません。
共有 LFO は音色の選択・置換時に再設定され、既存の声にも影響する場合がありますが、
ライブの音量・周波数・Feedback 編集では変更しません。

適用は次の未生成の64内部フレームのブロックからです。生成済み PCM や補間先読みには
遡りません。Promise 完了は適用状態を示し、デバイスで聞こえた時刻ではありません。

**急な周波数・Feedback 変更は、その値を直接反映します。それによる波形の不連続・
クリックノイズは仕様上許容します。** 自動的なパラメーターのスムージング、周波数の
滑らかな移行、Feedback の補間、クロスフェード、クリック抑制処理は追加しません。
変更時も位相・EG の進行・Feedback 履歴を保持し、再発音しません。
途中の値を指定したい場合は、利用者が明示的に制御できます。

上流 MSFA の既存の64フレームの OP ゲイン補間と、44.1→48 kHz の PCM 出力補間は
維持します。周波数・Feedback の指定値を補間する処理はありません。
NaN・Infinity 等は音色を変更せず拒否します。パラメーター変更による非有限の PCM、
振幅の破損、発散、クラッシュは許容しません。通常の Int16 クリップと出力範囲は
下記の音声モデルに従います。

Playground では `await tween(1, p => dx7.setOperator(2, {outputLevel: Math.round(99*p)}))`
のように setter の Promise を返します。数値の時間指定は秒です。

0.2.0 の「次の発音だけに適用」からの意図した挙動変更です。API の引数と、
編集しない場合の PCM は維持します。

ライブ音量は、進行中の EG を固定の基準にして OP の減衰量を変えます。
最初から無音・下限に張り付いた OP には並行して進む最大レベルの EG を使い、
再発音せず音を出せるようにします。ミュート中も attack/release の時間は進みます。
任意の編集後の実機と完全に同じ EG 時間を保証するものではありません。
完了した release は再開しません。
極端な ratio・note・pitch EG では、元の LUT の20オクターブ範囲を超える位相増分も
明示的にラップさせます。超音波域はエイリアスし、可聴域へクランプしません。
`ampModSensitivity`、`transpose`（0..48、中央24）、`oscillatorSync` はデータとして保持しますが、
下記の上流 msfa の制限を引き継ぎます。

## レート・時間・音量

- **内部レートは 44,100 Hz 固定**です。振幅エンベロープを含む上流の時間特性を保ちます。
- `sampleRate` は **返す PCM の出力レート**です。MVP は 44,100／48,000 Hz に対応し、
  その他は明示的なエラーにします。ブラウザでは実際の `AudioContext.sampleRate` を使います。
- 48,000 Hz へは、位相を保持する線形補間で出力側をリサンプリングします。
  音高・再生速度を維持する MVP 実装で、高品質な帯域制限補間ではありません。
- 演算は 64 内部フレーム単位です。イベントは次の未生成ブロックから適用され、
  生成済みの余り PCM と補間用の先読みには遡って適用しません。
  サンプル精度の予約 API はありません。
- PCM は上流の Int16 出力を 32,768 で割った値です。範囲は `-1`〜`32767/32768`。
  Float32 を返しますが、内部の最終出力は元の 16 bit 量子化を保っています。
  自動音量調整やコンプレッサーは追加していません。

## 発音管理と既知の制限

上流の 16 音の割り当てを使用します。全 16 声のキーを押している間、追加の Note On は無視します。
リリース中の声は次の発音に再利用される場合があります。
同音の連打は別の声を割り当てますが、Note Off は同音の全声をリリースします。
音色変更後も既存の声はオペレーター／エンベロープ設定を保持し、
音源全体で共有する LFO の設定は新しい音色に変わります。

この上流版には次の制限があります。値は SysEx から保持しますが、完全な DX7 実機再現は行いません。

- オペレーター AM 感度／LFO 振幅変調の一部は演算に適用されません。
- 音色の transpose／oscillator key sync は演算に適用されず、オペレーター位相は発音ごとにリセットされます。
- リリース終了後も使用済みの声の演算を継続します。負荷は最大 16 声に収まります。
- msfa 独自の共通出力フィルターを保持しています。DX7 実機の出力段と同一という意味ではありません。
- 現在の API は単一音色の楽器用です。MIDI チャンネル別の音源、Web MIDI 入力、
  連結 SysEx／リアルタイムのパラメーター変更 SysEx は対象外です。

SysEx はヘッダー、長さ、終端、7 bit データ、チェックサム、パラメーター範囲を検証します。
生の VCED 155 バイト／VMEM 128 バイトを直接 `loadSysex` することはできません。
コーデックの `createVoiceSysex`／`createBankSysex` で完全なメッセージにできます。

## テスト

```sh
npm run build:wasm
npm test
npm run test:native
npm run test:lifecycle
npm run typecheck
npm run test:browser
npm run test:package
```

ブラウザテストは開発用の Playwright が必要です。ワークスペースのインストール済み
Playwright も利用できます。ブラウザ未導入の場合は結果に未検証として記録します。
テスト用ブラウザは `npm exec playwright install chromium webkit firefox` で導入できます。
`npm run test:native` は同じ scalar msfa と同じ薄いアダプターをネイティブビルドし、
同条件の PCM を WASM と比較します。実機 DX7 との比較ではありません。
`test:lifecycle` は AddressSanitizer と確保数カウンターで生成・破棄・Panic を検証します。
Apple のリーク検出器には対応していないため、macOS では C++ 確保数の差分を確認します。
`test:package` はローカル tarball を隔離したフォルダーへインストールし、
Node.js の PCM 生成と、公開エクスポートを使う Vite ビルドを確認します。

確認結果と未確認環境は [docs/verification.md](docs/verification.md) に記録しています。

## Upstream とライセンス

採用コミットは `f67d41d313b7dc85f6fb99e79e515cc9d208cfff` です。
詳細な調査、採用範囲、制約は [docs/research.md](docs/research.md)、
上流からの変更一覧は [vendor/msfa/UPSTREAM.md](vendor/msfa/UPSTREAM.md) に記録しています。

元の scalar FM 演算、エンベロープ、アルゴリズム、発音割り当て、フィルターとクリッピングを使います。
変更は決定的な状態初期化、解放処理、薄い直接制御 API、現行ツールチェーンでのビルド対応です。
ネイティブ比較でも scalar 経路を選び、ARM の近似 NEON カーネルとの差を混ぜません。

msfa と新規コードは Apache-2.0 です。
[LICENSE](LICENSE)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、
上流の著作権表示を保持しています。Dexed のコードは含みません。
