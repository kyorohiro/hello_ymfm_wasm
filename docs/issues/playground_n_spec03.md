Tetorica FM2612 Playground: Worker-based JavaScript Execution

Goal

Move user-written JavaScript execution in the Playground from the browser main thread to a Web Worker.

The main purpose is not performance optimization.

The goals are:

1. Prevent user code from blocking the Playground UI.
2. Allow runaway user code to be stopped by terminating the Worker.
3. Explore an execution model that can later be reused when Tetorica FM2612 code is embedded in browser games.
4. Keep the existing Playground programming experience and API as unchanged as possible.

A user should still be able to write code such as:

setBpm(120);
liveLoop("bass", async () => {
  play("C2", {
    channel: 0,
    duration: 0.25,
  });
  await sleep(0.5);
});

and press Run.

The difference is that the JavaScript code itself should execute inside a Web Worker.

⸻

Target Architecture

Aim for this separation:

Main Thread
  ├─ Playground UI
  ├─ Monaco Editor
  └─ Run / Stop controls
          |
          | user JavaScript source
          v
Web Worker
  ├─ execute user code
  ├─ setBpm()
  ├─ beat()
  ├─ nextBeat()
  ├─ sleep()
  ├─ liveLoop()
  ├─ choose()
  ├─ rand()
  ├─ randInt()
  └─ generate musical/control events
          |
          | messages
          v
Existing audio/runtime layer
          |
          v
AudioWorklet
          |
          v
YM2612 / ymfm

Do NOT move YM2612 sample generation out of the AudioWorklet.

Do NOT execute arbitrary user JavaScript inside the AudioWorklet.

The Worker should primarily execute musical/control logic.

⸻

Phase 1: Investigate First

Before changing code, inspect the existing Playground implementation and identify:

* where user JavaScript is currently evaluated
* how play() reaches the synth/audio engine
* how sleep(), beat(), nextBeat(), and BPM timing currently work
* how liveLoop() is implemented
* how Run / Stop / Stop All currently work
* which Playground APIs require direct access to main-thread/browser objects
* which state currently lives on the main thread
* which APIs can move into the Worker without behavioral changes

Write a short implementation plan before making large structural changes.

Preserve the current API whenever practical.

⸻

Phase 2: Worker Prototype

Create a small Worker-based execution layer.

The main thread should be able to send something conceptually like:

worker.postMessage({
  type: "run",
  code,
});

The Worker should evaluate the supplied JavaScript source with the existing Playground API available.

For example, calling:

play("C4", {
  channel: 1,
  duration: 0.5,
});

inside the Worker should result in an event/message being sent to the existing audio/runtime layer.

Do not duplicate the YM2612 implementation inside the Worker.

⸻

Stop Behavior

Stopping execution is important.

If user code contains something such as:

while (true) {
}

the Playground UI must remain responsive.

The main thread must be able to stop the execution by terminating the Worker.

A new Worker may be created for the next Run.

Make sure existing audio can also be stopped/reset appropriately when the execution Worker is terminated.

⸻

Errors

Runtime errors inside user code should be sent back to the Playground UI.

Preserve useful information where possible:

* error message
* stack
* line/column information

The Playground should display errors similarly to the current implementation.

A Worker error must not break the Playground UI.

⸻

Compatibility

Existing Playground examples should continue to work with minimal or ideally zero changes.

Test at least:

* simple play()
* sleep()
* BPM changes
* beat() / nextBeat()
* multiple liveLoop() calls
* random helpers
* stopping loops
* Run → Stop → Run again
* syntax/runtime errors
* infinite loop / runaway code

⸻

Important: Worker Is Not a Security Sandbox

Do not treat Web Worker isolation as a security boundary.

Worker JavaScript may still have access to APIs such as fetch().

For this task, document what browser/network APIs remain accessible from user code.

Do not build a large security sandbox yet unless a very small and reliable restriction naturally fits the current architecture.

The immediate goal is execution isolation and architecture validation.

⸻

Future Game Runtime

Keep future game embedding in mind.

Ideally the Worker execution mechanism should not become tightly coupled to Monaco or the Playground UI.

Try to structure it so that later we could reuse something conceptually like:

const runtime = createFM2612Runtime(...);
runtime.run(source);
runtime.stop();

from a normal browser game without including the Playground.

Do not implement a large public runtime API yet.

Just avoid architectural decisions that would prevent this.

⸻

Constraints

* Preserve the current Playground behavior as much as possible.
* Avoid unnecessary refactoring.
* Do not rewrite the audio engine.
* Keep YM2612/ymfm generation in the AudioWorklet.
* Do not add heavy dependencies just for Worker execution.
* Prefer a small, understandable message protocol.
* Keep the implementation readable enough to serve as future documentation/example code.

Deliverable

Implement a working Worker-based prototype, then summarize:

1. files changed
2. execution flow before/after
3. APIs that run entirely in the Worker
4. APIs that require communication with the main/audio side
5. known behavioral differences
6. remaining security limitations
7. whether this architecture looks reusable for Tetorica FM2612 game embedding