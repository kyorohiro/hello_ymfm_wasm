Tetorica FM2612 Playground FX Tab

Goal

Add an `FX` tab to `docs/playground`.

The purpose is:

* keep `playground` as the live-coding page
* let users manipulate current FX parameters without rewriting code every time
* treat FX as a visual companion to `fx.setChain([...])`
* make real-time filter / EQ / delay / reverb tweaking easier while loops are running

The intended bottom tabs become:

* `Console`
* `Helpers`
* `Operator`
* `FX`

⸻

Why this is useful

`playground` is already strong for:

* `pg.play(...)`
* `liveLoop(...)`
* `fm` control
* `fx` control
* Monaco completion
* `Operator` tab for FM voice editing

But FX values are still mostly code-first.

That means changing something like:

* `filter.cutoff`
* `filter.q`
* `eq.bass`
* `delay.mix`
* `reverb.tone`

usually requires editing code and re-running it.

An `FX` tab would make it possible to:

* code the chain structure
* tweak the current chain by hand
* hear the result immediately
* later copy the final values back into code

So the `FX` tab should become:

* a quick sound-shaping panel for post-YM2612 processing
* a bridge between code and real-time listening
* the FX-side equivalent of the `Operator` tab

⸻

Important design choice

Do not make the `FX` tab invent a separate FX engine.

Instead:

* reuse the existing `fx.gain(...)`, `fx.eq(...)`, `fx.filter(...)`, `fx.delay(...)`, `fx.reverb(...)`
* show and control the current effect objects already created by code

This is important because the page should stay readable as:

code
  ↓
FX objects
  ↓
UI controls for those same FX objects

not:

code
  ↓
one FX system

UI
  ↓
another FX system

⸻

Mental model

The `FX` tab should reflect:

YM2612
  ↓
master FX chain
  ↓
output

This is the same idea already used in `web/megasynth.js`.

The tab should not imply:

* per-operator effects
* per-channel effects inside YM2612
* chip-internal reverb/delay

FX remain external post-processing.

⸻

What should be controlled

First version should focus only on parameters that already exist in `web/megasynth_fx.js`.

Recommended first scope:

Gain

* `gain.gain`

EQ

* `eq.bass`
* `eq.mid`
* `eq.treble`

Filter

* `filter.cutoff`
* `filter.q`

Delay

* `delay.time`
* `delay.feedback`
* `delay.mix`

Reverb

* `reverb.mix`
* `reverb.tone`

It is enough if these appear only when the effect exists in the current chain.

⸻

What should not be part of the first version

Do not do all of these immediately:

* drag-and-drop chain reordering
* arbitrary graph patching
* effect creation purely from the UI
* deleting effects from the chain in the first pass
* per-loop FX routing
* effect automation lanes
* preset banks for FX only

The first target is:

* code creates the chain
* tab sees the current chain
* tab tweaks the current chain

⸻

Current source of truth

The current source of truth for FX is still code:

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

The tab should read from the objects currently in the chain and manipulate those same objects.

This means the practical question is:

* how does the UI discover the current chain and its effect objects?

⸻

Recommended first synchronization rule

Like the first `Operator` tab, the first `FX` tab does not need perfect bidirectional sync with every code path.

Recommended first rule:

* when `fx.setChain([...])` runs, store the current chain for the tab
* the tab renders controls for the current chain
* UI changes call `.set(...)` or `.rampTo(...)` on those current effect objects
* code changes replace the chain, and the tab redraws itself from the new chain

This is much simpler than trying to understand every variable name in code forever.

Possible later improvement:

* detect effect labels from `mainFx.filter` / `mainFx.eq`
* show names from `livePrepare()` return objects
* capture UI state back into code snippets

⸻

Suggested practical approach

The most realistic first implementation is:

1. extend the existing `fx` API wiring in `docs/playground/playground.js`
2. whenever `fx.setChain([...])` is called, notify the `FX` tab
3. the `FX` tab stores the active chain
4. it renders one control group per effect

This avoids requiring AST-level code parsing.

The tab can use effect object fields directly:

* if an effect has `gain`
* render a gain control
* if an effect has `bass`, `mid`, `treble`
* render EQ controls
* if an effect has `cutoff`, `q`
* render filter controls

Because current FX units already expose parameter objects such as:

* `.set(...)`
* `.rampTo(...)`
* `.get()`

the UI can bind directly to those methods.

⸻

Suggested file split

Recommended structure:

* `docs/playground/index.html`
  * tab container only
* `docs/playground/playground.js`
  * live coding runtime
  * `fx` chain notifications
  * tab switching
* `docs/playground/playground_fx_tab.js`
  * FX tab UI logic only

This mirrors the `Operator` tab structure.

If the FX tab grows later, shared control helpers can be extracted.

⸻

Suggested first implementation steps

1. Add the `FX` tab beside `Console`, `Helpers`, and `Operator`.
2. Create `docs/playground/playground_fx_tab.js`.
3. Add a small hook so `fx.setChain([...])` notifies the tab.
4. Render one compact group per effect currently in the chain.
5. Support:
   * gain
   * EQ
   * filter
   * delay
   * reverb
6. Make UI changes call the current effect object's parameter controls.
7. Later, consider labels and better code/UI synchronization.

⸻

Possible UI shape

The first UI does not need to be fancy.

A practical first layout could be:

* one section per effect
* effect name badge
* compact controls under it

For example:

* `Gain`
  * `GAIN`
* `EQ`
  * `BASS`
  * `MID`
  * `TREBLE`
* `Filter`
  * `CUTOFF`
  * `Q`
* `Delay`
  * `TIME`
  * `FEEDBACK`
  * `MIX`
* `Reverb`
  * `MIX`
  * `TONE`

This should stay compact enough to fit the current bottom tab area.

⸻

Non-goals for the first version

Do not try to solve all of these immediately:

* parsing all `mainFx` structures from code
* complete code ↔ UI round-trip generation
* effect chain serialization
* live FX presets as a full system
* modulation automation recording

The first target is simply:

* code creates FX
* `FX` tab sees them
* user tweaks them live

⸻

Why this fits the project

This matches the current project direction well:

* `docs/synth`
  = playable instrument-like app
* `docs/playground`
  = programmable live coding app
* `Operator` tab
  = FM voice editing
* `FX` tab
  = post-processing editing

Together they make `playground` feel much closer to a small programmable music tool rather than only a code demo page.
