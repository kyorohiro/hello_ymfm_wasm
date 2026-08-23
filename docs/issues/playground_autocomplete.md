Tetorica FM2612 Playground Autocomplete Notes

Goal

Strengthen code completion in `docs/playground`.

The point is not only "editor convenience".

The Playground should help the user:

* discover what can be written
* avoid small API mistakes
* learn the YM2612 / Playground API while typing
* reach "a few lines and something good happens" faster

The completion system should support both:

* beginner exploration
* repeat live coding

⸻

Current situation

`docs/playground/index.html` currently uses:

* a plain `<textarea>`

and `docs/playground/playground.js` currently provides these important APIs:

* `play()`
* `sleep()`
* `beat()`
* `nextBeat()`
* `setBpm()`
* `liveLoop()`
* `livePrepare()`
* `stopLoop()`
* `stopAllLoops()`
* `stopAll()`
* `scale()`
* `choose()`
* `rand()`
* `randInt()`
* `fm`
* `fx`
* `MEGADRIVE_FM_PRESETS`

That means the "what can I write?" surface is already large enough that
discovery is becoming a real UX problem.

This is now one of the main remaining polish tasks.

⸻

What completion should optimize for

The first priority is not "IDE completeness".

The first priority is:

* show the next useful thing to type
* show the correct argument shape
* show small explanations

Bad completion:

* too many low-value symbols
* raw JavaScript noise
* no indication of which APIs are specific to Tetorica

Good completion:

* `liveLoop(...)`
* `livePrepare(...)`
* `fx.eq(...)`
* `fm.setPreset(...)`
* `filter.cutoff.rampTo(...)`
* `MEGADRIVE_FM_PRESETS["..."]`

with tiny explanations attached.

⸻

Main completion categories

1. Top-level Playground API

Examples:

* `play`
* `sleep`
* `beat`
* `nextBeat`
* `setBpm`
* `liveLoop`
* `livePrepare`
* `stopLoop`
* `stopAllLoops`
* `stopAll`
* `scale`
* `choose`
* `rand`
* `randInt`
* `fm`
* `fx`
* `MEGADRIVE_FM_PRESETS`

This is the most important layer.

If this layer is easy to discover, the Playground becomes much more usable.

⸻

2. Snippet-like completion

Completion should not only insert names.

It should often insert useful shapes.

Examples:

```js
liveLoop("lead", async () => {
  await play("E4", { channel: 0, duration: 0.08 });
  await beat(0.5);
});
```

```js
const mainFx = await livePrepare("main-fx", async ({ fx }) => {
  const eq = fx.eq({
    bass: 0,
    mid: 0,
    treble: 0,
  });

  return { eq };
});
```

```js
fm.setOperator(0, 4, {
  dt: 0,
  multi: 1,
  tl: 8,
  ar: 22,
  d1r: 6,
  d2r: 3,
  sl: 3,
  rr: 8,
});
```

This kind of completion is more valuable than simple identifier completion.

⸻

3. Object-field completion

Important object literals:

* `play("E4", { ... })`
* `fx.eq({ ... })`
* `fx.filter({ ... })`
* `fx.delay({ ... })`
* `fx.reverb({ ... })`
* `fm.setOperator(..., { ... })`

Examples:

For `play(..., { ... })`:

* `channel`
* `duration`
* `preset`

For `fx.eq({ ... })`:

* `bass`
* `mid`
* `treble`

For `fx.filter({ ... })`:

* `type`
* `cutoff`
* `q`

For `fx.delay({ ... })`:

* `time`
* `feedback`
* `mix`

For `fx.reverb({ ... })`:

* `mix`
* `tone`
* maybe later `seconds`
* maybe later `decay`

For `fm.setOperator(..., { ... })`:

* `dt`
* `multi`
* `tl`
* `ar`
* `d1r`
* `d2r`
* `sl`
* `rr`

⸻

4. Value completion

Some values should also complete.

Examples:

* preset names inside `MEGADRIVE_FM_PRESETS["..."]`
* note names like `C4`, `D#4`, `E2`
* scale names like:
  * `majorPentatonic`
  * `minorPentatonic`
  * `major`
  * `minor`
* filter types like:
  * `lowpass`
  * `highpass`
  * `bandpass`

These are not required for v1, but they have high practical value.

⸻

5. Explanation-oriented completion

Completion items should carry a short hint when possible.

Examples:

* `beat(0.5)`:
  wait half a beat using the shared music clock
* `livePrepare(...)`:
  prepare and reuse live state across runs
* `fx.setChain([...])`:
  replace the current master FX chain
* `filter.cutoff.rampTo(...)`:
  smoothly move filter cutoff
* `fm.setPreset(...)`:
  apply a YM2612 preset to one channel

These hints are especially important because the Playground is also a learning tool.

⸻

Recommended implementation stages

Stage 1: Keep `<textarea>`

Do not replace the editor immediately.

Start with:

* a small completion dictionary
* a snippet dictionary
* a side-panel / popup candidate list
* click-to-insert snippets

This keeps implementation cost small.

Possible features in Stage 1:

* helper cards that insert code
* prefix-based suggestion list
* API group list:
  * Loop
  * FX
  * FM
  * Utility

This is a practical first milestone.

⸻

Stage 2: Context-aware lightweight completion

Still on top of `<textarea>`, add:

* detect current token near the caret
* suggest top-level APIs
* detect `fx.` and show:
  * `eq`
  * `filter`
  * `delay`
  * `reverb`
  * `setChain`
  * `clear`
* detect `fm.` and show:
  * `setPreset`
  * `setOperator`
  * `setAlgo`
  * `setPan`
  * `noteOn`
  * `noteOff`
* detect `.rampTo(` and show parameter helpers

This will already feel much better than the current free typing experience.

⸻

Stage 3: Snippet-first guided coding

This stage is especially valuable for beginners.

Examples of snippet groups:

Loop:

* `liveLoop`
* `livePrepare`
* `beat`
* `nextBeat`

FX:

* `fx.eq`
* `fx.filter`
* `fx.delay`
* `fx.reverb`
* `fx.setChain`

FM:

* `fm.setPreset`
* `fm.setOperator`
* `fm.setAlgo`
* `fm.noteOn`
* `fm.noteOff`

Music:

* `play`
* `scale + choose`

This stage helps the user start from templates instead of blank text.

⸻

Stage 4: Monaco Editor or similar

If the Playground grows further, moving to Monaco becomes attractive.

Benefits:

* built-in completion UI
* hover help
* snippet support
* syntax highlighting
* possible JSDoc-driven hints
* future diagnostics

However, Monaco adds cost:

* larger payload
* more implementation work
* more UI complexity

So the migration should happen only if the lightweight approach becomes limiting.

⸻

Recommended current direction

For now, prefer:

* Stage 1
* then Stage 2

That means:

1. stay with `<textarea>`
2. add a small structured completion dataset
3. add click-to-insert snippets
4. add prefix-based suggestions for top-level APIs
5. add `fx.` / `fm.` / object-field aware suggestions

This will likely give a large UX improvement without needing a big editor rewrite.

⸻

Suggested completion data shape

Possible structure:

```js
const COMPLETIONS = [
  {
    label: "liveLoop",
    kind: "snippet",
    insertText: `liveLoop("lead", async () => {\n  await play("E4", { channel: 0, duration: 0.08 });\n  await beat(0.5);\n});`,
    detail: "Create a repeating named live loop.",
    group: "Loop",
  },
];
```

Possible object-field completions:

```js
const OBJECT_COMPLETIONS = {
  "fx.eq": [
    { label: "bass", detail: "Low shelf gain in dB." },
    { label: "mid", detail: "Mid peaking gain in dB." },
    { label: "treble", detail: "High shelf gain in dB." },
  ],
};
```

This can later be adapted to Monaco if needed.

⸻

Important Playground-specific completions

Highest-priority snippets:

* `liveLoop("lead", async () => { ... })`
* `const mainFx = await livePrepare("main-fx", async ({ fx }) => { ... })`
* `fx.setChain([ ... ])`
* `fm.setPreset(0, MEGADRIVE_FM_PRESETS["one-op-basic"])`
* `fm.setOperator(0, 4, { ... })`
* `filter.cutoff.rampTo(...)`
* `eq.bass.rampTo(...)`

These reflect the actual current strengths of the Playground.

⸻

Immediate next steps

1. Create `docs/playground/playground_completions.js`
   for static completion/snippet data.
2. Add one small snippet panel in the Playground UI.
3. Add click-to-insert for:
   * `liveLoop`
   * `livePrepare`
   * `fx.eq`
   * `fx.filter`
   * `fm.setOperator`
4. Add simple prefix-based suggestions around the caret.
5. Decide later whether to stay lightweight or adopt Monaco.

The first milestone is not:

* full IDE behavior

The first milestone is:

* "the user can discover and insert the right Tetorica APIs quickly without leaving the Playground."
