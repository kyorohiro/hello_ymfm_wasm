Tetorica FM2612 Playground

Current status

2026-08-22 時点で、最初の小さな Playground は動き始めている。

2026-08-24 時点では、

* `MegaSynth` 側に listener を持たせる方向が見えた
* Playground の Operator tab 同期も `MegaSynth.addListener(...)` ベースへ寄せ始めた
* つまり Playground は `YM2612Synth` に直接同期責務を足すのではなく、
  `MegaSynth` を browser / demo / live coding 向けの通知ハブとして扱う方向になっている

すでに入っているもの:

* `play(note, { channel, duration, preset })`
* `sleep(seconds)`
* `scale()`
* `choose()`
* `rand()` / `randInt()`
* `setBpm()`
* `beat()`
* `nextBeat()`
* `liveLoop(name, async () => {})`
* `fm` として `YM2612Synth` へ直接降りる入口

つまり、

* 少ないコードで鳴らす
* BPM と beat を共有する
* 複数 `liveLoop()` を走らせる
* 必要なら `fm.setOperator()` などで YM2612 を直接触る

ところまでは、最初の形ができた。

未解決:

* hot reload をもっと安全にする
* `liveLoop()` が yield しないコードへの防御
* live coding 向けの stop / replace の洗練
* 今後の `with_fx` 的な層をどうするか
* markdown ベースの書き方や tutorial との接続
* Playground の責務分割
* Synth demo と Playground の部品共通化

この文書の以下は、その先の設計メモとして残す。

Overview

Tetorica FM2612 に JavaScript ベースの Playground を追加する。

単なる YM2612 API のデモではなく、

10行程度のコードを書くだけで、テクノ / アンビエント / Chiptune 的な音楽が鳴る

ことを目指す。

Sonic Pi の「コードを書いてすぐ音楽として遊べる」体験を参考にするが、Tetorica FM2612 は YM2612 / Mega Drive / Genesis を前提とした Playground とする。

最終的には Playground で作ったコードを、そのままブラウザゲームなどへ組み込めることを重視する。

⸻

Why JavaScript?

MMLではなく JavaScript を使う。

MML は主に「曲を記述する言語」だが、Tetorica FM2612 Playground では「YM2612をプログラムする」ことを目的とする。

例えば、

play(choose(scale("Eb2", "majorPentatonic")));

のような簡単な記述から始めて、

fm.algorithm(0, 4);
fm.feedback(0, 5);
fm.operator(0, 2, {
  mul: 3,
  tl: 40,
});

のように YM2612 固有の機能へ降りていけるようにする。

JavaScript なので、通常のプログラミング機能もそのまま利用できる。

for (...)
Math.sin(...)
array.map(...)
async / await

ランダム生成やアルゴリズミック・コンポジションとの相性も良い。

また Playground 専用言語ではないため、作ったコードをゲーム側へ移植しやすい。

⸻

Inspiration: Sonic Pi

Sonic Pi の以下のような体験を参考にする。

with_fx :reverb, mix: 0.2 do
  live_loop :bleeps do
    play scale(:Eb2, :major_pentatonic, num_octaves: 3).choose,
      release: 0.1,
      amp: rand
    sleep 0.1
  end
end

重要なのは Ruby の文法そのものではなく、

* 少ないコードですぐ鳴る
* scale
* choose
* rand
* sleep
* live_loop
* FX
* ランダムでも音楽として成立する
* 実行しているだけでテクノ / アンビエント的な雰囲気になる

という体験。

Playground を「YM2612の勉強ページ」だけにはしない。

最初に触った人が、

おっ、これで何か作れそう

と思えることを優先する。

⸻

Tetorica FM2612 Difference

Sonic Pi と大きく違う点は、音源を YM2612 に限定すること。

Sonic Pi
  ↓
general purpose synth / sampler / FX
  ↓
Live Coding
Tetorica FM2612
  ↓
YM2612
  ↓
6 channels
  ↓
4 operators
  ↓
FM synthesis
  ↓
Genesis / Mega Drive

YM2612 の制約を隠さない。

例えば6chしか存在しないことも Playground の特徴として扱う。

// Example concept
channel(0).instrument(bass);
channel(1).instrument(lead);
channel(2).instrument(pad1);
channel(3).instrument(pad2);
channel(4).instrument(pad3);
channel(5).instrument(percussion);

「もうchannelがない」という状態も含めて YM2612 を体験できるようにする。

⸻

API Layers

API は段階的に YM2612 の内部へ降りられる構造にしたい。

Level 1: Music

最も簡単な音楽API。

play("C4");
play(
  choose(scale("Eb2", "majorPentatonic"))
);
await sleep(0.1);

候補:

play()
stop()
sleep()
scale()
chord()
choose()
rand()
randInt()
liveLoop()

⸻

Level 2: YM2612

FM音源を直接操作する。

fm.algorithm(0, 4);
fm.feedback(0, 5);
fm.operator(0, 1, {
  mul: 2,
  tl: 20,
  ar: 31,
  d1r: 10,
  d2r: 5,
  sl: 8,
  rr: 8,
});

既存の YM2612Synth API を可能な限り利用する。

Playground API が YM2612 を完全に隠してしまわないこと。

⸻

Level 3: Register

必要なら最終的にレジスタへ降りられる。

fm.writeRegister(...);

Playground から YM2612 自体を学べることも重要。

⸻

Current architecture direction

今後、Playground はかなり多機能化する見込みがある。

想定している主要追加機能:

* TFI / VGI 対応
* `docs/synth` 側の envelope view を Playground に持ち込む
* FX をコードだけでなく toggle / knob 的 UI からも触れるようにする
* ギター指板風の入力機能を持ち込む
* Sonic Pi を benchmark にして、同等以上の live coding 表現を目指す

この流れだと、

* `playground.js` に全部を足し続ける

のは危険。

今のうちに、

* 共通ライブラリ
* 単体 demo / synth app
* Playground orchestration

を分けて考える。

目安としては以下:

* `web/*`
  * 共通ライブラリ
  * `YM2612Synth`
  * `MegaSynth`
  * TFI / VGI
  * FX
  * recording
* `docs/synth/*`
  * 学習用 / 単体操作アプリ
  * operator
  * envelope
  * keyboard / fretboard
  * looper
* `docs/playground/*`
  * live coding 用の統合アプリ
  * editor
  * runtime
  * sync
  * helper tabs
  * controller tabs

つまり、Playground に直接機能を生やすより、

1. まず `web/*` か `docs/synth/*` で部品を作る
2. その後 Playground に持ち込む

の順を基本方針にしたい。

⸻

Near-future extraction plan

Playground を軽く保つため、今後は少なくとも以下の単位で分けることを意識する。

* `playground_runtime.js`
  * `runCode`
  * `liveLoop`
  * `play`
  * `beat`
  * `sleep`
  * `livePrepare`
* `playground_editor.js`
  * Monaco 初期化
  * completion
  * hover
  * fallback textarea
* `playground_console.js`
  * console tab
  * helper tab
  * log formatting
* `playground_sync.js`
  * `MegaSynth.addListener(...)`
  * operator / future fx tab への反映
* `playground_examples.js`
  * example code 定義
* `playground_operator_tab.js`
  * operator controller
* `playground_fx_tab.js`
  * future FX controller

特に重要なのは、

* `playground.js = 全部入り`

に戻さないこと。

Playground は最終的に「全部入りアプリ」になってもよいが、
実装本体は外へ逃がしておく。

⸻

Current sync direction

同期機能の基本方針は、以下で整理する。

* `YM2612Synth`
  * readable な low-level FM control layer
  * state notify の中心にはしない
* `MegaSynth`
  * browser/runtime wrapper
  * high-level FM events の listener hub
* Playground / Synth demo
  * `MegaSynth.addListener(...)` を購読して UI を同期

この方針にすると、

* `docs/playground`
* `docs/synth`
* 将来の game embed / app

のすべてで、同じ通知の考え方を使いやすい。

raw register write の同期は別問題なので、
まずは

* `setPreset`
* `setOperator`
* `setAlgo`
* `setPan`
* `noteOn`
* `noteOff`

の高レベル同期を優先する。

⸻

Generative FM

JavaScript を使う大きな理由の一つ。

音符だけでなく、FM音色そのものを生成・変化させられる。

liveLoop("metal", async () => {
  fm.algorithm(0, choose([0, 1, 2, 3, 4, 5, 6, 7]));
  fm.feedback(0, randInt(0, 7));
  fm.operator(0, 2, {
    mul: choose([1, 2, 3, 5, 7]),
    tl: randInt(20, 60),
  });
  play(
    choose(scale("C2", "minorPentatonic"))
  );
  await sleep(0.25);
});

これは単なる Generative Music ではなく、

Generative FM

として扱える。

YM2612 の音色がリアルタイムに変化し続けること自体を Playground の遊びにする。

⸻

FX

Sonic Pi のエモさには FX、特に Reverb / Echo がかなり効いている。

YM2612 は比較的乾いた音なので、外部FXとの相性も良い。

ただし、

YM2612

と

Tetorica FX

は明確に区別する。

FX を YM2612 の機能であるかのようには扱わない。

⸻

FX Architecture

基本的には「BOSS pedal方式」を検討する。

つまり、SynthへFXを内蔵するのではなく、独立したAudioNodeとして接続する。

YM2612
   ↓
Delay
   ↓
Reverb
   ↓
Master

イメージ:

const delay = fx.delay({
  time: 0.25,
  feedback: 0.4,
});
const reverb = fx.reverb({
  mix: 0.3,
});
fm
  .connect(delay)
  .connect(reverb)
  .connect(output);

この方式なら音の経路がコードから分かる。

また、YM2612Synth 自体へ

setReverb()
setDelay()
setChorus()

などを大量に追加する必要がない。

⸻

Initial FX

最初から大量に作らない。

候補:

Gain
Pan
Filter
Delay / Echo
Reverb
Distortion

特に最初は、

Delay
Reverb

を優先したい。

短いFM音を高速に鳴らしてReverbへ流すだけでも、テクノ / アンビエント的な音を作れる。

⸻

AudioNode / Game Performance

FX は可能な限り Web Audio API の AudioNode を利用する。

Main Thread
  ├─ Game Loop
  └─ Playground / Scheduler
Audio Thread
  ├─ YM2612
  ├─ Delay
  ├─ Reverb
  └─ other FX

FX parameter の時間変化には、可能なら AudioParam automation を利用する。

例えば毎フレーム、

filter.frequency.value = ...

と更新するのではなく、

filter.frequency.linearRampToValueAtTime(...);

などを利用する。

Game Loop と音響処理をできるだけ分離する。

YM2612 の AudioWorklet 化とも相性が良い。

FX AudioNode は可能な限り使い回し、音符ごとに大量生成・破棄しない。

⸻

Why Random Pentatonic Sounds Good

例えば、

play(
  choose(scale("Eb2", "majorPentatonic"))
);

だけでも比較的音楽として成立しやすい。

Major Pentatonic は、

Eb F G Bb C

のように強い衝突を起こしにくい音だけに選択肢を限定できる。

そこへ、

short release
fast interval
random amplitude
reverb

を組み合わせる。

例えば、

liveLoop("bleeps", async () => {
  play(
    choose(scale("Eb2", "majorPentatonic")),
    {
      release: 0.1,
      amp: rand(),
    }
  );
  await sleep(0.1);
});

実際には1秒間に10音程度鳴っていても、Attackを強くしすぎず短い音をReverbへ送ることで、「高速演奏」というより音の粒・空間として聞かせることができる。

さらにReverbによって過去の音が重なるため、ランダムに選択された音から偶然のHarmonyが発生する。

Playground の代表的なデモとして使えそう。

⸻

Examples

Playground を開いたとき、APIリファレンスより先に「格好いいExample」を見せたい。

候補:

Random Pentatonic
FM Arpeggio
Night Drive
Cyber Rain
Metallic Percussion
FM Bells
Ambient FM
Acid-ish Bass
6ch Techno
Generative FM

クリックするとコードがEditorへ入り、そのまま実行できるようにする。

重要なのは、

Exampleを実行すると即座に曲っぽいものが鳴る

こと。

⸻

Genesis / Mega Drive Assets

Tetorica FM2612 のもう一つの特徴。

既存の Genesis / Mega Drive の FM文化・資産を活用できる可能性がある。

将来的には、

VGM / VGZ
DefleMask related assets
YM2612 instrument formats
Genesis FM instrument data

などを Playground と接続したい。

ただし商用ゲームから抽出された音楽・音色データの再配布については、著作権・ライセンスを別途考慮する必要がある。

Playground上での解析・読み込みと、自作ゲームへの再配布は分けて考える。

⸻

Positioning

Tetorica FM2612 Playground は、

Sonic Pi clone

にはしない。

イメージとしては、

A modern JavaScript playground for the YM2612.

または、

Live coding with the sound of the Mega Drive / Genesis.

に近い。

Sonic Pi 的な、

10 lines of code and it already sounds cool.

という体験を入口にしながら、内部へ進むと本物のYM2612が存在する。

⸻

User Flow

理想的には、

Open Playground
      ↓
Run Example
      ↓
"Oh, this sounds cool."
      ↓
Change a note / scale / random parameter
      ↓
Change FM operator
      ↓
Understand YM2612
      ↓
Create own sound
      ↓
Copy code
      ↓
Use it directly in a browser game

という流れを作る。

⸻

Initial Scope

最初から完成されたDAWやSonic Pi相当を作らない。

まずは、

JavaScript Editor
Run / Stop
play()
sleep()
scale()
choose()
rand()
liveLoop()
YM2612Synth API
Delay
Reverb
Several impressive examples

程度を完成ラインとする。

VGM import、複数フォーマット対応、大量のFX、Tracker、MML、DAW機能などは後回し。

⸻

Goal

最初の目標は非常に単純。

10行でエモいFMが鳴る。

YM2612を知らない人でもPlaygroundを触って「面白い」と思える。

YM2612を知っている人には、

これをそのままゲームへ組み込みたい

と思ってもらえる。

そして必要になれば、簡単な play() から4 Operator、Algorithm、Feedback、最終的にはRegister操作まで降りていける。

Tetorica FM2612 Playground を、YM2612の単なるデモではなく、

YM2612を現代のJavaScriptから演奏する小さな楽器

として作る。
