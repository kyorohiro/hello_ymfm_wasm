# MegaDriveSynth Demo Memo

Last updated: 2026-08-21

## Current target

- Grow `docs/synth/` into an app-level YM2612 learning / play demo.
- Keep `YM2612Synth` as the readable low-level FM control layer.
- Keep `MegaDriveSynth` as the browser/runtime wrapper around:
  - `AudioContext`
  - `AudioWorklet`
  - YM2612 WASM loading
  - worklet initialization

## Current `docs/synth` state

- `docs/synth/index.html`
  provides the page shell and CSS.
- `docs/synth/synth.js`
  currently builds:
  - preset UI
  - operator/common parameter UI
  - envelope/output view
  - a PC-keyboard note grid
- The current keyboard is still a fixed note grid.
  It is built from:
  - `ROW_DEFS`
  - `KEY_LAYOUT`
- It is not yet a true fretboard-state-driven guitar/bass viewport.

## Important current limitation

The desired "guitar-like fretboard" behavior is not fully implemented yet.

In the current `docs/synth/synth.js`, there is not yet a dedicated state for:

- `horizontalFretPosition`
- guitar/bass instrument switching
- visible string-window switching such as:
  - `1-4`
  - `2-5`
  - `3-6`

So before adding more fretboard shortcuts, the demo needs a small fretboard model.

## Next fretboard direction

The keyboard grid should be driven from a real fretboard-style state instead of a fixed precomputed note table.

The intended note calculation should stay simple and explicit:

```txt
note midi =
  stringBaseMidi
  - fretOffsetWithinPcRow
  + horizontalFretPosition
```

And then:

- `midi -> note label`
- `midi -> block / fnum`

should be recomputed from that result.

Important:

- "position" means the starting fret of the visible PC-keyboard viewport
- it is not octave transpose logic
- the 12th fret must not be special-cased as "+1 octave"

## Planned quick fret-position presets

Add small shortcut buttons near the existing keyboard/fretboard controls.

Planned data shape:

```js
const FRET_POSITION_PRESETS = [
  { label: "Open", fret: 0 },
  { label: "5th", fret: 5 },
  { label: "12th", fret: 12 },
];
```

These presets are shortcuts only.

They must update the same `horizontalFretPosition` state used by:

- `ArrowLeft`
- `ArrowRight`

Examples:

- `Open` -> `horizontalFretPosition = 0`
- `5th` -> `horizontalFretPosition = 5`
- `12th` -> `horizontalFretPosition = 12`

After selecting one of these:

- update all visible note labels
- update visible `block / fnum` labels
- update the current fret-position display
- preserve the selected string window
- preserve the selected instrument / tuning

## Arrow key behavior must stay shared

Quick position presets must not create a separate transposition system.

Expected behavior:

```txt
select 12th
-> fret position = 12

press ArrowRight
-> fret position = 13

press ArrowLeft twice
-> fret position = 11
```

If the current position is exactly:

- `0`
- `5`
- `12`

the matching preset button should appear selected.

At positions like `6` or `11`, no preset button needs to appear selected.

## Planned compact UI shape

Keep the current UI concept small and close to the existing keyboard controls.

For Guitar:

```txt
Instrument: [ Guitar | Bass ]

Position: [ Open ] [ 5th ] [ 12th ]
Fret: 5

Strings: [ 1-4 ] [ 2-5 ] [ 3-6 ]
```

For Bass:

```txt
Instrument: [ Guitar | Bass ]

Position: [ Open ] [ 5th ] [ 12th ]
Fret: 5

Strings: 1-4
```

Bass does not need the three vertical string-window buttons.

## Implementation note

This should stay generic enough that more quick positions can be added later without rewriting the fretboard logic.

The important part is:

- centralize the fretboard state
- rebuild visible key labels from that state
- keep shortcuts as thin UI over the same state

## Listener direction

For future controller synchronization, prefer adding observer/listener support on the `MegaSynth` side rather than inside `YM2612Synth`.

Reason:

- `YM2612Synth` should stay as the readable low-level FM control layer
- listener / UI synchronization / recorder-facing notification logic would make `YM2612Synth` heavier
- `MegaSynth` is the better place to expose browser/demo-facing change events

Recommended direction:

- `YM2612Synth`
  - stays thin
  - keeps high-level FM helpers and low-level write helpers
- `MegaSynth`
  - emits events for:
    - `setPreset`
    - `setOperator`
    - `setAlgo`
    - `setPan`
    - `noteOn`
    - `noteOff`
    - optional raw low-level writes later
- UI controllers subscribe to `MegaSynth` events and update themselves from listeners

This should make controller code more reusable across:

- `docs/synth`
- `docs/playground`
- future game/demo embeddings

Important note about low-level writes:

- high-level FM events are easy to synchronize
- low-level `write(...)` / `writeAddress(...)` / `writeData(...)` are harder to interpret
- first listener design should prioritize high-level events
- raw low-level events can be emitted separately later if needed
