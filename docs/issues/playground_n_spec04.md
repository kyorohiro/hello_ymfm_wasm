Tetorica FM2612 Playground Runtime Interface + Worker Execution

Goal

Refactor the current Tetorica FM2612 Playground so that its JavaScript execution/runtime can be used independently from the Playground UI.

The motivation is simple:

Code written and tested in Tetorica FM2612 Playground should later be usable from a browser game.

A game normally runs rendering and game logic on the Main Thread, so Tetorica should optionally be able to execute its music JavaScript in a Web Worker.

Do not build a large game audio framework.

Keep the public interface very small.

⸻

Target API

The intended API is approximately:

const pg = Playground({
  audioWorkletUrl,
  logicWorkerURL, // optional
});
pg.put("stage1", sourceCode);
pg.play("stage1");
pg.pause();
pg.clear();

logicWorkerURL

logicWorkerURL is optional.

If provided:

user JavaScript
    ↓
Logic Worker

If omitted:

user JavaScript
    ↓
Main Thread

Both execution modes should expose the same Playground interface and behave as similarly as practical.

This allows simple applications to continue using Main Thread execution while games or the Playground UI can choose Worker execution.

⸻

Public Interface

Keep the initial interface minimal.

Conceptually:

interface PlaygroundOptions {
  audioWorkletUrl: string;
  logicWorkerURL?: string;
}
interface PlaygroundRuntime {
  put(id: string, sourceCode: string): void;
  play(id: string): void | Promise<void>;
  pause(): void;
  clear(): void;
}

Adjust exact TypeScript details to fit the existing codebase.

Do not add APIs unless required by the existing implementation.

⸻

put(id, sourceCode)

Registers JavaScript source under an ID.

Calling put() again with the same ID replaces the previous source.

Example:

pg.put("stage1", `
  setBpm(120);
  liveLoop("bass", async () => {
    play("C2");
    await sleep(0.5);
  });
`);

put() does not imply that a separate YM2612 instance should be created.

The ID identifies source code only.

⸻

play(id)

Execute the source registered under the given ID.

Example:

pg.play("stage1");

For this first implementation, only one logic program needs to be active at a time.

Do not design simultaneous independent script runtimes yet.

If another ID is played while one is already running, use the simplest behavior consistent with the existing Playground, preferably stopping/replacing the previous logic execution.

⸻

pause()

Stop/pause the currently running logic program.

There is no ID argument because only one logic program needs to be active at a time for now.

Preserve the existing Playground’s audio behavior as much as possible.

Do not invent a complicated resume/state persistence system unless it already exists.

⸻

clear()

Stop the current execution and clear registered sources/runtime state.

Use the existing audio reset/stop behavior where appropriate.

⸻

One Playground = One YM2612

This is important.

A Playground instance owns one shared audio engine.

Conceptually:

Playground
    │
    ├── Source Registry
    │     ├── "stage1"
    │     ├── "boss"
    │     └── ...
    │
    ├── Logic Executor
    │     ├── Main Thread mode
    │     └── Worker mode
    │
    └── Audio Engine
          │
          └── AudioWorklet
                │
                └── YM2612 / ymfm x 1

Do NOT create:

stage1 → YM2612
boss   → YM2612
jump   → YM2612

Instead:

stage1 ─┐
boss   ─┼─→ shared YM2612
jump   ─┘

The ID represents JavaScript source, not a synthesizer instance.

⸻

Existing Audio Architecture

Do not unnecessarily redesign the existing audio architecture.

Keep YM2612 / ymfm realtime audio generation in the AudioWorklet.

The new Logic Worker is for executing the JavaScript written by the Playground user.

Conceptually:

Main Thread
  ├── Game / Playground UI
  └── Playground Runtime
          │
          │
          ├── Main Thread logic execution
          │
          │        OR
          │
          └── Logic Worker
                    │
                    │ music/control commands
                    ▼
             existing audio path
                    │
                    ▼
              AudioWorklet
                    │
                    ▼
                 ymfm

Do not move arbitrary user JavaScript into the AudioWorklet.

The AudioWorklet must remain focused on realtime audio generation.

⸻

Worker Mode

When logicWorkerURL is supplied, the source registered with put() should execute in that Worker.

For example:

const pg = Playground({
  audioWorkletUrl: "./ym2612-worklet.js",
  logicWorkerURL: "./playground-logic-worker.js",
});

The Worker should provide the Playground programming APIs required by existing examples, such as the current implementations of:

* play()
* sleep()
* setBpm()
* beat()
* nextBeat()
* liveLoop()
* random/helper functions
* other currently supported Playground APIs

Do not blindly duplicate implementations.

First inspect which parts are pure logic and which parts need communication with the existing audio runtime.

⸻

Main Thread Mode

Without logicWorkerURL:

const pg = Playground({
  audioWorkletUrl: "./ym2612-worklet.js",
});

the same source should execute using the Main Thread implementation.

This mode is useful for:

* simple examples
* debugging
* backward compatibility
* environments where Worker execution is unnecessary

Try to share as much implementation as practical between Main Thread and Worker execution.

Avoid maintaining two unrelated Playground runtimes.

⸻

Why We Are Doing This

The intended workflow is:

Tetorica FM2612 Playground
        │
        │ write/test JavaScript
        ▼
      source
        │
        ▼
Browser Game
        │
        ▼
pg.put("stage1", source)
pg.play("stage1")

The same JavaScript that works in the Playground should be usable later from a browser game.

The game should not need Monaco or the Playground UI.

This is why the runtime interface must be independent from the current UI implementation.

⸻

Important Non-Goals

Do NOT build these yet:

* BGM/SFX abstractions
* asset management
* multiple YM2612 instances
* one YM2612 per source ID
* multiple simultaneous independent script runtimes
* game event systems
* complex channel ownership
* SharedArrayBuffer-based optimization
* a new audio scheduler
* a large security sandbox
* a large framework

Do not over-engineer this.

The first goal is simply:

const pg = Playground({...});
pg.put("music", source);
pg.play("music");
pg.pause();
pg.clear();

and optionally execute source in a Worker.

⸻

Implementation Approach

Before making large changes:

1. Inspect the current Playground implementation.
2. Identify where source code is currently evaluated.
3. Identify which APIs depend on Main Thread objects.
4. Identify how commands currently reach the AudioWorklet.
5. Identify what can be extracted into a reusable runtime without changing behavior.
6. Propose a small implementation plan.

Then implement the smallest reasonable version.

Preserve existing Playground examples and behavior wherever practical.

After implementation, summarize:

* files changed
* resulting Playground public API
* Main Thread execution flow
* Worker execution flow
* how Worker-side play() reaches the shared YM2612
* any Playground APIs that could not cleanly move to the Worker
* known differences between Main Thread and Worker modes
* remaining limitations

The priority is a small reusable boundary, not a complete architecture redesign.