Title: Playground FX Spec 01

Goal

Add the next small FX routing step for the Playground without redesigning the
current FX system.

This note is intentionally narrow.

It is not a full FX overview.
That already exists in:

* `docs/issues/playground_fx.md`

This memo is only for the next extension candidate:

* `parallel(...)`
* `branch(...)`

---

Current assumption

The current serial FX model stays as-is:

```js
fx.setChain([
  effect1,
  effect2,
  effect3,
]);
```

That behavior is already good enough for many cases, so this spec must not
break it.

---

Why this extension is needed

Some expressive sounds want more than one serial line.

Typical examples:

* dry + wet at the same time
* clean branch + distorted branch
* modulation branch + ambience branch
* low-end-preserving branch + moving effect branch

So the next useful step is not "more single FX units only".

It is a small routing feature.

---

Target API idea

```js
fx.setChain([
  fx.parallel(
    fx.branch(
      fx.distortion({ drive: 2.2, mix: 0.8 }),
      fx.reverb({ mix: 0.08 }),
    ),
    fx.branch(
      fx.flanger({ mix: 0.55 }),
      fx.reverb({ mix: 0.22 }),
    ),
  ),
]);
```

Smaller example:

```js
fx.setChain([
  fx.parallel(
    fx.branch(cleanFilter),
    fx.branch(distortion, delay),
  ),
]);
```

---

Meaning

`branch(...)`

* one serial chain
* same order rule as today's `fx.setChain([...])`

`parallel(...)`

* one input
* split to multiple branches
* process each branch independently
* mix the branch outputs back together

Concept:

```text
input
  ├─ branch A: distortion -> reverb ─┐
  ├─ branch B: flanger -> reverb ────┼─ mix -> output
  └─ branch C: clean filter only ────┘
```

---

What must stay true

* `fx.setChain([a, b, c])` keeps working unchanged
* existing Playground examples stay readable
* `livePrepare(...)` still works naturally
* effect object reuse still works
* this must not turn into a graph editor

---

First-pass non-goals

Do not add these yet:

* arbitrary graph patching
* arbitrary feedback routing
* branch labels
* per-branch gain UI
* visual patch editor
* automatic routing serialization format

The first goal is only a small split / merge helper.

---

Likely implementation shape

The cleanest direction is to make the routing object look like one more FX
unit.

That means the object returned by `parallel(...)` should behave like something
that has:

* `input`
* `output`
* `connect(...)`
* `disconnect()`
* `dispose()`

This keeps `MegaSynth` simple and avoids changing the outer API too much.

---

Why this matters for Tetorica

The chip sound itself comes from YM2612 / PSG, but a lot of emotional texture
can come from browser-side post FX.

This is especially useful for:

* choir-like layering
* guitar-ish chains
* wobble bass with preserved body
* cleaner tails behind harsher lead sounds

---

Suggested order

1. keep the current serial path stable
2. add `parallel(...)` / `branch(...)`
3. add one or two small Playground examples
4. later explain it in docs
