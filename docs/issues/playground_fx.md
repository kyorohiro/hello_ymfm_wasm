Tetorica FM2612 FX Design Notes

Goal

Add a lightweight FX system to Tetorica FM2612.

The FX system should:

* keep the YM2612 as the main sound source
* treat FX as external processing after the YM2612 output
* work well with the Playground
* support real-time parameter changes
* stay lightweight enough for games
* avoid interfering with the game loop
* target older Windows PCs as a practical lower-end environment

The intended mental model is:

YM2612
  ↓
Effector
  ↓
Effector
  ↓
Output

This is closer to connecting an actual synth to external pedals / rack effects than to embedding effects into the YM2612 itself.

⸻

Current implementation status

As of 2026-08-23, the first Playground-oriented FX layer already exists.

Implemented now:

* `web/megasynth.js`
  * `setFXChain(effects)`
  * `getFXChain()`
  * `connect(effect)`
  * `clearFXChain()`
  * `connectOutput()`
* `web/megasynth_fx.js`
  * `createGainFX(...)`
  * `createEqFX(...)`
  * `createFilterFX(...)`
  * `createDelayFX(...)`
  * `createReverbFX(...)`
* `docs/playground/playground.js`
  * `fx.gain(...)`
  * `fx.eq(...)`
  * `fx.filter(...)`
  * `fx.delay(...)`
  * `fx.reverb(...)`
  * `fx.setChain([...])`
  * `fx.clear()`
  * `livePrepare(name, async ({ fx, fm, log }) => { ... })`

This means the project already has:

* one master FX chain after YM2612 output
* effect creation from Playground code
* real-time parameter updates from `liveLoop(...)`
* reusable prepared FX state across `Run`

Important current example pages:

* `docs/playground/index.html`
  * `FX Loop`
  * `FX Motion`

`FX Motion` is especially important because it proves:

* `liveLoop("fx-motion", ...)`
  can move FX parameters while other loops are playing
* EQ, filter, delay, and reverb can all be adjusted from code

⸻

Current `livePrepare(...)` meaning

`livePrepare(name, fn)` is now the first answer to:

* "do not rebuild this every Run"

Behavior:

* first call with a `name`
  * executes `fn`
  * stores the result
* later calls with the same `name`
  * do not execute `fn` again
  * return the previously stored result

Conceptually:

* `liveLoop(...)`
  = live repeating behavior
* `livePrepare(...)`
  = live reusable prepared state

This is useful for:

* FX node creation
* shared chains
* future sequencer / looper helper state
* other browser-side live coding support objects

Current limitation:

* if the code inside `livePrepare("main-fx", ...)` changes
* but the name stays the same
* the old prepared result is still reused

So for now, changing behavior requires either:

* changing the prepare name
* or later adding reset/clear APIs

⸻

Current design consequence

The Playground no longer has to recreate every FX node on every `Run`.

Without `livePrepare(...)`, code like this:

```js
const filter = fx.filter(...);
const delay = fx.delay(...);
const reverb = fx.reverb(...);

fx.setChain([filter, delay, reverb]);
```

would recreate all nodes on every `Run`.

With `livePrepare(...)`, the intended pattern is now:

```js
const mainFx = await livePrepare("main-fx", async ({ fx }) => {
  const eq = fx.eq({ bass: 0, mid: 0, treble: 0 });
  const filter = fx.filter({ type: "lowpass", cutoff: 1200, q: 1.1 });
  const delay = fx.delay({ time: 0.24, feedback: 0.28, mix: 0.16 });
  const reverb = fx.reverb({ mix: 0.18, tone: 5400 });

  return { eq, filter, delay, reverb };
});

fx.setChain([
  mainFx.eq,
  mainFx.filter,
  mainFx.delay,
  mainFx.reverb,
]);
```

This is now the preferred Playground direction.

⸻

Current next-step interpretation

The first question is no longer:

* "can we add FX at all?"

That part is now answered with a practical yes.

The next questions are:

* how to reduce `Run`-time click noise further
* whether prepared FX should survive `Stop`
* whether `livePrepareReset(name)` or `livePrepareClearAll()` should exist
* how much of this should be shown in the UI vs left in code
* whether `FX Motion` should become the default example

⸻

Current repo situation

This repository already has one important hook for FX.

`web/megasynth.js` accepts:

* `outputNode`

and `docs/synth/synth_runtime.js` already passes `outputNode` into `MegaDriveSynth`.

That means the first FX version does not require:

* changing ymfm
* changing YM2612 register behavior
* redesigning `YM2612Synth`

The practical route is:

1. create a master bus
2. give that bus to `MegaSynth` as `outputNode`
3. connect FX nodes after that bus
4. connect the final FX output to `audioContext.destination`

Conceptually:

YM2612 AudioWorklet
  ↓
master bus
  ↓
FX chain
  ↓
destination

This is the strongest reason FX looks feasible now.

⸻

What this document is about

This document is mainly about:

* Playground-facing FX
* browser runtime FX
* post-YM2612 master processing

This document is not about:

* pretending YM2612 has built-in reverb or delay
* adding internal per-operator FX to the chip model
* modifying ymfm itself for effect processing

FX should stay clearly outside the YM2612 chip model.

⸻

First implementation target

Do the smallest useful thing first.

v1 should aim for:

* one YM2612 instance
* one master FX chain
* Web Audio based post-processing
* real-time parameter changes
* low enough CPU cost for games

Not v1:

* per-`liveLoop` FX routing
* one YM2612 instance per loop
* complex graph editors
* heavy convolution-first design
* studio-grade mastering

If v1 succeeds, that is already enough to give:

* nicer Playground sound
* easier preset blending
* a clearer game-embedding story

⸻

Recommended v1 order

Build in this order:

1. Gain
2. Filter
3. Delay
4. Reverb

Reason:

* Gain is the simplest chain sanity check.
* Filter makes real-time motion obvious.
* Delay gives immediate musical value.
* Reverb makes short FM notes feel more finished.

EQ and compressor are still useful, but they are less important than:

"can we obviously hear FX working in the Playground?"

⸻

Recommended first API direction

Do not start with Sonic Pi style `withFX(...)`.

That style suggests lexical scoping such as:

* only this loop has reverb
* only this block has delay

That is misleading in the current YM2612 architecture because all channels already end up in one stereo output.

A better first API direction is explicit master-chain control.

Examples:

```js
const delay = fx.delay({
  time: 0.2,
  feedback: 0.35,
  mix: 0.2,
});

megaSynth.setFXChain([
  delay,
]);
```

or:

```js
const filter = fx.filter({
  type: "lowpass",
  cutoff: 1800,
  q: 1.2,
});

megaSynth
  .connect(filter)
  .connectOutput();
```

If a `withFX(...)` style is ever added later, it should be built on top of a real routing model, not used to hide the lack of one.

⸻

Important Constraint: YM2612 Output

The YM2612 has six FM channels internally, but its final output is stereo L/R.

Conceptually:

CH0 ┐
CH1 ┤
CH2 ┤
CH3 ┤
CH4 ┤
CH5 ┘
     ↓
   YM2612
     ↓
 Stereo L/R
     ↓
    FX

Because of this, the initial FX design should operate on the full stereo output.

Do not try to emulate Sonic Pi’s per-liveLoop FX behavior in the first version.

Example:

withFX("reverb", () => {
  liveLoop("lead", ...);
});

would suggest that only the lead loop is routed through the reverb.

That is not naturally possible when all six YM2612 channels have already been mixed into the same stereo output.

Do not create one YM2612 instance per liveLoop only to support per-loop FX.

That would conflict with the current concept and increase runtime cost.

⸻

Current Direction

Use one YM2612 instance.

Apply effects after its stereo output.

YM2612
  ↓
EQ
  ↓
Compressor
  ↓
Distortion
  ↓
Delay
  ↓
Reverb
  ↓
Master
  ↓
Output

The exact order should be configurable.

Recommended first default chain:

YM2612
  ↓
Gain
  ↓
Filter
  ↓
Delay
  ↓
Reverb
  ↓
Master
  ↓
Output

This is small enough to test quickly and already musically useful.

⸻

Architecture

The FX layer should be based on Web Audio AudioNode.

Recommended architecture:

YM2612 AudioWorkletNode
        ↓
     FX Chain
        ↓
     Master
        ↓
AudioContext.destination

MegaSynth should own or expose the audio routing.

The YM2612 control object (fm) should remain focused on YM2612 register / instrument control.

Prefer:

megaSynth
  .connect(eq)
  .connect(compressor)
  .connect(reverb);

rather than:

fm.setReverb(...);
fm.setCompressor(...);

FX are not YM2612 features.

Keep that distinction visible in the API.

Concrete implication:

* `YM2612Synth`
  should not gain methods such as:
  * `setReverb()`
  * `setDelay()`
  * `setFilter()`
* `MegaSynth`
  or a separate FX/runtime layer
  should own the post-processing graph

This preserves the current design:

* `YM2612Synth`
  = chip control
* `MegaSynth`
  = browser runtime
* `FX`
  = post-processing

⸻

Suggested File Separation

Do not grow megasynth.js with every DSP implementation.

Possible structure:

web/
  megasynth.js
  megasynth_fx.js
  fx/
    gain.js
    eq.js
    compressor.js
    noise_gate.js
    distortion.js
    filter.js
    delay.js
    reverb.js

The exact layout is flexible.

The important point is to keep:

MegaSynth
= audio runtime
YM2612Synth
= YM2612 control
FX
= post-processing

as separate responsibilities.

Practical v1 candidate:

web/
  megasynth.js
  megasynth_fx.js
  fx/
    gain.js
    filter.js
    delay.js
    reverb.js

That is enough to begin without over-designing.

⸻

FX Interface

Use a common interface for effects.

Concept:

const reverb = fx.reverb({
  mix: 0.25,
});
reverb.input;
reverb.output;

Possible common shape:

{
  input,
  output,
  connect(),
  disconnect(),
  dispose(),
}

Effect-specific parameters can be exposed as parameter wrappers.

Example:

reverb.mix.set(0.3);
delay.feedback.set(0.4);
filter.cutoff.set(2400);

⸻

Chain API

A simple BOSS-pedal-like chain is preferred.

Example:

const eq = fx.eq({
  bass: 0,
  mid: 0,
  treble: 0,
});
const compressor = fx.compressor({
  threshold: -18,
  ratio: 3,
});
const delay = fx.delay({
  time: 0.25,
  feedback: 0.35,
  mix: 0.2,
});
const reverb = fx.reverb({
  mix: 0.2,
});
megaSynth
  .connect(eq)
  .connect(compressor)
  .connect(delay)
  .connect(reverb)
  .connectOutput();

Alternative internal representation:

megaSynth.setFXChain([
  eq,
  compressor,
  delay,
  reverb,
]);

The first version does not need to support every possible routing graph.

A linear chain is enough.

⸻

Initial FX Candidates

Keep the first version small.

Basic

* Gain
* Bass / Mid / Treble EQ
* Compressor
* Noise Gate or Expander

Character

* Distortion
* Filter
* optional Bit Crusher

Space

* Delay / Echo
* Reverb

This is enough to make YM2612 presets much easier to combine.

⸻

EQ

A simple 3-band EQ is useful because YM2612 presets can have very different perceived loudness and frequency balance.

Suggested controls:

Bass
Mid
Treble

This does not need to be a studio-grade parametric EQ in v1.

A few BiquadFilterNodes are enough.

Concept:

Low shelf
  ↓
Peaking mid
  ↓
High shelf

⸻

Compressor

Use DynamicsCompressorNode initially.

Purpose:

* reduce large differences between presets
* make combined sounds easier to control
* prevent sudden peaks from becoming unpleasant

Do not make aggressive compression the default.

The default should preserve the YM2612 character.

⸻

Noise Gate

Do not call this “noise cancel” unless actual active noise cancellation is implemented.

For the intended use case, a Noise Gate / Expander is more appropriate.

Purpose:

* suppress low-level residual noise
* reduce unwanted tails between phrases
* help with noisy or unstable presets

This should be optional.

A badly configured gate can cut releases unnaturally.

⸻

Distortion

Keep distortion simple initially.

Possible implementation:

Gain
  ↓
WaveShaperNode
  ↓
Output

Expose:

drive
mix
output

Avoid expensive oversampling modes by default.

⸻

Filter

A simple filter is important for real-time sound design.

Suggested initial options:

lowpass
highpass
bandpass

Parameters:

cutoff
Q

Use BiquadFilterNode.

⸻

Delay / Echo

Delay should be one of the first spatial effects.

Suggested structure:

          ┌──────── feedback ────────┐
          ↓                          │
Input → DelayNode → Wet → Output     │
  └──────── Dry ─────────→ Output    │
          ↑                          │
          └──────────────────────────┘

Parameters:

time
feedback
mix

Keep feedback safely clamped below unstable values.

⸻

Reverb

Reverb is important because short FM sounds become much more musical with a small amount of space.

However, reverb can become expensive.

Do not start with an unnecessarily heavy convolution implementation.

Possible directions:

v1

Use a lightweight algorithmic reverb built from:

* delays
* feedback
* filtering

or another simple low-cost implementation.

Later / Studio Mode

Allow convolution reverb with an impulse response.

Do not make convolution the required default for game usage.

⸻

Real-Time FX Control

FX parameters should be editable while the synth is playing.

Example:

filter.cutoff.set(1200);
reverb.mix.set(0.2);
delay.feedback.set(0.3);

The Playground should be able to modify the same parameters.

⸻

AudioParam Automation

When possible, use Web Audio AudioParam automation instead of updating values every animation frame.

Avoid:

requestAnimationFrame(() => {
  filter.frequency.value = value;
});

Prefer:

filter.frequency.setValueAtTime(
  current,
  audioContext.currentTime
);
filter.frequency.linearRampToValueAtTime(
  target,
  audioContext.currentTime + duration
);

This keeps parameter movement smooth and reduces Main Thread work.

⸻

Parameter Wrapper

Consider exposing a small wrapper around AudioParam.

Example:

filter.cutoff.set(1200);
filter.cutoff.rampTo(
  8000,
  2.0
);

Future Playground API:

await filter.cutoff.to(8000, {
  beats: 4,
});

Internally this can use AudioParam automation.

⸻

Playground Integration

FX should be controllable from both:

* JavaScript code
* GUI controls

Both should update the same FX objects.

Concept:

Playground Code
       ┐
       ├── FX API → AudioNode
GUI    ┘

Example:

const filter = fx.filter({
  cutoff: 1200,
  q: 1.0,
});
const reverb = fx.reverb({
  mix: 0.15,
});
megaSynth
  .connect(filter)
  .connect(reverb)
  .connectOutput();

Then:

liveLoop("fx-motion", async () => {
  filter.cutoff.set(
    choose([
      800,
      1600,
      3200,
      6400,
    ])
  );
  await beat(1);
});

This makes it possible to “perform” the FX parameters without changing the YM2612 instrument itself.

⸻

GUI

The FX UI can resemble a small pedal / rack chain.

Example:

YM2612
  ↓
[ EQ ]
Bass    ----●----
Mid     -----●---
Treble  ---●-----
  ↓
[ COMP ]
Threshold
Ratio
  ↓
[ DELAY ]
Time
Feedback
Mix
  ↓
[ REVERB ]
Mix
Room
  ↓
OUTPUT

The exact visual style is not important yet.

The important part is that the routing order is obvious.

⸻

FX Presets

Eventually allow FX chains to be saved as presets.

Example:

Clean
Warm
Radio
Arcade Room
Wide Delay
Dirty Cabinet

Possible structure:

{
  name: "Arcade Room",
  chain: [
    {
      type: "eq",
      params: {...}
    },
    {
      type: "compressor",
      params: {...}
    },
    {
      type: "delay",
      params: {...}
    },
    {
      type: "reverb",
      params: {...}
    }
  ]
}

Do not make this part of the first implementation unless it comes almost for free.

⸻

Performance Target

The FX system is intended to be usable inside games.

Do not optimize only for desktop music production.

Practical target:

YM2612 + a reasonable FX chain should remain usable while a game is running on an approximately 10-year-old Windows PC.

A useful lower-end reference is roughly:

Intel Core i5 8th-generation class
8 GB RAM
integrated Intel GPU
Windows 10-class environment

This is not a strict hardware requirement.

It is a design target for avoiding excessive DSP complexity.

⸻

Performance Philosophy

Prefer:

small DSP
stable timing
low CPU

over:

studio-quality effect
high CPU

for the default game path.

A game losing frame rate because the reverb is expensive is considered a bad trade-off.

⸻

Possible Quality Modes

Future idea:

FX Quality
Game
Standard
Studio

Game

* cheapest implementations
* limited reverb complexity
* low CPU
* intended for actual game runtime

Standard

* normal Playground quality
* balanced CPU / sound

Studio

* more expensive algorithms allowed
* intended for sound design / export
* not necessarily suitable for low-end game runtime

Do not implement this until actual profiling shows it is necessary.

⸻

Profiling

Measure before adding complicated optimizations.

Useful measurements:

* audio processing CPU
* Main Thread frame time
* AudioWorklet stability
* number of active AudioNodes
* cost of each enabled FX
* glitches / underruns during game rendering

Test with:

YM2612 only
YM2612 + EQ
YM2612 + EQ + compressor
YM2612 + EQ + compressor + delay
YM2612 + full default chain

This makes it possible to identify which effect causes problems.

⸻

Node Lifetime

Avoid recreating AudioNodes for every note.

Bad:

noteOn
↓
create reverb
↓
play
↓
destroy reverb

Preferred:

create FX chain once
↓
reuse while playing

FX should be long-lived objects.

⸻

Master FX vs Per-Loop FX

For v1:

One YM2612
  ↓
One master FX chain

Do not implement:

liveLoop A → FX A
liveLoop B → FX B

because all YM2612 channels are already mixed into the same stereo output.

Supporting true per-loop FX would require something like:

* multiple YM2612 instances
* internal per-channel stems
* another custom routing architecture

That is intentionally outside the initial scope.

⸻

Possible Future: Boost Mode

A future Tetorica Boost Mode may expose per-channel audio stems.

Concept:

YM2612-compatible synthesis
├─ CH0 stem
├─ CH1 stem
├─ CH2 stem
├─ CH3 stem
├─ CH4 stem
└─ CH5 stem
      ↓
individual FX
      ↓
mix

This would not represent the original physical YM2612 output structure.

Therefore it should be considered a Tetorica extension.

Do not block the current FX design waiting for this feature.

⸻

Genesis Compatibility

Keep this distinction clear:

YM2612 synthesis
= Genesis-compatible core
External FX
= Tetorica / Web Audio processing

A game can use external Reverb or Delay while still using authentic YM2612 synthesis.

However, an FX-processed result is not equivalent to raw Genesis hardware output.

Documentation and UI should not imply otherwise.

⸻

Export Considerations

If future VGM export is implemented:

YM2612 performance events
→ VGM

External Web Audio FX generally cannot be represented as standard Genesis YM2612 VGM commands.

Therefore:

VGM export
= dry YM2612 performance
WAV / rendered audio export
= YM2612 + FX

This distinction should stay explicit.

⸻

Minimal First Version

Recommended initial scope:

FX chain infrastructure
Gain
3-band EQ
Compressor
Filter
Simple Delay
Simple Reverb
Real-time parameter updates
AudioParam automation where applicable
Enable / Disable effect
Reorder effect chain if easy

Noise Gate and Distortion can follow immediately if implementation is small.

⸻

Do Not Do Yet

Avoid expanding scope into:

per-liveLoop FX
one YM2612 per loop
complex routing graphs
large convolution libraries
VST hosting
multi-band mastering
heavy spectral noise reduction
studio-grade mastering suite
automatic mixing

These can be reconsidered later.

⸻

Core Principle

The FX system should feel like:

Connect a YM2612 to a small chain of external effectors.

Not:

Turn Tetorica into a full DAW.

The YM2612 should remain visible and understandable.

The FX layer exists to make it easier to:

* shape presets
* combine sounds
* add space
* make game audio practical
* experiment in the Playground

while preserving lightweight runtime behavior.

⸻

Immediate next steps

1. Add a very small master-bus FX layer on top of `MegaSynth`.
2. Prove the routing with `Gain`.
3. Add `Filter`.
4. Add `Delay`.
5. Add `Reverb`.
6. Expose simple parameter changes from the Playground.

The first milestone is not:

* a polished FX workstation

The first milestone is:

* "YM2612 sound goes through one visible master FX chain, and the result is clearly controllable from browser-side code."
