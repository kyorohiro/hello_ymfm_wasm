Implement the next live-coding / FX features for Tetorica FM2612 Playground.

Goal:
Make it possible to reproduce Sonic Pi-style evolving synth effects such as:

* slicer / gated “bububububu” effects
* pitch slides
* filter sweeps
* pan movement
* long evolving notes
* chord-based generative patterns

Do NOT try to make a Sonic Pi compatibility layer.
Keep the existing Tetorica / YM2612 model visible.

Please inspect the current Playground, FX, liveLoop, YM2612Synth, Monaco declarations, and examples before changing anything.

Requirements:

1. Add fx.slicer()

Add a Web Audio effect that periodically gates/modulates gain.

Target API:

const slicer = fx.slicer({
  phase: 0.125,
  mix: 1,
});
fx.setChain([
  slicer,
  fx.reverb({
    room: 0.5,
    mix: 0.3,
  }),
]);

phase is expressed in beats, consistent with Playground BPM.

Examples:

phase: 0.25
phase: 0.125

The slicer must respond to current Playground BPM.

Keep the implementation lightweight.

A basic square/pulse gate is enough initially.
Avoid clicks if practical by using a very short gain ramp around transitions.

Do not introduce unnecessary dependencies.

2. Add a generic time interpolation helper

Add:

await tween(seconds, fn);

where fn(t) receives normalized progress:

t = 0.0 ... 1.0

Example:

await tween(4, (t) => {
  const value = 300 + (6000 - 300) * t;
  // update something
});

Requirements:

* async
* should update often enough for smooth audible parameter changes
* should not busy-loop
* use the existing Playground timing infrastructure where appropriate
* keep implementation simple
* should work inside liveLoop()

Also add:

lerp(a, b, t)

as a small numeric helper if useful.

3. Add note interpolation support

Do NOT interpolate YM2612 fnum directly across BLOCK boundaries.

Add a helper that can interpolate pitch correctly through a continuous representation.

Preferred API:

noteLerp("B2", "E3", t)

It may return:

{ block, fnum }

or another structure that can be passed easily to:

fm.setFrequency(channel, block, fnum);

Reuse the existing note parsing / noteToBlockFnum pitch logic as much as possible.

Do not create a separate conflicting pitch conversion implementation.

Pitch slides should remain musically continuous across octave/BLOCK boundaries.

4. Add chord()

Add a simple chord helper similar in spirit to the existing scale() helper.

Target usage:

chord("B2", "minor");

returns note names.

Minimum chord types:

"major"
"minor"

If the existing note utility architecture makes it easy, also add:

"major7"
"minor7"
"dominant7"

But do not over-engineer this.

It should work naturally with:

choose(chord("B2", "minor"))

Expose through both global Playground helpers and pg.chord.

5. Do NOT add a high-level Sonic Pi-style control() API yet

Do not add:

const p = play(...)
control(p, ...)

and do not change play() to return a voice/controller object.

For now, evolving sounds should be implemented explicitly through existing low-level APIs:

fm.setFrequency(...)
fm.setOperator(...)
fm.setPan(...)

This is intentional because Tetorica should expose the YM2612 rather than hide it.

6. Do NOT add amp to play() for this task

Dynamic loudness can currently be demonstrated using operator TL changes.

Example:

fm.setOperator(CH2, OP4, {
  tl: randInt(8, 70),
});

Do not introduce unrelated play-option abstractions.

7. Add an example inspired by this Sonic Pi structure

Conceptual source:

live_loop :bikes do
  with_synth :dsaw do
    with_fx(:slicer, phase: [0.25,0.125].choose) do
      with_fx(:reverb, room: 0.5, mix: 0.3) do
        start_note = chord([:b1, :b2, :e1, :e2, :b3, :e3].choose, :minor).choose
        final_note = chord([:b1, :b2, :e1, :e2, :b3, :e3].choose, :minor).choose
      end
    end
  end
end

Do NOT copy Sonic Pi syntax.

Create a Tetorica-native example showing:

fm.setPreset(CH2, MEGADRIVE_FM_PRESETS["fm-strings"]);
const slicer = fx.slicer({
  phase: choose([0.25, 0.125]),
  mix: 1,
});
const reverb = fx.reverb({
  room: 0.5,
  mix: 0.3,
});
fx.setChain([slicer, reverb]);
liveLoop("bikes", async () => {
  const roots = ["B1", "B2", "E1", "E2", "B3", "E3"];
  const startNote = choose(chord(choose(roots), "minor"));
  const finalNote = choose(chord(choose(roots), "minor"));
  const start = noteToBlockFnum(startNote);
  fm.setFrequency(CH2, start.block, start.fnum);
  fm.keyOn(CH2);
  await tween(4, (t) => {
    const pitch = noteLerp(startNote, finalNote, t);
    fm.setFrequency(CH2, pitch.block, pitch.fnum);
    // Example of evolving FM brightness.
    fm.setOperator(CH2, OP1, {
      tl: Math.round(50 + (20 - 50) * t),
    });
  });
  fm.keyOff(CH2);
  await sleep(4);
});

Adjust the example to match the actual APIs and current architecture.

If the current FX chain cannot safely change slicer phase per liveLoop iteration, choose the smallest clean design that makes that possible.

8. Monaco / TypeScript declarations

Update Playground Monaco declarations for all new APIs.

Expected declarations approximately:

declare function chord(
  root: string,
  name: string,
): string[];
declare function tween(
  seconds: number,
  fn: (t: number) => void | Promise<void>,
): Promise<void>;
declare function lerp(
  a: number,
  b: number,
  t: number,
): number;
declare function noteLerp(
  from: string,
  to: string,
  t: number,
): {
  block: number;
  fnum: number;
};

And expose corresponding helpers under pg.

Add proper declarations for fx.slicer() based on the existing FX typing style.

9. Tests

Add focused tests for:

* chord("B2", "minor")
* lerp()
* pitch interpolation across an octave/BLOCK boundary
* tween() reaches 0 → 1 and completes
* slicer construction / disposal / chain compatibility
* BPM-derived slicer timing if the architecture allows practical unit testing

Do not make tests timing-fragile.

10. Documentation / examples

Add a short example showing the “bububububu → sweep” style evolving sound.

Explain briefly that:

* YM2612 pitch changes use fm.setFrequency
* tonal brightness can be changed through operator parameters such as TL
* slicer and reverb are Web Audio effects
* this is intentionally lower-level than Sonic Pi

Keep docs concise.

Important constraints:

* Preserve all existing public APIs.
* No unrelated refactoring.
* No Sonic Pi compatibility layer.
* No control() abstraction yet.
* No per-play preset selection.
* Do not add preset to play().
* Do not add amp to play() in this task.
* Keep YM2612 channel limitations visible.
* Reuse existing timing, note conversion, FX, and liveLoop infrastructure where possible.
* Prefer small composable helpers over a large abstraction.

After implementation, report:

1. files changed
2. public APIs added
3. design decisions for slicer timing
4. how note interpolation handles YM2612 BLOCK/FNUM boundaries
5. tests added
6. any limitations discovered