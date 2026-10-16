Tetorica FM2612 Playground YM2612 Tab

2026-10-17: The tab label is now `YM2612`, since this editor controls the
YM2612 specifically. Future chip editors can use their chip names as tab
labels. References to `Operator` below describe the original design; operator
parameter names and internal module names remain unchanged.

The editor now includes a collapsible `Operator envelopes` editor using the
shared Synth drawing module. OP1–OP4 use the same colors as the parameter rows. Changes to AR, D1R,
D2R, SL, RR and TL update the guides, including preset/channel changes and code
updates in Main or Worker mode. The same diagram appears in the TFI/VGI file
editor.

These are schematic register-value guides, not measured EG levels or a timeline
in seconds. Note pitch, RS and SSG-EG affect actual chip behavior. Audio output
remains available in the Audio panel. The guide creates no audio nodes, draws
only after relevant changes, and defers drawing while collapsed, offscreen or
hidden. Multiple changes in one frame share a single redraw.

Mouse editing is inspired by h1romas4's
[mmlx-lsp FM Voice panel](https://github.com/h1romas4/mmlx-lsp)
([VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=h1romas4.mmlx-lsp)).
Choose OP1–OP4 (initially OP4), then drag its four labeled points:

| Point | Horizontal drag | Vertical drag |
| --- | --- | --- |
| AR / TL | AR, 0–31 | TL, 0–127 |
| D1R / SL | D1R, 0–31 | SL, 0–15 |
| D2R | D2R, 0–31 | — |
| RR | RR, 0–15 | — |

Moving a rate point left increases the rate, shortening its illustrated stage.
The stages use separate relative ranges so every integer, including zero, stays
reachable. Levels are schematic, with a visible minimum peak so a muted operator
can still be edited. This changes the guide's editing geometry, not chip EG
behavior; standalone Synth's original drawing is preserved.

Focused points support arrow keys: left/right changes rate, up/down changes level
(or rate for D2R/RR). Dragging preserves keyboard audition focus. Pointer capture
keeps drags working outside the plot and clamps values to chip ranges. Closing,
hiding, losing capture/focus, changing channel/preset/file or disposing the editor
ends the gesture. Plain clicks do not change values. Pointer moves coalesce into
one parameter patch per animation frame, with a final pending move committed on
release. Numeric and graphical edits share the same partial `setOperator` path;
the selected operator alone changes, without key-on, phase or envelope resets.
TFI/VGI edits use the existing file save and Sync/Revert paths.

Goal

Add an `Operator` tab to `docs/playground`.

The purpose is:

* keep `playground` as the live-coding page
* add a small operator control panel without turning `playground` into all of `docs/synth`
* let users hear code changes and manual FM parameter changes side by side
* keep the control surface readable as a direct view of `fm.setOperator()`, `fm.setAlgo()`, `fm.setPan()`, and `fm.setPreset()`

The intended bottom tabs become:

* `Console`
* `Helpers`
* `Operator`

⸻

Why this is useful

`playground` is already strong for:

* `pg.play(...)`
* `liveLoop(...)`
* `fm` low-level control
* `fx` control
* Monaco completion

But when someone is still learning YM2612 sound design, typing every parameter by hand is slower than moving a few controls.

So the `Operator` tab should become:

* a quick FM sound-design panel
* a visual companion to the code
* a bridge between `docs/synth` and `docs/playground`

This should make the page useful for both:

* "I want to try a few live loops quickly"
* "I want to shape the current YM2612 voice while listening"

⸻

Important design choice

Do not move all of `docs/synth` into `playground`.

Instead:

* reuse the existing `docs/synth` UI look and control style
* but extract only the operator-control part

So:

* UI style can stay close to `docs/synth`
* implementation should be split into a smaller module for `playground`

This keeps responsibilities clear.

`docs/synth`
  = standalone instrument / app

`docs/playground`
  = live coding app

`Operator` tab
  = shared control panel for YM2612 voice editing

⸻

What should be reused from `docs/synth`

Safe to reuse:

* operator parameter controls
* algorithm display / selection
* pan controls
* preset controls if small enough
* compact layout ideas already proven in `docs/synth`

Avoid bringing in directly:

* keyboard / fretboard UI
* looper UI
* TFI import/export UI
* broader instrument app state

The operator tab should stay focused.

⸻

Minimal first version

The first `Operator` tab should control one current FM voice only.

Recommended first scope:

* current channel selector
* preset selector
* algorithm selector
* feedback selector
* pan left / right toggle
* OP1
* OP2
* OP3
* OP4

Per operator:

* `DT`
* `MULTI`
* `TL`
* `AR`
* `D1R`
* `D2R`
* `SL`
* `RR`

This corresponds directly to current `YM2612Synth` public API.

Optional next step:

* `RS`
* `SSG-EG`

These are already known missing/advanced parameters in some other docs.

⸻

What the tab should call

The tab should not write to random internal state.

It should call the public FM API directly:

* `fm.setPreset(channel, preset)`
* `fm.setOperator(channel, operator, params)`
* `fm.setAlgo(channel, algorithm, feedback)`
* `fm.setPan(channel, left, right)`

This is important because:

* behavior stays readable
* recording hooks in `MegaSynth` can still observe those calls
* future export / replay / recording features stay compatible

The `Operator` tab should be a UI for existing API calls, not a separate synth engine.

⸻

State synchronization

This is the main tricky part.

There are two sources of change:

1. code in the editor
2. manual changes in the `Operator` tab

The first version does not need full two-way synchronization.

Recommended rule for first version:

* the `Operator` tab owns its own displayed state
* user changes in the tab immediately call `fm.*`
* code changes are not automatically reflected back into the tab unless explicitly reset/applied

In other words, first version can be:

* "tab sends writes outward"
* not yet
* "tab perfectly mirrors every code-driven change"

This is much simpler and still useful.

Possible later improvement:

* add `Apply to FM`
* add `Read current preset`
* add `Reset tab from preset`
* add `Capture current tab state as code snippet`

⸻

Suggested file split

Recommended structure:

* `docs/playground/index.html`
  * tab container only
* `docs/playground/playground.js`
  * live coding runtime
  * tab switching
  * passes `fm` / presets / current channel hooks into operator panel
* `docs/playground/playground_operator_tab.js`
  * operator tab UI logic only
* optional shared helpers later
  * parameter definitions
  * rendering helpers
  * compact control widgets

This keeps `playground.js` from growing too large.

⸻

Suggested first implementation steps

1. Add the `Operator` tab beside `Console` and `Helpers`.
2. Create `docs/playground/playground_operator_tab.js`.
3. Render one compact panel using the existing `docs/synth` look.
4. Start with one selected channel.
5. Wire operator controls to:
   * `fm.setOperator(...)`
   * `fm.setAlgo(...)`
   * `fm.setPan(...)`
6. Add preset selection.
7. Only after that, consider any synchronization with code-driven changes.

⸻

Non-goals for the first version

Do not try to solve all of these immediately:

* full bidirectional sync with editor code
* keyboard instrument UI inside `playground`
* looper integration
* TFI management
* envelope visualization
* operator graph / routing diagram

Those can come later.

The first target is simply:

* live code on top
* compact FM operator controls below
* both talking to the same `fm`

⸻

Why this fits the project

This matches the current project direction well:

* `docs/synth`
  = playable app
* `docs/playground`
  = programmable app
* tutorials
  = explain YM2612 / ymfm / Web embedding

An `Operator` tab in `playground` makes the coding page more musically useful without losing the low-level YM2612 learning value.
