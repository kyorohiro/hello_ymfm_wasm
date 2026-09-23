# TODO 2

Last updated: 2026-08-24

## Current missing parts

The project is already usable, but several areas are still incomplete.

The main remaining work is no longer "make it work at all".
It is now mostly:

- filling missing YM2612 features
- polishing Playground and Synth UX
- improving documentation and tutorials
- stabilizing Looper and export-related workflows

## 1. YM2612 / YM2612Synth missing parts

`YM2612Synth` already supports the basic FM voice workflow, but it does not cover the whole YM2612 surface yet.

Main missing or weak areas:

- worklet-side async low-level read path
- busy handling
- timer A / timer B handling
- more readable raw-write / learning-oriented APIs

Already added recently:

- `RS`
- `AM enable`
- `SSG-EG`
- `LFO`
- `PMS / AMS`
- low-level `write(...)`
- low-level `writeAddress(...)` / `writeData(...)`
- direct low-level `read(...)`
- direct low-level `readStatus(...)`
- low-level `onWrite`
- direct low-level `onRead`
- low-level `onIrq`

### Low-level API status

Low-level access is now "mostly usable".

Current shape:

- direct transport:
  - `write(offset, data)`
  - `read(offset)`
  - `readStatus()`
  - `getIrq()`
  - `setHooks({ onWrite, onRead, onIrq })`
- synth low-level layer:
  - `write(port, register, value)`
  - `writeAddress(port, register)`
  - `writeData(value)`
  - `read(offset)` on direct transport
  - `readStatus()` on direct transport
  - `setHooks({ onWrite, onRead, onIrq })`
- worklet transport:
  - `write(...)`
  - `getIrq()`
  - `onIrq`

Main remaining low-level gap:

- `read()` across AudioWorklet is still missing as a synchronous API.
- If needed, this should likely become `readAsync()` instead of pretending to be synchronous.

After that, the next most YM2612-like low-level additions are:

- busy flag exposure / policy
- timer A / timer B exposure
- deciding whether external I/O style hooks are worth surfacing now or later

VGM playback is already practical for part of the Mega Drive / Genesis workflow,
but it is not a full VGM implementation.

Still weak:

- DAC / PCM related paths
- unsupported or partially supported VGM commands
- broader compatibility beyond the current practical subset

## 2. Playground remaining work

`docs/playground` is already useful, but still has important polish work left.

Main remaining items:

- FX tab
- envelope visualization integration
- guitar / fretboard-style input integration
- safer hot reload / live replace behavior
- protection against non-yielding `liveLoop()` code
- stronger autocomplete / discovery
- continued file splitting so `playground.js` does not grow large again

## 3. Synth app remaining work

`docs/synth` is already close to an app, but can still be improved.

Main remaining items:

- stronger 6-channel use
- better preset coverage
- more compact and clearer UI
- clearer learning flow around operator / algorithm / envelope relationships
- more game-usable voice examples

## 4. Looper remaining work

The looper direction is now clearer, but it is not fully finished as a musical tool yet.

Main remaining items:

- better unit management
- improved undo / mute / delete behavior
- more stable playback UX
- export connection
- cleaner handling of event metadata vs recorded loop audio

## 5. Documentation remaining work

Documentation is one of the project goals, so this area is still important.

Main remaining items:

- reorganize tutorials
- refine `ex00`, `ex03`, and related pages
- improve the "how to learn YM2612 here" path
- strengthen FM learning pages
- connect tutorials and Playground more naturally
- improve English / Japanese presentation strategy

## 6. Packaging / release work

Release and itch.io packaging already work much better now,
but release scripts still need occasional maintenance when files move.

Main remaining items:

- reduce file-pickup mistakes in package scripts
- keep release structure understandable
- continue checking standalone app packaging after refactors

## Suggested near-term priorities

If choosing only a few next steps, these are likely the highest value:

1. Fill the most important missing `YM2612Synth` parameters.
2. Improve Playground with FX / envelope / fretboard integration.
3. Reorganize tutorials and YM2612 learning documentation.
4. Stabilize Looper as a more practical musical tool.

## Notes about `docs/issues`

`docs/issues` is starting to grow large.

It may soon help to classify issue notes into groups such as:

- `now`
- `later`
- `memo`
- `done`

Some current notes also overlap and may be merge candidates later.

## Command Editor prototype (Analyzer / Parsed Output)

- Implemented: 100-command paging, register data-byte edits and 0x61 wait edits.
- Original buffer is shared; sparse edits and page offsets are retained, with up to 1,000 undo steps.
- Data blocks have bounded previews and are read only. No full JSON expansion.
- Apply to player reloads the edited VGM for playback/analysis; Save edited VGM downloads it.
- Restore original clears edits; Apply is required to restore the player too.
- Wait edits recalculate total/loop sample counts; fixed byte lengths preserve all offsets and metadata.
- Other wait encodings, command insertion/deletion, address editing and sample editing are not implemented.
- Automated coverage includes paging, large blocks, byte preservation, undo, timing and invalid commands.
- Browser visual/manual playback verification remains pending.

## Playback startup buffering

AudioWorklet output now waits for the existing Worklet queue target before consuming
samples. Short tracks start when the producer sends its end marker and drain fully.
No fade, volume change or leading sample removal is applied. Flushes rebuffer using
the current queue setting. Pause/resume retains the queued position.
Synthetic tests cover startup, short/empty tracks, final samples and queue changes.
Browser listening checks remain pending. Background starvation and abrupt manual
stop/switch clicks are separate follow-up work; ScriptProcessor fallback is unchanged.

### Older-PC playback load

- Effect with Noise Gate at 0 now bypasses the ScriptProcessor gate entirely.
- Live History overview uses one SVG path per channel, preserving pitch history and key-off gaps;
  the trace uses uniform opacity instead of individual fading dots.
- Automated tests cover routing and 10,000-point history DOM size. Older Windows listening/performance
  comparison remains pending. Nonzero Gate still uses ScriptProcessor; per-channel card rebuilding,
  convolution/dynamics overhead and Fretboard rendering remain optimization candidates.

### Retained Pitch / Semantic Keyboard rendering

- Channel-card frames and scroll viewports stay mounted; text and metadata update only when changed.
- Semantic Keyboard creates its 73 keys/labels once per view-mode change. Updates touch only range/current-note layers.
- Pitch retains its scale and SVG history path; history updates replace the path data, not hundreds of SVG elements.
- Pitch history uses a continuous uniform-opacity trace instead of individually fading dots; key-off breaks remain.
- Tests cover retained nodes, unchanged-content skips, view switches, key-off, pitch bounds and keyboard generation counts.
- Comparison on the reported older Windows PC remains pending.
