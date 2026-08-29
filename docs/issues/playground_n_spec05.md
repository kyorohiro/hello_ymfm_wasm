Future Direction: PlaygroundPool for Simultaneous Sound Effects

Do not implement this unless it is necessary for the current refactoring.

This section describes a possible future use of the Playground runtime and should influence the design only enough to avoid blocking it.

Problem

A single Playground instance owns one YM2612 audio engine:

Playground
  ├─ Logic Executor
  └─ AudioWorklet
       └─ YM2612 x 1

This is appropriate for BGM and for experimenting with YM2612 code.

However, games often need multiple sound effects to play simultaneously.

For example:

sfx.play("jump");
sfx.play("hit");
sfx.play("explosion");

These events may overlap.

Trying to make all SFX share the same six YM2612 channels would require channel allocation, ownership, priority and voice-stealing logic inside one chip.

That may be useful later for authentic Mega Drive-style limitations, but it should not be required for general browser-game usage.

⸻

Possible Solution: PlaygroundPool

A future helper could manage multiple independent Playground instances.

Conceptually:

const sfx = PlaygroundPool({
  size: 8,
  playground: {
    audioWorkletUrl,
    logicWorkerURL,
  },
});
sfx.put("jump", jumpSource);
sfx.put("hit", hitSource);
sfx.put("explosion", explosionSource);
sfx.play("jump");
sfx.play("hit");
sfx.play("explosion");

Each simultaneous playback can use an available Playground/audio-engine instance.

Conceptually:

PlaygroundPool
   │
   ├── Playground #0
   │      └── YM2612 #0
   │
   ├── Playground #1
   │      └── YM2612 #1
   │
   ├── Playground #2
   │      └── YM2612 #2
   │
   └── ...

All outputs can eventually be mixed through the normal Web Audio graph.

⸻

Intended Behavior

Suppose:

sfx.play("jump");

is called.

The pool would:

1. find an idle Playground instance
2. make the requested source available to that instance
3. call play("jump")
4. return that instance to the pool when playback finishes

If another sound occurs before jump finishes:

sfx.play("explosion");

another idle Playground instance can play it.

Therefore multiple effects can overlap without sharing the six channels of one YM2612.

⸻

Pool Exhaustion

Eventually we may need simple voice stealing.

For example, with:

PlaygroundPool({
  size: 8,
});

only eight independent SFX instances could run simultaneously.

If a ninth sound is requested, the pool could eventually use a simple policy such as:

* reuse the oldest active instance
* stop it
* play the new sound

Do not design a complex priority system yet.

This behavior can be decided when PlaygroundPool is actually implemented.

⸻

Source Storage

The public API should ideally remain simple:

sfx.put("jump", jumpSource);
sfx.put("hit", hitSource);
sfx.play("jump");

It should not require callers to know which Playground instance will execute the sound.

Conceptually:

              source registry
        jump → JavaScript source
        hit  → JavaScript source
        boom → JavaScript source
                    │
                    ▼
              PlaygroundPool
          ┌─────────┼─────────┐
          ▼         ▼         ▼
         PG0       PG1       PG2
          │         │         │
          ▼         ▼         ▼
       YM2612    YM2612    YM2612

The pool chooses the execution instance.

⸻

Relationship with BGM

A browser game could eventually use:

const bgm = Playground({
  audioWorkletUrl,
  logicWorkerURL,
});
const sfx = PlaygroundPool({
  size: 8,
  playground: {
    audioWorkletUrl,
    logicWorkerURL,
  },
});

Then:

bgm.put("stage1", stage1Source);
bgm.play("stage1");
sfx.put("jump", jumpSource);
sfx.put("hit", hitSource);
sfx.play("jump");
sfx.play("hit");

Conceptually:

Game
 │
 ├── BGM
 │     │
 │     └── Playground
 │            └── YM2612
 │
 └── SFX
       │
       └── PlaygroundPool
              ├── YM2612
              ├── YM2612
              ├── YM2612
              └── ...

This intentionally does NOT emulate the hardware limitation of a single Mega Drive YM2612.

It is a browser-game convenience layer built using YM2612 sound engines.

A hardware-authentic mode could be considered separately in the future.

⸻

Important Design Constraint for Current Playground Work

The current Playground implementation should NOT know about PlaygroundPool.

Keep Playground small and independently reusable:

const pg = Playground({...});
pg.put(id, source);
pg.play(id);
pg.pause();
pg.clear();

PlaygroundPool should later be implementable as a composition layer on top of multiple Playground instances.

In other words:

PlaygroundPool
USES
Playground

not:

Playground
KNOWS ABOUT
PlaygroundPool

Avoid adding pool-specific concepts to the current Playground public API.

The immediate architectural question is simply:

“Can multiple independent Playground instances coexist cleanly on the same page and have their audio outputs mixed by Web Audio?”

If the answer is yes, the current Playground abstraction leaves a clean path for simultaneous game SFX later.