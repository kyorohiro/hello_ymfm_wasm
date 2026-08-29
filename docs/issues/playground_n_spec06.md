Future Direction: Offline Pre-Rendering for SFX

Do not turn this into a large rendering subsystem unless it is necessary for the current refactoring.

The purpose of this note is to make sure the new Playground runtime can later support offline pre-rendering of sound effects and short musical phrases.

Motivation

A realtime YM2612 instance is relatively expensive.

For browser games, it is undesirable to create many YM2612 instances just so multiple sound effects can overlap.

Instead, short SFX can potentially be created with the same Tetorica FM2612 JavaScript API, rendered to PCM ahead of time, cached as an AudioBuffer or WAV-like result, and then played cheaply during the game.

Conceptually:

Tetorica JavaScript source
        ↓
offline logic execution
        ↓
YM2612 offline rendering
        ↓
PCM / AudioBuffer
        ↓
normal Web Audio playback

This allows authoring with YM2612 while avoiding multiple realtime YM2612 instances during gameplay.

⸻

Important Requirement

The same source code should ideally work in both realtime and offline modes.

For example:

setBpm(120);
play("C4", {
  duration: beat(0.25),
});
await sleep(beat(0.5));
play("G4", {
  duration: beat(0.25),
});

This should be usable:

* interactively in Tetorica FM2612 Playground
* as realtime game audio if desired
* as an offline pre-rendered SFX

Avoid creating a separate “SFX scripting language.”

⸻

Time Must Be Abstracted

The most important design constraint is that Playground timing APIs should not be permanently tied to realtime wall-clock waiting.

For example, avoid designing sleep() so that its fundamental meaning is:

await new Promise(resolve => setTimeout(resolve, ms));

Instead, conceptually treat:

await sleep(value);

as:

advance the Playground timeline by value

The implementation can depend on the execution mode.

Conceptually:

Playground timing API
        │
        ▼
      Clock
      /   \
     /     \
Realtime   Offline
 Clock      Clock

⸻

Realtime Clock

Realtime mode behaves like the current Playground.

Conceptually:

sleep(0.5)
    ↓
wait until the corresponding realtime musical position

It may use the existing timing/scheduling implementation.

Do not replace working realtime scheduling just for this future feature.

⸻

Offline Clock

Offline mode should not actually wait.

For example:

await sleep(0.5);

should conceptually do:

virtualTime += 0.5 seconds

immediately.

Likewise:

setBpm(120);
await sleep(beat(1));

should advance virtual musical time by one beat without waiting for one real beat.

This allows a 2-second sound effect to potentially be rendered much faster than 2 seconds.

⸻

Event Timeline

One possible architecture is to let the logic runtime produce events associated with virtual times.

For example, this source:

play("C4");
await sleep(0.2);
play("E4");
await sleep(0.2);
play("G4");

could conceptually become:

0.0 sec  play C4
0.2 sec  play E4
0.4 sec  play G4

The offline YM2612 renderer can then process those events while generating the required samples as quickly as the CPU allows.

The exact implementation does not have to use a separate explicit event list if the current architecture suggests a simpler approach.

The important point is:

offline execution must advance simulated audio time, not wall-clock time.

⸻

beat() and BPM

beat() and BPM-dependent APIs should work in offline rendering.

Example:

setBpm(120);
play("C4");
await sleep(beat(1));
play("G4");

should represent:

0.0 sec : C4
0.5 sec : G4

because 120 BPM means one beat is 0.5 seconds.

If BPM changes during execution:

setBpm(120);
await sleep(beat(1));
setBpm(240);
await sleep(beat(1));

the offline clock should respect the BPM active at each point.

Do not precompute all beat values using only the initial BPM.

⸻

Existing Playground APIs

When inspecting the current implementation, identify which APIs are:

1. purely musical/logic APIs
2. dependent on realtime clock behavior
3. dependent on Main Thread browser APIs
4. directly controlling audio
5. compatible with a virtual/offline timeline

Especially inspect:

* sleep()
* beat()
* nextBeat()
* setBpm()
* play()
* note duration handling
* liveLoop()
* livePrepare()
* loop cancellation
* random helpers

Do not unnecessarily rewrite APIs that are already compatible.

⸻

liveLoop() Is Special

Infinite or persistent loops do not have a natural offline end time.

For example:

liveLoop("bass", async () => {
  play("C2");
  await sleep(0.25);
});

cannot determine by itself how long an offline render should be.

A future offline API may therefore require an explicit render duration:

await render(source, {
  duration: 2.0,
});

or some equivalent limit.

Do not solve the exact public API now unless necessary.

Just avoid assuming that script completion is the only possible definition of render completion.

For ordinary finite SFX scripts, reaching the end of the source may be enough.

⸻

YM2612 Offline Rendering

The offline renderer should eventually be able to run ymfm without waiting for AudioWorklet realtime callbacks.

Conceptually:

virtual timeline
      ↓
YM2612 register / note events
      ↓
ymfm generate samples in a tight loop
      ↓
PCM buffer

The offline path should generate the required number of samples as fast as possible.

It should not deliberately throttle itself to realtime playback speed.

The exact implementation should reuse the existing YM2612/ymfm code as much as practical.

Avoid maintaining two unrelated synth implementations.

⸻

Runtime vs Authoring

This feature is mainly intended for short game sounds.

Possible future workflow:

const pg = Playground({
  audioWorkletUrl,
  logicWorkerURL,
});
pg.put("jump", jumpSource);

During authoring:

pg.play("jump");

Later:

jumpSource
   ↓
offline render
   ↓
AudioBuffer

During gameplay:

sfx.play("jump");
sfx.play("jump");
sfx.play("hit");

These overlapping SFX should ideally use lightweight PCM playback rather than creating several realtime YM2612 instances.

⸻

Possible Future API

Do not consider this API final.

It is only an example of the direction:

const buffer = await pg.render("jump");

or:

const buffer = await renderPlaygroundSource(jumpSource, {
  duration: 1.0,
});

The important architectural requirement is more fundamental than the exact API:

the logic execution and timing model should be reusable with a virtual/offline clock.

⸻

Non-Goals for Current Work

Do not build all of these now:

* complete WAV export UI
* a large SFX manager
* a sample asset pipeline
* persistent browser caching
* IndexedDB asset management
* automatic SFX duration detection for every possible script
* sophisticated loop analysis
* multiple realtime YM2612 instances
* a second separate scripting API
* a full DAW-style offline engine

The current task should only preserve a clean path toward this.

⸻

Design Constraint for Current Playground Refactoring

While extracting the reusable Playground runtime, avoid hard-coding assumptions such as:

sleep() always means setTimeout()

or:

Playground logic can only run against AudioWorklet realtime time

Prefer a structure where timing/scheduling can later be supplied by an execution environment.

Conceptually:

Playground source/API
       │
       ▼
Logic Runtime
       │
       ├── Realtime Clock
       │       ↓
       │   AudioWorklet
       │
       └── Offline Clock
               ↓
          Offline ymfm renderer
               ↓
             PCM

The immediate implementation does not need to fully support the offline branch.

It should simply avoid making that branch unnecessarily difficult later.

⸻

Question to Answer After Refactoring

After implementing the current reusable Playground interface and Worker execution, report:

1. Is sleep() currently tightly coupled to realtime waiting?
2. Can beat() and BPM timing be reused with a virtual clock?
3. Can play() be expressed in terms of scheduled musical/audio time rather than only “play immediately”?
4. What would need to change to execute the same source without realtime delays?
5. Can ymfm currently generate samples outside AudioWorklet?
6. Which parts of the existing implementation could be reused for offline rendering?
7. What is the smallest additional abstraction required to support fast SFX pre-rendering later?

Do not implement a large offline system unless the answers show that a very small change makes it practical.