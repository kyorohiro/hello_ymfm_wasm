Tetorica FM2612 Playground - Implementation Hints

Purpose

このドキュメントは、Tetorica FM2612 Playground の実装上のヒントを記録する。

特に以下を対象とする。

* liveLoop() の実装
* コード変更時のHot Reload
* Loop境界での安全なcallback差し替え
* sleep() とScheduler
* Game Loopへの影響を抑える設計
* AudioContext / AudioWorklet との役割分担
* Playgroundで危険な無限ループを防ぐ方法

⸻

liveLoop Concept

liveLoop() は単純な while (true) helper ではなく、

名前付きでRuntimeに保持される永続的な音楽Loop

として扱う。

User code:

liveLoop("bass", async () => {
  play("E2");
  await sleep(0.25);
});

同じ名前の liveLoop() が再評価された場合、新しいLoopを追加しない。

既存Loopの次回実行callbackを更新する。

liveLoop("bass", callbackA)
        ↓ running
callbackA
callbackA
callbackA
        ↓ editor changed
liveLoop("bass", callbackB)
        ↓
current iteration finishes
        ↓
callbackB
callbackB
callbackB

⸻

Runtime and User Code Must Be Separated

PlaygroundのUser codeは、コード変更のたびに再評価される。

ただし、LiveLoop Runtime自体は再評価のたびに破棄しない。

Editor
  ↓
User Code Evaluation
  ↓
liveLoop("bass", newCallback)
  ↓
Persistent Playground Runtime
  ↓
Existing bass loop

Runtime側に以下のようなMapを保持する。

const liveLoops = new Map();

概念的には、

Map<string, LiveLoopState>

となる。

⸻

Basic LiveLoop State

最初の実装では以下程度でよい。

{
  name,
  currentFn,
  nextFn,
  stopped,
}

Example:

const liveLoops = new Map();
function liveLoop(name, fn) {
  const existing = liveLoops.get(name);
  if (existing) {
    existing.nextFn = fn;
    return;
  }
  const state = {
    name,
    currentFn: fn,
    nextFn: fn,
    stopped: false,
  };
  liveLoops.set(name, state);
  runLiveLoop(state);
}

Runner:

async function runLiveLoop(state) {
  while (!state.stopped) {
    state.currentFn = state.nextFn;
    await state.currentFn();
  }
  liveLoops.delete(state.name);
}

重要なのは、

Loop Taskそのもの

と、

Loopが実行するcallback

を分けること。

⸻

Hot Swap at Loop Boundary

コード変更を現在のiteration途中へ無理に割り込ませない。

変更は、

次のLoop iteration開始時

に反映する。

例えば、

liveLoop("bass", async () => {
  play("E2");
  await sleep(0.25);
});

実行中に、

liveLoop("bass", async () => {
  play("G2");
  await sleep(0.25);
});

へ変更した場合、

E2
|
sleep
|
Loop boundary
|
callback swap
|
G2
|
sleep

とする。

これにより、現在実行中の処理を途中で破壊しなくて済む。

⸻

Why Loop Boundary Hot Swap?

実行中のcallbackを強制停止すると、以下の問題が起こりやすい。

noteOnしたがnoteOffしていない
FX parameter変更途中
一時的なstateだけ変更された
Promiseが途中で破棄された
AudioNode routing変更途中

そのため、基本的には現在のiterationを完走させる。

その後、新しいcallbackへ切り替える。

⸻

Editor Auto Evaluation

Playgroundでは明示的なRunボタンだけでなく、コード変更を自動反映できるようにしたい。

Concept:

Editor Change
   ↓
debounce
   ↓
Evaluate User Code
   ↓
liveLoop("bass", newCallback)
   ↓
nextFn updated
   ↓
next iteration uses new code

入力中に毎キー評価すると構文エラーが頻発するので、短いdebounceを入れる。

目安:

150ms - 300ms

例えば:

let updateTimer;
editor.onChange(() => {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    evaluateEditorCode();
  }, 200);
});

⸻

Syntax Errors Should Not Stop Existing Music

Live coding中は一時的にSyntax Errorになるのが普通。

例えば、

play(

まで入力した瞬間は当然エラーになる。

このとき、現在正常に動いているLiveLoopまで停止させない。

理想:

Current LiveLoop
      ↓
continues running
New User Code
      ↓
Syntax Error
      ↓
show error in editor
      ↓
do not replace callbacks

つまり、

新しいコードの評価に成功した場合だけRuntimeへ反映する

こと。

既存のcallbackを先に消さない。

⸻

Evaluation Should Be Transaction-Like

User code評価は可能なら、

evaluate
   ↓
success
   ↓
commit new callbacks

とする。

エラーの場合:

evaluate
   ↓
error
   ↓
discard candidate changes

とする。

LiveLoop登録を評価中に即座にRuntimeへ反映すると、ファイル後半でエラーが起きた場合に一部だけ更新される可能性がある。

そのため将来的には、

beginEvaluation();
evaluateUserCode();
commitEvaluation();

のような考え方を持ってもよい。

例えば評価中は一時領域へ登録する。

candidateLoops.set(name, fn);

全体評価に成功後、

commitLiveLoops(candidateLoops);

する。

⸻

Missing Loops After Re-Evaluation

以前存在したLoopが新しいコードから削除された場合も考える。

Before:

liveLoop("bass", ...);
liveLoop("drums", ...);

After:

liveLoop("bass", ...);

この場合 drums をどうするか。

候補は2つある。

Option A: Removed Loop Stops

Editor全体をProgramとして扱い、新コードに存在しないLoopは停止する。

old:
bass
drums
new:
bass
=> drums stops

Playgroundとしてはこちらが直感的かもしれない。

Option B: Loop Persists Until Explicit Stop

Sonic Pi的に、定義を消しても既存Loopは残る。

これはLive Codingには便利だが、初心者には分かりにくい可能性がある。

初期実装では、

User code全体を再評価した結果、存在しなくなったLoopは停止

を基本候補とする。

ただし仕様決定が必要。

⸻

Stop API

最低限以下を用意する。

stopLiveLoop("bass");
stopAllLoops();

PlaygroundのStopボタンでは、

stopAllLoops();
fm.allNotesOff();

を行う。

必要ならFX automationもキャンセルする。

⸻

sleep()

User-facing APIは、

await sleep(0.25);

のまま維持する。

初期実装では単純なPromiseでもよい。

function sleep(seconds) {
  return new Promise(resolve => {
    setTimeout(resolve, seconds * 1000);
  });
}

ただしこれは最終的なMusic Schedulerにはしない。

⸻

Problem with setTimeout

setTimeout() はMain Thread負荷の影響を受ける。

Expected:

0.0
0.1
0.2
0.3
0.4

Actual example:

0.0
0.103
0.208
0.314
0.421

さらに、

while (...) {
  play();
  await sleep(0.1);
}

という実装では誤差が積み重なる。

Game LoopやRendering負荷が高い場合、音楽のテンポが不安定になる可能性がある。

⸻

Keep the sleep API Stable

User code:

await sleep(0.1);

は変更しない。

内部実装だけ段階的に改善する。

v0
setTimeout
↓
v1
AudioContext.currentTime based clock
↓
v2
look-ahead scheduling
↓
v3
AudioWorklet-aware scheduler

これにより、Playground APIを先に固められる。

⸻

Music Clock

将来的にはWall ClockではなくMusic Clockを持つ。

基準候補:

audioContext.currentTime

Concept:

Game Clock
Main Thread Clock
        separate
Music Clock
AudioContext.currentTime

Game Loopと音楽時間をできるだけ独立させる。

⸻

Virtual Time Cursor

各LiveLoopに音楽上のcursorを持つ方式も検討する。

Concept:

cursor = currentAudioTime;
play("C4");
// schedule at cursor
await sleep(0.1);
// cursor += 0.1
play("E4");
// schedule at cursor

sleep() を、

JavaScript threadを正確に一定時間止める

ではなく、

音楽上の時間を進める

という意味へ発展させられる。

⸻

Look-Ahead Scheduling

最終的には少し先の音楽イベントを予約する。

Main Thread
now
 |
 | schedule note at +50ms
 | schedule note at +100ms
 | schedule note at +150ms
 v
Audio Thread
+50ms   note
+100ms  note
+150ms  note

こうするとMain Threadが一瞬重くなっても、予約済みイベントはAudio側で継続できる。

⸻

Interaction with YM2612 AudioWorklet

理想構成:

Playground JS
    ↓
LiveLoop Runtime
    ↓
Music Scheduler
    ↓
AudioWorklet messages
    ↓
YM2612
    ↓
AudioNode FX
    ↓
Output

Main Thread上のLiveLoopは、

音を直接生成する

のではなく、

いつ
どのchannelで
どのnoteを
どのparameterで
鳴らすか

を予約する役割に寄せる。

⸻

FX Scheduling

Web Audio FXはAudioParam automationを優先する。

Avoid:

requestAnimationFrame(() => {
  filter.frequency.value = nextValue;
});

Prefer:

filter.frequency.linearRampToValueAtTime(
  target,
  audioContext.currentTime + duration
);

これによりGame Loopへの影響を減らす。

⸻

liveLoop Must Yield

以下は危険。

liveLoop("broken", async () => {
  play("C4");
});

callback内に sleep() がないため、

while
while
while
while

が高速に回り続け、Main Threadを占有する。

Playgroundでは防御が必要。

⸻

Cooperative Yield Detection

各iterationで、

sleep()
yield()
wait()

などが最低1回呼ばれたか確認する。

例えばRuntime contextへ、

state.didYield = false;

を持つ。

sleep() 時:

state.didYield = true;

iteration終了後:

if (!state.didYield) {
  stop loop;
  throw error;
}

User-facing error:

liveLoop("broken") did not yield.
Call sleep(), wait(), or another yielding function
inside every loop iteration.

⸻

Runtime Safety

Playgroundは任意JavaScriptを実行するため、LiveLoop以外にも危険がある。

例えば:

while (true) {}

これは liveLoop() の防御では止められない。

将来的にはUser code実行を、

Worker
iframe sandbox
isolated runtime

などへ分離することも検討する。

ただしAudioContextやUIとの接続方法とのトレードオフがある。

初期版ではスコープを広げすぎない。

⸻

LiveLoop State

将来的にはcallback以外のstateを保持することも考えられる。

例えば:

liveLoop("arp", async (loop) => {
  const note = notes[loop.index % notes.length];
  play(note);
  loop.index++;
  await sleep(0.125);
});

Runtime側:

{
  name,
  currentFn,
  nextFn,
  stopped,
  iteration,
  state,
}

ただし最初から独自state APIを増やす必要はない。

JavaScript closureで十分なケースも多い。

⸻

Closure and Hot Reload

以下の場合:

const notes = scale("E2", "minorPentatonic");
liveLoop("bass", async () => {
  play(choose(notes));
  await sleep(0.25);
});

User code再評価時に、

const notes = scale("C2", "majorPentatonic");

へ変更すると、新しく作られたcallbackは新しい notes closureを保持する。

次回Loop boundaryでcallbackを差し替えれば、新しいscaleも自然に反映される。

これはHot Reload方式の利点。

⸻

Possible Future: Quantized Update

初期版では、

next loop iteration

でコード変更を反映する。

将来的には、

next beat
next bar
next 4 bars

などのQuantized Updateも考えられる。

Example concept:

liveLoop("bass", {
  updateAt: "nextBar",
}, async () => {
  ...
});

または:

liveLoop("bass", async () => {
  ...
}, {
  updateAt: "nextLoop",
});

ただし初期版では nextLoop 固定でよい。

⸻

Important Design Principle

liveLoop() の実装詳細をUser codeへ漏らさない。

User-facing codeは可能な限りシンプルに保つ。

liveLoop("bleeps", async () => {
  play(
    choose(scale("Eb2", "majorPentatonic"))
  );
  await sleep(0.1);
});

内部では、

Named Runtime Task
Hot Callback Swap
Evaluation Transaction
Music Clock
Scheduler
AudioWorklet
Safety Guard

などを段階的に追加できるようにする。

⸻

Suggested Initial Implementation

最初は以下で十分。

Persistent LiveLoop Runtime
Map<string, LiveLoopState>
async / await
sleep() = setTimeout
callback hot swap at next iteration
editor auto-evaluate with debounce
syntax error keeps previous code running
stopLiveLoop()
stopAllLoops()
yield detection

Error behavior should be read in two layers:

1. Top-level Run / re-evaluation error

If newly entered code fails before `commitLiveLoops()` is reached,
the previous committed live loops should keep running.

This includes cases such as:

- syntax error
- top-level runtime error during the new Run

In other words, a failed re-run must not immediately destroy the last stable
liveLoop set.

2. Error inside an already running liveLoop iteration

If a loop callback itself throws after it has already been committed and started,
that loop may stop and show an error.

This is different from "new Run failed, keep the previous version".

The first rule is about preserving the previously committed live-loop set when
new code fails to install.
The second rule is about an active loop instance crashing during playback.

The current implementation direction is:

- failed new Run -> keep previous committed loops
- active loop iteration throws -> stop that loop and report error

If later we want "rollback to previous callback version for the same loop name",
that should be treated as a separate feature, not assumed by default.

その後Schedulerを改善する。

⸻

Recommended Implementation Order

1. liveLoop(name, fn) を作る
2. sleep(seconds) を作る
3. 名前付きLoopをRuntime Mapで保持する
4. 同名Loop再評価時に nextFn を更新する
5. 次のiterationから nextFn を利用する
6. Editor変更をdebounceして自動評価する
7. Syntax Error時は既存Loopを維持する
8. Stop / Stop Allを追加する
9. sleep() なしLiveLoopを検出する
10. 評価をtransaction-likeにする
11. AudioContext clockへ移行する
12. look-ahead schedulerへ移行する
13. AudioWorklet schedulingを検討する

⸻

Core Idea

LiveLoopの中心的な考え方は、

Loopを再起動するのではなく、Loopの中身を次の境界で交換する。

こと。

Persistent Loop
     ↓
callback A
     ↓
callback A
     ↓
editor update
     ↓
callback B registered
     ↓
current iteration finishes
     ↓
callback B
     ↓
callback B

これにより、Tetorica FM2612 Playgroundを単なる「コードを実行して音を出すページ」ではなく、

コードを書き換えながら音楽が途切れず変化していくLive Coding環境

として実装できる。
